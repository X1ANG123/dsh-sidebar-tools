/**
 * Every keystroke mapping, in one table. The pane never guesses what a key
 * means, so each mapping is asserted here rather than discovered in the browser.
 */
import { describe, expect, it } from 'vitest'
import { keyToBytes, type KeyStroke } from '../src/client/terminal/keys.ts'

/**
 * One keystroke, with every modifier defaulted to off.
 * @param key - `KeyboardEvent.key`.
 * @param overrides - the modifiers this case holds.
 * @returns the stroke.
 */
function stroke(key: string, overrides: Partial<KeyStroke> = {}): KeyStroke {
  return { key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...overrides }
}

describe('keyToBytes', () => {
  it('sends printable input as itself', () => {
    for (const key of ['a', 'Z', '7', ' ', '!', '你']) {
      expect(keyToBytes(stroke(key)), key).toBe(key)
    }
  })

  it('sends the editing keys a terminal expects', () => {
    expect(keyToBytes(stroke('Enter'))).toBe('\r')
    expect(keyToBytes(stroke('Backspace'))).toBe('\u007f')
    expect(keyToBytes(stroke('Tab'))).toBe('\t')
    expect(keyToBytes(stroke('Escape'))).toBe('\u001b')
  })

  it('sends cursor and paging sequences', () => {
    expect(keyToBytes(stroke('ArrowUp'))).toBe('\u001b[A')
    expect(keyToBytes(stroke('ArrowDown'))).toBe('\u001b[B')
    expect(keyToBytes(stroke('ArrowRight'))).toBe('\u001b[C')
    expect(keyToBytes(stroke('ArrowLeft'))).toBe('\u001b[D')
    expect(keyToBytes(stroke('Home'))).toBe('\u001b[H')
    expect(keyToBytes(stroke('End'))).toBe('\u001b[F')
    expect(keyToBytes(stroke('Insert'))).toBe('\u001b[2~')
    expect(keyToBytes(stroke('Delete'))).toBe('\u001b[3~')
    expect(keyToBytes(stroke('PageUp'))).toBe('\u001b[5~')
    expect(keyToBytes(stroke('PageDown'))).toBe('\u001b[6~')
  })

  it('folds Control chords into control bytes', () => {
    expect(keyToBytes(stroke('c', { ctrlKey: true }))).toBe('\u0003')
    expect(keyToBytes(stroke('a', { ctrlKey: true }))).toBe('\u0001')
    expect(keyToBytes(stroke('z', { ctrlKey: true }))).toBe('\u001a')
    expect(keyToBytes(stroke('C', { ctrlKey: true }))).toBe('\u0003')
    expect(keyToBytes(stroke('[', { ctrlKey: true }))).toBe('\u001b')
    expect(keyToBytes(stroke('\\', { ctrlKey: true }))).toBe('\u001c')
    expect(keyToBytes(stroke(']', { ctrlKey: true }))).toBe('\u001d')
  })

  it('leaves Control+Shift to the browser, so copy still copies', () => {
    expect(keyToBytes(stroke('C', { ctrlKey: true, shiftKey: true }))).toBeUndefined()
    expect(keyToBytes(stroke('V', { ctrlKey: true, shiftKey: true }))).toBeUndefined()
  })

  it('leaves the browser shortcuts it does not own alone', () => {
    expect(keyToBytes(stroke('r', { ctrlKey: true, shiftKey: true }))).toBeUndefined()
    expect(keyToBytes(stroke('F5'))).toBeUndefined()
    expect(keyToBytes(stroke('Shift'))).toBeUndefined()
    expect(keyToBytes(stroke('Meta'))).toBeUndefined()
    expect(keyToBytes(stroke('7', { ctrlKey: true }))).toBeUndefined()
    expect(keyToBytes(stroke('a', { metaKey: true }))).toBeUndefined()
    expect(keyToBytes(stroke('F1', { ctrlKey: true }))).toBeUndefined()
  })

  it('prefixes an escape for Alt, which is how a terminal spells Meta', () => {
    expect(keyToBytes(stroke('b', { altKey: true }))).toBe('\u001bb')
    expect(keyToBytes(stroke('ArrowLeft', { altKey: true }))).toBe('\u001b\u001b[D')
    expect(keyToBytes(stroke('b', { altKey: true, metaKey: true }))).toBeUndefined()
  })
})
