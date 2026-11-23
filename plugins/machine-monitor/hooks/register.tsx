import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Reading } from '../types'
import {
  BAR,
  WORDS,
  ago,
  coresLevel,
  cut,
  filled,
  formatBytes,
  formatCores,
  glance,
  languageOf,
  machineLevel,
  parseRefusal,
  parseReport,
  queuesLine,
  shareLevel,
  tempLevel,
} from './logic'
import type { Level, Words } from './logic'

const PANE = 'machine-monitor'
// The pane was open when the last session ended: it opens again with the next.
const WAS_OPEN = 'open'

const reading = atom({ plugin: 'machine-monitor', key: 'reading' } as const, null)
// Whether the pane is open: the band's button reads it for its look.
const isOpen = atom({ plugin: 'machine-monitor', key: 'isOpen' } as const, false)

// The pane's words and language, fixed by the options for this activation.
let words: Words = WORDS.en
let language = 'en'

// Runs the one command this mod runs: the plugin's own script, for JSON.
// `sample` is the CPU sample in seconds: short for the first look of a session.
async function measure($: EngineInterface, sample = 1): Promise<void> {
  const root = (await $.process.hookEnv()).CLAUDE_PLUGIN_ROOT ?? ''
  const now = await $.clock.now()
  let next: Reading

  try {
    const run = await $.process.run(
      ['python3', '-I', `${root}/skills/machine-monitor/resources.py`, '--json', '--lang', language, '-i', String(sample)],
      { timeoutMs: 20000 },
    )
    const refusal = run.exitCode === 3 ? parseRefusal(run.stdout) : null
    const report = run.exitCode === 0 ? parseReport(run.stdout) : null

    next = refusal
      ? { report: null, error: '', unsupported: refusal.unsupported, at: now }
      : report
        ? { report, error: '', unsupported: '', at: now }
        : {
            report: null,
            error: run.exitCode === 0 ? words.wrongShape : cut(run.stderr.trim() || `${words.exitCode} ${run.exitCode}`, 300),
            unsupported: '',
            at: now,
          }
  } catch (error) {
    next = { report: null, error: cut(error instanceof Error ? error.message : String(error), 300), unsupported: '', at: now }
  }

  // A failed run keeps the last good figures on screen, with the reason beside.
  await update($, reading, held => (next.report === null && !next.unsupported && held?.report ? { ...held, error: next.error } : next))
}

async function isShown($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
}

// The refresh timer of the open pane, and a run still under way.
let refreshMs = 5000
let ticking: { cancel: () => void } | undefined
let isMeasuring = false

async function tick($: EngineInterface): Promise<void> {
  if (isMeasuring || !(await isShown($))) {
    return
  }

  isMeasuring = true

  try {
    await measure($)
  } finally {
    isMeasuring = false
  }
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: words.title })
  await $.store.set(WAS_OPEN, true)
  await update($, isOpen, () => true)
  ticking?.cancel()
  ticking = $.clock.every(refreshMs, () => tick($))
  await measure($)
}

async function stop($: EngineInterface): Promise<void> {
  ticking?.cancel()
  ticking = undefined
  await $.store.set(WAS_OPEN, false)
  await update($, isOpen, () => false)
}

// What `/machine` and the band's button do: open the pane, or close it.
async function toggle($: EngineInterface): Promise<boolean> {
  if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
    await $.ui.close({ id: PANE })
    await stop($)

    return false
  }

  await openPane($)

  return true
}

