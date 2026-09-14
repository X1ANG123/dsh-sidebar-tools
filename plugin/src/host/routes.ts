/**
 * The terminal routes, each built from the same three gates: the composition's
 * browser-trust fence (Host, Origin, Fetch-Metadata), the loopback check that
 * keeps a host shell local, and — for every mutating call — a per-page CSRF
 * token. Bodies are bounded, parsed strictly, and neither a caller's bytes nor
 * its identifiers ever reach a command line or a response header.
 *
 * @module @deepseek-ai/dsh-client-ui-sidebar-tools/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { SubprocessTerminalSignal } from '@deepseek-ai/dsh-subprocess'
import type { Config } from '../config.ts'
import {
  CLOSE_ROUTE,
  CSRF_HEADER,
  FAVICON_ORIGIN_PARAM,
  FAVICON_ROUTE,
  INPUT_ROUTE,
  MAX_COLS,
  MAX_ID_LENGTH,
  MAX_INPUT_LENGTH,
  MAX_ROWS,
  MIN_COLS,
  MIN_ROWS,
  OPEN_ROUTE,
  SIGNAL_ROUTE,
  STREAM_ROUTE,
  TERMINAL_MODE_CHOICES,
  TOKEN_ROUTE,
  type TerminalFailure,
  type TerminalModeChoice,
} from '../shared.ts'
import {
  isJsonRequest,
  isLoopbackAddress,
  parseJsonObject,
  RateLimiter,
  readBoundedBody,
  readBoundedIntField,
  readStringField,
  sendJson,
  sendMethodNotAllowed,
  sendNoContent,
  TokenStore,
} from './security.ts'
import type { GuiTerminalService } from './terminals.ts'
import { FaviconCache, readFaviconOrigin } from './favicon.ts'

/** The trust surface consumed here; the connection package owns the full type. */
interface TrustFence {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** Everything the route handlers need. */
export interface RouteDeps {
  /** Composition context carrying the web carrier and the fence. */
  readonly ctx: Context
  /** Resolved plugin configuration. */
  readonly config: Config
  /** The terminal service the routes drive. */
  readonly terminals: GuiTerminalService
  /** Per-page CSRF tokens. */
  readonly tokens: TokenStore
  /** Open-request limiter, keyed by caller address. */
  readonly opens: RateLimiter
  /** The framed sites' logo cache the tab chip reads through. */
  readonly favicons: FaviconCache
}

/** Identifiers this plugin accepts: the Session id shape, and nothing else. */
const ID_PATTERN = /^[A-Za-z0-9._:-]+$/

/**
 * Answer an untrusted, unauthenticated, or non-loopback caller.
 * @param deps - route dependencies.
 * @param req - the incoming request.
 * @param res - the response to refuse on.
 * @returns true when the request was refused and nothing else may be written.
 */
function refuse(deps: RouteDeps, req: IncomingMessage, res: ServerResponse): boolean {
  const rejection = (Reflect.get(deps.ctx, 'connection') as TrustFence | undefined)?.requestRejection(req)
  if (rejection !== undefined) {
    res.statusCode = rejection
    res.end()
    return true
  }
  if (!deps.config.allowRemote && !isLoopbackAddress(req.socket.remoteAddress)) {
    // The pane is a host shell: it stays local unless a deployment says otherwise.
    res.statusCode = 403
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end('forbidden: terminal routes serve loopback callers only')
    return true
  }
  return false
}

/**
 * Validate one identifier from the wire.
 * @param value - the raw field.
 * @returns the value, or undefined when it cannot be an identifier.
 */
function readIdField(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) return undefined
  return ID_PATTERN.test(value) ? value : undefined
}

/**
 * Read and validate a JSON request body.
 * @param req - the request to read.
 * @param res - the response to answer a validation failure on.
 * @returns the parsed object, or undefined once a refusal was written.
 */
