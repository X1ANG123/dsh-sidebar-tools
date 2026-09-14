/**
 * The cell painter's contract is parity: a cell painted from emulator data must
 * resolve to exactly the style `parseAnsiLines` gives the same color in a tool
 * result card. The fixtures below are the same command output through both
 * paths, so a palette that drifts on either side fails here.
 *
 * One normalization is allowed and only one: whitespace inside an `rgb(...)`
 * literal. Anser's own palette strings are spaced inconsistently between
 * indices, and no renderer can distinguish `rgb(255,255,255)` from
 * `rgb(255, 255, 255)`.
 */
import { describe, expect, it } from 'vitest'
import { parseAnsiLines } from '../src/ansi.ts'
import { terminalCellStyle, type TerminalCellPaint } from '../src/cell-run-style.ts'

/**
 * The style the ANSI path resolves for one escape sequence.
 * @param escape - the SGR sequence to feed the parser.
 * @returns the span's inline style, or undefined when the parser styles nothing.
 */
function ansiStyle(escape: string): unknown {
  return parseAnsiLines(`${escape}X`)[0]?.[0]?.style
}

/**
 * Normalize one style for comparison.
 * @param style - a resolved style from either path.
 * @returns the same style with `rgb(...)` literals normalized.
 */
function normalized(style: unknown): unknown {
  if (typeof style !== 'object' || style === null) return style
  return Object.fromEntries(Object.entries(style as Record<string, unknown>).map(([key, value]) => [
    key,
    typeof value === 'string' ? value.replace(/,\s+/g, ',') : value,
  ]))
}

/**
 * Assert one cell paint and one escape sequence resolve to the same style.
 * @param paint - the cell paint.
 * @param escape - the equivalent SGR sequence.
 * @param label - the case name, for the failure message.
 */
function expectParity(paint: TerminalCellPaint, escape: string, label: string): void {
  expect(normalized(terminalCellStyle(paint)), label).toEqual(normalized(ansiStyle(escape)))
}

describe('terminalCellStyle', () => {
  it('matches the ANSI path for every one of the 16 basic colors', () => {
    for (let index = 0; index < 16; index += 1) {
      expectParity({ fg: index }, `\u001b[38;5;${String(index)}m`, `fg ${String(index)}`)
      expectParity({ bg: index }, `\u001b[48;5;${String(index)}m`, `bg ${String(index)}`)
    }
  })

  it('matches the ANSI path for the classic SGR colors, not just the cube', () => {
    for (const [sgr, index] of [[30, 0], [31, 1], [32, 2], [33, 3], [34, 4], [35, 5], [36, 6], [37, 7]] as const) {
      expectParity({ fg: index }, `\u001b[${String(sgr)}m`, `SGR ${String(sgr)}`)
    }
  })

  it('keeps anser’s literal pair when a cell paints its own background', () => {
    expectParity({ fg: 1, bg: 1 }, '\u001b[41m\u001b[31m', 'fg+bg')
    expect(terminalCellStyle({ fg: 1, bg: 1 })).toEqual({ backgroundColor: 'rgb(187, 0, 0)', color: 'rgb(187, 0, 0)' })
  })

  it('matches the ANSI path across the cube and the grayscale ramp', () => {
    for (const index of [16, 52, 208, 231, 232, 255]) {
      expectParity({ fg: index }, `\u001b[38;5;${String(index)}m`, `fg ${String(index)}`)
    }
  })

  it('matches the ANSI path for truecolor', () => {
    expectParity({ fg: 0x123456, fgRgb: true }, '\u001b[38;2;18;52;86m', 'fg truecolor')
    expectParity({ bg: 0xffffff, bgRgb: true }, '\u001b[48;2;255;255;255m', 'bg truecolor')
  })

  it('matches the ANSI path when the two sides use different color modes', () => {
    expectParity({ fg: 0x123456, fgRgb: true, bg: 1 }, '\u001b[48;5;1m\u001b[38;2;18;52;86m', 'rgb fg over palette bg')
    expectParity({ fg: 1, bg: 0x123456, bgRgb: true }, '\u001b[48;2;18;52;86m\u001b[38;5;1m', 'palette fg over rgb bg')
  })

  it('matches the ANSI path for every decoration it reproduces', () => {
    const decorations = [
      { bold: true }, { dim: true }, { italic: true }, { underline: true }, { strikethrough: true }, { hidden: true },
    ] as const
    const escapes = ['\u001b[1m', '\u001b[2m', '\u001b[3m', '\u001b[4m', '\u001b[9m', '\u001b[8m']
    for (const [at, paint] of decorations.entries()) {
      expectParity(paint, escapes[at] ?? '', `decoration ${String(at)}`)
    }
  })

  it('combines colors and decorations the way the card does', () => {
    expectParity({ fg: 2, bold: true, underline: true }, '\u001b[1m\u001b[4m\u001b[38;5;2m', 'combined')
  })

  it('styles nothing for a default cell', () => {
    expect(terminalCellStyle({})).toBeUndefined()
    expect(terminalCellStyle({ bold: false, fg: undefined, bg: undefined })).toBeUndefined()
  })

  it('clamps an out-of-range palette index instead of emitting an invalid color', () => {
    expect(terminalCellStyle({ fg: 999 })).toEqual({ color: 'rgb(238, 238, 238)' })
    expect(terminalCellStyle({ fg: -5 })).toEqual({ color: 'var(--dsw-alias-label-primary)' })
  })
})
