import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import { ACK_TOOL, FIRST_LOOK_MS, formatStamp, isTimer, notified, outputPathIn, readSettings, sampleOf } from './logic'
import { LINGER_MS, acknowledge, clearStale, finish, follow, look, remember, syncAgents } from './watch'

// The same value `watch.ts` writes: an atom is named where it is read.
const line = atom({ plugin: 'task-watch', key: 'line' } as const, null)

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

export const register: Register = (on, options) => {
  const settings = readSettings(options)
  // The one timer of the watch.
  let ticking: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    ticking?.cancel()
    ticking = $.clock.every(settings.intervalMs, () => look($, settings))

    // The main model's way to answer a wake-up: the work is fine.
    await $.tool.register({
      name: ACK_TOOL,
      description:
        'Tell task-watch that a background command or agent it warned you about is fine: a server or watcher meant to keep running, or slow but healthy work. task-watch then stops raising it until its output shows something new. Use it instead of moving the work out of the session.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The id task-watch gave for the work' },
          service: { type: 'boolean', description: 'True when the work is meant to keep running until stopped' },
        },
        required: ['id'],
      },
    })

    return result
  })

  on('tool.run', { tool: 'mcp__task-watch__acknowledge' }, async ($, e) => {
    return { result: await acknowledge($, e.id, e.service === true) }
  })

  // A command sent to the background is followed from the answer that says so.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const answer = await next(e)
    const input = asRecord(e)
    const command = asText(input.command)
    const result = asRecord(asRecord(answer).result)
    const id = asText(result.backgroundTaskId)

    // The main loop's own commands alone, and no pacing timer of the session's.
    if (id && e.agentId === undefined && !isTimer(command)) {
      await follow($, {
        kind: 'command',
        id,
        label: asText(input.description) || command.slice(0, 60),
        command,
        outputPath: asText(result.backgroundOutputPath) || outputPathIn(asText(asRecord(answer).text)),
      })
      // The name the main model gave the work stands for a moment; then the
      // watcher says in the person's language what is going on.
      $.clock.after(FIRST_LOOK_MS, () => look($, settings))
    }

    return answer
  })

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const answer = await next(e)
    const input = asRecord(e)
    const id = asText(input.task_id) || asText(input.shell_id)

    if (id) {
      await finish($, id, 'stopped')
      $.clock.after(LINGER_MS, () => clearStale($))
    }

    return answer
  })

  // The engine's own word that a background task ended.
  on('prompt.submit', async ($, e, next) => {
    // What the person typed, here or through Remote Control, says which
    // language they read.
    if ((e.origin.kind === 'composer' || e.origin.kind === 'bridge') && sampleOf(e.text)) {
      await remember($, sampleOf(e.text))
    }

    if (e.origin.kind === 'task-notification') {
      const ended = notified(e.text)

      if (ended) {
        await finish($, ended.id, ended.status)
        $.clock.after(LINGER_MS, () => clearStale($))
      }
    }

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    // The agent is listed a moment after its spawn is answered.
    $.clock.after(2000, () => syncAgents($))
    $.clock.after(FIRST_LOOK_MS, () => look($, settings))

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    await syncAgents($)
    $.clock.after(LINGER_MS, () => clearStale($))

    return result
  })

  // The row is there only while there is something to say.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const held = await read($, line)

    if (e.props.hasSurvey || held === null) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const mark = held.level === 'warn' ? '⚠' : held.level === 'ok' ? '✓' : '▸'
    const color = held.level === 'warn' ? 'warning' : held.level === 'ok' ? 'success' : 'subtle'

    return (
      <Box>
        <Text wrap="truncate-end">
          <Text color={color}>{`${mark} `}</Text>
          <Text dimColor>{`${formatStamp(held.at)} · `}</Text>
          <Text color={held.level === 'warn' ? 'warning' : 'text'}>{held.text}</Text>
        </Text>
      </Box>
    )
  })
}
