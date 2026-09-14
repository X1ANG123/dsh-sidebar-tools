/**
 * The screen emulator: raw PTY bytes in, one serialized visible screen out.
 *
 * `@xterm/headless` is the same VT engine the output cards take their palette
 * from, loaded through `createRequire` because the package ships CommonJS only.
 * It runs here rather than in the browser for two reasons: the pane then needs
 * no renderer dependency at all, and the emulator's protocol replies — which
 * pwsh's line editor waits for — can be written straight back into the PTY.
 *
 * Style runs are emitted as text segments in string order, so a wide character
 * never has to be reconciled with a column index. Blink is deliberately not
 * reproduced, matching the output cards; reverse video is consumed by swapping
 * the cell's two colors, which is what anser does for the same input.
 *
 * @module @deepseek-ai/dsh-client-ui-sidebar-tools/host/emulator
 */

import { createRequire } from 'node:module'
import {
  ATTR_BOLD, ATTR_DIM, ATTR_HIDDEN, ATTR_ITALIC, ATTR_STRIKETHROUGH, ATTR_UNDERLINE,
  type TerminalRun, type TerminalScreenFrame,
} from '../shared.ts'

/**
 * xterm's cell color-mode discriminators, read off the installed engine: the
 * 8/16 palette, the 256-color palette, and a 24-bit value. The first two both
 * carry a palette index, which is what the pane's palette needs; every other
 * mode — the default one included — means the cell inherits.
 */
const COLOR_MODE_PALETTE = 0x01000000
/** The 256-color palette. */
const COLOR_MODE_256 = 0x02000000
/** A 24-bit color. */
const COLOR_MODE_RGB = 0x03000000

/**
 * Whether a color mode carries a usable value.
 * @param mode - the mode a cell reports.
 * @returns true for the palette and 24-bit modes.
 */
function carriesColor(mode: number): boolean {
  return mode === COLOR_MODE_PALETTE || mode === COLOR_MODE_256 || mode === COLOR_MODE_RGB
}

/** One emulator cell, as far as a screen frame needs it. */
interface CellLike {
  getChars(): string
  getWidth(): number
  getFgColorMode(): number
  getFgColor(): number
  getBgColorMode(): number
  getBgColor(): number
  isBold(): number
  isDim(): number
  isItalic(): number
  isUnderline(): number
  isStrikethrough(): number
  isInvisible(): number
  isInverse(): number
  isBlink(): number
}

/** One emulator buffer line. */
interface LineLike {
  translateToString(trimRight?: boolean): string
  getCell(x: number): CellLike | undefined
}

/** The emulator's active buffer. */
interface BufferLike {
  readonly type: 'normal' | 'alternate'
  readonly cursorX: number
  readonly cursorY: number
  readonly viewportY: number
  /** Lines retained above the viewport, which is the history the pane can scroll. */
  readonly baseY: number
  getLine(y: number): LineLike | undefined
}

/** The emulator surface this module uses. */
interface EmulatorLike {
  write(data: string, callback?: () => void): void
  onData(handler: (data: string) => void): { dispose(): void }
  readonly buffer: { readonly active: BufferLike }
  dispose(): void
}

/** The CommonJS module `@xterm/headless` ships. */
interface HeadlessModule {
  Terminal: new (options: {
    cols: number
    rows: number
    scrollback: number
    allowProposedApi: boolean
  }) => EmulatorLike
}

const require = createRequire(import.meta.url)

/** One cell's colors and attributes, absent members meaning "inherit". */
interface Paint {
  fg?: number
  bg?: number
  fgRgb?: boolean
  bgRgb?: boolean
  a?: number
}

/**
 * The attribute bits one cell carries.
 * @param cell - the cell to read.
 * @returns the bit set, zero when the cell is plain.
 */
function attributeBits(cell: CellLike): number {
  let bits = 0
  if (cell.isBold() !== 0) bits |= ATTR_BOLD
  if (cell.isDim() !== 0) bits |= ATTR_DIM
  if (cell.isItalic() !== 0) bits |= ATTR_ITALIC
  if (cell.isUnderline() !== 0) bits |= ATTR_UNDERLINE
  if (cell.isStrikethrough() !== 0) bits |= ATTR_STRIKETHROUGH
  if (cell.isInvisible() !== 0) bits |= ATTR_HIDDEN
  // Blink is not reproduced, exactly as in the output cards.
  return bits
}

/**
 * Read one cell's paint, consuming reverse video the way anser does.
 * @param cell - the cell to read.
 * @returns the colors and attributes to carry on the wire.
 */
function paintOf(cell: CellLike): Paint {
  const fgMode = cell.getFgColorMode()
  const bgMode = cell.getBgColorMode()
  let fg = carriesColor(fgMode) ? cell.getFgColor() : undefined
  let bg = carriesColor(bgMode) ? cell.getBgColor() : undefined
  let fgRgb = fgMode === COLOR_MODE_RGB
  let bgRgb = bgMode === COLOR_MODE_RGB
  if (cell.isInverse() !== 0) {
    const swapped = fg
    fg = bg
    bg = swapped
    const swappedMode = fgRgb
    fgRgb = bgRgb
    bgRgb = swappedMode
  }
  const paint: Paint = {}
  if (fg !== undefined) paint.fg = fg
  if (bg !== undefined) paint.bg = bg
  if (fg !== undefined && fgRgb) paint.fgRgb = true
  if (bg !== undefined && bgRgb) paint.bgRgb = true
  const a = attributeBits(cell)
  if (a !== 0) paint.a = a
  return paint
}

