/**
 * The browser pane's body: one embedded page beside the conversation.
 *
 * The frame keeps the embedded site's own origin, and that is what makes a real
 * page work: without it every site is an opaque-origin document whose storage
 * access throws and whose requests carry `Origin: null`, so APIs, routing, and
 * logins all fail and the pane draws a static shell. The other half of the pair
 * is what keeps that safe — this interface refuses to be framed at all, so a
 * framed page cannot navigate here and inherit the app's own APIs. The pane
 * also refuses to frame this interface's own origin, never proxies, injects, or
 * bridges a page, and grants no sandbox escape. Where the engine supports it the
 * frame also loads credential-less, so the site receives none of this browser's
 * cookies and keeps no storage of its own.
 */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import {
  Button,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconGlobeOutline14,
  IconLinkOutline16,
  IconRefreshOutline16,
  Input,
  PaneBody,
  PaneHeader,
  PaneIconButton,
  PaneStatus,
  PaneStatusLine,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { AddressProblem } from './url.ts'
import { resolveAddress } from './url.ts'
import { usePaneFill } from '../fill-height.ts'
import type { createBrowserStore } from './store.ts'
import type {} from '../locales.ts'
import css from './BrowserBody.module.css'

/** The body's composed props: the tab it draws, its store, and its copy. */
export type BrowserBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createBrowserStore>>
  & PropsLocale<'sidebarTools'>

/**
 * The frame's sandbox: exactly the capability set a real page needs — forms,
 * scripts, the site's own origin (storage, same-origin API calls, cookie-backed
 * sessions), and popups, so a `target="_blank"` link opens the way the page
 * intends instead of being swallowed. An opened popup inherits this sandbox, so
 * it is never a way out of it. Top-level navigation, modals, downloads, and
 * every sandbox escape stay out. The origin half of this pair is only sound
 * because this interface refuses to be framed.
 */
const FRAME_SANDBOX = 'allow-forms allow-scripts allow-same-origin allow-popups'

/**
 * The frame's sandbox when the engine cannot load it credential-less: an opaque
 * origin, the pane's original posture. The site then keeps no storage and
 * receives no cookie, at the cost of the behavior that needs either.
 */
const FRAME_SANDBOX_STRICT = 'allow-forms allow-scripts'

/**
 * The attribute that keeps this browser's cookies out of the frame: requests go
 * out with no credentials and the site's storage is a partition that dies with
 * the document. A boolean attribute, so its value is the empty string.
 */
const FRAME_ISOLATION: Record<string, string> = { credentialless: '' }

/**
 * Whether this engine can load a frame credential-less. A browser without it
 * gets {@link FRAME_SANDBOX_STRICT} instead, because handing a framed site the
 * reader's cookies is not a trade this pane makes.
 * @returns true when the frame can be isolated.
 */
function credentiallessSupported(): boolean {
  return typeof HTMLIFrameElement !== 'undefined' && 'credentialless' in HTMLIFrameElement.prototype
}

/** Permissions the frame may never use, whatever the page asks for. */
const FRAME_ALLOW = [
  "camera 'none'",
  "microphone 'none'",
  "geolocation 'none'",
  "clipboard-read 'none'",
  "clipboard-write 'none'",
  "usb 'none'",
  "serial 'none'",
].join('; ')

/** How long a silent frame waits before the pane suggests opening it outside. */
const EMBED_HINT_MS = 6000

/**
 * Say why an address was refused.
 * @param problem - the refusal.
 * @param t - namespace-bound translate.
 * @returns the line to show.
 */
function problemLine(problem: AddressProblem, t: BrowserBodyProps['t']): string {
  switch (problem) {
    case 'empty': return t('error.emptyAddress')
    case 'credentials': return t('error.credentialsAddress')
    case 'same-origin': return t('error.sameOriginAddress')
    case 'too-long': return t('error.longAddress')
    default: return t('error.unsupportedAddress')
  }
}

/** The browser pane's body. */
export function BrowserBody({ useTabInfo, useStore, actions, t }: BrowserBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal } = tab
  const state = useStore(store => store.byTab[tab.id])
  const loadedRef = useRef(false)
  const fillRef = useRef<HTMLDivElement | null>(null)
  const fill = usePaneFill(fillRef, state !== undefined && state.url !== '', Math.round(window.innerHeight * 0.55))

  useEffect(() => {
    if (state !== undefined || signal.aborted) return
    actions.start(tab.id)
  }, [actions, signal, state, tab.id])

  // A frame that never reports a load is usually a site refusing to be
  // embedded; X-Frame-Options leaves nothing readable to test, so the pane
  // says what it can and offers the way out.
  useEffect(() => {
    if (state === undefined || state.url === '') return
    loadedRef.current = false
    const timer = window.setTimeout(() => {
      if (!loadedRef.current) actions.hint(tab.id, true)
    }, EMBED_HINT_MS)
    return () => { window.clearTimeout(timer) }
  }, [actions, state?.url, state?.nonce, tab.id, state])

  if (state === undefined) return null

  const submit = (): void => {
    // This interface's own origin is never embeddable: a frame of the app
    // inside the app is the one document that could reach the app's own APIs.
    const result = resolveAddress(state.draft, window.location.origin)
    if (!result.ok) {
      actions.refused(tab.id, result.problem)
      return
    }
    actions.visited(tab.id, result.url)
  }

  const canGoBack = state.index > 0
  const canGoForward = state.index >= 0 && state.index < state.history.length - 1
  // Where the engine supports it the frame loads credential-less: no cookie
  // reaches the site, and its storage dies with the document.
  const isolated = credentiallessSupported()
  return (
    <PaneBody className={css.pane} scroll="none" data-browser-state={state.url === '' ? 'empty' : 'framed'}>
      <PaneHeader>
        <PaneIconButton
          label={t('browser.back')}
          disabled={!canGoBack}
          onClick={() => { actions.step(tab.id, -1) }}
        >
          <IconChevronLeftOutline14 />
        </PaneIconButton>
        <PaneIconButton
          label={t('browser.forward')}
          disabled={!canGoForward}
          onClick={() => { actions.step(tab.id, 1) }}
        >
          <IconChevronRightOutline14 />
        </PaneIconButton>
        <PaneIconButton
          label={t('browser.reload')}
          disabled={state.url === ''}
          onClick={() => { actions.reload(tab.id) }}
        >
          <IconRefreshOutline16 />
        </PaneIconButton>
        {/* The address bar shares the controls' row: where you are and where you
            are going are one gesture, and the pane spends no second row on its
            own chrome. */}
        <div className={css.address}>
          <Input
            value={state.draft}
            placeholder={t('browser.address')}
            aria-label={t('browser.address')}
            onChange={(event) => { actions.draft(tab.id, event.target.value) }}
            onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
          />
        </div>
        <Button variant="outline" size="sm" onClick={submit}>{t('browser.go')}</Button>
      </PaneHeader>
      {state.problem !== undefined && (
        <PaneStatus data-browser-problem={state.problem}>
          <PaneStatusLine>{problemLine(state.problem, t)}</PaneStatusLine>
        </PaneStatus>
      )}
      {state.url !== '' && !isolated && (
        <PaneStatus data-browser-privacy="strict">
          <PaneStatusLine>{t('browser.privacyStrict')}</PaneStatusLine>
        </PaneStatus>
      )}
      {state.url === '' && state.problem === undefined && (
        <PaneStatus data-browser-empty="">
          <PaneStatusLine><IconGlobeOutline14 /> {t('browser.guide.description')}</PaneStatusLine>
        </PaneStatus>
      )}
      {state.url !== '' && (
        <div
          className={css.fill}
          ref={fillRef}
          data-browser-frame-host
          style={fill === undefined ? undefined : { height: `${String(fill)}px` }}
        >
          <iframe
            className={css.frame}
            data-browser-frame
            key={`${state.url}#${String(state.nonce)}`}
            src={state.url}
            title={t('browser.region')}
            sandbox={isolated ? FRAME_SANDBOX : FRAME_SANDBOX_STRICT}
            {...(isolated ? FRAME_ISOLATION : {})}
            allow={FRAME_ALLOW}
            referrerPolicy="no-referrer"
            onLoad={() => {
              loadedRef.current = true
              actions.hint(tab.id, false)
            }}
          />
        </div>
      )}
      {state.hint && (
        <PaneStatus data-browser-hint="">
          <PaneStatusLine>{t('browser.embedHint')}</PaneStatusLine>
          <PaneStatusLine>
            <a className={css.link} href={state.url} target="_blank" rel="noopener noreferrer">
              <IconLinkOutline16 />
              {t('browser.openExternal')}
            </a>
          </PaneStatusLine>
        </PaneStatus>
      )}
    </PaneBody>
  )
}
