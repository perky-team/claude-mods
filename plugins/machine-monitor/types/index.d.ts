// The report `skills/machine-monitor/resources.py --json` prints.
export type Machine = {
  host: string
  load: number[]
  cpus: number
  ram_used: number
  ram_total: number
  swap_used: number
  disk_used: number
  disk_total: number
  temps: { kind: string; degrees: number }[]
}

export type Queue = { name: string; free: boolean; job?: string; holder?: string; since?: string }

export type Session = {
  name: string
  cores: number
  mem: number
  note: string
  swap: number
  busy: boolean
  waiting: boolean
}

export type Owner = { name: string; cores: number; mem: number; what: string; sessions: Session[] }

export type Report = {
  machine: Machine
  queues: Queue[]
  owners: Owner[]
  docker: { count: number; cores: number; mem: number } | null
}

// The script's answer where it cannot read the machine.
export type Refusal = { unsupported: string }

// What the pane shows: the last report, or why there is none.
export type Reading = {
  report: Report | null
  error: string
  // Why this machine cannot be read at all; '' where it can.
  unsupported: string
  // `$.clock.now()` when the script last answered.
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'machine-monitor': { reading: Reading | null; isOpen: boolean }
  }
}
