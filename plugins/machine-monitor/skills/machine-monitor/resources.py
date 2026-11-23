#!/usr/bin/env python3
# What loads this Linux machine now: machine totals, optional job queues, and the CPU and memory of each
# owner of the machine, with every Claude session and its processes.
# Usage: resources.py [-i SECONDS] [-a] [--json] [--lang en|ru]
#   reads /proc, /sys/fs/cgroup (cgroup v2) and /sys/class/hwmon only; needs no root and changes nothing.
#   --json prints the report as one JSON object, for a program to read (the machine-monitor pane).
# Optional settings: $XDG_CONFIG_HOME/machine-monitor/config.json (default ~/.config/machine-monitor/config.json):
#   {"language": "en" | "ru",
#    "apps": {"<unit or app id>": "<name to show>"},
#    "queues": {"command": ["<program>", "<args>"...], "lock": "<lock file path with {queue}>"}}
#   The queues command prints one line per queue: "<name>: free", or "<name>: <job>, since <date> <HH:MM>".
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

CG = "/sys/fs/cgroup"
HZ = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100

CONFIG = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "machine-monitor", "config.json")

WORDS = {
    "en": {"of": "of", "disk": "disk", "queues": "queues", "free": "free", "since": "since", "who": "WHO",
           "cores": "CORES", "what": "WHAT", "sessions": "sessions", "window": "window", "its sessions": "its sessions",
           "ssh": "SSH or terminal login", "container": "container", "docker": "Docker: {n} containers",
           "works": "working", "waits": "waiting for you", "idles": "idle", "in background": "in the background",
           "no project": "no project", "min": "min", "h": "h", "d": "d", "daemon": "Docker (the daemon)",
           "indexer": "GNOME file indexer", "desktop": "GNOME desktop"},
    "ru": {"of": "из", "disk": "диск", "queues": "очереди", "free": "свободна", "since": "с", "who": "КТО",
           "cores": "ЯДЕР", "what": "ЧТО", "sessions": "сессий", "window": "окно", "its sessions": "его сессии",
           "ssh": "вход по SSH или в терминал", "container": "контейнер", "docker": "Docker: {n} контейнеров",
           "works": "работает", "waits": "ждёт вас", "idles": "простаивает", "in background": "в фоне",
           "no project": "без проекта", "min": "мин", "h": "ч", "d": "дн", "daemon": "Docker (сам демон)",
           "indexer": "индексатор файлов GNOME", "desktop": "рабочий стол GNOME"},
}
W = WORDS["en"]


def load_config():
    # The person's settings, or none; a broken file counts as none.
    try:
        with open(CONFIG) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def unsupported():
    # Why this machine cannot be read, or "" when it can.
    if not sys.platform.startswith("linux"):
        return f"machine-monitor reads Linux only; this is {sys.platform}"
    if not os.path.isfile(f"{CG}/cgroup.controllers"):
        return "machine-monitor needs cgroup v2 at /sys/fs/cgroup"
    return ""


def read(path, default=""):
    # A file's text, or the default when it is gone or unreadable.
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return default


def owners():
    # Cgroups that stand for one owner: system services and scopes, user units, login sessions.
    found = []
    for root, dirs, _ in os.walk(CG):
        rel = os.path.relpath(root, CG)
        name = os.path.basename(root)
        if rel == "." or not (name.endswith(".service") or name.endswith(".scope")):
            continue
        if name.startswith("user@"):
            continue
        found.append(rel)
        dirs[:] = []
    return found


def cg_sample(rel):
    # CPU microseconds used so far and memory without the file cache, for one cgroup.
    usec = 0
    for line in read(f"{CG}/{rel}/cpu.stat").splitlines():
        if line.startswith("usage_usec "):
            usec = int(line.split()[1])
    stat = dict(line.split() for line in read(f"{CG}/{rel}/memory.stat").splitlines() if line)
    cur = int(read(f"{CG}/{rel}/memory.current", "0") or 0)
    mem = cur - int(stat.get("file", 0)) + int(stat.get("shmem", 0))
    return usec, max(mem, 0)


