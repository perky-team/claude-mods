// What the watch does through the engine: follows the work, asks the watcher
// model, writes the line, wakes the main model.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Line, Watched } from '../types'
import {
  ACTIVE,
  describe,
  formatSpan,
  isOwnWords,
  isService,
  isStalled,
  mayAlert,
  nameOf,
  needsWatcher,
  outputAt,
  parseReport,
  sampleOf,
  systemPrompt,
  tail,
  usual,
  wakeText,
  withRun,
} from './logic'
import type { Durations, Facts, Settings } from './logic'

const watched = atom({ plugin: 'task-watch', key: 'watched' } as const, [])
const line = atom({ plugin: 'task-watch', key: 'line' } as const, null)
const sample = atom({ plugin: 'task-watch', key: 'sample' } as const, '')

const DURATIONS = 'durations'
const SAMPLE = 'sample'
// An output file past this is judged by its age alone: its end is not read.
const READ_LIMIT = 1_000_000
// How long the last line stays once nothing is left to watch.
export const LINGER_MS = 60 * 1000

async function durationsOf($: EngineInterface): Promise<Durations> {
  const stored: unknown = await $.store.get(DURATIONS)

  return typeof stored === 'object' && stored !== null ? (stored as Durations) : {}
}

export async function follow($: EngineInterface, work: Omit<Watched, 'startedAt' | 'alertedAt'>): Promise<void> {
  const now = await $.clock.now()
  const entry: Watched = { ...work, startedAt: now, alertedAt: 0, ackedAt: 0, outputAt: 0 }

  await update($, watched, list => (list.some(w => w.id === entry.id) ? list : [...list, entry]))
  // A warning already on the line is not written over by a start.
  const opening: Line = { text: entry.label, level: 'info', at: now }

  await update($, line, held => (held?.level === 'warn' ? held : opening))
}

// The work has ended: its run goes on record, and the line says how it ended
// once nothing else is being watched.
export async function finish($: EngineInterface, id: string, status: string): Promise<void> {
  const ended = (await read($, watched)).find(w => w.id === id)

  if (!ended) {
    return
  }

  const now = await $.clock.now()
  const ran = now - ended.startedAt
  const isGood = status === 'completed' || status === 'finished'

  if (ended.kind === 'command' && isGood) {
    await $.store.set(DURATIONS, withRun(await durationsOf($), ended.command, ran))
  }

  await update($, watched, list => list.filter(w => w.id !== id))

  // No words of the mod's own: the mark, the work's name and how long it ran.
  const closing: Line = isGood
    ? { text: `${nameOf(ended)} · ${formatSpan(ran)}`, level: 'ok', at: now }
    : { text: `${nameOf(ended)} · ${status} · ${formatSpan(ran)}`, level: 'warn', at: now }

  await update($, line, () => closing)
}

// Agents come and go without a call of the mod's own: the list is the truth.
export async function syncAgents($: EngineInterface): Promise<void> {
  let agents: Awaited<ReturnType<EngineInterface['agent']['list']>>

  try {
    agents = await $.agent.list()
  } catch {
    // A host that keeps no agents: nothing to follow.
    return
  }

  const active = agents.filter(agent => ACTIVE.includes(agent.status))
  const known = await read($, watched)

  for (const agent of active) {
    if (!known.some(w => w.id === agent.id)) {
      await follow($, {
        kind: 'agent',
        id: agent.id,
        label: agent.description || agent.type,
        command: '',
        outputPath: null,
      })
    }
  }

  for (const gone of known.filter(w => w.kind === 'agent' && !active.some(agent => agent.id === w.id))) {
    const last = agents.find(agent => agent.id === gone.id)?.status

    await finish($, gone.id, last === 'failed' || last === 'killed' ? last : 'finished')
  }
}