async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | undefined> {
  if (!isJsonRequest(req)) {
    sendJson(res, 415, { ok: false, code: 'unsupported-media-type', message: 'content-type must be application/json' })
    return undefined
  }
  let text: string | null
  try {
    text = await readBoundedBody(req)
  } catch {
    // Swallows connection errors mid-body: there is nothing left to answer precisely.
    sendJson(res, 400, { ok: false, code: 'bad-request', message: 'request body unreadable' })
    return undefined
  }
  if (text === null) {
    sendJson(res, 413, { ok: false, code: 'payload-too-large', message: 'request body is too large' })
    return undefined
  }
  const body = parseJsonObject(text)
  if (body === undefined) {
    sendJson(res, 400, { ok: false, code: 'bad-request', message: 'request body must be a JSON object' })
    return undefined
  }
  return body
}

/**
 * Answer one refusal in the shared wire shape.
 * @param res - the response to write.
 * @param status - HTTP status.
 * @param code - machine-readable refusal code.
 * @param message - operator-facing detail.
 */
function refuseWith(res: ServerResponse, status: number, code: TerminalFailure['code'], message: string): void {
  sendJson(res, status, { ok: false, code, message })
}

/**
 * Register every terminal route for the caller's lifetime.
 * @param deps - route dependencies.
 */
