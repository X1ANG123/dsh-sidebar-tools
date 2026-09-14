/**
 * The terminal pane's body: a sandboxed shell, drawn from the frames the host
 * sends, driven by keystrokes the pane forwards.
 *
 * The pane owns no terminal emulation: the host emulates, serializes the visible
 * screen, and streams it here. What this component decides is only what a
 * keystroke means, when to open a terminal, and how to say what went wrong.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import {
  ConnectionIndicator,
  PaneBody,
  PaneHeader,
  PaneIconButton,
  PaneStatus,
  PaneStatusLine,
  Pill,
  StateDot,
  terminalCellStyle,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ATTR_BOLD, ATTR_DIM, ATTR_HIDDEN, ATTR_ITALIC, ATTR_STRIKETHROUGH, ATTR_UNDERLINE,
  MAX_COLS, MAX_ROWS, MIN_COLS, MIN_ROWS, TERMINAL_MODE_CHOICES,
  type TerminalModeChoice,
  type TerminalRun,
  type TerminalSandboxInfo,
  type TerminalScreenFrame,
} from '../../shared.ts'
import type { TerminalFaceHandlers } from './face.ts'
import { paneAvailableHeight, usePaneFill } from '../fill-height.ts'
import { keyToBytes } from './keys.ts'
import type { TerminalFailureView, createTerminalStore } from './store.ts'
import type { TerminalHistoryLine } from './history.ts'
import type {} from '../locales.ts'
import css from './TerminalBody.module.css'

/** The pane's injected callbacks, all bound to this plugin's transport. */
export interface TerminalInjected {
  /** Open a terminal for a tab and attach its stream. */
  readonly openTerminal: (
    tabId: string,
    sessionId: string,
    cols: number,
    rows: number,
    handlers: TerminalFaceHandlers,
    mode?: TerminalModeChoice,
  ) => void
  /** Write bytes into a terminal; rejects when the host refuses them. */
  readonly sendInput: (tabId: string, terminalId: string, data: string) => Promise<void>
  /** Deliver a signal to a terminal's foreground group. */
  readonly signalTerminal: (terminalId: string, signal: 'SIGINT' | 'SIGTERM') => void
  /** Close a terminal and drop its stream. */
  readonly closeTerminal: (tabId: string, terminalId: string) => void
}

/** The body's composed props: the tab it draws, its store, its face, its copy. */
export type TerminalBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createTerminalStore>>
  & TerminalInjected
  & PropsLocale<'sidebarTools'>

/** Fallback grid, used until the container has been measured. */
const FALLBACK_COLS = 100
/** Fallback rows, used until the container has been measured. */
const FALLBACK_ROWS = 30

/**
 * One run's inline style, decoded from the wire's attribute bits.
 * @param run - the run as the host sent it.
 * @returns the style, or undefined when the run is plain.
 */
function runStyle(run: TerminalRun): ReturnType<typeof terminalCellStyle> {
  const attrs = run.a ?? 0
  return terminalCellStyle({
    ...(run.fg === undefined ? {} : { fg: run.fg }),
    ...(run.bg === undefined ? {} : { bg: run.bg }),
    ...(run.fgRgb === undefined ? {} : { fgRgb: run.fgRgb }),
    ...(run.bgRgb === undefined ? {} : { bgRgb: run.bgRgb }),
    bold: (attrs & ATTR_BOLD) !== 0,
    dim: (attrs & ATTR_DIM) !== 0,
    italic: (attrs & ATTR_ITALIC) !== 0,
    underline: (attrs & ATTR_UNDERLINE) !== 0,
    strikethrough: (attrs & ATTR_STRIKETHROUGH) !== 0,
    hidden: (attrs & ATTR_HIDDEN) !== 0,
  })
}

/**
 * Render one row: styled runs when the host sent them, plain text otherwise.
 * @param screen - the frame being drawn.
 * @param index - the row index.
 * @returns the row's content.
 */