/**
 * Whether two cells would paint the same run.
 * @param left - one paint.
 * @param right - the other paint.
 * @returns true when the styles are identical.
 */
function samePaint(left: Paint, right: Paint): boolean {
  return left.fg === right.fg && left.bg === right.bg
    && left.fgRgb === right.fgRgb && left.bgRgb === right.bgRgb
    && left.a === right.a
}

/**
 * One row's styled segments. The engine drops the cells nobody wrote and keeps
 * spaces somebody did, so this reproduces exactly the row text it is given: the
 * two must agree, or a pane would paint a different line from the one it drew.
 * @param line - the buffer line to read.
 * @param cols - how many columns the grid holds.
 * @param rowText - the row's text, as {@link LineLike.translateToString} rendered it.
 * @returns the row's runs in string order, joined exactly equal to `rowText`.
 */
function runsOf(line: LineLike, cols: number, rowText: string): TerminalRun[] {
  const runs: TerminalRun[] = []
  let text = ''
  let paint: Paint | undefined
  const flush = (): void => {
    if (text === '' || paint === undefined) return
    runs.push({ text, ...paint })
    text = ''
  }
  for (let x = 0; x < cols; x += 1) {
    const cell = line.getCell(x)
    if (cell === undefined) break
    // A zero-width cell is the second half of a wide character: its text
    // already arrived with the first, so it contributes no column here.
    if (cell.getWidth() === 0) continue
    const chars = cell.getChars()
    const next = paintOf(cell)
    if (paint !== undefined && !samePaint(paint, next)) flush()
    paint = next
    text += chars === '' ? ' ' : chars
  }
  flush()
  const built = runs.reduce((total, run) => total + run.text.length, 0)
  let excess = built - rowText.length
  if (excess <= 0) return runs
  // The blank cells the engine dropped are at the END of the row, so the trim
  // walks the runs backwards: trimming forwards would eat the colored text.
  const trimmed = [...runs]
  while (excess > 0 && trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1]
    if (last === undefined) break
    if (last.text.length <= excess) {
      excess -= last.text.length
      trimmed.pop()
      continue
    }
    trimmed[trimmed.length - 1] = { ...last, text: last.text.slice(0, last.text.length - excess) }
    excess = 0
  }
  return trimmed
}

/** The headless emulator, wrapped to one screen frame per update. */
export class ScreenEmulator {
  private readonly term: EmulatorLike
  private readonly replies: { dispose(): void } | undefined

  /**
   * @param cols - grid width.
   * @param rows - grid height.
   * @param scrollback - retained lines beyond the visible screen.
   * @param onReply - receives the emulator's terminal-protocol replies.
   */
  constructor(cols: number, rows: number, scrollback: number, onReply?: (data: string) => void) {
    const headless = require('@xterm/headless') as HeadlessModule
    this.cols = cols
    this.rows = rows
    // Reading the buffer is xterm's *proposed* API: it is the only way to see
    // the rendered screen, and the package's version is pinned by the lockfile.
    // A major upgrade must re-verify the frame serializer — the emulator spec
    // and the palette parity test are the guards.
    this.term = new headless.Terminal({ cols, rows, scrollback, allowProposedApi: true })
    this.replies = onReply === undefined ? undefined : this.term.onData(onReply)
  }

  private readonly cols: number
  private readonly rows: number

  /**
   * Feed terminal output to the emulator.
   * @param text - raw output text, decoded from the PTY's UTF-8 stream.
   * @returns a promise that settles once the emulator has consumed the text.
   */
  write(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.term.write(text, () => { resolve() })
    })
  }

  /**
   * Serialize the visible screen.
   * @param seq - the frame counter to stamp.
   * @param color - whether to include style runs.
   * @returns the frame to send.
   */
  serialize(seq: number, color: boolean): TerminalScreenFrame {
    const buffer = this.term.buffer.active
    const rows: string[] = []
    const runs: TerminalRun[][] = []
    for (let y = 0; y < this.rows; y += 1) {
      const line = buffer.getLine(buffer.viewportY + y)
      if (line === undefined) {
        rows.push('')
        if (color) runs.push([])
        continue
      }
      const text = line.translateToString(true)
      rows.push(text)
      if (color) runs.push(runsOf(line, this.cols, text))
    }
    const inRange = buffer.cursorY >= 0 && buffer.cursorY < this.rows
    return {
      kind: 'screen',
      seq,
      rows,
      cursor: { x: buffer.cursorX, y: buffer.cursorY, visible: inRange },
      alt: buffer.type === 'alternate',
      base: buffer.baseY,
      ...(color ? { runs } : {}),
    }
  }

  /** Release the emulator and its reply subscription. */
  dispose(): void {
    this.replies?.dispose()
    this.term.dispose()
  }
}
