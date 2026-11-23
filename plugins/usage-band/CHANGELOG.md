# Changelog

All notable changes to this plugin are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## 1.3.0 - 2026-11-23

- A light app: under a light color scheme the picture switches every color to a darker twin, at least 3:1 against both a white and a dark ground, so the row reads on a light theme too. Under a dark one it is drawn as before.

## 1.2.1 - 2026-11-23

- Removed the per-model weekly note (`f15%`): the engine reports no per-model limits to mods, so it never showed.

## 1.2.0 - 2026-11-23

- A second counter at the end of the row: the commands the session sent to the background that are still running, beside the agents at work. Pacing timers (`sleep`) are not counted.

## 1.1.0 - 2026-11-22

- In Claude Code Desktop, resting the pointer on a part of the row shows its figure: the context percent, each limit's percent with the time of its reset, the number of agents at work.

## 1.0.0 - 2026-11-22

First published version.

- Context, 5-hour and weekly bars above the prompt.
- Pace against an even plan for the 5-hour and the weekly window.
- Time left until each window resets, colored in proportion to the time left.
- Count of the agents still at work.
- One SVG picture in Claude Code Desktop, one line of glyphs in the terminal.