export function registerRoutes(deps: RouteDeps): void {
  const { ctx, config, terminals, tokens, opens, favicons } = deps

  // The tab chip's logo. Read-only, loopback-fenced like every other route, and
  // a lookup rather than a proxy: one origin, one path, image bytes only.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: FAVICON_ROUTE,
    handler: async (req, res) => {
      if (refuse(deps, req, res)) return
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendMethodNotAllowed(res, 'GET')
        return
      }
      const query = new URL(req.url ?? '/', 'http://x').searchParams.get(FAVICON_ORIGIN_PARAM)
      const origin = readFaviconOrigin(query)
      if (origin === undefined) {
        sendJson(res, 400, { ok: false, code: 'bad-request', message: 'origin must be an http(s) origin' })
        return
      }
      const asset = await favicons.of(origin)
      if (asset === undefined) {
        // The site offers no logo the host will vouch for; the chip keeps its
        // monogram, which is a normal answer rather than an error.
        res.statusCode = 404
        res.end()
        return
      }
      res.setHeader('content-type', asset.contentType)
      res.setHeader('cache-control', 'private, max-age=3600')
      res.statusCode = 200
      res.end(asset.body)
    },
  }), `ui-sidebar-tools: GET ${FAVICON_ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: TOKEN_ROUTE,
    handler: (req, res) => {
      if (refuse(deps, req, res)) return
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendMethodNotAllowed(res, 'GET')
        return
      }
      sendJson(res, 200, { token: tokens.issue() })
    },
  }), `ui-sidebar-tools: GET ${TOKEN_ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: OPEN_ROUTE,
    handler: async (req, res) => {
      if (refuse(deps, req, res)) return
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return
      }
      const body = await readJsonBody(req, res)
      if (body === undefined) return
      if (!tokens.verify(req.headers[CSRF_HEADER])) {
        refuseWith(res, 403, 'forbidden', 'missing or stale token')
        return
      }
      if (!opens.take(req.socket.remoteAddress ?? 'unknown')) {
        res.setHeader('retry-after', '60')
        refuseWith(res, 429, 'rate-limited', 'too many terminals opened recently')
        return
      }
      const sessionId = readIdField(body.sessionId)
      if (sessionId === undefined) {
        refuseWith(res, 400, 'bad-request', 'sessionId must be a Session identifier')
        return
      }
      const cols = body.cols === undefined
        ? config.defaultCols
        : readBoundedIntField(body, 'cols', MIN_COLS, Math.min(MAX_COLS, config.maxCols))
      const rows = body.rows === undefined
        ? config.defaultRows
        : readBoundedIntField(body, 'rows', MIN_ROWS, Math.min(MAX_ROWS, config.maxRows))
      if (cols === undefined || rows === undefined) {
        refuseWith(res, 400, 'bad-request', 'cols/rows are out of range')
        return
      }
      // The picker may narrow or follow the Session; the host clamps whatever it
      // asks for, so no client choice can widen a terminal.
      const choice = body.mode === undefined ? undefined : readStringField(body, 'mode', 32)
      if (body.mode !== undefined && (choice === undefined || !TERMINAL_MODE_CHOICES.includes(choice as TerminalModeChoice))) {
        refuseWith(res, 400, 'bad-request', 'mode must be read-only, workspace-write, or session')
        return
      }
      const result = await terminals.open(sessionId, cols, rows, choice as TerminalModeChoice | undefined)
      sendJson(res, result.ok ? 200 : 409, result)
    },
  }), `ui-sidebar-tools: POST ${OPEN_ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STREAM_ROUTE,
    handler: (req, res) => {
      if (refuse(deps, req, res)) return
      if (req.method !== 'GET') {
        sendMethodNotAllowed(res, 'GET')
        return
      }
      // The stream is read-only, so its capability is the 128-bit terminal id
      // itself: no token travels in a URL.
      const url = new URL(String(req.url), 'http://localhost')
      const terminalId = readIdField(url.searchParams.get('terminalId'))
      if (terminalId === undefined || !terminals.attach(terminalId, res)) {
        refuseWith(res, 404, 'unknown-terminal', 'no such terminal')
      }
    },
  }), `ui-sidebar-tools: GET ${STREAM_ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: INPUT_ROUTE,
    handler: async (req, res) => {
      if (refuse(deps, req, res)) return
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return
      }
      const body = await readJsonBody(req, res)
      if (body === undefined) return
      if (!tokens.verify(req.headers[CSRF_HEADER])) {
        refuseWith(res, 403, 'forbidden', 'missing or stale token')
        return
      }
      const terminalId = readIdField(body.terminalId)
      const data = readStringField(body, 'data', MAX_INPUT_LENGTH)
      if (terminalId === undefined || data === undefined) {
        refuseWith(res, 400, 'bad-request', 'terminalId and data are required')
        return
      }
      const refusal = await terminals.input(terminalId, data)
      if (refusal === undefined) sendNoContent(res)
      else refuseWith(res, refusal.code === 'rate-limited' ? 429 : 404, refusal.code, refusal.message)
    },
  }), `ui-sidebar-tools: POST ${INPUT_ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SIGNAL_ROUTE,
    handler: async (req, res) => {
      if (refuse(deps, req, res)) return
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return
      }
      const body = await readJsonBody(req, res)
      if (body === undefined) return
      if (!tokens.verify(req.headers[CSRF_HEADER])) {
        refuseWith(res, 403, 'forbidden', 'missing or stale token')
        return
      }
      const terminalId = readIdField(body.terminalId)
      const signal = body.signal
      if (terminalId === undefined || (signal !== 'SIGINT' && signal !== 'SIGTERM')) {
        refuseWith(res, 400, 'bad-request', 'terminalId and a SIGINT/SIGTERM signal are required')
        return
      }
      const refusal = await terminals.signal(terminalId, signal as SubprocessTerminalSignal)
      if (refusal === undefined) sendNoContent(res)
      else refuseWith(res, 404, refusal.code, refusal.message)
    },
  }), `ui-sidebar-tools: POST ${SIGNAL_ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CLOSE_ROUTE,
    handler: async (req, res) => {
      if (refuse(deps, req, res)) return
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return
      }
      const body = await readJsonBody(req, res)
      if (body === undefined) return
      if (!tokens.verify(req.headers[CSRF_HEADER])) {
        refuseWith(res, 403, 'forbidden', 'missing or stale token')
        return
      }
      const terminalId = readIdField(body.terminalId)
      if (terminalId === undefined) {
        refuseWith(res, 400, 'bad-request', 'terminalId is required')
        return
      }
      await terminals.close(terminalId, 'closed by the pane')
      sendNoContent(res)
    },
  }), `ui-sidebar-tools: POST ${CLOSE_ROUTE}`)
}
