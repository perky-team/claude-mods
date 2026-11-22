# usage-band

A Claude Code mod that draws one row above the prompt, so the figures that decide how you spend a session are always in view.

```
[context]  •  [5-hour limit] [pace] 04:55  •  [weekly limit] [pace] 6:12:41  •  [agents] 0
```

| Part | What it shows |
| --- | --- |
| Context bar | How full the context window is |
| 5-hour bar | How much of the 5-hour rate limit is used |
| Weekly bar | How much of the weekly rate limit is used |
| Pace badge | Use against an even plan for the window: `▲ +14%` is ahead of the plan, `▼ −8%` is behind it |
| Time left | Until the window resets: `04:55` is hours and minutes, `6:12:41` is days, hours and minutes |
| Agents | How many subagents and teammates are still at work |

Bars turn amber from 70% and red from 90%. The time left is colored in proportion to the share of the window still ahead: red with the whole window ahead, amber at half, green at the reset.

## Install

```
claude plugin marketplace add perky-team/claude-mods
claude plugin install usage-band@perky-team
```

Or at the prompt of a terminal session:

```
/plugin install usage-band --marketplace perky-team/claude-mods
```

## Where it draws

- Claude Code Desktop (Code tab): one SVG picture. Its colors are fixed and do not follow the app's theme.
- Terminal: one line of text glyphs in the theme's colors.

The row is redrawn after every turn and once a minute.

## Limits

- Rate limits come from the last API response: without a subscription there are none, and the bars stay empty.
- The context fill appears after the first response of a session, and again after a compaction.
- A window whose reset has passed is drawn empty until the next response brings a new reading.
- The limits are the account's, shared by every session; the context is the session's own.
- Per-model limits are not reported to mods, so none is shown.

## Requirements

Claude Code 2.1.319 or later.

## Development

```
claude plugin validate plugins/usage-band
claude plugin test plugins/usage-band
```

To run the mod from this folder while changing it:

```
claude --plugin-dir plugins/usage-band
```
