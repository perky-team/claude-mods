// The usage band as one SVG document, for the surfaces that draw Svg.

import { barColor, formatPace, paceColor } from './format'
import type { Level, Pace } from './format'

export type Meter = {
  // 0 to 100, or null while the engine has no figure.
  percent: number | null
  // The time left until the reset, "04:55" or "6:12:41"; '' for none.
  left: string
  // The share of the window still ahead, 0 to 1: colors `left`. Null draws it grey.
  leftShare: number | null
  // The use against an even plan, drawn as a badge after the bar; null for none.
  pace: Pace | null
  // What a pointer resting on the meter is told, where the surface shows it.
  title?: string
}

// A short plain note after the meters, such as "f15%"; grey unless colored.
// `agents` draws the agent mark, a small robot head, before the text.
export type Note = { text: string; color?: string; icon?: 'agents'; title?: string }

type Rgb = readonly [number, number, number]

const GREEN: Rgb = [34, 197, 94]
const AMBER: Rgb = [245, 158, 11]
const RED: Rgb = [239, 68, 68]
const GREY = '#8b93a1'
export const BLUE = '#60a5fa'
const FONT = 'font-family="ui-sans-serif, system-ui, sans-serif"'

const hex = (rgb: Rgb): string => `#${rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`

const HEX: Record<Level, string> = { success: hex(GREEN), warning: hex(AMBER), error: hex(RED) }

const mix = (from: Rgb, to: Rgb, t: number): Rgb => [
  from[0] + (to[0] - from[0]) * t,
  from[1] + (to[1] - from[1]) * t,
  from[2] + (to[2] - from[2]) * t,
]

// A color in proportion to the time left: green at the reset, amber at half
// the window, red with the whole window ahead.
export const leftColor = (share: number): string => {
  const s = Math.min(1, Math.max(0, share))

  return hex(s <= 0.5 ? mix(GREEN, AMBER, s * 2) : mix(AMBER, RED, (s - 0.5) * 2))
}

const clamp = (n: number): number => Math.min(100, Math.max(0, n))

const BAR = 96
// Between the parts of one meter, and on each side of a dot.
const INNER = 8
const AROUND_DOT = 11

// A picture cannot measure its text, so each run is given the width it is to
// take (`textLength`): what follows it then stands exactly where it is drawn.
const charWidth = (char: string): number =>
  char >= '0' && char <= '9' ? 6.9 : char === ':' || char === ' ' ? 3.6 : char === '%' ? 10 : char === 'f' ? 4.6 : 7.6

export const textWidth = (text: string): number =>
  Math.round([...text].reduce((sum, char) => sum + charWidth(char), 0) * 10) / 10

const run = (x: number, y: number, text: string, color: string, anchor: 'start' | 'middle' = 'start'): string =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" textLength="${textWidth(text)}" lengthAdjust="spacing" ${FONT} font-size="12" font-weight="600" fill="${color}">${text}</text>`

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// A part of the picture with a tooltip: the unseen rect makes the gaps between
// its marks answer the pointer too.
const titled = (title: string | undefined, from: number, to: number, height: number, marks: string): string =>
  title
    ? `<g><title>${escape(title)}</title><rect x="${from}" y="0" width="${to - from}" height="${height}" fill="#000" fill-opacity="0"/>${marks}</g>`
    : marks

const AGENT_MARK = 13

// A robot head, 13 wide: an antenna, a rounded face, two eyes.
const agentMark = (x: number, color: string): string =>
  `<line x1="${x + 6.5}" y1="3.6" x2="${x + 6.5}" y2="6" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>` +
  `<circle cx="${x + 6.5}" cy="3" r="1.2" fill="${color}"/>` +
  `<rect x="${x + 0.7}" y="6" width="11.6" height="10" rx="3" fill="none" stroke="${color}" stroke-width="1.4"/>` +
  `<circle cx="${x + 4.4}" cy="11" r="1.3" fill="${color}"/>` +
  `<circle cx="${x + 8.6}" cy="11" r="1.3" fill="${color}"/>`

// Rounded bars for the level; after a bar its pace as a badge and the time left
// until the reset; a dot between one meter and the next, and before each note,
// with the same space on both sides of it.
export const barsSvg = (
  meters: readonly Meter[],
  notes: readonly Note[] = [],
): { source: string; width: number; height: number } => {
  const height = 22
  // `x` is the right edge of the last thing drawn.
  let x = 1
  let body = ''

  const dot = () => {
    body += `<circle cx="${x + AROUND_DOT}" cy="11" r="2" fill="${GREY}"/>`
    x += 2 * AROUND_DOT
  }

  meters.forEach((meter, i) => {
    if (i > 0) {
      dot()
    }

    const from = x
    const fill = (BAR * clamp(meter.percent ?? 0)) / 100
    let marks = `<rect x="${x}" y="7" width="${BAR}" height="8" rx="4" fill="${GREY}" fill-opacity="0.3"/>`

    // A fill narrower than its own round caps would not draw as a bar.
    marks +=
      fill > 0
        ? `<rect x="${x}" y="7" width="${Math.max(8, fill)}" height="8" rx="4" fill="${HEX[barColor(meter.percent)]}"/>`
        : ''
    x += BAR

    if (meter.pace !== null) {
      const text = formatPace(meter.pace)
      const width = textWidth(text) + 14
      const color = HEX[paceColor(meter.pace)]

      x += INNER
      marks += `<rect x="${x}" y="2" width="${width}" height="18" rx="9" fill="${color}" fill-opacity="0.18"/>`
      marks += run(x + width / 2, 15, text, color, 'middle')
      x += width
    }

    if (meter.left) {
      x += INNER
      marks += run(x, 15.5, meter.left, meter.leftShare === null ? GREY : leftColor(meter.leftShare))
      x += textWidth(meter.left)
    }

    body += titled(meter.title, from, x, height, marks)
  })

  for (const note of notes) {
    const color = note.color ?? GREY

    dot()

    const from = x
    let marks = ''

    if (note.icon === 'agents') {
      marks += agentMark(x, color)
      x += AGENT_MARK + 5
    }

    marks += run(x, 15.5, note.text, color)
    x += textWidth(note.text)
    body += titled(note.title, from, x, height, marks)
  }

  const width = Math.ceil(x + 1)

  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
    width,
    height,
  }
}
