# Changelog

All notable changes to this plugin are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## 1.2.0 - 2026-11-23

- The row speaks the session's language more often:
  - the watcher model names each piece of work in the person's language, and the row uses that name instead of the description the session gave it, which is often in English;
  - the mod's own words are gone from the row: silence shows as `⏸ 10m 0s`, and the bare summary as `⏳ 2 · 6m 12s`;
  - the language sample leaves out quoted lines, code, links and comments, skips the mod's own messages, and is kept for the next session.
- The usual duration is that of the very command where it ran before; runs of similar commands, whose numbers differ, are used only when it never did, and the watcher is told they may differ in size.

## 1.1.0 - 2026-11-23

- Services: a dev server, a file watcher or a log follower is meant to keep running and to stay quiet. It is known by its command (`vite`, `npm run dev`, `--watch`, `tail -f` and the like) or by the watcher model's word, and its silence is no longer taken for a stall: it is raised only on errors in its output.
- A quiet service costs nothing: the watcher model is asked about it again only once its output moves, and the row shows its name and how long it runs.
- One wake-up for one state of the work: the main model is not woken again over the same work until its output has changed since.
- The `acknowledge` tool: the main model tells the watch that work it was woken about is fine, and the watch stays quiet about it until its output shows something new. The wake-up names the tool, and asks the model not to move work out of the session to quiet the watch.

## 1.0.0 - 2026-11-23

First published version.

- Follows the commands the session sends to the background, and its agents.
- A one-line status above the prompt: a first look twenty seconds after work starts, then one every few minutes, written by a small model in the language of the session.
- The date and time of the last look at the start of the line.
- Remembers how long each command took before, and tells the watcher model.
- Wakes the main model when the watcher finds the work suspicious, or its output has stopped changing.
- Options for the interval, the watcher model, the stall time, the language and the wake-up.
