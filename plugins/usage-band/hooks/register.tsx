import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  BAR_CELLS,
  FIVE_HOURS_MS,
  WEEK_MS,
  barColor,
  countActive,
  filledCells,
  endedTask,
  formatAgents,
  formatCommands,
  formatFable,
  formatLeftDays,
  formatLeftHours,
  formatPace,
  formatPercent,
  formatReset,
  isTimer,
  leftShare,
  live,
  paceColor,
  toSnapshot,
  windowPace,
} from './format'
import { BLUE, barsSvg, leftColor } from './svg'
import type { Meter, Note } from './svg'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
// Moved once a minute so the time left is redrawn in a quiet chat too.
const tick = atom({ plugin: 'usage-band', key: 'tick' } as const, 0)

// Subagents and teammates still at work: they spend the limits in the background.
const agents = atom({ plugin: 'usage-band', key: 'agents' } as const, 0)

// The ids of the commands the main loop sent to the background and that the
// engine has not yet reported ended.
const commands = atom({ plugin: 'usage-band', key: 'commands' } as const, [])

async function dropCommand($: EngineInterface, id: string): Promise<void> {
  await update($, commands, ids => ids.filter(held => held !== id))
}

// A host that keeps no agents refuses the list: the count stays as it was, and
// the hook that asked goes on.
async function countAgents($: EngineInterface): Promise<void> {
  try {
    const count = countActive(await $.agent.list())
    await update($, agents, () => count)
  } catch {
    // Nothing to count on this host.
  }
}

export const register: Register = on => {
  // The one minute timer: a session that starts again must not add a second.
  let ticking: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const figures = toSnapshot(await $.session.usage())
    await update($, snapshot, () => figures)

    ticking?.cancel()
    ticking = $.clock.every(60 * 1000, async () => {
      await countAgents($)
      await update($, tick, n => (n + 1) % 1440)
    })
    await countAgents($)

    return result
  })

  // Pushed after each main-thread turn and when a rate-limit window moves a point.
  on('session.measure', async ($, e, next) => {
    const figures = toSnapshot(e)
    await update($, snapshot, () => figures)

    return next(e)
  })

  // An agent is counted once it has started, and again when any turn ends: a
  // subagent's own turn ending is how it finishes.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    $.clock.after(2000, () => countAgents($))

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await countAgents($)

    return result
  })

  // A command sent to the background is counted from the answer that says so,
  // until the engine's notification that it ended, or a stop.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const answer = await next(e)
    const input = e as { command?: unknown }
    const result = (answer as { result?: { backgroundTaskId?: unknown } }).result
    const id = typeof result?.backgroundTaskId === 'string' ? result.backgroundTaskId : ''
    const command = typeof input.command === 'string' ? input.command : ''

    if (id && e.agentId === undefined && !isTimer(command)) {
      await update($, commands, ids => (ids.includes(id) ? ids : [...ids, id]))
    }

    return answer
  })

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const answer = await next(e)
    const input = e as { task_id?: unknown; shell_id?: unknown }
    const id = typeof input.task_id === 'string' ? input.task_id : typeof input.shell_id === 'string' ? input.shell_id : ''

    if (id) {
      await dropCommand($, id)
    }

    return answer
  })

  on('prompt.submit', async ($, e, next) => {
    const id = e.origin.kind === 'task-notification' ? endedTask(e.text) : null

    if (id) {
      await dropCommand($, id)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const figures = await read($, snapshot)
    // Read for the redraw alone: the write once a minute brings the hook back.
    await read($, tick)

    if (e.props.hasSurvey || figures === null) {
      return next(e)
    }

    const table = $.ui.resolve(e)
    const { Box, Text } = table
    const now = await $.clock.now()
    const fiveHour = live(figures.fiveHour, now)
    const sevenDay = live(figures.sevenDay, now)
    // A snapshot stored before the mod read the Fable window has no such key.
    const working = await read($, agents)
    const running = (await read($, commands)).length
    // Always there, grey at zero and blue while any works.
    const notes: Note[] = [
      { text: String(working), icon: 'agents', title: `Agents at work: ${working}`, ...(working > 0 ? { color: BLUE } : {}) },
      { text: String(running), icon: 'commands', title: `Background commands: ${running}`, ...(running > 0 ? { color: BLUE } : {}) },
      ...(figures.fable ? [{ text: formatFable(figures.fable), title: `Fable weekly limit ${formatPercent(figures.fable.percentUsed)}` }] : []),
    ]
    const said = (name: string, limit: typeof fiveHour) =>
      `${name} ${formatPercent(limit?.percentUsed ?? null)}${limit?.resetsAt ? ` · resets ${formatReset(limit.resetsAt)}` : ''}`
    const meters: Meter[] = [
      { percent: figures.contextPercent, left: '', leftShare: null, pace: null, title: `Context ${formatPercent(figures.contextPercent)}` },
      {
        percent: fiveHour?.percentUsed ?? null,
        left: formatLeftHours(fiveHour, now),
        leftShare: leftShare(fiveHour, FIVE_HOURS_MS, now),
        pace: windowPace(fiveHour, FIVE_HOURS_MS, now),
        title: said('5-hour limit', fiveHour),
      },
      {
        percent: sevenDay?.percentUsed ?? null,
        left: formatLeftDays(sevenDay, now),
        leftShare: leftShare(sevenDay, WEEK_MS, now),
        pace: windowPace(sevenDay, WEEK_MS, now),
        title: said('Weekly limit', sevenDay),
      },
    ]

    // Where the surface draws Svg, the band is one picture of rounded bars.
    // Its colors are fixed, not the theme's. The terminal's table has no Svg:
    // it keeps the line of glyphs below.
    if (e.surface !== 'terminal' && 'Svg' in table) {
      const { Svg } = table
      const picture = barsSvg(meters, notes)
      return (
        <Box>
          <Svg
            source={picture.source}
            alt={[...meters, ...notes].map(part => part.title).join(', ')}
            isInteractive
            width={picture.width}
            height={picture.height}
          />
        </Box>
      )
    }

    // One Text of nested runs, so the whole band is one line: a bar is block
    // glyphs, then its pace and the time left until the reset in its color.
    const meter = ({ percent, left, leftShare: share, pace }: Meter) => {
      const filled = filledCells(percent)

      return [
        <Text color={barColor(percent)}>{'█'.repeat(filled)}</Text>,
        <Text dimColor>{'░'.repeat(BAR_CELLS - filled)}</Text>,
        pace ? <Text color={paceColor(pace)}>{` ${formatPace(pace)}`}</Text> : null,
        left ? <Text color={share === null ? 'subtle' : leftColor(share)}>{` ${left}`}</Text> : null,
      ]
    }

    const dot = <Text dimColor>{'  ·  '}</Text>

    return (
      <Box>
        <Text wrap="truncate-end">
          {meter(meters[0]!)}
          {dot}
          {meter(meters[1]!)}
          {dot}
          {meter(meters[2]!)}
          {notes.map(note => [
            dot,
            <Text color={note.color ?? 'subtle'}>
              {note.icon === 'agents'
                ? formatAgents(Number(note.text))
                : note.icon === 'commands'
                  ? formatCommands(Number(note.text))
                  : note.text}
            </Text>,
          ])}
        </Text>
      </Box>
    )
  })
}
