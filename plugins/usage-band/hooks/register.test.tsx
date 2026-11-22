import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { barsSvg, leftColor, textWidth } from './svg'
import { barColor, filledCells, formatFable, formatPace, formatReset, toSnapshot, paceColor, weeklyPace, windowElapsed, formatLeftDays, formatLeftHours, leftShare, live, windowPace, countActive, formatAgents, formatCommands, isTimer, endedTask, FIVE_HOURS_MS } from './format'

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const fiveHourReset = new Date(2026, 10, 22, 18, 40).toISOString()
const sevenDayReset = new Date(2026, 10, 25, 9, 0).toISOString()

test('a reset is written as local hours:minutes day.month', async () => {
  expect(formatReset(fiveHourReset)).toBe('18:40 22.11')
  expect(formatReset(null)).toBe('')
  expect(formatReset('not a date')).toBe('')
})

test('the bar fills and colors by the percent', async () => {
  expect(filledCells(null)).toBe(0)
  expect(filledCells(0)).toBe(0)
  expect(filledCells(2)).toBe(1)
  expect(filledCells(42)).toBe(4)
  expect(filledCells(100)).toBe(10)
  expect(filledCells(140)).toBe(10)
  expect(barColor(42)).toBe('success')
  expect(barColor(70)).toBe('warning')
  expect(barColor(90)).toBe('error')
})

test('the weekly pace is the use against an even seven-day plan', async () => {
  const reset = Date.parse(sevenDayReset)
  const day = 24 * 60 * 60 * 1000
  const limit = (percentUsed: number) => ({ percentUsed, resetsAt: sevenDayReset })

  // Three and a half days in, an even plan has used 50%.
  const ahead = weeklyPace(limit(64), reset - 3.5 * day)
  expect(ahead?.expected).toBe(50)
  expect(formatPace(ahead!)).toBe('▲ +14%')
  expect(paceColor(ahead!)).toBe('error')

  const behind = weeklyPace(limit(42), reset - 3.5 * day)
  expect(formatPace(behind!)).toBe('▼ −8%')
  expect(paceColor(behind!)).toBe('success')

  expect(formatPace(weeklyPace(limit(50), reset - 3.5 * day)!)).toBe('= 0%')
  expect(paceColor(weeklyPace(limit(55), reset - 3.5 * day)!)).toBe('warning')
  // A window whose reset has passed is the old one: nothing is said of it.
  expect(live(limit(80), reset + day)).toBe(null)
  expect(live(limit(80), reset)).toBe(null)
  expect(live(limit(80), reset - day)?.percentUsed).toBe(80)
  expect(live({ percentUsed: 5, resetsAt: null }, reset)?.percentUsed).toBe(5)
  expect(weeklyPace(live(limit(80), reset + day), reset + day)).toBe(null)
  expect(weeklyPace(null, reset)).toBe(null)
  expect(weeklyPace({ percentUsed: 5, resetsAt: null }, reset)).toBe(null)
})

test('the band draws three meters and the pace, on both surfaces', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(Date.parse(sevenDayReset) - 3.5 * 24 * 60 * 60 * 1000)
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { window: 200000, tokens: 84000, percent: 42 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 31.4, resetsAt: fiveHourReset },
      { kind: 'seven_day', percentUsed: 87, resetsAt: sevenDayReset },
      { kind: 'spend_limit', percentUsed: 99 },
    ],
    changed: ['context', 'rateLimits'],
  })

  // The terminal has no Svg: one line of glyphs.
  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // The clock stands 3 days 12 hours before the weekly reset, and 21 h 40 min
  // before the five-hour one.
  expect((await terminal.find({ type: 'Text', text: /▲/ }))?.text).toBe(
    '████░░░░░░  ·  ███░░░░░░░ ▲ +31% 21:40  ·  █████████░ ▲ +37% 3:12:00  ·  ◉ 0  ·  ▣ 0',
  )
  await terminal.unmount()

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const picture = await desktop.find({ type: 'Svg' })
  expect(picture).toBeTruthy()
  expect(await desktop.find({ type: 'Text', text: /▲/ })).toBeFalsy()
  await desktop.unmount()
})

test('the time passed is the share of the window behind the clock', async () => {
  const reset = Date.parse(fiveHourReset)
  const limit = { percentUsed: 10, resetsAt: fiveHourReset }

  expect(windowElapsed(limit, FIVE_HOURS_MS, reset - FIVE_HOURS_MS)).toBe(0)
  expect(windowElapsed(limit, FIVE_HOURS_MS, reset - FIVE_HOURS_MS / 4)).toBe(75)
  expect(windowElapsed(limit, FIVE_HOURS_MS, reset + 1000)).toBe(100)
  expect(windowElapsed(limit, FIVE_HOURS_MS, reset - 2 * FIVE_HOURS_MS)).toBe(0)
  expect(windowElapsed(null, FIVE_HOURS_MS, reset)).toBe(null)
  expect(windowElapsed({ percentUsed: 10, resetsAt: null }, FIVE_HOURS_MS, reset)).toBe(null)
})

