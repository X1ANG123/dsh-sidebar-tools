/**
 * The terminal pane's transport: one token, one stream per tab, and the calls
 * that drive a shell.
 *
 * Every mutating call carries the per-page CSRF token in a header; the stream is
 * a same-origin EventSource, whose capability is the terminal's own 128-bit id.
 * Handles live here rather than in the store, because a store is read by the
 * renderer and stays plain data.
 *
 * @module @deepseek-ai/dsh-client-ui-sidebar-tools/client/terminal/face
 */

import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import {
  CLOSE_ROUTE,
  CSRF_HEADER,
  INPUT_ROUTE,
  OPEN_ROUTE,
  SIGNAL_ROUTE,
  STREAM_ROUTE,
  TOKEN_ROUTE,
  type TerminalErrorCode,
  type TerminalFrame,
  type TerminalModeChoice,
  type TerminalSandboxInfo,
  type TerminalSignalName,
} from '../../shared.ts'

/** What the pane learns from the transport. */
export interface TerminalFaceHandlers {
  /** The host published a terminal; its id and confinement facts. */
  readonly opened: (terminalId: string, sandbox: TerminalSandboxInfo) => void
  /** One screen frame arrived. */
  readonly frame: (frame: TerminalFrame & { kind: 'screen' }) => void
  /** The shell's status changed. */
  readonly status: (frame: TerminalFrame & { kind: 'status' }) => void
  /** The transport or the host refused. */
  readonly failed: (code: TerminalErrorCode | 'transport', message: string) => void
  /** Whether a stream reconnect is in flight. */
  readonly reconnecting: (active: boolean) => void
}

/** One tab's live stream. */
interface Stream {
  readonly source: EventSource
  readonly handlers: TerminalFaceHandlers
  readonly terminalId: string
  retries: number
  timer: number | undefined
}

/** Longest a reconnect waits between attempts. */
const MAX_RETRY_DELAY_MS = 8000

/** One refusal body, as both halves spell it. */
interface FailureBody {
  readonly code?: unknown
  readonly message?: unknown
}

/**
 * Read a JSON failure body defensively. The message is the host's own wire text
 * and is never shown verbatim: the pane localizes the code instead.
 * @param body - the parsed body, of unknown shape.
 * @returns the code and the host's message, with fallbacks that never throw.
 */
function failureOf(body: unknown): { code: TerminalErrorCode | 'transport'; message: string } {
  const failure = (body ?? {}) as FailureBody
  const code = typeof failure.code === 'string' ? failure.code as TerminalErrorCode : 'transport'
  const message = typeof failure.message === 'string' ? failure.message : ''
  return { code, message }
}

/** The terminal pane's transport, held in the plugin's apply closure. */
export class TerminalFace {
  private readonly streams = new Map<TabId, Stream>()
  private token: string | undefined
  private tokenExpiresAt = 0

  /**
   * Fetch (or reuse) the per-page CSRF token.
   * @returns the token, or undefined when the host refused.
   */
  private async csrf(): Promise<string | undefined> {
    if (this.token !== undefined && Date.now() < this.tokenExpiresAt) return this.token
    try {
      const response = await fetch(TOKEN_ROUTE, { credentials: 'same-origin' })
      if (!response.ok) return undefined
      const body = await response.json() as { token?: unknown }
      if (typeof body.token !== 'string') return undefined
      this.token = body.token
      // Refresh well before the host's own expiry; a stale token is a 403.
      this.tokenExpiresAt = Date.now() + 30 * 60 * 1000
      return this.token
    } catch {
      return undefined
    }
  }

