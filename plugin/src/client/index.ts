/**
 * Browser half of the sidebar tools plugin: the `terminal` and `browser` tab
 * types of the right Sidebar.
 *
 * Registration is the public two-stage path — each type into
 * `ctx.sidebarRightTabs`, its body into the keyed `sidebar.right.pane.tab` seat
 * under that type's `id`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { BrowserBody } from './browser/BrowserBody.tsx'
import { BrowserTitle } from './browser/BrowserTitle.tsx'
import { createBrowserStore } from './browser/store.ts'
import { en, zh } from './locales.ts'
import { TerminalFace } from './terminal/face.ts'
import { TerminalBody, type TerminalBodyProps } from './terminal/TerminalBody.tsx'
import { TerminalTitle } from './terminal/TerminalTitle.tsx'
import { BROWSER_ID, TERMINAL_ID, browserDefinition, terminalDefinition } from './terminal/definition.ts'
import { createTerminalStore } from './terminal/store.ts'

export type { TerminalBodyProps } from './terminal/TerminalBody.tsx'
export type { BrowserBodyProps } from './browser/BrowserBody.tsx'
export type { TerminalTabState, TerminalState } from './terminal/store.ts'
export type { BrowserTabState, BrowserState } from './browser/store.ts'

/** This package's copy namespace. */
const NS = 'sidebarTools'

/** Required browser services: the tab registry, the keyed seats, and copy. */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * Client plugin body: two tab types, their dictionaries, and their bodies.
 * @param ctx - client root context carrying the registry, the slots, and copy.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(terminalDefinition(t)), 'ui-sidebar-tools: terminal type')
  ctx.effect(() => ctx.sidebarRightTabs.register(browserDefinition(t)), 'ui-sidebar-tools: browser type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-tools: dictionaries')

  const face = new TerminalFace()
  const terminals = createTerminalStore()
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: TERMINAL_ID,
      locale: NS,
      store: terminals,
      inject: (): Pick<TerminalBodyProps, 'openTerminal' | 'sendInput' | 'signalTerminal' | 'closeTerminal'> => ({
        openTerminal: (tabId, sessionId, cols, rows, handlers, mode) => {
          void face.open(tabId as Parameters<typeof face.open>[0], sessionId, cols, rows, handlers, mode)
        },
        sendInput: async (_tabId, terminalId, data) => {
          const failure = await face.send(terminalId, data)
          // The pane turns this into its own localized line; the code travels as
          // the error message so no copy lives in the transport.
          if (failure !== undefined) throw new Error(failure.code)
        },
        signalTerminal: (terminalId, signal) => { void face.signal(terminalId, signal) },
        closeTerminal: (tabId, terminalId) => {
          void face.close(tabId as Parameters<typeof face.close>[0], terminalId)
        },
      }),
    },
    TerminalBody,
  )), 'ui-sidebar-tools: terminal tab body')

  // The chip follows the shell's own status, which the record captured at open
  // time cannot know.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: TERMINAL_ID, locale: NS, store: terminals },
    TerminalTitle,
  )), 'ui-sidebar-tools: terminal tab title')

  const browsers = createBrowserStore()
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: BROWSER_ID, locale: NS, store: browsers },
    BrowserBody,
  )), 'ui-sidebar-tools: browser tab body')

  // The chip names the page the pane is showing, which the record captured at
  // open time cannot know.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: BROWSER_ID, locale: NS, store: browsers },
    BrowserTitle,
  )), 'ui-sidebar-tools: browser tab title')
}
