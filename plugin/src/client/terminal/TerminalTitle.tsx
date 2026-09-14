/**
 * The terminal tab's live title: its chip says whether the shell is still
 * running, which the record captured at open time cannot know.
 *
 * The title seat is the same dispatch as the body — same key, same information
 * hook — so this component reads the pane's own store and nothing else.
 */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createTerminalStore } from './store.ts'
import type {} from '../locales.ts'

/** The title's composed props: the tab it names, its store, and its copy. */
export type TerminalTitleProps =
  & PropsRuntime<'sidebar.right.pane.tab.title'>
  & PropsStore<ReturnType<typeof createTerminalStore>>
  & PropsLocale<'sidebarTools'>

/** The terminal tab's chip text. */
export function TerminalTitle({ useTabInfo, useStore, t }: TerminalTitleProps): ReactNode {
  const { tab } = useTabInfo()
  const state = useStore(store => store.byTab[tab.id])
  if (state?.status?.kind === 'exited') return t('terminal.titleExited')
  return t('terminal.title')
}
