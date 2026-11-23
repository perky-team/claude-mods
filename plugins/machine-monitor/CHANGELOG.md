# Changelog

All notable changes to this plugin are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## 1.0.0 - 2026-11-23

First published version.

- A pane beside the chat with the machine's load, memory, swap, disk and temperature, optional job queues, and the CPU and memory of each owner of the machine, with every Claude session nested under it.
- Opened and closed with `/monitor`, or with a button at the right of the band above the prompt; refreshed every few seconds while shown, and not at all while closed or hidden.
- A one-line form for the minimized pane in Claude Code Desktop.
- The `machine-monitor` skill: the same report as text, for the model to read and show.
- English or Russian; job queues and names for services from an optional config file.
- Linux with cgroup v2 only; elsewhere the pane says so and the button is left out.
