import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Report } from '../types'
import {
  WORDS,
  coresLevel,
  filled,
  formatBytes,
  glance,
  languageOf,
  machineLevel,
  parseRefusal,
  parseReport,
  queuesLine,
  shareLevel,
  tempLevel,
} from './logic'

const G = 2 ** 30
const M = 2 ** 20

const REPORT: Report = {
  machine: {
    host: 'dev-box',
    load: [0.63, 0.5, 0.4],
    cpus: 16,
    ram_used: 7.5 * G,
    ram_total: 26.7 * G,
    swap_used: 0,
    disk_used: 146 * G,
    disk_total: 915 * G,
    temps: [{ kind: 'CPU', degrees: 42 }],
  },
  queues: [
    { name: 'heavy', free: true },
    { name: 'deploy', free: false, job: 'build.sh', holder: 'Release (shop)', since: '14:02' },
  ],
  owners: [
    {
      name: 'Claude Desktop: its sessions',
      cores: 2.4,
      mem: 1.5 * G,
      what: 'sessions: 2',
      sessions: [
        { name: 'Visual editor (shop)', cores: 2.3, mem: 420 * M, note: 'working', swap: 0, busy: true, waiting: false },
        { name: 'linux (no project)', cores: 0.01, mem: 202 * M, note: 'idle 2 min', swap: 0, busy: false, waiting: false },
      ],
    },
    { name: 'containerd (Docker)', cores: 0.3, mem: 600 * M, what: 'containerd', sessions: [] },
  ],
  docker: { count: 3, cores: 0.02, mem: 300 * M },
}

const PANE = {
  plugin: 'machine-monitor',
  component: 'Pane',
  requestId: 'machine-monitor',
  props: {
    title: 'Machine',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BANDLIST = {
  plugin: 'machine-monitor',
  component: 'AbovePromptList',
  props: {
    rows: [],
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

// A command typed at the prompt of a terminal 80 cells wide.
const typed = { command: 'monitor', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

type Pane = { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }

// The engine beneath the plugin: panes, the script's answers, the plugin's folder.
const engine = (on: On, answer: () => { exitCode: number; stdout: string; stderr?: string }) => {
  const world = { panes: [] as Pane[], runs: [] as string[][] }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'monitor' } }))
  on('process.hookEnv', () => ({ value: { CLAUDE_PLUGIN_ROOT: '/plugins/machine-monitor' } }))
  on('ui.open', (_, e) => {
    world.panes = [{ id: e.id, title: e.title ?? '', isShown: true, isFocused: false, isPlaced: true }]

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    world.panes = []

    return { value: undefined }
  })
  on('ui.panes', () => ({ value: world.panes }))
  on('process.run', (_, e) => {
    world.runs.push([...e.argv])

    const { exitCode, stdout, stderr = '' } = answer()

    return { value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return world
}

const ok = () => ({ exitCode: 0, stdout: JSON.stringify(REPORT) })

test('the report and the refusal are read only in their shapes', async () => {
  expect(parseReport(JSON.stringify(REPORT))?.machine.host).toBe('dev-box')
  expect(parseReport('not json')).toBe(null)
  expect(parseReport('{"machine": {}, "owners": [], "queues": []}')).toBe(null)
  expect(parseRefusal('{"unsupported": "machine-monitor reads Linux only; this is darwin"}')?.unsupported).toBe(
    'machine-monitor reads Linux only; this is darwin',
  )
  expect(parseRefusal(JSON.stringify(REPORT))).toBe(null)
  expect(languageOf('ru')).toBe('ru')
  expect(languageOf('de')).toBe('en')
})

test('the figures, their levels and their words', async () => {
  expect(formatBytes(420 * M)).toBe('420M')
  expect(formatBytes(7.5 * G)).toBe('7.5G')
  expect(shareLevel(0.75)).toBe('warning')
  expect(tempLevel(90)).toBe('error')
  expect(coresLevel(2.4)).toBe('warning')
  expect(filled(0.04)).toBe(1)
  expect(queuesLine(REPORT, WORDS.en)).toBe('heavy free · deploy build.sh — «Release (shop)» since 14:02')
  expect(queuesLine(REPORT, WORDS.ru)).toBe('heavy свободна · deploy build.sh — «Release (shop)» с 14:02')
  expect(glance(REPORT)).toBe('load 0.63/16 · RAM 7.5G/26.7G · 42°')
  expect(machineLevel(REPORT)).toBe('success')
})

test('/monitor and the button open the pane, the plugin script draws it, and it closes', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(1_000_000)
  mock.store(on)

  const world = engine(on, ok)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // The first look of the session: short, from the plugin's own folder.
  expect(world.runs).toEqual([
    ['python3', '-I', '/plugins/machine-monitor/skills/machine-monitor/resources.py', '--json', '--lang', 'en', '-i', '0.2'],
  ])

  const opened = await $.command.run(typed)
  expect((opened as { text?: string }).text).toBe('The machine pane is open')
  expect(world.panes[0]?.title).toBe('Machine')
  expect(world.runs.length).toBe(2)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /dev-box/ }))?.text).toBe('dev-box')
    expect((await ui.find({ type: 'Text', text: /of 16/ }))?.text).toBe('0.63 of 16')
    expect((await ui.find({ type: 'Text', text: /^heavy free/ }))?.text).toBe('heavy free · deploy build.sh — «Release (shop)» since 14:02')
    expect((await ui.find({ type: 'Text', text: /^WHO$/ }))?.text).toBe('WHO')
    expect((await ui.find({ type: 'Text', text: /^Docker:/ }))?.text).toBe('Docker: 3')
    expect((await ui.find({ type: 'Text', text: /^updated/ }))?.text).toBe('updated 0 s ago')
    await ui.unmount()
  }

  // The timer reads again while the pane is shown, and not while it is hidden.
  await clock.advance(5000)
  expect(world.runs.length).toBe(3)
  world.panes = [{ ...world.panes[0]!, isShown: false }]
  await clock.advance(5000)
  expect(world.runs.length).toBe(3)

  // The button beside the band's rows closes it, and opens it again.
  const band = await $.ui.mount({ ...BANDLIST, surface: 'desktop' })
  expect(await band.find({ key: 'machine-monitor-toggle' })).toBeTruthy()
  await band.press({ key: 'machine-monitor-toggle' })
  expect(world.panes.length).toBe(0)
  await band.press({ key: 'machine-monitor-toggle' })
  expect(world.panes.length).toBe(1)
  await band.unmount()

  const closed = await $.command.run(typed)
  expect((closed as { text?: string }).text).toBe('The machine pane is closed')
  const before = world.runs.length
  await clock.advance(20000)
  expect(world.runs.length).toBe(before)
})

