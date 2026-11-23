# machine-monitor

![License: MIT](https://img.shields.io/badge/license-MIT-blue) ![Claude Code 2.1.319+](https://img.shields.io/badge/Claude%20Code-2.1.319%2B-d97757) ![Linux only](https://img.shields.io/badge/platform-Linux-informational)

What loads this machine right now, beside the chat: load, memory, disk, temperature, and the CPU and memory of every Claude session you run. For when several sessions, agents and builds share one machine and you want to know which one makes it slow.

```
┌─ Machine ──────────────────────────────────────────────┐
│ dev-box                                     CPU 42°    │
│ load  ▬▬▭▭▭▭▭▭▭▭  0.63 of 16                            │
│ RAM   ▬▬▬▭▭▭▭▭▭▭  7.5G / 26.7G                         │
│ disk  ▬▬▭▭▭▭▭▭▭▭  146G / 915G                          │
│ swap  0M                                               │
│ queues: heavy free · deploy build.sh since 14:02       │
│                                                        │
│ WHO                                     CORES    RAM   │
│ Claude Desktop: its sessions             2.40   1.5G   │
│   └ Visual editor (shop)                 2.30   420M   │
│       working                                          │
│   └ linux (no project)                   0.01   202M   │
│       idle 2 min                                       │
│ Remote Control shop                      0.02   433M   │
│ Docker: 3                                0.02   300M   │
│ updated 3 s ago                                        │
└────────────────────────────────────────────────────────┘
```

- [What it has](#what-it-has)
- [Install](#install)
- [Options](#options)
- [Job queues and names](#job-queues-and-names)
- [Where it works](#where-it-works)
- [Limits](#limits)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## What it has

The plugin brings two ways to read the same report.

**A pane.** Open it with `/monitor`, or with the 🖥️ button at the right of the band above the prompt. While it is shown it reads the machine every 5 seconds; closed or hidden, it reads nothing. A pane that was open when a session ended opens again with the next. In Claude Code Desktop the minimized pane keeps one line: `load 0.63/16 · RAM 7.5G/26.7G · 42°`.

What stands out is colored:

| Part | Amber | Red |
| --- | --- | --- |
| load, RAM, disk | from 70% | from 90% |
| CPU temperature | from 75° | from 85° |
| An owner or a session | from 2 cores | from 4 cores |
| A session | waiting for you | |
| swap | from 1 GB | |
| queues | one is held | |

A working session is green; an idle one is dimmed.

**A skill.** Ask the model what loads the machine, or why it is slow, and it runs the same script and shows its report as text.

The button belongs to this plugin alone. It sits at the right of whatever rows other mods draw above the prompt, such as [usage-band](../usage-band); with none of them installed it stands there by itself.

## Install

```
claude plugin marketplace add perky-team/claude-mods
claude plugin install machine-monitor@perky-team
```

Or at the prompt of a terminal session:

```
/plugin install machine-monitor --marketplace perky-team/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `perky-team/claude-mods`, then Add plugin.

It needs `python3` on the `PATH` (3.8 or later); the script uses its standard library alone.

Update, then restart the session:

```
claude plugin marketplace update perky-team
claude plugin update machine-monitor@perky-team
```

Remove:

```
claude plugin uninstall machine-monitor@perky-team
```

## Options

Set them on the screen the install shows, or later in the plugin's configuration.

| Option | Default | What it does |
| --- | --- | --- |
| Refresh every (seconds) | `5` | How often the shown pane reads the machine; two at the least |
| Language | `en` | The language of the pane: `en` or `ru` |

## Job queues and names

An optional file, `~/.config/machine-monitor/config.json` (or under `$XDG_CONFIG_HOME`), adds what only you know about your machine:

```json
{
  "language": "en",
  "apps": {
    "nightly-e2e": "shop: nightly end-to-end run"
  },
  "queues": {
    "command": ["~/projects/shop/deploy/queue.sh", "status"],
    "lock": "/tmp/shop-{queue}.lock"
  }
}
```

- `language`: the language of the skill's report. The pane follows its own option.
- `apps`: names to show for systemd units, app scopes or snaps, keyed by the unit's name without `.service`.
- `queues.command`: a program that prints one line per queue, `<name>: free` or `<name>: <job>, since <date> <HH:MM>`. Its first word may start with `~`.
- `queues.lock`: the lock file each queue's job holds through `flock`, with `{queue}` for the queue's name. The report then names the session that started the job.

Without the file there are no queues, and units are shown by their own names.

## Where it works

| Where | Works |
| --- | --- |
| Linux with systemd and cgroup v2, in Claude Code Desktop and the terminal | Yes |
| macOS, Windows | No: the pane says so, and the button is left out |
| WSL sessions of the desktop app, cloud sessions | No: plugins do not load there |
| VS Code chat panel | The skill works; the editor draws no pane |

Requires Claude Code 2.1.319 or later. Tested on Ubuntu with GNOME; other distributions should work wherever `/sys/fs/cgroup` is cgroup v2.

## Limits

- Claude sessions are recognized by how their processes are started: Claude Desktop, Remote Control, `claude` in a terminal, a session over SSH. A session started some other way shows as part of its owner, not on a row of its own.
- Session titles come from the local transcripts; the claude.ai titles only when the skill has refreshed them through the `claude-code-remote` MCP server.
- The pane reads with a one-second CPU sample: a burst shorter than that may not show.
- The temperature is the CPU's, from `k10temp` or `coretemp`; other sensors are not read.
- Docker containers that use little are folded into one `Docker` row; `-a` in the skill lists them all.

## Troubleshooting

**The pane says the script did not answer.**

- Check that `python3` runs from a terminal.
- The line under the message is the script's own error.

**The pane says this machine cannot be read.**

- It is not Linux, or `/sys/fs/cgroup` is not cgroup v2. The plugin does not read such machines.

**No button above the prompt.**

- A session that was open before the install needs `/reload-plugins`, or a restart.
- On a machine the script cannot read, the button is left out on purpose.

## Development

```
claude plugin validate plugins/machine-monitor
claude plugin test plugins/machine-monitor
python3 plugins/machine-monitor/skills/machine-monitor/resources.py --json
```

`skills/machine-monitor/resources.py` reads the machine and prints the report, as text or as JSON. `hooks/logic.ts` reads that JSON and holds the pane's words and arithmetic; `hooks/register.tsx` runs the script, draws the pane and the button.

See [CHANGELOG.md](CHANGELOG.md) for the history of versions.

## License

[MIT](../../LICENSE)