function rowContent(screen: TerminalScreenFrame, index: number): ReactNode {
  const runs = screen.runs?.[index]
  if (runs === undefined) return screen.rows[index] ?? ''
  return runs.map((run, at) => (
    // Runs are text segments in string order; the index is their only key.
    <span key={at} style={runStyle(run)}>{run.text}</span>
  ))
}

/**
 * Render one retained line, which carries its own runs.
 * @param line - the retained line.
 * @returns the row's content.
 */
function historyContent(line: TerminalHistoryLine): ReactNode {
  if (line.runs === undefined) return line.text
  return line.runs.map((run, at) => (
    <span key={at} style={runStyle(run)}>{run.text}</span>
  ))
}

/**
 * Say what the pane's confinement is, in the pane's own words.
 * @param sandbox - the facts the host reported.
 * @param t - namespace-bound translate.
 * @returns the badge text.
 */
function sandboxLabel(sandbox: TerminalSandboxInfo, t: TerminalBodyProps['t']): string {
  if (sandbox.mode === 'danger-full-access') return t('terminal.sandboxNone')
  return sandbox.enforcement === 'full'
    ? t('terminal.sandboxFull', { mode: sandbox.mode })
    : t('terminal.sandboxPartial', { mode: sandbox.mode })
}

/**
 * Say why a terminal could not be opened or has gone away.
 * @param failure - the stored failure.
 * @param t - namespace-bound translate.
 * @returns the line to show.
 */
function failureLine(failure: TerminalFailureView, t: TerminalBodyProps['t']): string {
  switch (failure.code) {
    // A transport failure carries no host text worth showing: the pane says
    // what it knows in its own words.
    case 'transport': return t('error.unreadableAnswer')
    case 'input': return t('error.inputRejected')
    case 'session-not-live': return t('error.sessionNotLive')
    case 'limit-reached': return t('error.limitReached')
    case 'rate-limited': return t('error.rateLimited')
    case 'shell-unavailable': return t('error.shellUnavailable')
    case 'sandbox-unavailable': return t('error.sandboxUnavailable')
    case 'unknown-terminal': return t('error.unknownTerminal')
    case 'forbidden': return t('error.forbidden')
    case 'bad-request': return t('error.badRequest')
    default: return t('error.unavailable', { message: failure.message })
  }
}

/**
 * The next choice in the picker's cycle. The deployment default comes first, so
 * a first click narrows rather than widens.
 * @param current - the choice in force.
 * @returns the choice one step on.
 */
function nextModeChoice(current: TerminalModeChoice | undefined): TerminalModeChoice {
  const at = current === undefined ? -1 : TERMINAL_MODE_CHOICES.indexOf(current)
  return TERMINAL_MODE_CHOICES[(at + 1) % TERMINAL_MODE_CHOICES.length] ?? 'session'
}

/**
 * Name one mode choice.
 * @param choice - the choice, or undefined for the deployment's default.
 * @param t - namespace-bound translate.
 * @returns the label a picker shows.
 */
function modeChoiceLabel(choice: TerminalModeChoice | undefined, t: TerminalBodyProps['t']): string {
  switch (choice) {
    case 'read-only': return t('terminal.modeReadOnly')
    case 'workspace-write': return t('terminal.modeWorkspaceWrite')
    case 'session': return t('terminal.modeSession')
    default: return t('terminal.modeDefault')
  }
}

