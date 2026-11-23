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
  // Meant to keep running (a dev server, a watcher): silence is no alarm.
  // Absent in work followed before 1.1.0.
  service?: boolean
  // When the main model said it is fine; 0 or absent for never.
  ackedAt?: number
  // When its output last changed, as the last look saw it; 0 or absent for unknown.
  outputAt?: number
  // A short name in the person's language, from the watcher model; absent until it named one.
  title?: string
}

// The row above the prompt.
export type Line = {
  text: string
  level: 'info' | 'ok' | 'warn'
  // `$.clock.now()` when it was written.
  at: number
}

declare module 'claude-code' {
  // The tool this mod gives the model, so its calls are typed.
  interface McpToolInputs {
    'mcp__task-watch__acknowledge': { id: string; service?: boolean }
  }

  interface PluginState {
    'task-watch': { watched: Watched[]; line: Line | null; sample: string }
  }
}