def procs():
    # Every process: parent, CPU ticks so far, anonymous memory, name, command line, working folder, cgroup.
    out = {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        raw = read(f"/proc/{pid}/stat")
        if not raw:
            continue
        rest = raw[raw.rfind(")") + 2:].split()
        status = read(f"/proc/{pid}/status")
        anon = swap = 0
        for line in status.splitlines():
            if line.startswith("RssAnon:"):
                anon = int(line.split()[1]) * 1024
            if line.startswith("VmSwap:"):
                swap = int(line.split()[1]) * 1024
        try:
            cwd = os.readlink(f"/proc/{pid}/cwd")
        except OSError:
            cwd = ""
        cg = read(f"/proc/{pid}/cgroup").strip().split("::", 1)[-1].lstrip("/")
        out[int(pid)] = {
            "ppid": int(rest[1]),
            "ticks": int(rest[11]) + int(rest[12]),
            "anon": anon,
            "swap": swap,
            "comm": raw[raw.find("(") + 1:raw.rfind(")")],
            "cmd": read(f"/proc/{pid}/cmdline").replace("\0", " ").strip(),
            "cwd": cwd,
            "cg": cg,
        }
    return out


def docker_names():
    # Container id to name, when this process may talk to Docker; empty otherwise.
    try:
        res = subprocess.run(["docker", "ps", "--no-trunc", "--format", "{{.ID}} {{.Names}}"],
                             capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if res.returncode != 0:
        return {}
    return dict(line.split(" ", 1) for line in res.stdout.splitlines() if " " in line)


# Names a person understands for common units and apps; the config's "apps" adds to them and wins.
APPS = {}


def default_apps():
    return {"com.anthropic.Claude": "Claude Desktop", "com.google.Chrome": "Google Chrome",
            "telegram-desktop": "Telegram Desktop", "org.gnome.Shell": W["desktop"],
            "docker": W["daemon"], "containerd": "containerd (Docker)",
            "localsearch-3": W["indexer"], "tracker-miner-fs-3": W["indexer"]}


def label(rel, names, procs_in):
    # A name a person understands for an owner cgroup: the app, the service or the container.
    name = os.path.basename(rel)
    if name.startswith("docker-") and name.endswith(".scope"):
        cid = name[len("docker-"):-len(".scope")]
        if cid in names:
            return W["container"] + " " + names[cid]
        main = min(procs_in) if procs_in else None
        cmd = procs_in[main]["cmd"].split(" ")[0] if main else ""
        return W["container"] + " " + (os.path.basename(cmd) or cid[:12])
    if name.startswith("session-") and name.endswith(".scope"):
        return W["ssh"] + " " + name[len("session-"):-len(".scope")]
    if name.startswith("app-") and name.endswith(".scope"):
        core = name[len("app-"):-len(".scope")]
        launched = core.startswith("gnome-")
        core = core.removeprefix("gnome-").rsplit("-", 1)[0]
        app = APPS.get(core, core.split(".")[-1])
        if core == "com.anthropic.Claude":
            return app + (f": {W['window']}" if launched else f": {W['its sessions']}")
        return app
    if name.startswith("snap.") and name.endswith(".scope"):
        snap = name.split(".")[1]
        return APPS.get(snap, snap)
    unit = name.removesuffix(".service").split("@")[0]
    return APPS.get(unit, unit)


def is_session(p):
    # A Claude session process: Remote Control's child with a session id, Desktop's over SSH, or a claude in a terminal.
    exe = p["cmd"].split(" ", 1)[0]
    if "remote-control" in p["cmd"]:
        return False
    return ("--session-id" in p["cmd"] or os.path.basename(exe) == "claude" or "/claude/versions/" in exe
            or "/.claude/remote/ccd-cli/" in exe)


# Session titles from claude.ai, when something keeps them here; the local transcripts otherwise.
TITLES = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "machine-monitor", "titles.json")


def session_meta(pid):
    # The local record of a session process: ids, folder, status and when it changed.
    import json
    try:
        return json.loads(read(os.path.expanduser(f"~/.claude/sessions/{pid}.json"), "{}"))
    except ValueError:
        return {}


def cached(meta, titles):
    # The claude.ai record of a session from the cache: title, board bucket and what it asks of the user.
    rec = titles.get(meta.get("bridgeSessionId"), {})
    return {"title": rec} if isinstance(rec, str) else rec


def session_title(meta, titles):
    # A session's title: from the cache of claude.ai titles, else the title in its local transcript, else "".
    import json
    if cached(meta, titles).get("title"):
        return cached(meta, titles)["title"]
    sid, cwd = meta.get("sessionId"), meta.get("cwd", "")
    if not sid:
        return ""
    folder = "".join(c if c.isalnum() else "-" for c in cwd)
    path = os.path.expanduser(f"~/.claude/projects/{folder}/{sid}.jsonl")
    try:
        with open(path, "rb") as f:
            f.seek(max(0, os.path.getsize(path) - 2**20))
            tail = f.read().decode("utf-8", "replace")
    except OSError:
        return meta.get("name", "") if meta.get("nameSource") != "derived" else ""
    m = re.findall(r'"customTitle":"((?:[^"\\]|\\.)*)"', tail)
    if m:
        return json.loads(f'"{m[-1]}"')
    return meta.get("name", "") if meta.get("nameSource") != "derived" else ""


def ago(ms):
    # Time since a moment in milliseconds, as minutes, hours or days.
    sec = max(0, time.time() - ms / 1000)
    if sec < 3600:
        return f"{int(sec // 60)} {W['min']}"
    if sec < 86400:
        return f"{int(sec // 3600)} {W['h']}"
    return f"{int(sec // 86400)} {W['d']}"


def session_state(meta, titles):
    # What a session does now: works, waits for the user, or idles since when.
    if meta.get("status") == "busy":
        return W["works"]
    rec = cached(meta, titles)
    if rec.get("bucket") == "blocked":
        return W["waits"] + (f": {rec['needs']}" if rec.get("needs") else "")
    if meta.get("statusUpdatedAt"):
        return W["idles"] + " " + ago(meta["statusUpdatedAt"])
    return ""


def where(cwd, sid, title):
    # A session's place as short text: its title, or its worktree, and its project.
    home = os.path.expanduser("~")
    path = cwd.replace(home, "~", 1)
    if "/.config/Claude/scratch-workspaces/" in path:
        proj = W["no project"]
    elif "/.claude/worktrees/" in path:
        proj = os.path.basename(path.split("/.claude/worktrees/", 1)[0])
    else:
        proj = os.path.basename(path) or path
    if title:
        room = 38 - len(proj) - 3
        return f"{title if len(title) <= room else title[:room - 1] + '…'} ({proj})"
    return f"{proj}, worktree …{sid}" if "/.claude/worktrees/" in path and sid else proj


def mb(n):
    # Bytes as megabytes or gigabytes.
    return f"{n / 2**30:.1f}G" if n >= 2**30 else f"{n / 2**20:.0f}M"


def temp_values():
    # The CPU temperatures the kernel reports, as (kind, degrees).
    out = []
    for hw in sorted(os.listdir("/sys/class/hwmon")):
        base = f"/sys/class/hwmon/{hw}"
        kind = {"k10temp": "CPU", "coretemp": "CPU"}.get(read(f"{base}/name").strip())
        val = read(f"{base}/temp1_input").strip()
        if kind and val:
            out.append((kind, int(val) // 1000))
    return out


def temps():
    # The CPU, disk and GPU temperatures the kernel reports.
    return " ".join(f"{kind} {deg}°" for kind, deg in temp_values())


def machine_data():
    # Load, memory, swap and disk of the whole machine, as numbers.
    load = read("/proc/loadavg").split()[:3]
    mi = {k: int(v.split()[0]) * 1024 for k, v in (l.split(":", 1) for l in read("/proc/meminfo").splitlines())}
    disk = shutil.disk_usage("/")
    return {"host": os.uname().nodename, "load": [float(x) for x in load], "cpus": os.cpu_count(),
            "ram_used": mi["MemTotal"] - mi["MemAvailable"], "ram_total": mi["MemTotal"],
            "swap_used": mi["SwapTotal"] - mi["SwapFree"], "disk_used": disk.used, "disk_total": disk.total,
            "temps": [{"kind": kind, "degrees": deg} for kind, deg in temp_values()]}


def machine():
    # Load, memory, swap and disk of the whole machine.
    m = machine_data()
    return (f"{m['host']}  load {read('/proc/loadavg').split()[0]} {W['of']} {m['cpus']}  RAM {mb(m['ram_used'])}/{mb(m['ram_total'])}"
            f"  swap {mb(m['swap_used'])}  {W['disk']} {mb(m['disk_used'])}/{mb(m['disk_total'])}  {temps()}")


def main():
    ap = argparse.ArgumentParser(description="What loads this Linux machine now.")
    ap.add_argument("-i", type=float, default=1.0, help="seconds between the two CPU samples")
    ap.add_argument("-a", action="store_true", help="show every owner of the machine, not only Claude")
    ap.add_argument("--json", action="store_true", help="print the report as one JSON object")
    ap.add_argument("--lang", choices=sorted(WORDS), help="the language of the report; default: the config's, else en")
    args = ap.parse_args()

    global W
    config = load_config()
    W = WORDS.get(args.lang or str(config.get("language", "en")), WORDS["en"])
    APPS.update(default_apps())
    if isinstance(config.get("apps"), dict):
        APPS.update({str(k): str(v) for k, v in config["apps"].items()})

    reason = unsupported()
    if reason:
        print(json.dumps({"unsupported": reason}) if args.json else reason)
        sys.exit(3)
    # The report for --json, filled where the text is printed.
    report = {"machine": machine_data() if args.json else None, "queues": [], "owners": [], "docker": None,
              "language": "ru" if W is WORDS["ru"] else "en"}

    rels = owners()
    c0 = {r: cg_sample(r) for r in rels}
    p0 = procs()
    t0 = time.monotonic()
    time.sleep(args.i)
    c1 = {r: cg_sample(r) for r in rels if os.path.isdir(f"{CG}/{r}")}
    p1 = procs()
    dt = time.monotonic() - t0
    names = docker_names()
    try:
        titles = json.loads(read(TITLES, "{}"))
    except ValueError:
        titles = {}

    # CPU in cores per process, from the two samples.
    cpu = {pid: (p["ticks"] - p0[pid]["ticks"]) / HZ / dt for pid, p in p1.items() if pid in p0}
    kids = {}
    for pid, p in p1.items():
        kids.setdefault(p["ppid"], []).append(pid)

    def tree(pid):
        # The process and all its descendants.
        out, todo = [], [pid]
        while todo:
            cur = todo.pop()
            out.append(cur)
            todo.extend(kids.get(cur, []))
        return out

    # Each Claude session process with its title, for the rows and for the queue holders.
    owner_of = {}
    for pid, p in p1.items():
        if is_session(p) and not is_session(p1.get(p["ppid"], {"cmd": ""})):
            for x in tree(pid):
                owner_of[x] = pid

    def holder(q):
        # Who holds a queue: the session that started its job, else the unit it runs in.
        for pid, p in p1.items():
            if lock and p["cmd"].startswith("flock") and lock.replace("{queue}", q) in p["cmd"]:
                if pid in owner_of:
                    s = owner_of[pid]
                    return "«" + (session_title(session_meta(s), titles) or where(p1[s]["cwd"], "", "")) + "»"
                return label(p["cg"], names, {})
        return ""

    out = [machine()]
    queues = config.get("queues") if isinstance(config.get("queues"), dict) else {}
    command = [os.path.expanduser(str(x)) for x in queues.get("command", [])] if isinstance(queues.get("command"), list) else []
    lock = str(queues.get("lock", ""))
    if command and os.access(command[0], os.X_OK):
        try:
            res = subprocess.run(command, capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.TimeoutExpired):
            res = subprocess.CompletedProcess(command, 1, "", "")
        parts = []
        for line in res.stdout.splitlines():
            q, _, rest = line.partition(": ")
            if rest == "free":
                parts.append(f"{q} {W['free']}")
                report["queues"].append({"name": q, "free": True})
                continue
            m = re.search(r"(\S+), since \S+ (\d+:\d+)", rest)
            job = os.path.basename(m.group(1)) if m else rest
            who = holder(q)
            parts.append(f"{q} {job}{' — ' + who if who else ''}{' ' + W['since'] + ' ' + m.group(2) if m else ''}")
            report["queues"].append({"name": q, "free": False, "job": job, "holder": who.strip("«»"),
                                     "since": m.group(2) if m else ""})
        if parts:
            out.append(f"{W['queues']}: " + ", ".join(parts))
    out.append("")
    if not args.json:
        print("\n".join(out))

    rows = []
    for r in c1:
        if r not in c0:
            continue
        cores = (c1[r][0] - c0[r][0]) / 1e6 / dt
        rows.append((cores, c1[r][1], r))
    rows.sort(reverse=True)

    if not args.json:
        print(f"{W['who']:<42} {W['cores']:>5} {'RAM':>6}  {W['what']}")
    dock = [0.0, 0, 0]
    for cores, mem, r in rows:
        members = [pid for pid, p in p1.items() if p["cg"] == r]
        sessions = [pid for pid in members if is_session(p1[pid]) and not is_session(p1.get(p1[pid]["ppid"], {"cmd": ""}))]
        unit = label(r, names, {pid: p1[pid] for pid in members})
        if not args.a and not sessions and not unit.startswith(("Claude", "claude-rc")):
            continue
        if not args.a and os.path.basename(r).startswith("docker-") and cores < 0.1:
            dock[0] += cores
            dock[1] += mem
            dock[2] += 1
            continue
        if not args.a and cores < 0.1 and mem < 500 * 2**20 and not sessions:
            continue
        what = ""
        if members:
            top = max(members, key=lambda pid: cpu.get(pid, 0))
            if cpu.get(top, 0) >= 0.05:
                what = p1[top]["comm"]
        if sessions:
            what = f"{W['sessions']}: {len(sessions)}"
        if unit.startswith("claude-rc") and members:
            main_pid = min(members)
            unit = f"Remote Control {os.path.basename(p1[main_pid]['cwd'])}"
        owner = {"name": unit, "cores": round(cores, 3), "mem": mem, "what": what, "sessions": []}
        report["owners"].append(owner)
        if not args.json:
            print(f"{unit[:42]:<42} {cores:>5.2f} {mb(mem):>6}  {what}")
        for s in sorted(sessions, key=lambda pid: -sum(cpu.get(x, 0) for x in tree(pid))):
            members_s = tree(s)
            s_cores = sum(cpu.get(x, 0) for x in members_s)
            s_mem = sum(p1[x]["anon"] for x in members_s if x in p1)
            busy = max(members_s[1:] or [s], key=lambda x: cpu.get(x, 0))
            job = p1[busy]["comm"] if busy != s and cpu.get(busy, 0) >= 0.05 else ""
            sid = ""
            parts = p1[s]["cmd"].split()
            if "--session-id" in parts:
                sid = parts[parts.index("--session-id") + 1][-6:]
            meta = session_meta(s)
            name = where(p1[s]["cwd"], sid, session_title(meta, titles))
            s_swap = sum(p1[x]["swap"] for x in members_s if x in p1)
            state = session_state(meta, titles)
            if job and state.startswith(W["idles"]):
                note = f"{W['in background']} {job}"
            else:
                note = ", ".join(x for x in (job, state) if x)
            if s_swap >= 50 * 2**20:
                note += f" · swap {mb(s_swap)}"
            owner["sessions"].append({"name": name, "cores": round(s_cores, 3), "mem": s_mem, "note": note,
                                      "swap": s_swap, "busy": state == W["works"], "waiting": state.startswith(W["waits"])})
            if not args.json:
                print(f"  └ {name[:38]:<38} {s_cores:>5.2f} {mb(s_mem):>6}  {note[:60]}")
    if dock[2]:
        report["docker"] = {"count": dock[2], "cores": round(dock[0], 3), "mem": dock[1]}
        if not args.json:
            print(f"{W['docker'].format(n=dock[2]):<42} {dock[0]:>5.2f} {mb(dock[1]):>6}")
    if args.json:
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