export const register: Register = (on, options) => {
  refreshMs = Math.max(2, typeof options.refreshSeconds === 'number' ? options.refreshSeconds : 5) * 1000
  language = languageOf(options.language)
  words = WORDS[languageOf(options.language)]

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    await $.command.register({ name: 'monitor', description: 'Open or close the pane with what loads this machine' })

    if ((await $.store.get(WAS_OPEN)) === true) {
      await openPane($)
    } else {
      // One short look, to learn whether this machine can be read at all: where
      // it cannot, the band's button is left out.
      await measure($, 0.2)
    }

    return result
  })

  on('command.run', { command: 'monitor' }, async $ =>
    (await toggle($)) ? { text: words.opened, isTextDisplayOnly: true } : { text: words.closed, isTextDisplayOnly: true },
  )

  // A button at the right of the band above the prompt, beside whatever rows
  // other mods draw there: the rows are wrapped, never copied.
  on('ui.render', { component: 'AbovePromptList' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, reading))?.unsupported) {
      return next(e)
    }

    const rows = await next(e)
    const isShown = await read($, isOpen)
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box alignItems="center" gap={1}>
        <Box flexGrow={1} flexShrink={1} flexDirection="column">
          {rows}
        </Box>
        {/* One glyph, drawn plain: a monitor. A Button takes text alone, no picture. */}
        <Button key="machine-monitor-toggle" label="🖥️" plain dimColor={!isShown} onPress={() => void toggle($)} />
      </Box>
    )
  })

  // The person closed it from its mark or key: nothing runs until it opens again.
  on('ui.close', async ($, e, next) => {
    const result = await next(e)

    if (e.id === PANE) {
      await stop($)
    }

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const held = await read($, reading)
    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(30, e.props.bodyColumns)

    if (held === null) {
      return (
        <Box>
          <Text dimColor>{words.measuring}</Text>
        </Box>
      )
    }

    const report = held.report

    if (held.unsupported) {
      return (
        <Box>
          <Text color="warning" wrap="wrap">
            {held.unsupported}
          </Text>
        </Box>
      )
    }

    if (report === null) {
      return (
        <Box flexDirection="column">
          <Text color="error">{words.noAnswer}</Text>
          <Text dimColor wrap="wrap">
            {held.error}
          </Text>
        </Box>
      )
    }

    const m = report.machine

    if (e.props.placement === 'widget') {
      return (
        <Box>
          <Text color={machineLevel(report)} wrap="truncate-end">
            {glance(report)}
          </Text>
        </Box>
      )
    }

    const bar = (key: string, share: number) => {
      const level = shareLevel(share)
      const on_ = filled(share)

      return (
        <Box key={key} width={BAR} height={1}>
          <Box key={`${key}-on`} width={on_} height={1} backgroundColor={level} />
          <Box key={`${key}-off`} width={BAR - on_} height={1} backgroundColor="subtle" />
        </Box>
      )
    }

    const gauge = (key: string, name: string, share: number, figures: string) => (
      <Box key={key} gap={1}>
        <Box width={5}>
          <Text dimColor>{name}</Text>
        </Box>
        {bar(key, share)}
        <Text color={shareLevel(share)}>{figures}</Text>
      </Box>
    )

    const numbers = 13
    const nameWidth = Math.max(12, width - numbers - 2)

    const row = (key: string, name: string, cores: number, mem: number, color: Level | 'text', note: string, isDim = false) => (
      <Box key={key} flexDirection="column">
        <Box>
          <Box width={nameWidth}>
            <Text color={color} dimColor={isDim} wrap="truncate-end">
              {cut(name, nameWidth)}
            </Text>
          </Box>
          <Box width={6} justifyContent="flex-end">
            <Text color={coresLevel(cores) ?? 'text'} dimColor={isDim && coresLevel(cores) === null}>
              {formatCores(cores)}
            </Text>
          </Box>
          <Box width={7} justifyContent="flex-end">
            <Text dimColor={isDim}>{formatBytes(mem)}</Text>
          </Box>
        </Box>
        {note ? (
          <Box paddingLeft={4}>
            <Text dimColor wrap="truncate-end">
              {cut(note, width - 4)}
            </Text>
          </Box>
        ) : null}
      </Box>
    )

    const temp = m.temps[0]

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          <Box>
            <Box flexGrow={1}>
              <Text weight="bold">{m.host}</Text>
            </Box>
            {temp ? <Text color={tempLevel(temp.degrees)}>{`${temp.kind} ${temp.degrees}°`}</Text> : null}
          </Box>
          {gauge('load', 'load', (m.load[0] ?? 0) / Math.max(1, m.cpus), `${(m.load[0] ?? 0).toFixed(2)} ${words.of} ${m.cpus}`)}
          {gauge('ram', 'RAM', m.ram_used / Math.max(1, m.ram_total), `${formatBytes(m.ram_used)} / ${formatBytes(m.ram_total)}`)}
          {gauge('disk', words.disk, m.disk_used / Math.max(1, m.disk_total), `${formatBytes(m.disk_used)} / ${formatBytes(m.disk_total)}`)}
          <Box gap={1}>
            <Box width={5}>
              <Text dimColor>swap</Text>
            </Box>
            <Text color={m.swap_used >= 2 ** 30 ? 'warning' : 'text'}>{formatBytes(m.swap_used)}</Text>
          </Box>
          {report.queues.length > 0 ? (
            <Text wrap="truncate-end">
              <Text dimColor>{`${words.queues}: `}</Text>
              <Text color={report.queues.some(q => !q.free) ? 'warning' : 'text'}>{queuesLine(report, words)}</Text>
            </Text>
          ) : null}
        </Box>
        <Box flexDirection="column">
          <Box>
            <Box width={nameWidth}>
              <Text dimColor>{words.who}</Text>
            </Box>
            <Box width={6} justifyContent="flex-end">
              <Text dimColor>{words.cores}</Text>
            </Box>
            <Box width={7} justifyContent="flex-end">
              <Text dimColor>RAM</Text>
            </Box>
          </Box>
          {report.owners.map((owner, i) => (
            <Box key={`owner-${i}`} flexDirection="column">
              {row(`owner-${i}-row`, owner.name, owner.cores, owner.mem, 'text', owner.sessions.length > 0 ? '' : owner.what)}
              {owner.sessions.map((s, j) =>
                row(
                  `owner-${i}-s-${j}`,
                  `  └ ${s.name}`,
                  s.cores,
                  s.mem,
                  s.waiting ? 'warning' : s.busy ? 'success' : 'text',
                  s.note,
                  !s.busy && !s.waiting,
                ),
              )}
            </Box>
          ))}
          {report.docker
            ? row('docker', `Docker: ${report.docker.count}`, report.docker.cores, report.docker.mem, 'text', '', true)
            : null}
        </Box>
        <Text dimColor wrap="truncate-end">
          {`${words.updated} ${ago((await $.clock.now()) - held.at, words)}${held.error ? ` · ${words.lastFailed}: ${held.error}` : ''}`}
        </Text>
      </Box>
    )
  })
}
