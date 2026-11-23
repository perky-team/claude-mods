// Reading the script's report, the words of the pane and its arithmetic: no engine calls.

import type { Refusal, Report } from '../types'

export type Level = 'success' | 'warning' | 'error'

export type Language = 'en' | 'ru'

export const WORDS = {
  en: {
    title: 'Machine',
    measuring: 'Measuring…',
    noAnswer: 'The machine-monitor script did not answer',
    of: 'of',
    disk: 'disk',
    queues: 'queues',
    free: 'free',
    since: 'since',
    who: 'WHO',
    cores: 'CORES',
    updated: 'updated',
    lastFailed: 'the last reading failed',
    wrongShape: 'the script answered in another shape',
    exitCode: 'exit code',
    secondsAgo: 's ago',
    minutesAgo: 'min ago',
    opened: 'The machine pane is open',
    closed: 'The machine pane is closed',
    button: 'Open or close the machine pane',
  },
  ru: {
    title: 'Машина',
    measuring: 'Замеряю…',
    noAnswer: 'Скрипт machine-monitor не ответил',
    of: 'из',
    disk: 'диск',
    queues: 'очереди',
    free: 'свободна',
    since: 'с',
    who: 'КТО',
    cores: 'ЯДЕР',
    updated: 'обновлено',
    lastFailed: 'последний замер не удался',
    wrongShape: 'скрипт ответил не в том виде',
    exitCode: 'код',
    secondsAgo: 'с назад',
    minutesAgo: 'мин назад',
    opened: 'Панель машины открыта',
    closed: 'Панель машины закрыта',
    button: 'Открыть или закрыть панель машины',
  },
} as const

export type Words = (typeof WORDS)[Language]

export const languageOf = (value: unknown): Language => (value === 'ru' ? 'ru' : 'en')

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// The script's refusal to read a machine it cannot: not Linux, or no cgroup v2.
export const parseRefusal = (text: string): Refusal | null => {
  try {
    const parsed: unknown = JSON.parse(text)

    return isObject(parsed) && typeof parsed.unsupported === 'string' ? { unsupported: parsed.unsupported } : null
  } catch {
    return null
  }
}

// The script's JSON, when it has the shape the pane draws; null otherwise.
export const parseReport = (text: string): Report | null => {
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  if (!isObject(parsed) || !isObject(parsed.machine) || !Array.isArray(parsed.owners) || !Array.isArray(parsed.queues)) {
    return null
  }

  const m = parsed.machine

  if (
    typeof m.host !== 'string' ||
    !Array.isArray(m.load) ||
    !isNumber(m.cpus) ||
    !isNumber(m.ram_used) ||
    !isNumber(m.ram_total) ||
    !isNumber(m.disk_used) ||
    !isNumber(m.disk_total)
  ) {
    return null
  }

  return parsed as unknown as Report
}

// Bytes as the script writes them: "420M", "7.5G".
export const formatBytes = (n: number): string =>
  n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)}G` : `${Math.round(n / 2 ** 20)}M`

export const formatCores = (cores: number): string => cores.toFixed(2)

// How loud a share of a whole is drawn.
export const shareLevel = (share: number): Level => (share >= 0.9 ? 'error' : share >= 0.7 ? 'warning' : 'success')

export const tempLevel = (degrees: number): Level => (degrees >= 85 ? 'error' : degrees >= 75 ? 'warning' : 'success')

// An owner or a session that eats this many cores stands out.
export const coresLevel = (cores: number): Level | null => (cores >= 4 ? 'error' : cores >= 2 ? 'warning' : null)

export const BAR = 10

export const filled = (share: number): number =>
  share <= 0 ? 0 : Math.min(BAR, Math.max(1, Math.round(share * BAR)))

export const cut = (text: string, width: number): string =>
  width <= 1 ? text.slice(0, Math.max(0, width)) : text.length > width ? `${text.slice(0, width - 1)}…` : text

// The queues as one line: "heavy free · deploy build.sh — «Project» since 14:02".
export const queuesLine = (report: Report, words: Words): string =>
  report.queues
    .map(q =>
      q.free
        ? `${q.name} ${words.free}`
        : `${q.name} ${q.job ?? ''}${q.holder ? ` — «${q.holder}»` : ''}${q.since ? ` ${words.since} ${q.since}` : ''}`,
    )
    .join(' · ')

// The minimized pane's one line.
export const glance = (report: Report): string => {
  const m = report.machine
  const temp = m.temps[0]

  return [
    `load ${(m.load[0] ?? 0).toFixed(2)}/${m.cpus}`,
    `RAM ${formatBytes(m.ram_used)}/${formatBytes(m.ram_total)}`,
    ...(temp ? [`${temp.degrees}°`] : []),
  ].join(' · ')
}

// What stands out on the machine as a whole, worst first.
export const machineLevel = (report: Report): Level => {
  const m = report.machine
  const levels: Level[] = [
    shareLevel((m.load[0] ?? 0) / Math.max(1, m.cpus)),
    shareLevel(m.ram_used / Math.max(1, m.ram_total)),
    ...m.temps.map(t => tempLevel(t.degrees)),
    ...(m.swap_used >= 2 ** 30 ? (['warning'] as Level[]) : []),
  ]

  return levels.includes('error') ? 'error' : levels.includes('warning') ? 'warning' : 'success'
}

export const ago = (ms: number, words: Words): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))

  return seconds < 60 ? `${seconds} ${words.secondsAgo}` : `${Math.floor(seconds / 60)} ${words.minutesAgo}`
}
