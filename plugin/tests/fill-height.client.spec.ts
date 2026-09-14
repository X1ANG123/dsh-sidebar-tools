// @vitest-environment jsdom
/**
 * The pane-fill measurement: it must stop at the box that actually clips the
 * child. Measuring to the window instead lets a terminal grid grow past the
 * pane's own bottom, where the clip hides the last rows and no scrollbar can
 * reach them — the bug that made scrolled-back output look cut off.
 */
import { describe, expect, it, vi } from 'vitest'
import { paneAvailableHeight } from '../src/client/fill-height.ts'

/**
 * A DOMRect double.
 * @param top - the top edge.
 * @param bottom - the bottom edge.
 * @returns the rectangle.
 */
function rect(top: number, bottom: number): DOMRect {
  return {
    top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/**
 * A pane body with one filling child.
 * @param overflow - the body's own overflow, `hidden` or `auto` in a real pane.
 * @returns the child to measure.
 */
function stage(overflow: string): HTMLElement {
  const outer = document.createElement('div')
  const body = document.createElement('div')
  const child = document.createElement('div')
  body.style.overflowY = overflow
  outer.append(body)
  body.append(child)
  document.body.append(outer)
  vi.spyOn(child, 'getBoundingClientRect').mockReturnValue(rect(100, 140))
  vi.spyOn(body, 'getBoundingClientRect').mockReturnValue(rect(60, 400))
  return child
}

describe('paneAvailableHeight', () => {
  it('measures to a scrolling ancestor, not to a body that merely hides', () => {
    expect(paneAvailableHeight(stage('auto'), 300)).toBe(300)
    // A body that hides its overflow is exactly as tall as its child, so
    // measuring to it would feed the child's own height back as its limit and
    // squash a frame to nothing.
    expect(paneAvailableHeight(stage('hidden'), 300)).toBe(window.innerHeight - 100)
  })

  it('falls back to the window when no ancestor scrolls', () => {
    expect(paneAvailableHeight(stage('visible'), 300)).toBe(window.innerHeight - 100)
  })

  it('answers with the caller’s fallback while the pane is too small to use', () => {
    const child = stage('auto')
    vi.spyOn(child, 'getBoundingClientRect').mockReturnValue(rect(window.innerHeight - 18, window.innerHeight))
    expect(paneAvailableHeight(child, 300)).toBe(300)
  })
})
