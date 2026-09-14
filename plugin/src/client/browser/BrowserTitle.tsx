/**
 * The browser tab's live title: its chip names the page the pane is showing, the
 * way a browser tab does — the site's own favicon where the site serves it, and a
 * monogram of the host otherwise.
 *
 * The favicon is asked for with `crossorigin="anonymous"` and no referrer, which
 * is the whole point: naming a page must not hand the site a cookie or leak where
 * the reader came from. A host that does not serve it over CORS simply falls back
 * to the monogram, so the chip is never empty.
 *
 * The title seat is the same dispatch as the body — same key, same information
 * hook — so this component reads the pane's own store and nothing else.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createBrowserStore } from './store.ts'
import { FAVICON_ORIGIN_PARAM, FAVICON_ROUTE } from '../../shared.ts'
import type {} from '../locales.ts'
import css from './BrowserTitle.module.css'

/** The title's composed props: the tab it names, its store, and its copy. */
export type BrowserTitleProps =
  & PropsRuntime<'sidebar.right.pane.tab.title'>
  & PropsStore<ReturnType<typeof createBrowserStore>>
  & PropsLocale<'sidebarTools'>

/**
 * The host a framed address belongs to, which is what the chip names.
 * @param url - the framed address.
 * @returns the host, or undefined when there is no usable address.
 */
function hostOf(url: string): string | undefined {
  if (url === '') return undefined
  try {
    return new URL(url).host
  } catch {
    // The pane only stores addresses it accepted; an unparsable one simply
    // leaves the chip with its type name.
    return undefined
  }
}

/**
 * The logo this host fetched for the framed site.
 *
 * Not the site's own address: a browser `<img>` to the site would carry that
 * site's cookies, and an anonymous one needs CORS the site does not grant. The
 * host's route carries neither problem, and answers 404 when the site has no
 * logo — the chip then keeps its monogram.
 * @param url - the framed address.
 * @returns the logo address on this interface's own origin.
 */
function faviconOf(url: string): string {
  const origin = new URL(url).origin
  return `${FAVICON_ROUTE}?${FAVICON_ORIGIN_PARAM}=${encodeURIComponent(origin)}`
}

/** The browser tab's chip: the site's own logo, and the host it belongs to. */
export function BrowserTitle({ useTabInfo, useStore, t }: BrowserTitleProps): ReactNode {
  const { tab } = useTabInfo()
  const state = useStore(store => store.byTab[tab.id])
  const [logoFailed, setLogoFailed] = useState(false)
  const host = state === undefined ? undefined : hostOf(state.url)
  if (state === undefined || host === undefined) return t('browser.title')
  return (
    <span className={css.chip} title={state.url}>
      {!logoFailed && (
        <img
          className={css.logo}
          src={faviconOf(state.url)}
          alt=""
          referrerPolicy="no-referrer"
          // No logo is better than an invented one: a site this host could not
          // vouch for shows its name alone.
          onError={() => { setLogoFailed(true) }}
        />
      )}
      <span className={css.label}>{host}</span>
    </span>
  )
}
