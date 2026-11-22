# Changelog

All notable changes to this plugin are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## 1.0.0 - 2026-11-23

First published version.

- Follows the commands the session sends to the background, and its agents.
- A one-line status above the prompt: a first look twenty seconds after work starts, then one every few minutes, written by a small model in the language of the session.
- The date and time of the last look at the start of the line.
- Remembers how long each command took before, and tells the watcher model.
- Wakes the main model when the watcher finds the work suspicious, or its output has stopped changing.
- Options for the interval, the watcher model, the stall time, the language and the wake-up.
