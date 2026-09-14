/**
 * The route security matrix: what each route answers to a caller that is
 * untrusted, unauthenticated, non-loopback, below the ceiling, or simply wrong.
 * The handlers are driven directly through the composition's own registration
 * call, so every gate runs in the order the server runs it.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { registerRoutes } from '../src/host/routes.ts'
import type { GuiTerminalService } from '../src/host/terminals.ts'
import { RateLimiter, TokenStore } from '../src/host/security.ts'
import { FaviconCache } from '../src/host/favicon.ts'
import {
  CLOSE_ROUTE, CSRF_HEADER, FAVICON_ROUTE, INPUT_ROUTE, OPEN_ROUTE, SIGNAL_ROUTE, STREAM_ROUTE, TOKEN_ROUTE,
} from '../src/shared.ts'
import { testConfig } from './fixtures.ts'
import type { Config } from '../src/config.ts'

/** One registered route, as the fake carrier holds it. */
interface Route {
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => unknown
}

/** What a test may vary about a request. */
interface RequestOptions {
  readonly method?: string
  readonly url?: string
  readonly headers?: Record<string, string>
  readonly body?: string
  readonly remoteAddress?: string
}

/** A response that records what a handler wrote. */
interface Recorded {
  readonly res: ServerResponse
  readonly status: () => number
  readonly body: () => string
  readonly header: (name: string) => string | undefined
  readonly streaming: () => boolean
}

/**
 * A response double.
 * @returns the response plus readers for its status, body, and headers.
 */
function recordResponse(): Recorded {
  let status = 0
  const headers = new Map<string, string>()
  const chunks: string[] = []
  let ended = false
  const res = {
    get statusCode() { return status },
    set statusCode(value: number) { status = value },
    setHeader: (name: string, value: string) => { headers.set(name.toLowerCase(), value) },
    writeHead: (code: number, extra?: Record<string, string>) => {
      status = code
      for (const [name, value] of Object.entries(extra ?? {})) headers.set(name.toLowerCase(), value)
    },
    write: (chunk: string) => { chunks.push(chunk); return true },
    end: (chunk?: string) => { if (typeof chunk === 'string') chunks.push(chunk); ended = true },
    on: () => { /* the close listener is not part of these assertions */ },
    writableEnded: false,
    destroyed: false,
    writableLength: 0,
    destroy: () => { /* a dropped reader is asserted through the service, not here */ },
  }
  return {
    res: res as unknown as ServerResponse,
    status: () => status,
    body: () => chunks.join(''),
    header: name => headers.get(name.toLowerCase()),
    streaming: () => headers.get('content-type') === 'text/event-stream' && !ended,
  }
}

/**
 * A request double whose body arrives as one chunk.
 * @param options - what this test varies.
 * @returns the request.
 */
function recordRequest(options: RequestOptions = {}): IncomingMessage {
  const body = options.body
  const req = {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers: { host: '127.0.0.1:3080', ...options.headers },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    resume: () => { /* the bounded reader drains through iteration instead */ },
    async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
      if (body !== undefined) yield Buffer.from(body)
    },
  }
  return req as unknown as IncomingMessage
}

