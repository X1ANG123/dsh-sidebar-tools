// @vitest-environment jsdom
/**
 * The browser body over a real store: what it refuses, what the frame it
 * creates is allowed to do, and that a refusal never leaves a frame behind.
 */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { BrowserBody, type BrowserBodyProps } from '../src/client/browser/BrowserBody.tsx'
import { createBrowserStore } from '../src/client/browser/store.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const TAB = 'tab-1'

/** A selector hook bound to one store instance, as the framework binds it. */
function hookOf(instance: { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }) {
  return function useSelector<S>(select: (state: never) => S): S {
    return select(useSyncExternalStore(instance.subscribe, instance.getSnapshot) as never)
  }
}

/**
 * Mount-ready props over one store instance.
 * @returns the props.
 */
function harness() {
  const instance = createBrowserStore().create()
  const controller = new AbortController()
  const shared = {
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'pane-1' },
      tab: {
        id: TAB,
        kind: 'browser',
        contentId: 'browser',
        title: zh['browser.title'],
        visible: true,
        navigation: { address: 'browser', params: undefined, revision: 1 },
        signal: controller.signal,
        actions: { openResource: vi.fn(), openTab: vi.fn(), close: vi.fn() },
      },
    }),
    useStore: hookOf(instance),
    actions: instance.actions,
    t: makeTranslate(zh),
  }
  return { shared }
}

/**
 * Type an address and press Enter, as a reader would.
 * @param address - the raw text.
 */
function visit(address: string): void {
  const field = screen.getByLabelText(zh['browser.address'])
  fireEvent.change(field, { target: { value: address } })
  fireEvent.keyDown(field, { key: 'Enter' })
}

describe('BrowserBody', () => {
  it('starts on the guide copy, with no frame at all', () => {
    const test = harness()
    const view = render(<BrowserBody {...test.shared as unknown as BrowserBodyProps} />)
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(screen.getByText(zh['browser.guide.description'])).toBeDefined()
  })

  it('frames an accepted address with no referrer and the denials it keeps', () => {
    const test = harness()
    const view = render(<BrowserBody {...test.shared as unknown as BrowserBodyProps} />)
    act(() => { visit('example.com') })
    const frame = view.container.querySelector('iframe')
    expect(frame?.getAttribute('src')).toBe('https://example.com/')
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(frame?.getAttribute('allow')).toContain("camera 'none'")
  })

  it('loads the frame credential-less where the engine supports it', () => {
    // jsdom has no credentialless frame, so the support bit is staged here; the
    // pane's own choice is what is under test, not the engine's.
    Object.defineProperty(HTMLIFrameElement.prototype, 'credentialless', { value: '', configurable: true })
    try {
      const test = harness()
      const view = render(<BrowserBody {...test.shared as unknown as BrowserBodyProps} />)
      act(() => { visit('example.com') })
      const frame = view.container.querySelector('iframe')
      expect(frame?.getAttribute('sandbox')).toBe('allow-forms allow-scripts allow-same-origin allow-popups')
      expect(frame?.hasAttribute('credentialless')).toBe(true)
      expect(view.container.querySelector('[data-browser-privacy]')).toBeNull()
    } finally {
      Reflect.deleteProperty(HTMLIFrameElement.prototype, 'credentialless')
    }
  })

  it('falls back to an opaque origin, and says so, where isolation is unavailable', () => {
    const test = harness()
    const view = render(<BrowserBody {...test.shared as unknown as BrowserBodyProps} />)
    act(() => { visit('example.com') })
    const frame = view.container.querySelector('iframe')
    expect(frame?.getAttribute('sandbox')).toBe('allow-forms allow-scripts')
    expect(frame?.hasAttribute('credentialless')).toBe(false)
    expect(screen.getByText(zh['browser.privacyStrict'])).toBeDefined()
  })

  it('searches for a phrase rather than refusing it', () => {
    const test = harness()
    const view = render(<BrowserBody {...test.shared as unknown as BrowserBodyProps} />)
    act(() => { visit('hello world') })
    expect(view.container.querySelector('iframe')?.getAttribute('src'))
      .toBe('https://duckduckgo.com/?q=hello%20world')
  })

  it('refuses this interface’s own origin and leaves no frame behind', () => {
    const test = harness()
    const view = render(<BrowserBody {...test.shared as unknown as BrowserBodyProps} />)
    act(() => { visit(`${window.location.origin}/somewhere`) })
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(screen.getByText(zh['error.sameOriginAddress'])).toBeDefined()
  })

  it('refuses a scheme a frame must not load', () => {
    const test = harness()
    const view = render(<BrowserBody {...test.shared as unknown as BrowserBodyProps} />)
    act(() => { visit('javascript:alert(1)') })
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(screen.getByText(zh['error.unsupportedAddress'])).toBeDefined()
  })

  it('keeps a refused address in the bar so it can be fixed', () => {
    const test = harness()
    render(<BrowserBody {...test.shared as unknown as BrowserBodyProps} />)
    act(() => { visit('data:text/html,<b>x</b>') })
    expect(screen.getByLabelText<HTMLInputElement>(zh['browser.address']).value).toBe('data:text/html,<b>x</b>')
  })

  it('reloads the same address under a new key, so the frame really reloads', () => {
    const test = harness()
    const view = render(<BrowserBody {...test.shared as unknown as BrowserBodyProps} />)
    act(() => { visit('example.com') })
    const first = view.container.querySelector('iframe')
    act(() => { fireEvent.click(screen.getByRole('button', { name: zh['browser.reload'] })) })
    const second = view.container.querySelector('iframe')
    expect(second?.getAttribute('src')).toBe(first?.getAttribute('src'))
    expect(second).not.toBe(first)
  })
})
