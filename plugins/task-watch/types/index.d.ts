// One piece of background work the mod follows.
export type Watched = {
  kind: 'command' | 'agent'
  // The background task's id, or the agent's.
  id: string
  // A few words on what it is: the call's own description, or the command.
  label: string
  // The command line, for a command.
  command: string
  // `$.clock.now()` when it was first seen.
  startedAt: number
  // Where a command's output is written, when the engine said.
  outputPath: string | null
  // When the main model was last woken over it; 0 for never.
  alertedAt: number
}

// The row above the prompt.
export type Line = {
  text: string
  level: 'info' | 'ok' | 'warn'
  // `$.clock.now()` when it was written.
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'task-watch': { watched: Watched[]; line: Line | null; sample: string }
  }
}