/** The terminal service double, with only the calls the routes make. */
function stubTerminals(overrides: Partial<Record<keyof GuiTerminalService, unknown>> = {}): GuiTerminalService {
  const open = vi.fn(async () => ({
    ok: true as const,
    terminalId: 'a'.repeat(32),
    shell: '/usr/bin/pwsh',
    cols: 100,
    rows: 30,
    sandbox: { mode: 'workspace-write' as const, enforcement: 'partial' as const, workspaceRoot: '/work' },
  }))
  return {
    open,
    attach: vi.fn(() => true),
    input: vi.fn(async () => undefined),
    signal: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as GuiTerminalService
}

/** Everything the route tests share. */
interface Harness {
  readonly routes: readonly Route[]
  readonly terminals: GuiTerminalService
  readonly tokens: TokenStore
  readonly fence: ReturnType<typeof vi.fn>
  readonly config: Config
}

/**
 * Register the routes against doubles.
 * @param options - fence answer, configuration, and service overrides.
 * @returns the harness a test drives.
 */
function harness(options: {
  rejection?: 401 | 403 | undefined
  config?: Partial<Config>
  terminals?: Partial<Record<keyof GuiTerminalService, unknown>>
} = {}): Harness {
  const routes: Route[] = []
  const fence = vi.fn(() => options.rejection)
  const config = testConfig(options.config)
  const terminals = stubTerminals(options.terminals)
  const tokens = new TokenStore(config.csrfTokenTtlMs, config.csrfTokenMaxEntries)
  const ctx = {
    effect: (body: () => unknown) => body(),
    webServer: { register: (route: Route) => { routes.push(route); return () => { /* disposable */ } } },
    connection: { requestRejection: fence },
    logger: { info: () => { /* audit lines are not asserted here */ }, warn: () => { /* idem */ } },
  } as unknown as Context
  registerRoutes({
    ctx,
    config,
    terminals,
    tokens,
    opens: new RateLimiter(config.maxOpensPerMinute, 60_000),
    favicons: new FaviconCache(),
  })
  return { routes, terminals, tokens, fence, config }
}

/**
 * Call one registered route.
 * @param harnessed - the harness.
 * @param path - the route path.
 * @param options - the request to make.
 * @returns the recorded response.
 */
async function call(harnessed: Harness, path: string, options: RequestOptions = {}): Promise<Recorded> {
  const route = harnessed.routes.find(candidate => candidate.path === path)
  if (route === undefined) throw new Error(`route ${path} was not registered`)
  const recorded = recordResponse()
  await route.handler(recordRequest({ url: path, ...options }), recorded.res)
  return recorded
}

/** A JSON request carrying a live token. */
function authorized(harnessed: Harness, path: string, payload: unknown, options: RequestOptions = {}): Promise<Recorded> {
  return call(harnessed, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CSRF_HEADER]: harnessed.tokens.issue() },
    body: JSON.stringify(payload),
    ...options,
  })
}

describe('every route', () => {
  it('is registered once each, under the plugin prefix', () => {
    const { routes } = harness()
    const paths = routes.map(route => route.path).sort()
    expect(paths).toEqual([
      CLOSE_ROUTE, FAVICON_ROUTE, INPUT_ROUTE, OPEN_ROUTE, SIGNAL_ROUTE, STREAM_ROUTE, TOKEN_ROUTE,
    ].sort())
    for (const path of paths) expect(path.startsWith('/gui-terminal/')).toBe(true)
  })

  it('answers the composition’s refusal before doing anything else', async () => {
    for (const rejection of [401, 403] as const) {
      const harnessed = harness({ rejection })
      for (const path of [TOKEN_ROUTE, FAVICON_ROUTE, OPEN_ROUTE, STREAM_ROUTE, INPUT_ROUTE, SIGNAL_ROUTE, CLOSE_ROUTE]) {
        const recorded = await call(harnessed, path, { method: 'POST' })
        expect(recorded.status(), `${path} → ${String(rejection)}`).toBe(rejection)
      }
      expect(harnessed.terminals.open).not.toHaveBeenCalled()
    }
  })

  it('refuses a caller that is not on loopback unless the deployment opts in', async () => {
    const local = harness()
    const remote = await call(local, TOKEN_ROUTE, { remoteAddress: '10.1.2.3' })
    expect(remote.status()).toBe(403)
    expect(remote.body()).toContain('loopback')

    const open = harness({ config: { allowRemote: true } })
    expect((await call(open, TOKEN_ROUTE, { remoteAddress: '10.1.2.3' })).status()).toBe(200)
  })

  it('refuses a method it does not serve', async () => {
    const harnessed = harness()
    expect((await call(harnessed, OPEN_ROUTE, { method: 'GET' })).status()).toBe(405)
    expect((await call(harnessed, TOKEN_ROUTE, { method: 'POST' })).status()).toBe(405)
    expect((await call(harnessed, STREAM_ROUTE, { method: 'POST' })).status()).toBe(405)
  })
})

