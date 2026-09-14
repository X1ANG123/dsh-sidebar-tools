/**
 * The two tab types this package owns: `terminal` and `browser`.
 *
 * A type is a static declaration — which kind it is, what it is called, and how
 * the guide page offers it — while its body registers separately under the same
 * `id` in `sidebar.right.pane.tab`.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { IconCodeOutline16, IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '../locales.ts'

/** This package's tab-type identity, and the terminal body's registration key. */
export const TERMINAL_ID = '@deepseek-ai/dsh-client-ui-sidebar-tools/terminal'
/** The terminal tab kind. */
export const TERMINAL_KIND = 'terminal'
/** The browser body's registration key. */
export const BROWSER_ID = '@deepseek-ai/dsh-client-ui-sidebar-tools/browser'
/** The browser tab kind. */
export const BROWSER_KIND = 'browser'

/**
 * The terminal type: a page opened by kind, offered on the guide after Files.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function terminalDefinition(t: TranslateNS<'sidebarTools'>): SidebarRightTabDefinition {
  return {
    id: TERMINAL_ID,
    kind: TERMINAL_KIND,
    priority: 'builtin',
    title: () => t('terminal.title'),
    // A shell is a session: opening another one is a new tab, never a focus on
    // the shell already running.
    opensNewTab: true,
    guide: [{
      order: 20,
      title: () => t('terminal.guide.title'),
      description: () => t('terminal.guide.description'),
      icon: IconCodeOutline16,
    }],
  }
}

/**
 * The browser type: a page opened by kind, offered on the guide after Terminal.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function browserDefinition(t: TranslateNS<'sidebarTools'>): SidebarRightTabDefinition {
  return {
    id: BROWSER_ID,
    kind: BROWSER_KIND,
    priority: 'builtin',
    title: () => t('browser.title'),
    // A page is a place: opening another one is a new tab, never a focus on the
    // page already showing.
    opensNewTab: true,
    guide: [{
      order: 21,
      title: () => t('browser.guide.title'),
      description: () => t('browser.guide.description'),
      icon: IconGlobeOutline14,
    }],
  }
}
