/**
 * The scrollback fold: which lines a screen frame commits to history, and when
 * the pane must give up on aligning with the host's buffer instead of showing
 * lines that never sat next to each other.
 */
import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, emptyHistory, extendHistory } from '../src/client/terminal/history.ts'
import type { TerminalScreenFrame } from '../src/shared.ts'

/**
 * One screen frame.
 * @param base - retained lines above the screen.
 * @param rows - the visible rows.
 * @param extra - overrides for runs and the alternate buffer.
 * @returns the frame.
 */
function screen(base: number, rows: readonly string[], extra: Partial<TerminalScreenFrame> = {}): TerminalScreenFrame {
  return {
    kind: 'screen',
    seq: base + 1,
    rows,
    cursor: { x: 0, y: Math.max(rows.length - 1, 0), visible: true },
    alt: false,
    base,
    ...extra,
  }
}

describe('extendHistory', () => {
  it('keeps nothing while the screen has not scrolled', () => {
    let history = extendHistory(emptyHistory(), screen(0, ['one', 'two']))
    history = extendHistory(history, screen(0, ['one', 'two']))
    expect(history.lines).toEqual([])
    expect(history.from).toBe(0)
  })

  it('commits the rows that left the top of the previous screen', () => {
    let history = extendHistory(emptyHistory(), screen(0, ['one', 'two']))
    history = extendHistory(history, screen(1, ['two', 'three']))
    expect(history.lines).toEqual([{ text: 'one' }])
    history = extendHistory(history, screen(2, ['three', 'four']))
    expect(history.lines).toEqual([{ text: 'one' }, { text: 'two' }])
    // The oldest retained line keeps its absolute index as the log grows.
    expect(history.from).toBe(0)
  })

  it('carries the previous row’s runs into history', () => {
    const runs = [[{ text: 'one', fg: 2 }]]
    let history = extendHistory(emptyHistory(), screen(0, ['one', 'two'], { runs }))
    history = extendHistory(history, screen(1, ['two', 'three']))
    expect(history.lines).toEqual([{ text: 'one', runs: runs[0] }])
  })

  it('starts over when lines scrolled past unseen', () => {
    const history = extendHistory(emptyHistory(), screen(0, ['one', 'two']))
    // The shell printed a whole screen while the pane was not looking.
    expect(extendHistory(history, screen(9, ['nine', 'ten'])).lines).toEqual([])
  })

  it('starts over when the buffer shrank, which is a clear', () => {
    let history = extendHistory(emptyHistory(), screen(0, ['one', 'two']))
    history = extendHistory(history, screen(1, ['two', 'three']))
    expect(extendHistory(history, screen(0, ['fresh'])).lines).toEqual([])
  })

  it('keeps its history against a host that reports no buffer offset', () => {
    // A host from before the frame carried `base`: the screens still say what
    // scrolled, so the pane keeps its scrollback without one.
    const bare = (rows: readonly string[]): TerminalScreenFrame => ({
      ...screen(0, rows),
      base: undefined as unknown as number,
    })
    let history = extendHistory(emptyHistory(), bare(['one', 'two']))
    history = extendHistory(history, bare(['two', 'three']))
    expect(history.lines).toEqual([{ text: 'one' }])
    history = extendHistory(history, bare(['three', 'four']))
    expect(history.lines).toEqual([{ text: 'one' }, { text: 'two' }])
  })

  it('invents nothing when two blank screens cannot be told apart', () => {
    const bare = (): TerminalScreenFrame => ({
      ...screen(0, ['', '']),
      base: undefined as unknown as number,
    })
    const history = extendHistory(extendHistory(emptyHistory(), bare()), bare())
    expect(history.lines).toEqual([])
  })

  it('keeps no history for a full-screen program and starts over on leaving it', () => {
    let history = extendHistory(emptyHistory(), screen(0, ['one', 'two']))
    history = extendHistory(history, screen(1, ['two', 'three']))
    history = extendHistory(history, screen(0, ['vim'], { alt: true }))
    expect(history.lines).toEqual([])
    history = extendHistory(history, screen(4, ['back']))
    expect(history.lines).toEqual([])
  })

  it('stops at its own limit, keeping the newest lines', () => {
    let history = emptyHistory()
    for (let step = 0; step < HISTORY_LIMIT + 20; step += 1) {
      history = extendHistory(history, screen(step, [`line ${String(step)}`, 'live']))
    }
    expect(history.lines).toHaveLength(HISTORY_LIMIT)
    expect(history.lines[history.lines.length - 1]).toEqual({ text: `line ${String(HISTORY_LIMIT + 18)}` })
  })
})