test('the pane speaks Russian when the option says so', { options: { language: 'ru' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)

  const world = engine(on, ok)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(world.runs[0]).toContain('ru')

  const opened = await $.command.run(typed)
  expect((opened as { text?: string }).text).toBe('Панель машины открыта')
  expect(world.panes[0]?.title).toBe('Машина')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /из 16/ }))?.text).toBe('0.63 из 16')
  expect((await ui.find({ type: 'Text', text: /^КТО$/ }))?.text).toBe('КТО')
  await ui.unmount()
})

test('a machine the script cannot read: no button, and the pane says why', async ($, on) => {
  mock.clock(on)
  mock.store(on)

  engine(on, () => ({ exitCode: 3, stdout: '{"unsupported": "machine-monitor reads Linux only; this is darwin"}' }))
  on('ui.render', { component: 'AbovePromptList' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>usage row</Text>
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const band = await $.ui.mount({ ...BANDLIST, surface: 'desktop' })
  expect((await band.find({ type: 'Text', text: /usage row/ }))?.text).toBe('usage row')
  expect(await band.find({ key: 'machine-monitor-toggle' })).toBeFalsy()
  await band.unmount()

  await $.command.run(typed)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Linux only/ }))?.text).toBe('machine-monitor reads Linux only; this is darwin')
  await ui.unmount()
})

test('a script that fails says so, and keeps the last figures', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)

  let answer = ok()
  const world = engine(on, () => answer)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(typed)

  answer = { exitCode: 1, stdout: '', stderr: 'Traceback: something broke' } as typeof answer
  await clock.advance(5000)
  expect(world.runs.length).toBe(3)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /dev-box/ }))?.text).toBe('dev-box')
  expect((await ui.find({ type: 'Text', text: /^updated/ }))?.text).toBe('updated 5 s ago · the last reading failed: Traceback: something broke')
  await ui.unmount()
})

test('a pane that was open when the session ended opens with the next', async ($, on) => {
  mock.clock(on)
  mock.store(on, { open: true })

  const world = engine(on, ok)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(world.panes.length).toBe(1)
})