/** The terminal pane's body. */
export function TerminalBody({
  useTabInfo, sessionId, useSessions, useStore, actions, openTerminal, sendInput, signalTerminal, closeTerminal, t,
}: TerminalBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal, actions: tabActions } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTab[tab.id])
  const gridRef = useRef<HTMLDivElement | null>(null)
  const sinkRef = useRef<HTMLTextAreaElement | null>(null)
  const [size, setSize] = useState<{ cols: number; rows: number } | undefined>(undefined)
  const fill = usePaneFill(gridRef, true, Math.round(window.innerHeight * 0.6))

  // Measure the character grid once, before the first open: the host fixes the
  // session's dimensions at spawn, and a shell that is told the wrong size
  // wraps everything it prints.
  useLayoutEffect(() => {
    const element = gridRef.current
    if (element === null || size !== undefined) return
    const probe = document.createElement('span')
    probe.textContent = 'M'.repeat(10)
    const style = window.getComputedStyle(element)
    element.appendChild(probe)
    const charWidth = probe.getBoundingClientRect().width / 10
    const lineHeight = Number.parseFloat(style.lineHeight) || 19
    element.removeChild(probe)
    const rect = element.getBoundingClientRect()
    // The pane does not always hand its body a definite height, so measure the
    // room between the grid and the pane's bottom instead of trusting this
    // element's own box, and fall back to a share of the viewport while the
    // panel is still settling. A shell told it has the five-row minimum would
    // print into a sliver.
    const fallbackHeight = window.innerHeight * 0.6
    const usableHeight = paneAvailableHeight(element, fallbackHeight)
    const cols = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor((Math.max(rect.width, 320) - 20) / Math.max(1, charWidth))))
    const rows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.floor(usableHeight / lineHeight)))
    setSize({ cols, rows })
  }, [size])

  const open = useCallback((choice?: TerminalModeChoice): void => {
    if (signal.aborted) return
    const cols = size?.cols ?? FALLBACK_COLS
    const rows = size?.rows ?? FALLBACK_ROWS
    openTerminal(tab.id, sessionId, cols, rows, {
      opened: (terminalId, sandbox) => { actions.opened(tab.id, terminalId, sandbox) },
      frame: (frame) => { actions.frame(tab.id, frame) },
      status: (frame) => { actions.status(tab.id, frame.status) },
      failed: (code, message) => { actions.failed(tab.id, { code, message }) },
      reconnecting: (active) => { actions.reconnecting(tab.id, active) },
    }, choice)
  }, [actions, openTerminal, sessionId, signal, size, tab.id])

  /**
   * Replace this pane's terminal, keeping the confinement the reader chose: a
   * mode change is a new shell, because the old one was confined at spawn.
   * @param choice - the confinement to open the next terminal under.
   */
  const restart = useCallback((choice?: TerminalModeChoice): void => {
    const current = state?.terminalId
    if (current !== undefined) closeTerminal(tab.id, current)
    actions.start(tab.id)
    if (choice !== undefined) actions.mode(tab.id, choice)
    open(choice)
  }, [actions, closeTerminal, open, state?.terminalId, tab.id])

  useEffect(() => {
    if (state !== undefined || cwd === undefined || size === undefined || signal.aborted) return
    actions.start(tab.id)
    open()
  }, [actions, cwd, open, signal, size, state, tab.id])

  // The record's abort signal is the pane's lifetime: a terminal must not
  // outlive the tab that owns it.
  useEffect(() => {
    const stop = (): void => {
      const terminalId = state?.terminalId
      if (terminalId !== undefined) closeTerminal(tab.id, terminalId)
      actions.forget(tab.id)
    }
    signal.addEventListener('abort', stop, { once: true })
    return () => { signal.removeEventListener('abort', stop) }
  }, [actions, closeTerminal, signal, state?.terminalId, tab.id])

  // The pane owns the keyboard, and the sink is where keystrokes land: a live
  // terminal takes focus as soon as it is the visible tab, so typing works
  // without the reader first having to discover that the screen is clickable.
  useEffect(() => {
    if (state?.terminalId === undefined || !tab.visible) return
    const sink = sinkRef.current
    if (sink === null) return
    // The panel may still be placing focus as this commits, so assert it on the
    // next frame as well: a pane that only accepts keys after a click reads as a
    // broken shell.
    const focus = (): void => { sink.focus({ preventScroll: true }) }
    focus()
    const frame = window.requestAnimationFrame(() => {
      if (document.activeElement !== sink) focus()
    })
    return () => { window.cancelAnimationFrame(frame) }
  }, [state?.terminalId, tab.visible])

  /**
   * Turn a refused keystroke into the pane's own line, so a rejected input
   * never looks like a dead shell.
   * @param error - what the transport threw; its message carries the code.
   */
  const noteInputFailure = useCallback((error: unknown): void => {
    const throttled = error instanceof Error && error.message === 'rate-limited'
    actions.failed(tab.id, { code: throttled ? 'rate-limited' : 'input', message: '' })
  }, [actions, tab.id])

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    const terminalId = state?.terminalId
    if (terminalId === undefined) return
    // A reader with terminal text selected means Control+C copies; with nothing
    // selected it stays the interrupt a terminal has always sent.
    const selection = window.getSelection()
    if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'c'
      && selection !== null && !selection.isCollapsed
      && gridRef.current?.contains(selection.anchorNode ?? null) === true) return
    const bytes = keyToBytes(event)
    if (bytes === undefined) return
    event.preventDefault()
    void sendInput(tab.id, terminalId, bytes).catch(noteInputFailure)
  }

  const screen = state?.screen
  const history = state?.history.lines ?? []
  const [copied, setCopied] = useState(false)

  /**
   * Put the whole retained output — history and the live screen — on the
   * clipboard, so an error a reader can see is an error they can paste.
   */
  const copyOutput = useCallback((): void => {
    const text = [...history.map(line => line.text), ...(screen?.rows ?? [])].join('\n').trimEnd()
    if (text === '') return
    void writeClipboard(text).then((ok) => { if (ok) setCopied(true) })
  }, [history, screen])

  // The label reports the copy for a moment, then goes back to offering one.
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => { setCopied(false) }, 1500)
    return () => { window.clearTimeout(timer) }
  }, [copied])
  // New output follows the bottom unless the reader scrolled up; a reader who
  // did keeps their place while the shell keeps writing above them.
  const followingRef = useRef(true)
  useEffect(() => {
    const grid = gridRef.current
    if (grid === null || !followingRef.current) return
    grid.scrollTop = grid.scrollHeight
  }, [history.length, screen])

  /** Keep the follow flag honest for whichever box scrolls. */
  const noteScroll = useCallback((event: React.UIEvent<HTMLElement>): void => {
    const box = event.currentTarget
    followingRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 8
  }, [])

  /** A click returns the keyboard to the sink; a drag belongs to the selection. */
  const refocusUnlessSelected = useCallback((): void => {
    const selection = window.getSelection()
    if (selection === null || selection.isCollapsed) sinkRef.current?.focus({ preventScroll: true })
  }, [])
  return (
    <PaneBody
      className={css.pane}
      scroll="none"
      data-terminal-state={state?.failure !== undefined ? 'failed' : state?.terminalId === undefined ? 'starting' : 'live'}
      // A click returns the keyboard to the sink, but a drag is a selection: the
      // default action stays put so terminal text can be selected and copied,
      // and the sink takes focus back only when nothing is selected.
      onMouseUp={refocusUnlessSelected}
    >
      <PaneHeader>
        <StateDot state={state?.status?.kind === 'exited' ? 'idle' : 'ongoing'} />
        <span>{t('terminal.title')}</span>
        {state?.sandbox !== undefined && (
          <Pill
            className={css.badge}
            onClick={() => { restart(nextModeChoice(state.mode)) }}
            // What stays on screen is the confinement the host actually
            // enforced; the tooltip names the choice this pane asked for and
            // what a click does to it, so neither fact hides the other.
            title={t('terminal.modeCycle', { mode: modeChoiceLabel(state.mode, t) })}
            aria-label={t('terminal.modeCycle', { mode: modeChoiceLabel(state.mode, t) })}
          >
            {sandboxLabel(state.sandbox, t)}
          </Pill>
        )}
        {screen !== undefined && (
          <PaneIconButton
            label={copied ? t('terminal.copied') : t('terminal.copy')}
            className={css.pushEnd}
            onClick={() => { copyOutput() }}
          >
            <span aria-hidden="true">⧉</span>
          </PaneIconButton>
        )}
        {state?.terminalId !== undefined && state.status?.kind !== 'exited' && (
          <PaneIconButton
            label={t('terminal.interrupt')}
            onClick={() => { signalTerminal(state.terminalId ?? '', 'SIGINT') }}
          >
            <span aria-hidden="true">■</span>
          </PaneIconButton>
        )}
      </PaneHeader>
      {state?.failure !== undefined && (
        <PaneStatus data-terminal-failure={state.failure.code}>
          <PaneStatusLine>{failureLine(state.failure, t)}</PaneStatusLine>
          <PaneStatusLine>
            <PaneIconButton
              label={t('terminal.restart')}
              onClick={() => { restart(state?.mode) }}
            >
              <span aria-hidden="true">↻</span>
            </PaneIconButton>
          </PaneStatusLine>
        </PaneStatus>
      )}
      {state?.failure === undefined && screen === undefined && (
        <PaneStatus><PaneStatusLine>{t('terminal.starting')}</PaneStatusLine></PaneStatus>
      )}
      <div
        className={css.grid}
        ref={gridRef}
        role="log"
        aria-live="off"
        aria-label={t('terminal.region')}
        style={{
          // The screen the host sent decides the floor, and the pane's own
          // measurement decides the fill, so a whole screen is always visible.
          ...(screen === undefined ? {} : { '--term-rows': String(screen.rows.length) }),
          ...(fill === undefined ? {} : { height: `${String(fill)}px` }),
        } as React.CSSProperties}
        onScroll={noteScroll}
      >
        <textarea
          className={css.input}
          ref={sinkRef}
          aria-label={t('terminal.input')}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value=""
          onChange={() => { /* the sink only ever forwards keystrokes */ }}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const terminalId = state?.terminalId
            if (terminalId === undefined) return
            const text = event.clipboardData.getData('text')
            if (text === '') return
            event.preventDefault()
            void sendInput(tab.id, terminalId, text).catch(noteInputFailure)
          }}
        />
        {screen !== undefined && (
          <pre className={css.screen} data-terminal-screen data-terminal-alt={screen.alt ? '' : undefined}>
            {/* Retained lines come first, so the pane scrolls back through them. */}
            {history.map((line, index) => (
              <div className={css.row} data-terminal-history="" key={`h${String(index)}`}>
                {historyContent(line) === '' ? ' ' : historyContent(line)}
              </div>
            ))}
            {screen.rows.map((_text, index) => (
              // Rows are positional: the frame replaces the whole screen.
              <div className={css.row} key={index}>{rowContent(screen, index) === '' ? ' ' : rowContent(screen, index)}</div>
            ))}
            {screen.cursor.visible && (
              <span
                className={css.cursor}
                aria-hidden="true"
                style={{
                  '--cursor-x': String(screen.cursor.x),
                  // The cursor sits one screen below the retained lines.
                  '--cursor-y': String(history.length + screen.cursor.y),
                } as React.CSSProperties}
              />
            )}
          </pre>
        )}
      </div>
      {state?.reconnecting === true && (
        <div className={css.hint}>
          <ConnectionIndicator
            state="connecting"
            disconnectedLabel={t('terminal.reconnecting')}
            reconnectLabel={t('terminal.restart')}
            connectingLabel={t('terminal.reconnecting')}
            recoveredLabel=""
            reconnectActionLabel={t('terminal.restart')}
            restartActionLabel={t('terminal.restart')}
            onReconnect={() => { open() }}
          />
        </div>
      )}
      {state?.status?.kind === 'exited' && state.failure === undefined && (
        <PaneStatus data-terminal-exited="">
          <PaneStatusLine>
            {state.status.signal === null
              ? t('terminal.exited', { code: String(state.status.exitCode ?? '?') })
              : t('terminal.exitedSignal', { signal: state.status.signal })}
          </PaneStatusLine>
          <PaneStatusLine>
            <PaneIconButton
              label={t('terminal.restart')}
              onClick={() => { restart(state?.mode) }}
            >
              <span aria-hidden="true">↻</span>
            </PaneIconButton>
          </PaneStatusLine>
        </PaneStatus>
      )}
      {tabActions === undefined && null}
    </PaneBody>
  )
}