describe('GET /gui-terminal/token', () => {
  it('mints a token for a trusted loopback caller', async () => {
    const recorded = await call(harness(), TOKEN_ROUTE)
    expect(recorded.status()).toBe(200)
    expect(JSON.parse(recorded.body()).token).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('GET /gui-terminal/favicon', () => {
  it('refuses anything that is not a bare http(s) origin', async () => {
    const harnessed = harness()
    for (const query of ['', '?origin=', '?origin=ftp%3A%2F%2Fexample.com', '?origin=https%3A%2F%2Fexample.com%2Fx']) {
      expect((await call(harnessed, FAVICON_ROUTE, { url: `${FAVICON_ROUTE}${query}` })).status(), query).toBe(400)
    }
  })
})

describe('POST /gui-terminal/open', () => {
  it('refuses a missing, stale, or malformed token', async () => {
    const harnessed = harness()
    const body = JSON.stringify({ sessionId: 'session-1' })
    expect((await call(harnessed, OPEN_ROUTE, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })).status()).toBe(403)
    expect((await call(harnessed, OPEN_ROUTE, {
      method: 'POST', headers: { 'content-type': 'application/json', [CSRF_HEADER]: 'deadbeef' }, body,
    })).status()).toBe(403)
    // A token minted for another page is refused once the store forgets it.
    const stale = harness({ config: { csrfTokenMaxEntries: 1 } })
    const first = stale.tokens.issue()
    stale.tokens.issue()
    expect((await call(stale, OPEN_ROUTE, {
      method: 'POST', headers: { 'content-type': 'application/json', [CSRF_HEADER]: first }, body,
    })).status()).toBe(403)
    expect(harnessed.terminals.open).not.toHaveBeenCalled()
  })

  it('requires an application/json body and a bounded one', async () => {
    const harnessed = harness()
    const token = harnessed.tokens.issue()
    expect((await call(harnessed, OPEN_ROUTE, {
      method: 'POST', headers: { 'content-type': 'text/plain', [CSRF_HEADER]: token }, body: '{}',
    })).status()).toBe(415)
    expect((await call(harnessed, OPEN_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CSRF_HEADER]: token },
      body: JSON.stringify({ sessionId: 'session-1', pad: 'x'.repeat(70 * 1024) }),
    })).status()).toBe(413)
    expect((await call(harnessed, OPEN_ROUTE, {
      method: 'POST', headers: { 'content-type': 'application/json', [CSRF_HEADER]: token }, body: '{',
    })).status()).toBe(400)
    expect((await call(harnessed, OPEN_ROUTE, {
      method: 'POST', headers: { 'content-type': 'application/json', [CSRF_HEADER]: token }, body: '[]',
    })).status()).toBe(400)
  })

  it('refuses an identifier that is not a Session id, or a grid out of range', async () => {
    const harnessed = harness()
    for (const payload of [
      { sessionId: 'has space' },
      { sessionId: '' },
      { sessionId: 'x'.repeat(200) },
      { sessionId: 7 },
      { sessionId: 'session-1', cols: 1 },
      { sessionId: 'session-1', rows: 9999 },
      { sessionId: 'session-1', cols: 12.5 },
    ]) {
      expect((await authorized(harnessed, OPEN_ROUTE, payload)).status(), JSON.stringify(payload)).toBe(400)
    }
    expect(harnessed.terminals.open).not.toHaveBeenCalled()
  })

  it('publishes a terminal for a well-formed request and passes the bounds through', async () => {
    const harnessed = harness()
    const recorded = await authorized(harnessed, OPEN_ROUTE, { sessionId: 'session-1', cols: 120, rows: 40 })
    expect(recorded.status()).toBe(200)
    expect(JSON.parse(recorded.body())).toMatchObject({ ok: true, cols: 100, rows: 30 })
    expect(harnessed.terminals.open).toHaveBeenCalledWith('session-1', 120, 40, undefined)
  })

  it('accepts the pane’s confinement choice and refuses anything else', async () => {
    const harnessed = harness()
    expect((await authorized(harnessed, OPEN_ROUTE, { sessionId: 'session-1', mode: 'read-only' })).status()).toBe(200)
    expect(harnessed.terminals.open).toHaveBeenLastCalledWith('session-1', 100, 30, 'read-only')
    // `danger-full-access` is deliberately not a pane choice: a pane may narrow
    // itself or follow its Session, never widen past it.
    for (const mode of ['danger-full-access', 'READ-ONLY', '', 7]) {
      expect((await authorized(harnessed, OPEN_ROUTE, { sessionId: 'session-1', mode })).status(), String(mode)).toBe(400)
    }
  })

  it('reports a refusal from the service as a conflict, not a success', async () => {
    const harnessed = harness({
      terminals: {
        open: vi.fn(async () => ({ ok: false as const, code: 'sandbox-unavailable' as const, message: 'no provider' })),
      },
    })
    const recorded = await authorized(harnessed, OPEN_ROUTE, { sessionId: 'session-1' })
    expect(recorded.status()).toBe(409)
    expect(JSON.parse(recorded.body())).toMatchObject({ ok: false, code: 'sandbox-unavailable' })
  })

  it('rate-limits opens and says when to come back', async () => {
    const harnessed = harness({ config: { maxOpensPerMinute: 1 } })
    expect((await authorized(harnessed, OPEN_ROUTE, { sessionId: 'session-1' })).status()).toBe(200)
    const limited = await authorized(harnessed, OPEN_ROUTE, { sessionId: 'session-1' })
    expect(limited.status()).toBe(429)
    expect(limited.header('retry-after')).toBe('60')
  })
})

