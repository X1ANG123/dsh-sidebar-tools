/**
 * The emulator's contract: raw bytes in, one visible screen out — with the
 * cursor, the alternate buffer, wide characters, and style runs the pane draws.
 * The engine is the real one, so a change in it is visible here.
 */
import { describe, expect, it } from 'vitest'
import { ScreenEmulator } from '../src/host/emulator.ts'

/**
 * One emulator over a small grid.
 * @param onReply - receives the emulator's protocol replies.
 * @returns the emulator, to be disposed by the caller's test.
 */
function emulator(onReply?: (data: string) => void): ScreenEmulator {
  return new ScreenEmulator(20, 3, 100, onReply)
}

describe('ScreenEmulator', () => {
  it('serializes text, the cursor, and the normal buffer', async () => {
    const screen = emulator()
    await screen.write('hello')
    const frame = screen.serialize(1, false)
    expect(frame).toMatchObject({ kind: 'screen', seq: 1, alt: false, base: expect.any(Number) })
    expect(frame.rows[0]).toBe('hello')
    expect(frame.cursor).toEqual({ x: 5, y: 0, visible: true })
    expect(frame.runs).toBeUndefined()
    screen.dispose()
  })

  it('reports the alternate buffer while a full-screen program owns it', async () => {
    const screen = emulator()
    await screen.write('\u001b[?1049hfull screen')
    const frame = screen.serialize(1, false)
    expect(frame.alt).toBe(true)
    expect(frame.rows[0]).toBe('full screen')
    await screen.write('\u001b[?1049l')
    expect(screen.serialize(2, false).alt).toBe(false)
    screen.dispose()
  })

  it('places the cursor where a cursor-addressing sequence put it', async () => {
    const screen = emulator()
    await screen.write('\u001b[2;4H')
    expect(screen.serialize(1, false).cursor).toEqual({ x: 3, y: 1, visible: true })
    screen.dispose()
  })

  it('keeps a wide character whole and reproduces the row exactly in its runs', async () => {
    const screen = emulator()
    await screen.write('你 a   ')
    const frame = screen.serialize(1, true)
    // The engine drops the cells nobody wrote, and keeps the spaces somebody
    // did write: the pane must not silently reshape authored output.
    expect(frame.rows[0]).toBe('你 a   ')
    // 你 is two columns, then a space, an `a`, and three written spaces.
    expect(frame.cursor.x).toBe(7)
    const runs = frame.runs?.[0] ?? []
    expect(runs.map(run => run.text).join('')).toBe(frame.rows[0])
    screen.dispose()
  })

  it('carries a palette-indexed run for colored output', async () => {
    const screen = emulator()
    await screen.write('\u001b[31mred\u001b[0m plain')
    const frame = screen.serialize(1, true)
    const runs = frame.runs?.[0] ?? []
    expect(runs[0]).toEqual({ text: 'red', fg: 1 })
    expect(runs[1]).toEqual({ text: ' plain' })
    expect(runs.map(run => run.text).join('')).toBe(frame.rows[0])
    screen.dispose()
  })

  it('distinguishes the 256-color and truecolor palettes from the basic one', async () => {
    const screen = emulator()
    await screen.write('\u001b[38;5;208mC\u001b[38;2;18;52;86mT')
    const runs = screen.serialize(1, true).runs?.[0] ?? []
    expect(runs[0]).toEqual({ text: 'C', fg: 208 })
    expect(runs[1]).toEqual({ text: 'T', fg: 0x123456, fgRgb: true })
    screen.dispose()
  })

  it('carries attributes as bits and consumes reverse video by swapping colors', async () => {
    const screen = emulator()
    await screen.write('\u001b[1;4mstyle\u001b[0m')
    const bold = screen.serialize(1, true).runs?.[0]?.[0]
    expect(bold?.a).toBe(1 | 8)
    await screen.write('\u001b[2;1H\u001b[7;31;44mrev')
    const reversed = screen.serialize(2, true).runs?.[1]?.[0]
    expect(reversed?.fg).toBe(4)
    expect(reversed?.bg).toBe(1)
    screen.dispose()
  })

  it('never carries blink, which the output cards do not reproduce either', async () => {
    const screen = emulator()
    await screen.write('\u001b[5mblinking')
    expect(screen.serialize(1, true).runs?.[0]?.[0]?.a).toBeUndefined()
    screen.dispose()
  })

  it('hands the emulator’s own replies back to the caller', async () => {
    const replies: string[] = []
    const screen = emulator(data => { replies.push(data) })
    // A device-status request is what a shell's line editor waits for.
    await screen.write('\u001b[6n')
    expect(replies.join('')).toContain('\u001b[')
    screen.dispose()
  })

  it('answers an empty screen with empty rows rather than throwing', () => {
    const screen = emulator()
    const frame = screen.serialize(1, true)
    expect(frame.rows).toHaveLength(3)
    expect(frame.rows.every(row => row === '')).toBe(true)
    expect(frame.runs).toEqual([[], [], []])
    screen.dispose()
  })
})
