/**
 * The browser pane's view state: the address it is showing, the history it can
 * step through, and what it is saying about the last address it refused.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { AddressProblem } from './url.ts'

/** One browser tab's state. */
export interface BrowserTabState {
  /** The address currently framed, empty before the first navigation. */
  url: string
  /** What the address bar shows while it is being edited. */
  draft: string
  /** Addresses visited, oldest first. */
  history: string[]
  /** Index of `url` inside `history`, or -1 when nothing was visited. */
  index: number
  /** Why the last submission was refused, when it was. */
  problem: AddressProblem | undefined
  /** Whether the frame has gone quiet long enough to suggest opening it outside. */
  hint: boolean
  /** A reload nonce: changing it makes the frame load again. */
  nonce: number
}

/** Every browser tab, keyed by tab id. */
export interface BrowserState {
  byTab: Record<TabId, BrowserTabState>
}

/** The store's write set; every action names the tab it writes. */
type BrowserActions = {
  start: (draft: BrowserState, tabId: TabId) => void
  draft: (draft: BrowserState, tabId: TabId, text: string) => void
  visited: (draft: BrowserState, tabId: TabId, url: string) => void
  refused: (draft: BrowserState, tabId: TabId, problem: AddressProblem) => void
  step: (draft: BrowserState, tabId: TabId, delta: number) => void
  reload: (draft: BrowserState, tabId: TabId) => void
  hint: (draft: BrowserState, tabId: TabId, visible: boolean) => void
  forget: (draft: BrowserState, tabId: TabId) => void
}

/**
 * One tab's bucket.
 * @param state - the draft.
 * @param tabId - the tab being written.
 * @returns the tab's state.
 */
function bucket(state: BrowserState, tabId: TabId): BrowserTabState {
  const tab = state.byTab[tabId]
  if (tab === undefined) throw new Error(`ui-sidebar-tools: no browser state for tab "${tabId}"`)
  return tab
}

/**
 * Declare the browser pane's store.
 * @returns the store handle to declare on the registration.
 */
export function createBrowserStore(): EngineStoreHandle<BrowserState, BrowserActions> {
  return defineStore({
    init: (): BrowserState => ({ byTab: {} }),
    actions: {
      /**
       * Seed one tab's state.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      start: (d, tabId) => {
        d.byTab[tabId] = {
          url: '',
          draft: '',
          history: [],
          index: -1,
          problem: undefined,
          hint: false,
          nonce: 0,
        }
      },
      /**
       * Record what the address bar shows.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param text - the current text.
       */
      draft: (d, tabId, text) => {
        bucket(d, tabId).draft = text
      },
      /**
       * Navigate to an accepted address, truncating any forward history.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param url - the normalized address.
       */
      visited: (d, tabId, url) => {
        const tab = bucket(d, tabId)
        tab.history = [...tab.history.slice(0, tab.index + 1), url]
        tab.index = tab.history.length - 1
        tab.url = url
        tab.draft = url
        tab.problem = undefined
        tab.hint = false
      },
      /**
       * Record a refused address.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param problem - why it was refused.
       */
      refused: (d, tabId, problem) => {
        bucket(d, tabId).problem = problem
      },
      /**
       * Step through the history.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param delta - -1 for back, +1 for forward.
       */
      step: (d, tabId, delta) => {
        const tab = bucket(d, tabId)
        const next = tab.index + delta
        if (next < 0 || next >= tab.history.length) return
        tab.index = next
        tab.url = tab.history[next] ?? tab.url
        tab.draft = tab.url
        tab.hint = false
      },
      /**
       * Load the current address again.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      reload: (d, tabId) => {
        const tab = bucket(d, tabId)
        tab.nonce += 1
        tab.hint = false
      },
      /**
       * Record whether the frame looks like a refusal to embed.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param visible - whether the hint applies.
       */
      hint: (d, tabId, visible) => {
        bucket(d, tabId).hint = visible
      },
      /**
       * Forget one tab.
       * @param d - draft state.
       * @param tabId - the tab that went away.
       */
      forget: (d, tabId) => {
        d.byTab = Object.fromEntries(Object.entries(d.byTab).filter(([id]) => id !== tabId))
      },
    },
  })
}