async function gather($: EngineInterface, work: Watched, now: number, durations: Durations): Promise<Facts> {
  const facts: Facts = {
    watched: work,
    elapsedMs: now - work.startedAt,
    usualMs: null,
    silentMs: null,
    last: '',
  }

  const before = work.kind === 'command' ? usual(durations, work.command) : null

  facts.usualMs = before?.ms ?? null
  facts.usualIsExact = before?.isExact ?? true

  try {
    if (work.kind === 'agent') {
      const messages = await $.session.messages({ agentId: work.id })

      if (Array.isArray(messages)) {
        const spoken = [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim())

        facts.last = tail(spoken?.text ?? '', 800)
      }
    } else if (work.outputPath) {
      const stat = await $.fs.stat(work.outputPath)

      facts.silentMs = Math.max(0, now - stat.mtimeMs)
      facts.last =
        stat.size <= READ_LIMIT ? tail(await $.fs.read(work.outputPath), 2500) : '(output too large to read)'
    }
  } catch {
    // An output file not written yet, or a conversation not readable: the
    // watcher judges by the time alone.
  }

  return facts
}

// One look at the work: the line rewritten, the main model woken if need be.
export async function check($: EngineInterface, settings: Settings): Promise<void> {
  await syncAgents($)

  const now = await $.clock.now()
  const list = await read($, watched)

  if (list.length === 0) {
    await update($, line, held => (held && now - held.at >= LINGER_MS ? null : held))

    return
  }

  const durations = await durationsOf($)
  const facts: Facts[] = []

  for (const work of list) {
    facts.push(await gather($, work, now, durations))
  }

  // Before the person has typed anything since the mod loaded, their last own
  // message in the transcript says which language they read; failing that, the
  // last one any session of theirs kept.
  if ((await read($, sample)) === '') {
    let found = ''

    try {
      const rows = await $.session.messages()

      found = [...rows]
        .reverse()
        .filter(row => row.role === 'user' && isOwnWords(row.text))
        .map(row => sampleOf(row.text))
        .find(text => /\p{L}{3}/u.test(text)) ?? ''
    } catch {
      // No transcript to read.
    }

    if (found === '') {
      const kept: unknown = await $.store.get(SAMPLE)

      found = typeof kept === 'string' ? kept : ''
    }

    if (found !== '') {
      await update($, sample, () => found)
    }
  }

  // A service whose output has not moved since the last look gives the
  // watcher nothing to read: it is not asked about it.
  const asked = facts.filter(f => needsWatcher(f, now))
  let report: ReturnType<typeof parseReport> = null

  if (asked.length > 0) {
    try {
      const reply = await $.model.complete({
        model: settings.model,
        system: systemPrompt(settings.language, await read($, sample)),
        prompt: asked.map(describe).join('\n\n---\n\n'),
        maxTokens: 300,
      })

      report = reply.isAnswered ? parseReport(reply.text) : null

      if (report === null) {
        $.ui.log(`task-watch: no report from ${settings.model}: ${reply.isAnswered ? 'an answer of another shape' : reply.reason}`, {
          to: 'debug',
        })
      }
    } catch (error) {
      // A model the engine refuses to call: the line falls back to the bare facts.
      $.ui.log(`task-watch: ${settings.model} was not asked: ${error instanceof Error ? error.message : String(error)}`, {
        to: 'debug',
      })
    }
  }

  // What this look learned: which work is a service, what it is called in the
  // person's language, and when each output moved.
  const services = new Set(report?.services ?? [])
  const titles = report?.titles ?? {}

  await update($, watched, all =>
    all.map(w => {
      const seen = facts.find(f => f.watched.id === w.id)
      const changedAt = seen ? outputAt(seen, now) : null

      return {
        ...w,
        service: w.service === true || services.has(w.id),
        outputAt: changedAt ?? w.outputAt ?? 0,
        ...(titles[w.id] ? { title: titles[w.id] } : {}),
      }
    }),
  )

  const known = await read($, watched)
  const current = (f: Facts): Facts => ({ ...f, watched: known.find(w => w.id === f.watched.id) ?? f.watched })
  const looked = facts.map(current)
  const stalled = looked.filter(f => isStalled(f, settings.stallMs))
  const longest = looked.reduce((a, b) => (b.elapsedMs > a.elapsedMs ? b : a))
  const suspect = report?.verdict === 'suspect' ? (looked.find(f => f.watched.id === report?.subject) ?? longest) : null
  const subject = stalled[0] ?? suspect
  const why =
    stalled.length > 0
      ? `⏸ ${formatSpan(stalled[0]!.silentMs ?? 0)}`
      : (report?.reason ?? '')
  // Work the main model said is fine stays quiet until its output moves again.
  const ackedAt = subject?.watched.ackedAt ?? 0
  const changedAt = subject ? outputAt(subject, now) : null
  const isAccepted = ackedAt > 0 && !(changedAt !== null && changedAt > ackedAt)
  const isWrong = subject !== null && !isAccepted
  // The watcher's words; for a quiet service, its name and how long it runs.
  const status =
    report?.status ??
    (looked.every(f => isService(f.watched))
      ? looked.map(f => `${nameOf(f.watched)} · ${formatSpan(f.elapsedMs)}`).join(' · ')
      : `⏳ ${list.length} · ${formatSpan(longest.elapsedMs)}`)
  const written: Line = {
    text: `${status}${isWrong && why ? ` — ${why}` : ''}`,
    level: isWrong ? 'warn' : 'info',
    at: now,
  }

  await update($, line, () => written)

  if (subject !== null && isWrong && settings.wake && mayAlert(subject.watched, changedAt)) {
    await update($, watched, all => all.map(w => (w.id === subject.watched.id ? { ...w, alertedAt: now } : w)))
    // A turn of its own once the session is idle; not awaited, as it resolves
    // only when that turn starts.
    // The main model reads the reason in English where the row shows a glyph.
    const reason = stalled[0] === subject ? `no output for ${formatSpan(subject.silentMs ?? 0)}` : why

    void $.prompt.submit({ text: wakeText(subject, reason || 'the watcher found it suspicious') })
  }
}

