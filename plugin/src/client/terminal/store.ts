/**
 * The terminal pane's view state: what the last frame drew, what the shell is
 * doing, and what the pane is saying about the connection.
 *
 * Only serializable frame data lives here; the EventSource and fetch handles
 * stay in the face, because a store is read by the renderer and must survive as
 * plain data.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type {
  TerminalErrorCode,
  TerminalModeChoice,
  TerminalSandboxInfo,
  TerminalScreenFrame,
  TerminalStatus,
} from '../../shared.ts'
import { emptyHistory, extendHistory, type TerminalHistory } from './history.ts'

/** A failure the pane shows in place of a screen. */
export interface TerminalFailureView {
  /** A wire code, `transport` for a stream that never connected, or `input` for a rejected keystroke. */
  readonly code: TerminalErrorCode | 'transport' | 'input'
  readonly message: string
}

/** One terminal tab's state. */
export interface TerminalTabState {
  /** The published terminal, once the host answered. */
  terminalId: string | undefined
  /** Effective confinement, as the host reported it. */
  sandbox: TerminalSandboxInfo | undefined
  /** The newest screen. */
  screen: TerminalScreenFrame | undefined
  /** The shell's process status. */
  status: TerminalStatus | undefined
  /** Why the pane has nothing to draw, when it has nothing to draw. */
  failure: TerminalFailureView | undefined
  /** True while the stream is being re-established. */
  reconnecting: boolean
  /** The confinement this pane asked for; `undefined` means the deployment's own. */
  mode: TerminalModeChoice | undefined
  /** Lines the screen has scrolled past, oldest first. */
  history: TerminalHistory
}

/** Every terminal tab, keyed by tab id. */
export interface TerminalState {
  byTab: Record<TabId, TerminalTabState>
}

/** The store's write set; every action names the tab it writes. */
type TerminalActions = {
  start: (draft: TerminalState, tabId: TabId) => void
  opened: (draft: TerminalState, tabId: TabId, terminalId: string, sandbox: TerminalSandboxInfo) => void
  frame: (draft: TerminalState, tabId: TabId, screen: TerminalScreenFrame) => void
  status: (draft: TerminalState, tabId: TabId, status: TerminalStatus) => void
  failed: (draft: TerminalState, tabId: TabId, failure: TerminalFailureView) => void
  reconnecting: (draft: TerminalState, tabId: TabId, active: boolean) => void
  mode: (draft: TerminalState, tabId: TabId, choice: TerminalModeChoice) => void
  forget: (draft: TerminalState, tabId: TabId) => void
}

/**
 * One tab's bucket, which every writer after `start` relies on.
 * @param state - the draft.
 * @param tabId - the tab being written.
 * @returns the tab's state.
 */
function bucket(state: TerminalState, tabId: TabId): TerminalTabState {
  const tab = state.byTab[tabId]
  if (tab === undefined) throw new Error(`ui-sidebar-tools: no terminal state for tab "${tabId}"`)
  return tab
}

/**
 * Declare the terminal pane's store.
 * @returns the store handle to declare on the registration.
 */
export function createTerminalStore(): EngineStoreHandle<TerminalState, TerminalActions> {
  return defineStore({
    init: (): TerminalState => ({ byTab: {} }),
    actions: {
      /**
       * Seed one tab's state.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       */
      start: (d, tabId) => {
        d.byTab[tabId] = {
          terminalId: undefined,
          sandbox: undefined,
          screen: undefined,
          status: undefined,
          failure: undefined,
          reconnecting: false,
          mode: undefined,
          history: emptyHistory(),
        }
      },
      /**
       * Record the published terminal.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param terminalId - the host's terminal id.
       * @param sandbox - the confinement facts the host reported.
       */
      opened: (d, tabId, terminalId, sandbox) => {
        const tab = bucket(d, tabId)
        tab.terminalId = terminalId
        tab.sandbox = sandbox
        tab.failure = undefined
      },
      /**
       * Record one screen frame.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param screen - the frame, already parsed.
       */
      frame: (d, tabId, screen) => {
        const tab = bucket(d, tabId)
        // History first: the fold reads the screen this frame replaces.
        tab.history = extendHistory(tab.history, screen)
        tab.screen = screen
        tab.failure = undefined
      },
      /**
       * Record the shell's process status.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param status - the status the host reported.
       */
      status: (d, tabId, status) => {
        bucket(d, tabId).status = status
      },
      /**
       * Record why the pane cannot draw a terminal.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param failure - the refusal to show.
       */
      failed: (d, tabId, failure) => {
        const tab = bucket(d, tabId)
        tab.failure = failure
      },
      /**
       * Record whether the stream is being re-established.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param active - true while a reconnect is in flight.
       */
      reconnecting: (d, tabId, active) => {
        bucket(d, tabId).reconnecting = active
      },
      /**
       * Record the confinement this pane wants for its next terminal.
       * @param d - draft state.
       * @param tabId - the tab being drawn.
       * @param choice - the requested mode.
       */
      mode: (d, tabId, choice) => {
        bucket(d, tabId).mode = choice
      },
      /**
       * Forget one tab, for a record that is gone.
       * @param d - draft state.
       * @param tabId - the tab that went away.
       */
      forget: (d, tabId) => {
        d.byTab = Object.fromEntries(Object.entries(d.byTab).filter(([id]) => id !== tabId))
      },
    },
  })
}
