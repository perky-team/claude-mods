import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  describe,
  formatSpan,
  isOwnWords,
  looksLikeService,
  needsWatcher,
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
  // A command never run before: the similar ones, said to be only similar.
  expect(usual(runs, 'npm test 22')).toEqual({ ms: 200, isExact: false })
  expect(usual(runs, 'npm run build')).toBe(null)
  // The very command, run before: its own runs, not the similar ones.
  runs = withRun(runs, 'npm test 22', 900)
  expect(usual(runs, 'npm test 22')).toEqual({ ms: 900, isExact: true })
  expect(usual(runs, 'npm test 1')).toEqual({ ms: 200, isExact: true })
  expect(usual(runs, 'npm test 7')).toEqual({ ms: 300, isExact: false })

  for (const ms of [1, 2, 3, 4, 5, 6]) {
    runs = withRun(runs, 'make', ms)
  }

  // Only the last five runs are kept.
  expect(usual(runs, 'make')).toEqual({ ms: 4, isExact: true })
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

test('servers and watchers are told from work that should end', async () => {
  for (const command of [
    'npx vite --host 127.0.0.1 --port 5199 --strictPort',
    'npm run dev',
    'pnpm dev',
    'next dev -p 3000',
    'python3 -m http.server 8000',
    'uvicorn app:app --reload',
    'tsc --watch',
    'tail -f /var/log/syslog',
    'docker compose up',
  ]) {
    expect([command, looksLikeService(command)]).toEqual([command, true])
  }

  for (const command of ['npm run build', 'npm test', 'cargo build --release', 'docker compose up -d', 'pytest -x']) {
    expect([command, looksLikeService(command)]).toEqual([command, false])
  }

  // A quiet service gives the watcher nothing new; a task always does.
  const server = facts({ watched: { ...facts().watched, command: 'npx vite', outputAt: START + 3 * MINUTE }, silentMs: 11 * MINUTE })
  expect(needsWatcher(server, START + 14 * MINUTE)).toBe(false)
  expect(needsWatcher({ ...server, silentMs: 0 }, START + 14 * MINUTE)).toBe(true)
  expect(needsWatcher(facts(), START + 14 * MINUTE)).toBe(true)
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
    subject: '',
    services: [],
    titles: {},
  })
  expect(parseReport('{"status": "Dev server up", "verdict": "ok", "reason": "", "subject": "", "services": ["b1", 7]}')?.services).toEqual(['b1'])
  expect(
    parseReport('Here you go:\n```json\n{"status": "Retrying\\nthe upload", "verdict": "suspect", "reason": "same error 5 times"}\n```'),
  ).toEqual({ status: 'Retrying the upload', verdict: 'suspect', reason: 'same error 5 times', subject: '', services: [], titles: {} })
  expect(
    parseReport('{"status": "Сборка", "verdict": "ok", "reason": "", "subject": "", "services": [], "titles": {"b1": "Сборка релиза", "b2": 5, "b3": " "}}')
      ?.titles,
  ).toEqual({ b1: 'Сборка релиза' })
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

  // Once for one state of the work: again only after its output moved.
  expect(mayAlert(watched, START)).toBe(true)
  expect(mayAlert({ ...watched, alertedAt: START }, START - MINUTE)).toBe(false)
  expect(mayAlert({ ...watched, alertedAt: START }, null)).toBe(false)
  expect(mayAlert({ ...watched, alertedAt: START }, START + MINUTE)).toBe(true)
  // Said to be fine: quiet until the output moves after that.
  expect(mayAlert({ ...watched, ackedAt: START }, START - MINUTE)).toBe(false)
  expect(mayAlert({ ...watched, ackedAt: START }, START + MINUTE)).toBe(true)

  // A service may be silent: no stall.
  expect(isStalled(facts({ watched: { ...watched, command: 'npx vite --port 5199' } }), 10 * MINUTE)).toBe(false)
  expect(isStalled(facts({ watched: { ...watched, service: true } }), 10 * MINUTE)).toBe(false)

  const wake = wakeText(facts(), 'no output for 11m 0s')

  expect(wake.includes('"Build the app" (id b1)')).toBe(true)
  expect(wake.includes('earlier runs took about 3m 0s')).toBe(true)
  expect(wake.includes('Why: no output for 11m 0s')).toBe(true)
  expect(wake.includes('call mcp__task-watch__acknowledge with id "b1"')).toBe(true)
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
  expect((await ui.find({ type: 'Text', text: /./ }))?.text).toBe('⚠ 22.11 14:40 · Waiting for the server — ⏸ 10m 0s')
  await ui.unmount()
})