  /**
   * Send one authenticated JSON call.
   * @param route - the route to post to.
   * @param payload - the JSON body.
   * @returns the response, or the refusal to report.
   */
  private async post(route: string, payload: Record<string, unknown>): Promise<Response | { code: 'transport'; message: string }> {
    const token = await this.csrf()
    if (token === undefined) return { code: 'transport', message: '' }
    try {
      return await fetch(route, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: token },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      return { code: 'transport', message: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Open a terminal for a tab and attach its stream.
   * @param tabId - the tab this terminal belongs to.
   * @param sessionId - the Session the pane belongs to.
   * @param cols - measured grid width.
   * @param rows - measured grid height.
   * @param handlers - what the pane wants to hear about.
   * @param mode - the confinement the pane asks for; omitted uses the deployment's own.
   */
  async open(
    tabId: TabId,
    sessionId: string,
    cols: number,
    rows: number,
    handlers: TerminalFaceHandlers,
    mode?: TerminalModeChoice,
  ): Promise<void> {
    const response = await this.post(OPEN_ROUTE, { sessionId, cols, rows, ...(mode === undefined ? {} : { mode }) })
    if (!(response instanceof Response)) {
      handlers.failed(response.code, response.message)
      return
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      handlers.failed('transport', '')
      return
    }
    const opened = body as { ok?: unknown; terminalId?: unknown; sandbox?: unknown; code?: unknown; message?: unknown }
    if (opened.ok !== true || typeof opened.terminalId !== 'string') {
      const failure = failureOf(body)
      handlers.failed(failure.code === 'transport' ? 'transport' : failure.code, failure.message)
      return
    }
    const sandbox = opened.sandbox as TerminalSandboxInfo
    handlers.opened(opened.terminalId, sandbox)
    this.attach(tabId, opened.terminalId, handlers)
  }

  /**
   * Attach (or re-attach) the frame stream for one tab.
   * @param tabId - the tab this stream belongs to.
   * @param terminalId - the terminal to read.
   * @param handlers - what the pane wants to hear about.
   */
  private attach(tabId: TabId, terminalId: string, handlers: TerminalFaceHandlers): void {
    this.detach(tabId)
    const source = new EventSource(`${STREAM_ROUTE}?terminalId=${encodeURIComponent(terminalId)}`)
    const stream: Stream = { source, handlers, terminalId, retries: 0, timer: undefined }
    this.streams.set(tabId, stream)
    source.onmessage = (event: MessageEvent<string>) => {
      stream.retries = 0
      handlers.reconnecting(false)
      let frame: TerminalFrame
      try {
        frame = JSON.parse(event.data) as TerminalFrame
      } catch {
        // A frame the pane cannot read is dropped; the next one replaces it.
        return
      }
      if (frame.kind === 'screen') handlers.frame(frame)
      else if (frame.kind === 'status') handlers.status(frame)
      else handlers.failed('transport', frame.message)
    }
    source.onerror = () => {
      // EventSource retries by itself, but a host restart needs a fresh stream.
      handlers.reconnecting(true)
      this.scheduleReconnect(tabId, stream)
    }
  }

  /**
   * Re-establish one tab's stream with capped backoff.
   * @param tabId - the tab whose stream broke.
   * @param stream - the broken stream.
   */
  private scheduleReconnect(tabId: TabId, stream: Stream): void {
    if (stream.timer !== undefined || this.streams.get(tabId) !== stream) return
    const delay = Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** stream.retries)
    stream.retries += 1
    stream.timer = window.setTimeout(() => {
      stream.timer = undefined
      stream.source.close()
      this.attach(tabId, stream.terminalId, stream.handlers)
    }, delay)
  }

  /**
   * Drop one tab's stream without closing its terminal.
   * @param tabId - the tab whose stream ends.
   */
  detach(tabId: TabId): void {
    const stream = this.streams.get(tabId)
    if (stream === undefined) return
    this.streams.delete(tabId)
    if (stream.timer !== undefined) window.clearTimeout(stream.timer)
    stream.source.close()
  }

  /**
   * Write bytes into one terminal.
   *
   * A stale page token is the one failure worth retrying on the spot — the host
   * rotates tokens, and a pane that silently swallowed keystrokes would look
   * like a broken shell. Every other refusal comes back to the caller.
   * @param terminalId - the host terminal id.
   * @param data - the bytes, as text.
   * @returns the refusal, or undefined once the bytes were accepted.
   */
  async send(terminalId: string, data: string): Promise<{ readonly code: TerminalErrorCode | 'transport'; readonly message: string } | undefined> {
    if (data === '') return undefined
    const response = await this.post(INPUT_ROUTE, { terminalId, data })
    if (!(response instanceof Response)) return { code: 'transport', message: response.message }
    if (response.ok) return undefined
    if (response.status === 403) {
      this.token = undefined
      this.tokenExpiresAt = 0
      const retry = await this.post(INPUT_ROUTE, { terminalId, data })
      if (retry instanceof Response && retry.ok) return undefined
    }
    return { code: response.status === 429 ? 'rate-limited' : 'bad-request', message: '' }
  }

  /**
   * Deliver one signal to one tab's foreground group.
   * @param terminalId - the host terminal id.
   * @param signal - the signal to deliver.
   */
  async signal(terminalId: string, signal: TerminalSignalName): Promise<void> {
    await this.post(SIGNAL_ROUTE, { terminalId, signal })
  }

  /**
   * Close one tab's terminal and drop its stream.
   * @param tabId - the tab to close.
   * @param terminalId - the host terminal id.
   */
  async close(tabId: TabId, terminalId: string): Promise<void> {
    this.detach(tabId)
    await this.post(CLOSE_ROUTE, { terminalId })
  }
}