test('the time left is written 04:55 and 6:12:41', async () => {
  const reset = Date.parse(sevenDayReset)
  const limit = { percentUsed: 10, resetsAt: sevenDayReset }
  const minute = 60 * 1000
  const hour = 60 * minute

  expect(formatLeftHours(limit, reset - (4 * hour + 55 * minute))).toBe('04:55')
  expect(formatLeftHours(limit, reset - 20 * 1000)).toBe('00:01')
  expect(formatLeftHours(limit, reset + hour)).toBe('00:00')
  expect(formatLeftDays(limit, reset - (6 * 24 * hour + 12 * hour + 41 * minute))).toBe('6:12:41')
  expect(formatLeftDays(limit, reset - 5 * minute)).toBe('0:00:05')
  expect(formatLeftDays(limit, reset + hour)).toBe('0:00:00')
  expect(formatLeftHours(null, reset)).toBe('')
  expect(formatLeftDays({ percentUsed: 10, resetsAt: null }, reset)).toBe('')
})

test('a Fable window, where one is reported, is written f15%', async ($, on) => {
  const windows = [
    { kind: 'five_hour', percentUsed: 31 },
    { kind: 'seven_day', percentUsed: 57, resetsAt: sevenDayReset },
    { kind: 'seven_day_fable', percentUsed: 14.6, resetsAt: sevenDayReset },
  ]
  const figures = toSnapshot({ context: {}, rateLimits: windows })

  expect(formatFable(figures.fable!)).toBe('f15%')
  expect(toSnapshot({ context: {}, rateLimits: windows.slice(0, 2) }).fable).toBe(null)
  expect(barsSvg([{ percent: 1, left: '', leftShare: null, pace: null }], [{ text: 'f15%' }]).source.includes('>f15%<')).toBe(true)

  mock.clock(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure({ context: { window: 200000 }, rateLimits: windows, changed: ['rateLimits'] })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /f15%/ }))?.text.endsWith('  ·  ◉ 0  ·  ▣ 0  ·  f15%')).toBe(true)
  await ui.unmount()
})

test('the five-hour pace is the use against an even five-hour plan', async () => {
  const reset = Date.parse(fiveHourReset)
  const limit = { percentUsed: 71, resetsAt: fiveHourReset }

  // Half the window gone: the plan stands at 50%.
  const pace = windowPace(limit, FIVE_HOURS_MS, reset - FIVE_HOURS_MS / 2)
  expect(pace?.expected).toBe(50)
  expect(formatPace(pace!)).toBe('▲ +21%')
  expect(windowPace(null, FIVE_HOURS_MS, reset)).toBe(null)
})

test('the time left is colored in proportion: red far, amber half way, green near', async () => {
  expect(leftColor(1)).toBe('#ef4444')
  expect(leftColor(0.5)).toBe('#f59e0b')
  expect(leftColor(0)).toBe('#22c55e')
  // Half way between two stops is half way between their colors.
  expect(leftColor(0.75)).toBe('#f27128')
  expect(leftColor(0.25)).toBe('#8cb235')
  expect(leftColor(2)).toBe('#ef4444')
  expect(leftColor(-1)).toBe('#22c55e')

  const reset = Date.parse(fiveHourReset)
  const limit = { percentUsed: 10, resetsAt: fiveHourReset }

  expect(leftShare(limit, FIVE_HOURS_MS, reset - FIVE_HOURS_MS)).toBe(1)
  expect(leftShare(limit, FIVE_HOURS_MS, reset - FIVE_HOURS_MS / 4)).toBe(0.25)
  expect(leftShare(null, FIVE_HOURS_MS, reset)).toBe(null)
})

