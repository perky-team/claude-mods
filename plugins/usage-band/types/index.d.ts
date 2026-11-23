export type Limit = { percentUsed: number; resetsAt: string | null }

export type Snapshot = {
  contextPercent: number | null
  fiveHour: Limit | null
  sevenDay: Limit | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snapshot: Snapshot | null; tick: number; agents: number; commands: string[] }
  }
}