// The engine beneath the mod for a background command: its output's time and
// text, the watcher's answers, and what the main model is told.
const world = (on: On, command: string) => {
  const state = {
    outputChangedAt: START,
    output: 'VITE v6 ready in 300 ms\nLocal: http://127.0.0.1:5199/',
    reply: '{"status": "Dev server ready on 5199", "verdict": "ok", "reason": "", "subject": "", "services": ["b9"]}',
    asked: 0,
    woken: [] as string[],
    tools: [] as string[],
  }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: [] }))
  on('tool.register', (_, e) => {
    state.tools.push(e.name)

    return { value: { tool: `mcp__task-watch__${e.name}` } }
  })
  on('tool.call', (_, e) =>
    e.tool === 'Bash'
      ? {
          result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b9' },
          text: 'Output is being written to: /tmp/x/b9.output.',
        }
      : { result: {} },
  )
  on('fs.stat', () => ({ value: { kind: 'file', size: 60, mtimeMs: state.outputChangedAt, isLink: false } }))
  on('fs.read', () => ({ value: state.output }))
  on('model.complete', () => {
    state.asked += 1

    return {
      value: {
        isAnswered: true,
        text: state.reply,
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    }
  })
  on('prompt.submit', (_, e) => {
    state.woken.push(e.text)

    return { text: e.text }
  })

  return { state, command }
}

test('a dev server that sits quiet for an hour is not raised, and costs one look', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(START)
  mock.store(on)

  const { state } = world(on, 'npx vite --host 127.0.0.1 --port 5199 --strictPort')

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(state.tools).toEqual(['acknowledge'])
  await $.tool.call({ tool: 'Bash', command: 'npx vite --host 127.0.0.1 --port 5199 --strictPort', description: 'Vite dev server', run_in_background: true })

  // The first look asks the watcher; after that the output never moves.
  await clock.advance(20 * 1000)
  expect(state.asked).toBe(1)
  await clock.advance(80 * MINUTE)

  expect(state.asked).toBe(1)
  expect(state.woken.length).toBe(0)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Vite/ }))?.text).toBe('▸ 22.11 15:50 · Vite dev server · 1h 20m')
  await ui.unmount()

  // Its output moves: the watcher reads it again.
  state.outputChangedAt = START + 81 * MINUTE
  await clock.advance(5 * MINUTE)
  expect(state.asked).toBe(2)
})

test('a task raised once is not raised again until it changes, and the model can call it fine', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(START)
  mock.store(on)

  const { state } = world(on, 'deploy.sh')

  state.output = 'uploading…'
  state.reply = '{"status": "Uploading the release", "verdict": "ok", "reason": "", "subject": "", "services": []}'

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'deploy.sh', description: 'Deploy', run_in_background: true })

  // Silent past the stall time: one wake-up, naming the tool to answer with.
  await clock.advance(10 * MINUTE)
  expect(state.woken.length).toBe(1)
  expect(state.woken[0]!.includes('mcp__task-watch__acknowledge with id "b9"')).toBe(true)

  // Still silent an hour on: no more wake-ups.
  await clock.advance(60 * MINUTE)
  expect(state.woken.length).toBe(1)

  // The model says it is fine: the line calms down.
  const ack = await $.tool.call({ tool: 'mcp__task-watch__acknowledge', id: 'b9', service: false })
  expect(JSON.stringify(ack).includes('will not raise \\"Deploy\\" again')).toBe(true)

  const calm = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await calm.find({ type: 'Text', text: /Deploy|Uploading/ }))?.text?.startsWith('▸')).toBe(true)
  await calm.unmount()

  await clock.advance(30 * MINUTE)
  expect(state.woken.length).toBe(1)

  // New output with an error after that: raised again.
  state.output = 'uploading…\nERROR: 503 from the registry'
  state.reply = '{"status": "Upload failing", "verdict": "suspect", "reason": "the registry answers 503", "subject": "b9", "services": []}'
  state.outputChangedAt = await clock.now()
  await clock.advance(5 * MINUTE)
  expect(state.woken.length).toBe(2)
  expect(state.woken[1]!.includes('Why: the registry answers 503')).toBe(true)
})

test('the language sample leaves out what is not the person\'s own words', async () => {
  expect(
    sampleOf('<!-- reply 1 -->\n> Status every 5 minutes on long work\n\nэто поправишь? `npm run build` https://example.com/x'),
  ).toBe('это поправишь?')
  expect(sampleOf('```\nTraceback (most recent call last)\n```\nпочему падает?')).toBe('почему падает?')
  expect(isOwnWords('task-watch: the background command "x" may need attention.')).toBe(false)
  expect(isOwnWords('<task-notification>')).toBe(false)
  expect(isOwnWords('почему?')).toBe(true)
})

test('the row names work by the watcher\'s title, in the person\'s language', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(START)
  mock.store(on)

  const { state } = world(on, 'npx vite --port 5199')

  state.reply =
    '{"status": "Сервер Vite запущен на 5199", "verdict": "ok", "reason": "", "subject": "", "services": ["b9"], "titles": {"b9": "Сервер Vite"}}'

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npx vite --port 5199', description: 'Start the Vite dev server', run_in_background: true })

  const shown = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const text = (await ui.find({ type: 'Text', text: /./ }))?.text
    await ui.unmount()

    return text
  }

  // Until the first look: the name the session gave.
  expect(await shown()).toBe('▸ 22.11 14:30 · Start the Vite dev server')
  await clock.advance(20 * 1000)
  expect(await shown()).toBe('▸ 22.11 14:30 · Сервер Vite запущен на 5199')
  // A quiet service after that: the watcher's title, no English of the mod's.
  await clock.advance(30 * MINUTE)
  expect(await shown()).toBe('▸ 22.11 15:00 · Сервер Vite · 30m 0s')
})
