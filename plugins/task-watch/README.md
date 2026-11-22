# task-watch

![License: MIT](https://img.shields.io/badge/license-MIT-blue) ![Claude Code 2.1.319+](https://img.shields.io/badge/Claude%20Code-2.1.319%2B-d97757)

A Claude Code mod that keeps an eye on long work in the background, so you do not have to ask how it is going, and the session does not have to wake itself to tell you.

While a background command or an agent runs, one row above the prompt says what is happening:

```
▸ 23.11 00:03 · Build: 5 of 15 modules compiled, 47 s in, usually about 2 min
```

A small model writes that line every few minutes from the facts the mod collects. When the work looks stuck or wrong, the line turns into a warning and the main model is woken to deal with it:

```
⚠ 23.11 00:18 · Upload keeps failing — the same error five times in a row
```

When the work ends, the line says how long it took, and a minute later the row is gone:

```
✓ 23.11 00:21 · Build the app · 15m 0s
```

- [How it works](#how-it-works)
- [Install](#install)
- [Options](#options)
- [What it costs](#what-it-costs)
- [What leaves your machine](#what-leaves-your-machine)
- [Where it works](#where-it-works)
- [Limits](#limits)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## How it works

```
a command goes to the background, or an agent starts
        │
        ▼
   the row appears with the work's name
        │
   20 seconds later, then every 5 minutes while it runs
        │
        ├─ the mod collects the facts: what runs and for how long, how long
        │  earlier runs took, the end of the output, when it last changed
        │
        ├─ the watcher model ──► one line of status in the row
        │                   └──► a verdict: ok, or suspect with a reason
        │
        └─ suspect, or the output silent for 10 minutes
                  ──► the row turns into a warning
                  ──► the main model gets a message with the facts and takes a turn
        │
   the work ends ──► the row says how long it took, then goes
```

What the mod follows:

- Commands the main session sends to the background with the Bash tool. A plain `sleep` is taken for a pacing timer and left alone.
- Subagents and teammates, for as long as the engine lists them as pending, running or waiting.

How the watcher knows what is normal:

- **Earlier runs.** The mod records how long each command took when it finished well, and keeps the last five runs. The record is shared by all your sessions. Commands are compared with their numbers left out, so `npm test 1` and `npm test 2` count as one.
- **The output itself.** Errors, a step that repeats, a retry loop: the watcher reads the end of the output and judges it.
- **Silence.** Whatever the watcher says, a command whose output has not changed for the stall time wakes the main model.

The main model is woken over one piece of work at most once in three looks.

## Install

```
claude plugin marketplace add perky-team/claude-mods
claude plugin install task-watch@perky-team
```

Or at the prompt of a terminal session:

```
/plugin install task-watch --marketplace perky-team/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `perky-team/claude-mods`, then Add plugin.

Update, then restart the session:

```
claude plugin marketplace update perky-team
claude plugin update task-watch@perky-team
```

Remove:

```
claude plugin uninstall task-watch@perky-team
```

## Options

Set them on the screen the install shows, or later in the plugin's configuration.

| Option | Default | What it does |
| --- | --- | --- |
| Check every (minutes) | `5` | How often the work is looked at and the line rewritten; one minute at the least |
| Watcher model | `haiku` | The model that writes the line and judges the work: an alias or a full model id |
| Silence that counts as stuck (minutes) | `10` | A command whose output has not changed for this long wakes the main model |
| Status language | `auto` | `auto` follows the language of your own messages in the session; or name one, such as `English` |
| Wake the main model | on | Off, a warning stays in the row and no message is sent |

## What it costs

Every look is one request to the watcher model: a few thousand input tokens at most, and a reply capped at 300. With the defaults that is twelve small requests an hour, and only while something runs in the background. They are billed to the session's own credentials and count toward the same limits as the rest of your use.

A wake-up costs a turn of the main model. It happens only on a warning.

## What leaves your machine

To write the line, the mod sends the watcher model, through your own Claude Code session:

- the name and the command line of each background command, cut to 300 characters;
- the last 2,500 characters of its output;
- the last words of each agent, cut to 800 characters;
- with the language set to `auto`, the first 200 characters of your last message, as a sample of the language.

If the output of your commands may hold secrets, they are in what is sent. Nothing goes anywhere else, and nothing is sent while no work is in the background.

## Where it works

| Where | Works |
| --- | --- |
| Claude Code Desktop, local sessions of the Code tab | Yes |
| Terminal | Yes |
| Mobile app | Not tested |
| VS Code chat panel | The watch runs and can wake the main model, but the editor draws no row above the prompt |
| Cloud sessions, WSL sessions of the desktop app | No: plugins do not load there |

Requires Claude Code 2.1.319 or later.

## Limits

- The watcher sees the facts the mod collects, not the whole session. It can raise a false alarm, which costs one turn of the main model, or miss a problem; the stall time is the backstop.
- A first run has no record to compare with: "longer than usual" starts with the second.
- A number in a command that changes how much work it does (`build --shards 42`) is left out of the comparison, so its usual time can mislead.
- Work that is quiet for a long time by design, such as a big download with no progress output, looks stuck. Raise the stall time for such work.
- The wake-up starts a turn once the session is idle. If the main model is in the middle of a long turn of its own, the message waits for that turn to end.
- Commands started by a subagent are not followed, only the main session's own.
- An output file past one megabyte is judged by its age alone: its end is not read.
- After the session restarts, work that died with it may stay in the row until a look finds its agents gone; a dead command is dropped only by the engine's notice.

## Troubleshooting

**No row appears when a command goes to the background.**

- Check that the mod is installed and enabled: `claude plugin list` should show `task-watch@perky-team` as enabled.
- A session that was open before the install needs `/reload-plugins`, or a restart.
- The band above the prompt can be collapsed: click `[-]` beside it, or press ctrl+x ctrl+a.
- Only commands run with the Bash tool in the background are followed; a plain `sleep` is not.

**The row shows the bare facts, such as `1 in the background · longest 6m 12s`.**

- The watcher model did not answer, or answered in another shape. Run the session with `claude --debug` to read why: the mod writes the reason to the debug log.
- Check the model named in the options: an alias your account cannot use is refused.

**The line is in the wrong language.**

- With `auto`, the language is taken from your last message in the session. Set the option to a language by name to fix it.

## Development

```
claude plugin validate plugins/task-watch
claude plugin test plugins/task-watch
```

To run the mod from this folder while changing it:

```
claude --plugin-dir plugins/task-watch
```

The code is three files under `hooks/`: `logic.ts` holds the arithmetic and the text and never touches the engine, `watch.ts` does the work through the engine, `register.tsx` hooks the events and draws the row.

See [CHANGELOG.md](CHANGELOG.md) for the history of versions.

## License

[MIT](../../LICENSE)