test('the picture writes the time left and the pace, no percent figures', async () => {
  const picture = barsSvg(
    [
      { percent: 42, left: '', leftShare: null, pace: null },
      { percent: 31.4, left: '04:55', leftShare: 1, pace: { expected: 40, delta: -8.6 } },
      { percent: 87, left: '6:12:41', leftShare: 0, pace: { expected: 50, delta: 37 } },
    ],
  )
  const count = (part: string) => picture.source.split(part).length - 1

  expect(picture.source.startsWith('<svg ')).toBe(true)
  expect(picture.source.endsWith('</svg>')).toBe(true)
  expect(picture.source.includes('NaN')).toBe(false)
  expect(picture.source.includes('undefined')).toBe(false)
  // Three level tracks and three fills, nothing else drawn as a bar.
  expect(count('height="8"')).toBe(6)
  // Two times left and two paces.
  expect(count('<text')).toBe(4)
  // A dot between one meter and the next.
  expect(count('<circle')).toBe(2)
  expect(picture.source.includes('>▼ −9%<')).toBe(true)
  // The pace stands before the time left.
  expect(picture.source.indexOf('>▼ −9%<') < picture.source.indexOf('>04:55<')).toBe(true)
  expect(picture.source.includes('fill="#ef4444">04:55<')).toBe(true)
  expect(picture.source.includes('fill="#22c55e">6:12:41<')).toBe(true)

  // The space is the same on both sides of each dot: 11 from the edge of what
  // stands before it, 11 to the bar after it.
  const dots = [...picture.source.matchAll(/<circle cx="([\d.]+)"/g)].map(m => Number(m[1]))
  const bars = [...picture.source.matchAll(/<rect x="([\d.]+)" y="7" width="96"/g)].map(m => Number(m[1]))
  expect(bars.length).toBe(3)
  expect(Math.round((dots[0]! - (bars[0]! + 96)) * 10) / 10).toBe(11)
  expect(Math.round((bars[1]! - dots[0]!) * 10) / 10).toBe(11)
  expect(Math.round((bars[2]! - dots[1]!) * 10) / 10).toBe(11)
  // The second dot stands 11 past the end of "04:55", whose width the picture fixes.
  const time = /<text x="([\d.]+)"[^>]*textLength="([\d.]+)"[^>]*>04:55</.exec(picture.source)!
  expect(Number(time[2])).toBe(textWidth('04:55'))
  expect(Math.round((dots[1]! - (Number(time[1]) + Number(time[2]))) * 10) / 10).toBe(11)
  expect(picture.source.includes('>▲ +37%<')).toBe(true)

  const empty = barsSvg([{ percent: null, left: '', leftShare: null, pace: null }])
  expect(empty.source.includes('NaN')).toBe(false)
  expect(empty.source.includes('<text')).toBe(false)
  expect(empty.source.includes('<circle')).toBe(false)
})

test('figures the engine does not have yet show as a dash', async ($, on) => {
  mock.clock(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { window: 200000 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /░/ }))?.text).toBe('░░░░░░░░░░  ·  ░░░░░░░░░░  ·  ░░░░░░░░░░  ·  ◉ 0  ·  ▣ 0')
  await ui.unmount()
})

test('the time left moves by itself, once a minute', async ($, on) => {
  const clock = mock.clock(on)
  const hour = 60 * 60 * 1000
  await clock.set(Date.parse(fiveHourReset) - 2 * hour)

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000, percent: 42 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 31, resetsAt: fiveHourReset }],
    },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /02:00/ }))?.text).toBe('████░░░░░░  ·  ███░░░░░░░ ▼ −29% 02:00  ·  ░░░░░░░░░░  ·  ◉ 0  ·  ▣ 0')

  await clock.advance(60 * 1000)
  expect((await ui.find({ type: 'Text', text: /01:59/ }))?.text).toBe('████░░░░░░  ·  ███░░░░░░░ ▼ −29% 01:59  ·  ░░░░░░░░░░  ·  ◉ 0  ·  ▣ 0')
  await ui.unmount()
})

test('a window whose reset has passed draws empty, with no time and no pace', async ($, on) => {
  const clock = mock.clock(on)
  // Past the five-hour reset, three days before the weekly one.
  await clock.set(Date.parse(sevenDayReset) - 60 * 60 * 1000)
  on('session.measure', (_, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { window: 200000, percent: 42 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 71, resetsAt: fiveHourReset },
      { kind: 'seven_day', percentUsed: 87, resetsAt: sevenDayReset },
    ],
    changed: ['context', 'rateLimits'],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /·/ }))?.text).toBe(
    '████░░░░░░  ·  ░░░░░░░░░░  ·  █████████░ ▼ −12% 0:01:00  ·  ◉ 0  ·  ▣ 0',
  )

  await ui.unmount()

  // No session started here, so no minute timer runs: a new drawing reads the clock.
  await clock.advance(2 * 60 * 60 * 1000)
  const later = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await later.find({ type: 'Text', text: /·/ }))?.text).toBe('████░░░░░░  ·  ░░░░░░░░░░  ·  ░░░░░░░░░░  ·  ◉ 0  ·  ▣ 0')
  await later.unmount()
})

