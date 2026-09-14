/**
 * How much room a pane actually leaves for a filling child.
 *
 * The right Sidebar's pane does not always hand its body a definite height: the
 * column outside it scrolls, and a child that only asks for `flex: 1` gets
 * nothing to grow into. Measuring the space between the child's top edge and the
 * bottom of the nearest scrolling ancestor is what lets a terminal fill the pane
 * and an embedded frame occupy it instead of collapsing to its intrinsic size.
 *
 * @module @deepseek-ai/dsh-client-ui-sidebar-tools/client/fill-height
 */

import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

/** Below this the pane is still settling, so the caller's fallback is better. */
const MIN_USEFUL_PX = 80

/**
 * The room a pane leaves below one element, up to its scrolling ancestor.
 * @param element - the element that will fill the space.
 * @param fallback - the value to use while the pane measures as nothing.
 * @returns a height in pixels, never the meaningless zero a settling pane reports.
 */
export function paneAvailableHeight(element: HTMLElement, fallback: number): number {
  let node: HTMLElement | null = element.parentElement
  let bottom = window.innerHeight
  while (node !== null) {
    const rect = node.getBoundingClientRect()
    const overflowY = window.getComputedStyle(node).overflowY
    // Only a *scrolling* ancestor has a height the pane cannot move. A body that
    // merely hides its overflow is exactly as tall as the child it holds, so
    // measuring to it feeds the child's own height back as its own limit — which
    // squashes a frame to nothing. The pane's own bodies scroll instead, so a few
    // pixels of overshoot are reachable rather than clipped.
    if (rect.height > 0 && (overflowY === 'auto' || overflowY === 'scroll')) {
      bottom = rect.bottom
      break
    }
    node = node.parentElement
  }
  const available = Math.floor(bottom - element.getBoundingClientRect().top)
  return available > MIN_USEFUL_PX ? available : fallback
}

/**
 * Track the room a pane leaves below one element, re-measuring whenever any
 * ancestor is resized (a dragged divider, a fullscreen toggle, a window resize).
 * @param ref - the element that will fill the space.
 * @param enabled - whether the caller currently has something to fill with.
 * @param fallback - the value used while the pane measures as nothing.
 * @returns the measured height, or undefined before the first measurement.
 */
export function usePaneFill(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  fallback: number,
): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined)
  useEffect(() => {
    const element = ref.current
    if (!enabled || element === null) return
    const measure = (): void => { setHeight(paneAvailableHeight(element, fallback)) }
    measure()
    // jsdom and older engines have no observer; the first measurement stands.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    let node: HTMLElement | null = element.parentElement
    while (node !== null) {
      observer.observe(node)
      node = node.parentElement
    }
    return () => { observer.disconnect() }
  }, [enabled, fallback, ref])
  return height
}