describe('GET /gui-terminal/stream', () => {
  it('hands the response to the service, which owns the stream headers', async () => {
    // The service writes the event-stream headers; the route only decides
    // whether the capability is real.
    const attach = vi.fn((_id: string, res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
      return true
    })
    const harnessed = harness({ terminals: { attach } })
    const recorded = await call(harnessed, STREAM_ROUTE, {
      url: `${STREAM_ROUTE}?terminalId=${'a'.repeat(32)}`,
    })
    expect(attach).toHaveBeenCalledWith('a'.repeat(32), recorded.res)
    expect(recorded.streaming()).toBe(true)
  })

  it('answers 404 for an unknown, absent, or malformed capability', async () => {
    const harnessed = harness({ terminals: { attach: vi.fn(() => false) } })
    for (const query of ['', '?terminalId=', '?terminalId=has%20space', `?terminalId=${'a'.repeat(200)}`]) {
      expect((await call(harnessed, STREAM_ROUTE, { url: `${STREAM_ROUTE}${query}` })).status(), query).toBe(404)
    }
  })
})

describe('POST /gui-terminal/input', () => {
  it('writes bytes for a live terminal and refuses everything else', async () => {
    const harnessed = harness()
    expect((await authorized(harnessed, INPUT_ROUTE, { terminalId: 'a'.repeat(32), data: 'ls\r' })).status()).toBe(204)
    expect(harnessed.terminals.input).toHaveBeenCalledWith('a'.repeat(32), 'ls\r')

    expect((await authorized(harnessed, INPUT_ROUTE, { terminalId: 'a'.repeat(32) })).status()).toBe(400)
    expect((await authorized(harnessed, INPUT_ROUTE, { terminalId: 'a'.repeat(32), data: '' })).status()).toBe(400)
    expect((await authorized(harnessed, INPUT_ROUTE, {
      terminalId: 'a'.repeat(32), data: 'x'.repeat(40 * 1024),
    })).status()).toBe(400)

    const unknown = harness({
      terminals: { input: vi.fn(async () => ({ ok: false as const, code: 'unknown-terminal' as const, message: 'gone' })) },
    })
    expect((await authorized(unknown, INPUT_ROUTE, { terminalId: 'b'.repeat(32), data: 'x' })).status()).toBe(404)

    const throttled = harness({
      terminals: { input: vi.fn(async () => ({ ok: false as const, code: 'rate-limited' as const, message: 'slow down' })) },
    })
    expect((await authorized(throttled, INPUT_ROUTE, { terminalId: 'c'.repeat(32), data: 'x' })).status()).toBe(429)
  })
})

describe('POST /gui-terminal/signal', () => {
  it('accepts only the signals this plugin delivers', async () => {
    const harnessed = harness()
    expect((await authorized(harnessed, SIGNAL_ROUTE, {
      terminalId: 'a'.repeat(32), signal: 'SIGINT',
    })).status()).toBe(204)
    for (const signal of ['SIGKILL', 'sigint', '', 9]) {
      expect((await authorized(harnessed, SIGNAL_ROUTE, {
        terminalId: 'a'.repeat(32), signal,
      })).status(), String(signal)).toBe(400)
    }
  })
})

describe('POST /gui-terminal/close', () => {
  it('closes a terminal and answers with nothing to say', async () => {
    const harnessed = harness()
    const recorded = await authorized(harnessed, CLOSE_ROUTE, { terminalId: 'a'.repeat(32) })
    expect(recorded.status()).toBe(204)
    expect(harnessed.terminals.close).toHaveBeenCalledWith('a'.repeat(32), 'closed by the pane')
  })
})
