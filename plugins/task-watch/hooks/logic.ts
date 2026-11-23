// The arithmetic and the text of the watch: nothing here touches the engine.

import type { Watched } from '../types'

export type Settings = {
  intervalMs: number
  stallMs: number
  model: string
  language: string
  wake: boolean
}

const MINUTE = 60 * 1000

const positive = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

export const readSettings = (options: Readonly<Record<string, unknown>>): Settings => ({
  // Under a minute would spend more on watching than the work is worth.
  intervalMs: Math.max(1, positive(options.intervalMinutes, 5)) * MINUTE,
  stallMs: positive(options.stallMinutes, 10) * MINUTE,
  model: typeof options.model === 'string' && options.model.trim() ? options.model.trim() : 'haiku',
  // `auto`: the language of the person's own messages in the session.
  language: typeof options.language === 'string' && options.language.trim() ? options.language.trim() : 'auto',
  wake: options.wake !== false,
})

// A command meant to keep running until stopped: a dev server, a watcher, a
// follow. Its silence is no alarm. The watcher model may also say so.
const SERVICE =
  /\b(vite|nodemon|http-server|live-server|uvicorn|gunicorn|hypercorn|webpack-dev-server|storybook)\b|\b(next|nuxt|astro|remix|svelte-kit|gatsby|ng) (dev|serve|start)\b|\b(npm|pnpm|yarn|bun) (run )?(dev|start|serve|watch|preview)\b|--watch\b|\bwatch\b|\bserve\b|http\.server|runserver|\bflask run\b|\brails s(erver)?\b|\btail -[fF]\b|journalctl\b.* -f\b|\bkubectl\b.*\b(logs|port-forward)\b|\bdocker(-| )compose up\b(?!.*(-d\b|--detach))/

export const looksLikeService = (command: string): boolean => SERVICE.test(command)

// A timer the session starts for its own pacing is not work to watch.
export const isTimer = (command: string): boolean => /^\s*sleep\s+[\d.]+[smhd]?\s*$/.test(command)

// "Output is being written to: <path>." in a backgrounded command's result.
export const outputPathIn = (text: string): string | null => {
  const found = /Output is being written to:\s*(\S+)/.exec(text)

  return found?.[1] ? found[1].replace(/[.,;]+$/, '') : null
}

// The task a background notification reports on, and how it ended.
export const notified = (text: string): { id: string; status: string } | null => {
  const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]?.trim()

  return id ? { id, status: /<status>([^<]+)<\/status>/.exec(text)?.[1]?.trim() ?? 'finished' } : null
}

// Runs of one command are compared under this: the numbers in it left out.
export const signature = (command: string): string => command.trim().replace(/\d+/g, '#').replace(/\s+/g, ' ').slice(0, 120)

export type Durations = Readonly<Record<string, readonly number[]>>

const KEPT_RUNS = 5
const KEPT_COMMANDS = 200

export const withRun = (durations: Durations, command: string, ms: number): Durations => {
  const key = signature(command)
  const next = { ...durations, [key]: [...(durations[key] ?? []), ms].slice(-KEPT_RUNS) }
  const keys = Object.keys(next)

  // The oldest commands go first once the record is full.
  for (const old of keys.slice(0, Math.max(0, keys.length - KEPT_COMMANDS))) {
    delete next[old]
  }

  return next
}

// The middle of the runs on record; null with none.
export const usual = (durations: Durations, command: string): number | null => {
  const runs = [...(durations[signature(command)] ?? [])].sort((a, b) => a - b)

  return runs.length === 0 ? null : runs[Math.floor(runs.length / 2)]!
}

export const formatSpan = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))

  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)

  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const two = (n: number) => String(n).padStart(2, '0')

// The local date and time of a look at the work: "22.11 14:35".
export const formatStamp = (at: number): string => {
  const d = new Date(at)

  return `${two(d.getDate())}.${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`
}

// Whether a user row of the transcript is the person's own words: not a tool
// result (no text) and not a notice the engine framed in tags or brackets.
export const isOwnWords = (text: string): boolean => {
  const start = text.trim()

  return start !== '' && !start.startsWith('<') && !start.startsWith('[')
}

// How soon after work starts it is first looked at.
export const FIRST_LOOK_MS = 20 * 1000

// The start of a message of the person's own, kept as a sample of their language.
export const sampleOf = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 200)

export const tail = (text: string, limit: number): string => (text.length > limit ? `…${text.slice(-limit)}` : text)

// What the mod found out about one piece of work, for the watcher to read.
export type Facts = {
  watched: Watched
  elapsedMs: number
  usualMs: number | null
  // Since a command's output last changed; null when unknown.
  silentMs: number | null
  // The end of a command's output, or an agent's last words.
  last: string
}

export const isService = (watched: { kind: string; command: string; service?: boolean }): boolean =>
  watched.kind === 'command' && (watched.service === true || looksLikeService(watched.command))

export const describe = (facts: Facts): string => {
  const { watched } = facts
  const lines = [
    `Id: ${watched.id}`,
    `${watched.kind === 'agent' ? 'Agent' : 'Command'}: ${watched.label}`,
    ...(isService(watched) ? ['Kind: a service, meant to keep running until stopped'] : []),
    ...(watched.kind === 'command' ? [`Command line: ${watched.command.slice(0, 300)}`] : []),
    `Running for: ${formatSpan(facts.elapsedMs)}`,
    `Usual duration of earlier runs: ${facts.usualMs === null ? 'unknown, first run on record' : formatSpan(facts.usualMs)}`,
    ...(facts.silentMs === null ? [] : [`Output last changed: ${formatSpan(facts.silentMs)} ago`]),
    watched.kind === 'agent' ? 'Its last words:' : 'End of its output:',
    facts.last.trim() ? facts.last.trim() : '(nothing yet)',
  ]

  return lines.join('\n')
}

