// @vitest-environment jsdom
/**
 * The browser tab's chip: it names the page the pane is showing, with the site's
 * own favicon where the site serves it and a monogram of the host otherwise. The
 * favicon request must carry no credentials and no referrer — naming a page never
 * hands the site a cookie.
 */
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { BrowserTitle, type BrowserTitleProps } from '../src/client/browser/BrowserTitle.tsx'
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
 * Mount-ready props over one store instance, optionally with a page open.
 * @param url - the address the pane is showing.
 * @returns the props.
 */
function harness(url = '') {
  const instance = createBrowserStore().create()
  instance.actions.start(TAB as never)
  if (url !== '') instance.actions.visited(TAB as never, url)
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
        signal: new AbortController().signal,
        actions: { openResource: vi.fn(), openTab: vi.fn(), close: vi.fn() },
      },
    }),
    useStore: hookOf(instance),
    actions: instance.actions,
    t: makeTranslate(zh),
  }
  return { shared }
}

describe('BrowserTitle', () => {
  it('falls back to the type name before anything is open', () => {
    const test = harness()
    render(<BrowserTitle {...test.shared as unknown as BrowserTitleProps} />)
    expect(screen.getByText(zh['browser.title'])).toBeDefined()
  })

  it('names the host and asks this host for the site’s logo', () => {
    const test = harness('https://docs.example.com/guide?x=1')
    const view = render(<BrowserTitle {...test.shared as unknown as BrowserTitleProps} />)
    expect(screen.getByText('docs.example.com')).toBeDefined()
    const logo = view.container.querySelector('img')
    // The logo comes from our own route, which fetches it without credentials:
    // a direct `<img>` to the site would carry that site's cookies.
    expect(logo?.getAttribute('src'))
      .toBe(`/gui-terminal/favicon?origin=${encodeURIComponent('https://docs.example.com')}`)
    expect(logo?.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('shows the host alone when the site has no logo to show', () => {
    const test = harness('https://docs.example.com/')
    const view = render(<BrowserTitle {...test.shared as unknown as BrowserTitleProps} />)
    const logo = view.container.querySelector('img')
    expect(logo).not.toBeNull()
    fireEvent.error(logo as Element)
    // No invented initial: the name stands by itself.
    expect(view.container.querySelector('img')).toBeNull()
    expect(screen.getByText('docs.example.com')).toBeDefined()
  })
})