test('agents still at work are counted at the end of the line', async ($, on) => {
  expect(countActive([{ status: 'running' }, { status: 'pending' }, { status: 'waiting' }])).toBe(3)
  expect(countActive([{ status: 'completed' }, { status: 'failed' }, { status: 'killed' }, { status: 'idle' }])).toBe(0)
  expect(formatAgents(0)).toBe('◉ 0')
  expect(formatAgents(2)).toBe('◉ 2')

  const clock = mock.clock(on)
  await clock.set(Date.parse(fiveHourReset) - 60 * 60 * 1000)

  let list = [
    { id: 'a1', description: 'search', type: 'Explore', status: 'running' },
    { id: 'a2', description: 'tests', type: 'general-purpose', status: 'running' },
    { id: 'a3', description: 'old', type: 'Explore', status: 'completed' },
  ]

  // Only the status is read; the rest of an agent's row is left out here.
  on('agent.list', () => ({ value: list as unknown as AgentInfo[] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, percent: 42 }, rateLimits: [] },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /█/ }))?.text).toBe('████░░░░░░  ·  ░░░░░░░░░░  ·  ░░░░░░░░░░  ·  ◉ 2  ·  ▣ 0')

  // Both finish: the minute timer counts again and the note reads zero.
  list = list.map(agent => ({ ...agent, status: 'completed' }))
  await clock.advance(60 * 1000)
  expect((await ui.find({ type: 'Text', text: /█/ }))?.text).toBe('████░░░░░░  ·  ░░░░░░░░░░  ·  ░░░░░░░░░░  ·  ◉ 0  ·  ▣ 0')
  await ui.unmount()

  // The picture draws the agent mark itself and writes only the number.
  const picture = barsSvg(
    [{ percent: 1, left: '', leftShare: null, pace: null }],
    [{ text: '2', color: '#60a5fa', icon: 'agents' }],
  )
  expect(picture.source.includes('fill="#60a5fa">2<')).toBe(true)
  expect(picture.source.includes('<rect x="119.7" y="6" width="11.6" height="10" rx="3" fill="none" stroke="#60a5fa"')).toBe(true)
  expect(picture.source.includes('◉')).toBe(false)
})

test('each part of the picture tells its figure to a resting pointer', async () => {
  const picture = barsSvg(
    [
      { percent: 42, left: '', leftShare: null, pace: null, title: 'Context 42%' },
      { percent: 71, left: '04:55', leftShare: 1, pace: null, title: '5-hour limit 71% <&>' },
    ],
    [{ text: '0', icon: 'agents', title: 'Agents at work: 0' }],
  )

  expect(picture.source.includes('<g><title>Context 42%</title>')).toBe(true)
  expect(picture.source.includes('<title>5-hour limit 71% &lt;&amp;&gt;</title>')).toBe(true)
  expect(picture.source.includes('<title>Agents at work: 0</title>')).toBe(true)
  expect(picture.source.split('<g>').length).toBe(picture.source.split('</g>').length)

  // A part with no title is drawn bare.
  expect(barsSvg([{ percent: 1, left: '', leftShare: null, pace: null }]).source.includes('<title>')).toBe(false)
})

test('commands in the background are counted until the engine reports them ended', async ($, on) => {
  expect(formatCommands(2)).toBe('▣ 2')
  expect(isTimer('sleep 290')).toBe(true)
  expect(isTimer('sleep 5 && make')).toBe(false)
  expect(endedTask('<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>')).toBe('b1')
  expect(endedTask('hello')).toBe(null)

  mock.clock(on)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', (_, e) =>
    e.tool === 'Bash'
      ? { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `b-${String(e.command).length}` } }
      : { result: {} },
  )

  await $.session.measure({ context: { window: 200000, percent: 42 }, rateLimits: [], changed: ['context'] })

  const shown = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const text = (await ui.find({ type: 'Text', text: /█/ }))?.text
    await ui.unmount()

    return text
  }

  expect((await shown())?.endsWith('◉ 0  ·  ▣ 0')).toBe(true)

  // A pacing timer is not counted; two builds are.
  await $.tool.call({ tool: 'Bash', command: 'sleep 290', run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: 'make', run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: 'make all', run_in_background: true })
  expect((await shown())?.endsWith('◉ 0  ·  ▣ 2')).toBe(true)

  // One is reported ended, the other is stopped.
  await $.prompt.submit({
    text: '<task-notification>\n<task-id>b-4</task-id>\n<status>completed</status>',
    origin: { kind: 'task-notification' },
    wait: false,
  })
  expect((await shown())?.endsWith('◉ 0  ·  ▣ 1')).toBe(true)
  await $.tool.call({ tool: 'TaskStop', task_id: 'b-8' })
  expect((await shown())?.endsWith('◉ 0  ·  ▣ 0')).toBe(true)

  const picture = barsSvg(
    [{ percent: 1, left: '', leftShare: null, pace: null }],
    [{ text: '1', color: '#60a5fa', icon: 'commands', title: 'Background commands: 1' }],
  )
  expect(picture.source.includes('<title>Background commands: 1</title>')).toBe(true)
  expect(picture.source.includes('<polyline')).toBe(true)
})
