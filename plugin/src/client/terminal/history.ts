/**
 * The pane's scrollback: the lines the screen has already scrolled past.
 *
 * The host sends one window — the visible screen — and how many lines sit above
 * it, so the pane can rebuild the history itself instead of asking for it: when
 * a frame's `base` grows by k, exactly the first k rows of the previous frame
 * will never be drawn again, which makes them the next history lines. That keeps
 * scrolling local, costs no wire traffic, and stops at the host's own retained
 * buffer, because there `base` stops growing.
 *
 * @module @deepseek-ai/dsh-client-ui-sidebar-tools/client/terminal/history
 */

import type { TerminalRun, TerminalScreenFrame } from '../../shared.ts'

/** One retained line: its text and, when the deployment colors output, its runs. */
export interface TerminalHistoryLine {
  readonly text: string
  readonly runs?: readonly TerminalRun[]
}

/** The retained lines, the screen they were derived from, and the index math. */
export interface TerminalHistory {
  /** Oldest first; the last entry is the line just above the visible screen. */
  readonly lines: readonly TerminalHistoryLine[]
  /** Absolute index of `lines[0]` in the host's buffer. */
  readonly from: number
  /** The frame the next one aligns against. */
  readonly screen: TerminalScreenFrame | undefined
}

/**
 * The most lines one pane keeps. The host's own `scrollback` setting is the real
 * bound; this only stops a long session from growing the browser's memory.
 */
export const HISTORY_LIMIT = 2000

/**
 * The history a pane starts with.
 * @returns an empty history.
 */
export function emptyHistory(): TerminalHistory {
  return { lines: [], from: 0, screen: undefined }
}

/**
 * How many leading rows of the previous screen the new one has scrolled past,
 * read off the two screens when the host did not say. One line of overlap with a
 * non-blank row is the signal; a screen of blank lines matches everything, so it
 * commits nothing rather than inventing history.
 * @param previous - the screen before this one.
 * @param screen - the frame just received.
 * @returns the count, or `undefined` when the two screens do not line up.
 */
function shiftedOut(previous: TerminalScreenFrame, screen: TerminalScreenFrame): number | undefined {
  for (let moved = 1; moved < previous.rows.length; moved += 1) {
    const tail = previous.rows.slice(moved)
    if (tail.length > screen.rows.length) continue
    if (!tail.some(row => row.trim() !== '')) continue
    if (tail.every((row, index) => row === screen.rows[index])) return moved
  }
  return undefined
}

/**
 * Fold one screen frame into the history.
 * @param history - the history so far.
 * @param screen - the frame just received.
 * @returns the history after this frame, ready for the next one.
 */
export function extendHistory(history: TerminalHistory, screen: TerminalScreenFrame): TerminalHistory {
  const previous = history.screen
  // The absolute index this screen starts at; a host that predates the frame's
  // own offset leaves the log where it was.
  const anchored = typeof screen.base === 'number' ? screen.base : history.from + history.lines.length
  // A full-screen program owns the pane and commits no lines; leaving one
  // returns to a buffer the pane has no aligned window onto, so it starts over.
  if (screen.alt) {
    return { lines: previous?.alt === true ? history.lines : [], from: anchored, screen }
  }
  if (previous === undefined) return { lines: [], from: anchored, screen }
  if (typeof screen.base !== 'number' || typeof previous.base !== 'number') {
    // A host from before the frame carried its buffer offset: the screens still
    // say what scrolled, so the pane keeps its history without one.
    const moved = shiftedOut(previous, screen)
    if (moved === undefined) return { ...history, screen }
    const grownFrom = previous.rows.slice(0, moved).map((text, index): TerminalHistoryLine => {
      const runs = previous.runs?.[index]
      return runs === undefined ? { text } : { text, runs }
    })
    return { lines: [...history.lines, ...grownFrom].slice(-HISTORY_LIMIT), from: history.from, screen }
  }
  const held = history.from + history.lines.length
  // A gap means lines scrolled past unseen (or the buffer was cleared): the
  // only honest answer is to drop what the pane can no longer place.
  if (screen.base < held || screen.base < previous.base) {
    return { lines: [], from: anchored, screen }
  }
  const committed = screen.base - held
  if (committed === 0) return { ...history, screen }
  if (previous.alt === true || committed > previous.rows.length) {
    return { lines: [], from: anchored, screen }
  }
  const grown = previous.rows.slice(0, committed).map((text, index): TerminalHistoryLine => {
    const runs = previous.runs?.[index]
    return runs === undefined ? { text } : { text, runs }
  })
  const merged = [...history.lines, ...grown]
  // Dropping the oldest line moves the log's origin with it: `from + lines.length`
  // is the absolute index the next frame aligns against.
  const dropped = Math.max(merged.length - HISTORY_LIMIT, 0)
  return { lines: merged.slice(dropped), from: history.from + dropped, screen }
}
