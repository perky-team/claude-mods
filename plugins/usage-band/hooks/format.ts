import type { Limit, Snapshot } from '../types'

type Window = { kind: string; percentUsed: number; resetsAt?: string }
type Figures = { context: { percent?: number }; rateLimits: readonly Window[] }

const pick = (windows: readonly Window[], isIt: (kind: string) => boolean): Limit | null => {
  const found = windows.find(w => isIt(w.kind))

  return found
    ? { percentUsed: found.percentUsed, resetsAt: found.resetsAt ?? null }
    : null
}

export const formatFable = (limit: Limit): string => `f${Math.round(limit.percentUsed)}%`

export const toSnapshot = (figures: Figures): Snapshot => ({
  contextPercent: figures.context.percent ?? null,
  fiveHour: pick(figures.rateLimits, kind => kind === 'five_hour'),
  sevenDay: pick(figures.rateLimits, kind => kind === 'seven_day'),
  // The weekly window of the Fable model, where the engine reports one.
  fable: pick(figures.rateLimits, kind => /fable/i.test(kind)),
})

const two = (n: number) => String(n).padStart(2, '0')

// Local time and date of the reset: "18:40 22.11".
export const formatReset = (iso: string | null): string => {
  const at = iso === null ? NaN : Date.parse(iso)

  if (Number.isNaN(at)) {
    return ''
  }

  const d = new Date(at)

  return `${two(d.getHours())}:${two(d.getMinutes())} ${two(d.getDate())}.${two(d.getMonth() + 1)}`
}

export const BAR_CELLS = 10

// How many of the bar's cells are filled; any use at all shows one cell.
export const filledCells = (percent: number | null): number => {
  if (percent === null || percent <= 0) {
    return 0
  }

  return Math.min(BAR_CELLS, Math.max(1, Math.round((percent / 100) * BAR_CELLS)))
}

// How loud a figure is drawn, as theme keys.
export type Level = 'success' | 'warning' | 'error'

export const barColor = (percent: number | null): Level => {
  const p = percent ?? 0

  return p >= 90 ? 'error' : p >= 70 ? 'warning' : 'success'
}

export const formatPercent = (percent: number | null): string =>
  percent === null ? '—' : `${Math.round(percent)}%`

export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000

// How much of a window of `length` that ends at the reset has passed, 0 to 100.
export const windowElapsed = (limit: Limit | null, length: number, now: number): number | null => {
  const resetsAt = limit?.resetsAt ? Date.parse(limit.resetsAt) : NaN

  if (Number.isNaN(resetsAt)) {
    return null
  }

  return Math.min(100, Math.max(0, ((now - (resetsAt - length)) / length) * 100))
}

// A window whose reset has passed says nothing of the new one: its figures are
// the old window's until the next response brings a reading.
export const live = (limit: Limit | null, now: number): Limit | null => {
  const resetsAt = limit?.resetsAt ? Date.parse(limit.resetsAt) : NaN

  return !Number.isNaN(resetsAt) && resetsAt <= now ? null : limit
}

// The share of a window of `length` still ahead of the clock, 0 to 1.
export const leftShare = (limit: Limit | null, length: number, now: number): number | null => {
  const elapsed = windowElapsed(limit, length, now)

  return elapsed === null ? null : 1 - elapsed / 100
}

const MINUTE_MS = 60 * 1000

// Whole minutes left until the reset, rounded up; 0 once it has passed; null for no reset.
const minutesLeft = (limit: Limit | null, now: number): number | null => {
  const resetsAt = limit?.resetsAt ? Date.parse(limit.resetsAt) : NaN

  return Number.isNaN(resetsAt) ? null : Math.max(0, Math.ceil((resetsAt - now) / MINUTE_MS))
}

// Hours and minutes left: "04:55".
export const formatLeftHours = (limit: Limit | null, now: number): string => {
  const minutes = minutesLeft(limit, now)

  return minutes === null ? '' : `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`
}

// Days, hours and minutes left: "6:12:41".
export const formatLeftDays = (limit: Limit | null, now: number): string => {
  const minutes = minutesLeft(limit, now)

  if (minutes === null) {
    return ''
  }

  const hours = Math.floor(minutes / 60)

  return `${Math.floor(hours / 24)}:${two(hours % 24)}:${two(minutes % 60)}`
}

export type Pace = {
  // The share of the limit an even spend would have used by now, 0 to 100.
  expected: number
  // Used less expected, in points: above zero is ahead of the plan.
  delta: number
}

// An even plan spends 100% over the window of `length` that ends at the reset.
export const windowPace = (limit: Limit | null, length: number, now: number): Pace | null => {
  const expected = windowElapsed(limit, length, now)

  if (limit === null || expected === null) {
    return null
  }

  return { expected, delta: limit.percentUsed - expected }
}

export const weeklyPace = (sevenDay: Limit | null, now: number): Pace | null => windowPace(sevenDay, WEEK_MS, now)

export const formatPace = (pace: Pace): string => {
  const points = Math.round(pace.delta)

  if (points === 0) {
    return '= 0%'
  }

  return points > 0 ? `▲ +${points}%` : `▼ −${-points}%`
}

export const paceColor = (pace: Pace): Level => {
  const points = Math.round(pace.delta)

  return points >= 10 ? 'error' : points > 0 ? 'warning' : 'success'
}

// The statuses of an agent that is still at work, or about to be.
const ACTIVE: readonly string[] = ['pending', 'running', 'waiting']

export const countActive = (agents: readonly { status: string }[]): number =>
  agents.filter(agent => ACTIVE.includes(agent.status)).length

// Written at zero too, so the line keeps its shape when agents come and go.
// The glyph stands for the agent where no picture draws one.
export const formatAgents = (count: number): string => `◉ ${count}`
