import { expect, mock, test } from 'claude-code/testing'

import {
  describe,
  formatSpan,
  formatStamp,
  sampleOf,
  systemPrompt,
  isStalled,
  isTimer,
  mayAlert,
  notified,
  outputPathIn,
  parseReport,
  readSettings,
  signature,
  usual,
  wakeText,
  withRun,
} from './logic'
import type { Facts } from './logic'

const BAND = {
  plugin: 'task-watch',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const MINUTE = 60 * 1000
const START = new Date(2026, 10, 22, 14, 30).getTime()

const facts = (over: Partial<Facts> = {}): Facts => ({
  watched: {
    kind: 'command',
    id: 'b1',
    label: 'Build the app',
    command: 'npm run build',
    startedAt: START,
    outputPath: '/tmp/b1.output',
    alertedAt: 0,
  },
  elapsedMs: 14 * MINUTE,
  usualMs: 3 * MINUTE,
  silentMs: 11 * MINUTE,
  last: 'compiling…',
  ...over,
})

test('the options are read with their defaults and floors', async () => {
  expect(readSettings({})).toEqual({
    intervalMs: 5 * MINUTE,
    stallMs: 10 * MINUTE,
    model: 'haiku',
    language: 'auto',
    wake: true,
  })
  expect(readSettings({ intervalMinutes: 0.2, stallMinutes: -3, model: ' ', language: 'Russian', wake: false })).toEqual({
    intervalMs: MINUTE,
    stallMs: 10 * MINUTE,
    model: 'haiku',
    language: 'Russian',
    wake: false,
  })
})

test('what the engine says of a background command is read', async () => {
  expect(isTimer('sleep 290')).toBe(true)
  expect(isTimer(' sleep 5m ')).toBe(true)
  expect(isTimer('sleep 5 && npm test')).toBe(false)
  expect(outputPathIn('Command running in background with ID: b1. Output is being written to: /tmp/x/b1.output. You will')).toBe(
    '/tmp/x/b1.output',
  )
  expect(outputPathIn('nothing here')).toBe(null)
  expect(notified('<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>')).toEqual({
    id: 'b1',
    status: 'completed',
  })
  expect(notified('<task-id> a9 </task-id>')).toEqual({ id: 'a9', status: 'finished' })
  expect(notified('hello')).toBe(null)
})

test('earlier runs of a command give its usual time', async () => {
  expect(signature('  npm   run build --port 8080 ')).toBe('npm run build --port #')

  let runs = {}

  for (const ms of [100, 300, 200]) {
    runs = withRun(runs, 'npm test 1', ms)
  }

  // The numbers in a command do not make it another command.
  expect(usual(runs, 'npm test 22')).toBe(200)
  expect(usual(runs, 'npm run build')).toBe(null)

  for (const ms of [1, 2, 3, 4, 5, 6]) {
    runs = withRun(runs, 'make', ms)
  }

  // Only the last five runs are kept.
  expect(usual(runs, 'make')).toBe(4)
})

test('the watcher is told which language to write in', async () => {
  expect(formatStamp(START)).toBe('22.11 14:30')
  expect(sampleOf('  ничего   не\nпроисходит ')).toBe('ничего не происходит')
  expect(sampleOf('x'.repeat(500)).length).toBe(200)
  // A language named in the options wins; `auto` follows the person's message.
  expect(systemPrompt('German', 'ничего не происходит').includes('in German:')).toBe(true)
  expect(systemPrompt('auto', 'ничего не происходит').includes('written in: «ничего не происходит»')).toBe(true)
  expect(systemPrompt('Auto', '').includes('in English:')).toBe(true)
})

test('spans read as a person says them', async () => {
  expect(formatSpan(42 * 1000)).toBe('42s')
  expect(formatSpan(192 * 1000)).toBe('3m 12s')
  expect(formatSpan(134 * MINUTE)).toBe('2h 14m')
})

test("the watcher's answer is read leniently", async () => {
  expect(parseReport('{"status": "Compiling, 60% done", "verdict": "ok", "reason": ""}')).toEqual({
    status: 'Compiling, 60% done',
    verdict: 'ok',
    reason: '',
  })
  expect(
    parseReport('Here you go:\n```json\n{"status": "Retrying\\nthe upload", "verdict": "suspect", "reason": "same error 5 times"}\n```'),
  ).toEqual({ status: 'Retrying the upload', verdict: 'suspect', reason: 'same error 5 times' })
  // An unknown verdict is no alarm; no status is no report.
  expect(parseReport('{"status": "Working", "verdict": "maybe"}')?.verdict).toBe('ok')
  expect(parseReport('{"verdict": "ok"}')).toBe(null)
  expect(parseReport('no json at all')).toBe(null)
  expect(parseReport('{broken')).toBe(null)
})

test('the facts, the stall rule and the wake-up text', async () => {
  const text = describe(facts())

  expect(text.includes('Command: Build the app')).toBe(true)
  expect(text.includes('Running for: 14m 0s')).toBe(true)
  expect(text.includes('Usual duration of earlier runs: 3m 0s')).toBe(true)
  expect(text.includes('Output last changed: 11m 0s ago')).toBe(true)
  expect(describe(facts({ usualMs: null, silentMs: null, last: '' })).includes('unknown, first run on record')).toBe(true)

  expect(isStalled(facts(), 10 * MINUTE)).toBe(true)
  // Silent, but not yet running that long itself; or with no output to judge by.
  expect(isStalled(facts({ elapsedMs: 4 * MINUTE }), 10 * MINUTE)).toBe(false)
  expect(isStalled(facts({ silentMs: null }), 10 * MINUTE)).toBe(false)

  const { watched } = facts()

  expect(mayAlert(watched, START, 5 * MINUTE)).toBe(true)
  expect(mayAlert({ ...watched, alertedAt: START }, START + 10 * MINUTE, 5 * MINUTE)).toBe(false)
  expect(mayAlert({ ...watched, alertedAt: START }, START + 15 * MINUTE, 5 * MINUTE)).toBe(true)

  const wake = wakeText(facts(), 'no output for 11m 0s')

  expect(wake.includes('"Build the app" (id b1)')).toBe(true)
  expect(wake.includes('earlier runs took about 3m 0s')).toBe(true)
  expect(wake.includes('Why: no output for 11m 0s')).toBe(true)
})

test('a background command is followed from its start to its end', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(START)
  mock.store(on)

  const woken: string[] = []
  const asked: { model: string; prompt: string; system: string }[] = []
  let reply = '{"status": "Compiling, 60% done", "verdict": "ok", "reason": ""}'
  let outputChangedAt = START

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] }))
  on('tool.call', (_, e) =>
    e.tool === 'Bash'
      ? {
          result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: e.command === 'sleep 290' ? 't1' : 'b1' },
          text: 'Command running in background with ID: b1. Output is being written to: /tmp/x/b1.output. You will be notified.',
        }
      : { result: {} },
  )
  on('fs.stat', () => ({ value: { kind: 'file', size: 20, mtimeMs: outputChangedAt, isLink: false } }))
  on('fs.read', () => ({ value: 'webpack: 60% building' }))
  on('model.complete', (_, e) => {
    asked.push({ model: e.model, prompt: String(e.prompt), system: String(e.system) })

    return {
      value: {
        isAnswered: true,
        text: reply,
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
  on('prompt.submit', (_, e) => {
    if (e.origin.kind === 'plugin') {
      woken.push(e.text)
    }

    return { text: e.text }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const shown = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const text = (await ui.find({ type: 'Text', text: /./ }))?.text
    await ui.unmount()

    return text
  }

  // Nothing to watch: no row. A pacing timer of the session's is not work.
  expect(await shown()).toBe(undefined)
  await $.tool.call({ tool: 'Bash', command: 'sleep 290', run_in_background: true })
  expect(await shown()).toBe(undefined)

  await $.prompt.submit({ text: 'собери приложение', origin: { kind: 'composer' }, wait: false })
  await $.tool.call({ tool: 'Bash', command: 'npm run build', description: 'Build the app', run_in_background: true })
  expect(await shown()).toBe('▸ 22.11 14:30 · Build the app')

  // Twenty seconds on, the first look: the watcher's words take the name's place.
  reply = '{"status": "Starting the build", "verdict": "ok", "reason": ""}'
  await clock.advance(20 * 1000)
  expect(await shown()).toBe('▸ 22.11 14:30 · Starting the build')
  expect(asked.length).toBe(1)

  // Five minutes from the start: the next line, under the clock's time.
  reply = '{"status": "Compiling, 60% done", "verdict": "ok", "reason": ""}'
  outputChangedAt = START + 4 * MINUTE
  await clock.advance(5 * MINUTE - 20 * 1000)
  expect(await shown()).toBe('▸ 22.11 14:35 · Compiling, 60% done')
  expect(asked.length).toBe(2)
  expect(asked[0]!.model).toBe('haiku')
  expect(asked[0]!.prompt.includes('Command: Build the app')).toBe(true)
  expect(asked[1]!.prompt.includes('webpack: 60% building')).toBe(true)
  expect(asked[1]!.system.includes('«собери приложение»')).toBe(true)
  expect(woken.length).toBe(0)

  // The watcher finds it suspicious: a warning, and the main model is woken once.
  reply = '{"status": "Upload keeps failing", "verdict": "suspect", "reason": "same error five times"}'
  outputChangedAt = START + 9 * MINUTE
  await clock.advance(5 * MINUTE)
  expect(await shown()).toBe('⚠ 22.11 14:40 · Upload keeps failing — same error five times')
  expect(woken.length).toBe(1)
  expect(woken[0]!.includes('task-watch: the background command "Build the app" (id b1)')).toBe(true)
  expect(woken[0]!.includes('Why: same error five times')).toBe(true)

  // Still wrong at the next look: the line says so, the model is not woken again yet.
  await clock.advance(5 * MINUTE)
  expect(woken.length).toBe(1)

  // The engine reports the end: the line says how long it took, then goes.
  await $.prompt.submit({
    text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>',
    origin: { kind: 'task-notification' },
    wait: false,
  })
  expect(await shown()).toBe('✓ 22.11 14:45 · Build the app · 15m 0s')
  await clock.advance(2 * MINUTE)
  expect(await shown()).toBe(undefined)
})

test('output that stopped changing wakes the main model whatever the watcher says', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(START)
  mock.store(on)

  const woken: string[] = []

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => ({
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b2' },
    text: 'Output is being written to: /tmp/x/b2.output.',
  }))
  // Written once at the start, never again.
  on('fs.stat', () => ({ value: { kind: 'file', size: 5, mtimeMs: START, isLink: false } }))
  on('fs.read', () => ({ value: 'start' }))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: '{"status": "Waiting for the server", "verdict": "ok", "reason": ""}',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  on('prompt.submit', (_, e) => {
    woken.push(e.text)

    return { text: e.text }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'deploy.sh', run_in_background: true })

  await clock.advance(5 * MINUTE)
  expect(woken.length).toBe(0)

  await clock.advance(5 * MINUTE)
  expect(woken.length).toBe(1)
  expect(woken[0]!.includes('Why: no output for 10m 0s')).toBe(true)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /./ }))?.text).toBe('⚠ 22.11 14:40 · Waiting for the server — no output for 10m 0s')
  await ui.unmount()
})