// The main model's word that a piece of work is fine: no more wake-ups over it
// until its output moves. Answers what the model reads back.
export async function acknowledge($: EngineInterface, id: string, isServiceWork: boolean): Promise<string> {
  const now = await $.clock.now()
  const known = (await read($, watched)).find(w => w.id === id)

  if (!known) {
    return `task-watch follows no work with id "${id}" now.`
  }

  await update($, watched, all =>
    all.map(w => (w.id === id ? { ...w, ackedAt: now, service: w.service === true || isServiceWork } : w)),
  )
  const calm: Line = { text: nameOf(known), level: 'info', at: now }

  await update($, line, held => (held?.level === 'warn' ? calm : held))

  return `task-watch will not raise "${known.label}" again until its output shows something new.`
}

export async function clearStale($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const isIdle = (await read($, watched)).length === 0

  await update($, line, held => (isIdle && held && now - held.at >= LINGER_MS ? null : held))
}

// A look that is still under way is not overtaken by the next one.
let isLooking = false

// One guarded look: what the timer runs, and what runs soon after work starts.
export async function look($: EngineInterface, settings: Settings): Promise<void> {
  if (isLooking) {
    return
  }

  isLooking = true

  try {
    await check($, settings)
  } catch (error) {
    // A failed look leaves the line as it was; the next one tries again.
    const said = error instanceof Error ? error.message : String(error)

    $.ui.log(`task-watch: a look at the work failed: ${said}`, { to: 'debug' })
  } finally {
    isLooking = false
  }
}

// The person's own message, kept as the sample of the language to write in,
// for this session and as the fallback of the next.
export async function remember($: EngineInterface, text: string): Promise<void> {
  if (!/\p{L}{3}/u.test(text)) {
    return
  }

  await update($, sample, () => text)
  await $.store.set(SAMPLE, text)
}
