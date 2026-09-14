/**
 * Terminal-cell paint → inline style, for screen-oriented terminal surfaces.
 *
 * The palette is the one {@link parseAnsiLines} already uses, deliberately
 * shared from the same tables: the 8/16 basic colors map onto theme tokens (so
 * text adapts to light and dark), and every other palette index or truecolor
 * value keeps its literal `rgb(...)`. That is what makes a live terminal pane
 * and a tool-result card render one command identically.
 *
 * Anser's asymmetry is preserved on purpose: a run that paints its own
 * background keeps literal colors for both, because authored contrast must
 * survive. Blink is absent, exactly as it is for the output cards.
 */

import type { CSSProperties } from 'react'
import { STYLE_BY_DECORATION, TOKEN_BY_BASIC_RGB } from './ansi.ts'

/** Paint of one terminal cell or run of cells. */
export interface TerminalCellPaint {
  /** Foreground: palette index 0-255, or a 24-bit `0xRRGGBB` value under `fgRgb`. */
  readonly fg?: number | undefined
  /** Background: palette index 0-255, or a 24-bit `0xRRGGBB` value under `bgRgb`. */
  readonly bg?: number | undefined
  /** The foreground is a 24-bit value rather than a palette index. */
  readonly fgRgb?: boolean | undefined
  /** The background is a 24-bit value rather than a palette index. */
  readonly bgRgb?: boolean | undefined
  /** Bold (`SGR 1`). */
  readonly bold?: boolean | undefined
  /** Dim (`SGR 2`). */
  readonly dim?: boolean | undefined
  /** Italic (`SGR 3`). */
  readonly italic?: boolean | undefined
  /** Underline (`SGR 4`). */
  readonly underline?: boolean | undefined
  /** Strikethrough (`SGR 9`). */
  readonly strikethrough?: boolean | undefined
  /** Hidden (`SGR 8`). */
  readonly hidden?: boolean | undefined
}

/**
 * The 8/16 basic colors exactly as anser resolves them, so the token table
 * keyed by those triples keeps working for cell data too. These are read off
 * anser rather than assumed: basic white and bright white are the same color
 * here, and bright green is `0, 255, 0`.
 */
const BASIC_TRIPLES: readonly string[] = [
  '0, 0, 0',
  '187, 0, 0',
  '0, 187, 0',
  '187, 187, 0',
  '0, 0, 187',
  '187, 0, 187',
  '0, 187, 187',
  '255, 255, 255',
  '85, 85, 85',
  '255, 85, 85',
  '0, 255, 0',
  '255, 255, 85',
  '85, 85, 255',
  '255, 85, 255',
  '85, 255, 255',
  '255, 255, 255',
]

/** The 6×6×6 color cube's channel levels, indices 16-231. */
const CUBE_LEVELS: readonly number[] = [0, 95, 135, 175, 215, 255]

/** Decoration keys in the order their CSS is applied. */
const DECORATIONS: readonly (keyof TerminalCellPaint)[] = [
  'bold', 'dim', 'italic', 'underline', 'strikethrough', 'hidden',
]

/**
 * One palette index as an `r, g, b` triple: the 16 basic colors, the 6×6×6
 * cube, then the 24-step grayscale ramp.
 * @param index - palette index; values outside 0-255 are clamped into range.
 * @returns the triple, formatted as anser formats it.
 */
function tripleOf(index: number): string {
  const bounded = Math.max(0, Math.min(255, Math.trunc(index)))
  if (bounded < 16) return BASIC_TRIPLES[bounded] ?? BASIC_TRIPLES[0] ?? '0, 0, 0'
  if (bounded >= 232) {
    const level = 8 + (bounded - 232) * 10
    return `${String(level)}, ${String(level)}, ${String(level)}`
  }
  const offset = bounded - 16
  const red = CUBE_LEVELS[Math.floor(offset / 36) % 6] ?? 0
  const green = CUBE_LEVELS[Math.floor(offset / 6) % 6] ?? 0
  const blue = CUBE_LEVELS[offset % 6] ?? 0
  return `${String(red)}, ${String(green)}, ${String(blue)}`
}

/**
 * One color as CSS: a 24-bit value splits into channels, a palette index goes
 * through {@link tripleOf}.
 * @param value - palette index or `0xRRGGBB`.
 * @param truecolor - whether `value` is a 24-bit color.
 * @returns the `rgb(...)` text anser emits for the same color.
 */
function colorOf(value: number, truecolor: boolean): string {
  const triple = truecolor
    ? `${String((value >> 16) & 0xff)}, ${String((value >> 8) & 0xff)}, ${String(value & 0xff)}`
    : tripleOf(value)
  return `rgb(${triple})`
}

/**
 * Resolve one cell's paint into an inline style.
 * @param paint - the cell's colors and attributes.
 * @returns the style, or undefined when the cell carries no color and no decoration.
 */
export function terminalCellStyle(paint: TerminalCellPaint): CSSProperties | undefined {
  const style: CSSProperties = {}
  const background = paint.bg === undefined ? undefined : colorOf(paint.bg, paint.bgRgb === true)
  if (background !== undefined) style.backgroundColor = background
  if (paint.fg !== undefined) {
    const literal = colorOf(paint.fg, paint.fgRgb === true)
    // A cell that paints its own background keeps anser's literal pair so the
    // authored contrast survives; a foreground-only cell maps onto a token.
    style.color = background === undefined ? TOKEN_BY_BASIC_RGB[tripleOf(paint.fg).replace(/\s+/g, '')] ?? literal : literal
  }
  for (const decoration of DECORATIONS) {
    if (paint[decoration] !== true) continue
    Object.assign(style, STYLE_BY_DECORATION[decoration])
  }
  return Object.keys(style).length === 0 ? undefined : style
}