// The language the watcher writes in: the one named, or with `auto` that of
// the person's own message; English where there is no message to go by.
const languageRule = (language: string, sample: string): string =>
  language.toLowerCase() !== 'auto'
    ? `in ${language}`
    : sample
      ? `in the language this message of the person's is written in: «${sample}»`
      : 'in English'

export const systemPrompt = (language: string, sample: string): string => {
  const tongue = languageRule(language, sample)

  return [
    'You watch background work for a coding assistant and report on it to the person waiting.',
    'You are given facts about each piece of work: what it is, how long it has run, how long such runs usually take, when its output last changed, and the end of its output.',
    'Answer with one JSON object and nothing else: {"status": string, "verdict": "ok" | "suspect", "reason": string, "subject": string, "services": string[]}.',
    `"status": one line, at most 110 characters, ${tongue}: what is being done right now and how far along it is. No preamble, no quotes, no line breaks.`,
    '"verdict": "suspect" only when the facts show a problem: errors or failures in the output, the same step or retry repeating, a run far longer than usual, or output that stopped changing where it should not. Work that is simply slow, or quiet while it builds or downloads, is "ok".',
    `"reason": empty for "ok"; for "suspect" one short sentence ${tongue} naming what looks wrong.`,
    '"subject": for "suspect", the Id of the work that looks wrong; otherwise empty.',
    '"services": the Ids of the work meant to keep running until stopped, such as a dev server, a file watcher or a log follower. Silence or no end is normal for these: they are "suspect" only on errors in their output.',
  ].join('\n')
}

export type Report = { status: string; verdict: 'ok' | 'suspect'; reason: string; subject: string; services: string[] }

const oneLine = (text: string, limit: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}

// The watcher's answer, read leniently: a model may wrap its JSON in a fence
// or a sentence. Null when no status can be found in it.
export const parseReport = (text: string): Report | null => {
  const body = /\{[\s\S]*\}/.exec(text)?.[0]

  if (!body) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(body)

    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }

    const { status, verdict, reason, subject, services } = parsed as Record<string, unknown>

    if (typeof status !== 'string' || !status.trim()) {
      return null
    }

    return {
      status: oneLine(status, 140),
      verdict: verdict === 'suspect' ? 'suspect' : 'ok',
      reason: typeof reason === 'string' ? oneLine(reason, 200) : '',
      subject: typeof subject === 'string' ? subject.trim() : '',
      services: Array.isArray(services) ? services.filter((id): id is string => typeof id === 'string') : [],
    }
  } catch {
    return null
  }
}

// A task whose output has not changed for the whole stall time, and that has
// itself run that long. A service may be silent for as long as it likes.
export const isStalled = (facts: Facts, stallMs: number): boolean =>
  !isService(facts.watched) && facts.silentMs !== null && facts.silentMs >= stallMs && facts.elapsedMs >= stallMs

// When the output last changed: `now` less the silence; null when unknown.
export const outputAt = (facts: Facts, now: number): number | null => (facts.silentMs === null ? null : now - facts.silentMs)

// The main model is woken over one piece of work once for one state of it: not
// again until its output has changed since the last wake-up, and not after it
// said the work is fine until the output has changed since then.
export const mayAlert = (watched: Watched, changedAt: number | null): boolean => {
  const after = Math.max(watched.alertedAt, watched.ackedAt ?? 0)

  return after === 0 || (changedAt !== null && changedAt > after)
}

// Whether the watcher has anything new to read about this work since the last
// look: any task or agent; a service only once its output has moved.
export const needsWatcher = (facts: Facts, now: number): boolean => {
  if (!isService(facts.watched)) {
    return true
  }

  const changedAt = outputAt(facts, now)

  return changedAt === null || changedAt > (facts.watched.outputAt ?? 0)
}

export const ACK_TOOL = 'acknowledge'
export const ACK_TOOL_FULL = 'mcp__task-watch__acknowledge'

// What the main model is told when it is woken.
export const wakeText = (facts: Facts, why: string): string =>
  [
    `task-watch: the background ${facts.watched.kind} "${facts.watched.label}" (id ${facts.watched.id}) may need attention.`,
    `It has run for ${formatSpan(facts.elapsedMs)}` +
      (facts.usualMs === null ? '' : `; earlier runs took about ${formatSpan(facts.usualMs)}`) +
      (facts.silentMs === null ? '.' : `; its output last changed ${formatSpan(facts.silentMs)} ago.`),
    `Why: ${why}`,
    'Look at it now: decide whether it is stuck or failing, and wait, fix or stop it. Answer in a line or two.',
    `If it is fine (a server or watcher meant to keep running, or slow but healthy work), call ${ACK_TOOL_FULL} with id "${facts.watched.id}" and say whether it is a service: the watch then stops raising it until its output shows something new. Do not move the work out of the session to quiet the watch.`,
  ].join('\n')

export const ACTIVE: readonly string[] = ['pending', 'running', 'waiting']
