/**
 * Host-side request security: the primitives every route here is built from.
 *
 * Three independent gates guard one request: the composition's browser-trust
 * fence (Host/Origin/Fetch-Metadata, owned by the connection service), the
 * loopback check for a feature that hands out a host shell, and a per-page CSRF
 * token for mutating calls. Bodies are bounded and parsed strictly, and nothing
 * a caller sends is ever echoed into a header or a command line.
 *
 * @module @deepseek-ai/dsh-client-ui-sidebar-tools/host/security
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { MAX_BODY_BYTES } from '../shared.ts'

/**
 * Whether an address names the local loopback authority.
 * @param address - `socket.remoteAddress`, in any of Node's forms.
 * @returns true for IPv6 loopback and any IPv4 address in 127/8.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  if (address === '::1') return true
  const bare = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  const parts = bare.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Per-page CSRF tokens: minted on demand, kept in memory, never persisted and
 * never placed in a URL. A cross-site caller cannot read the token response
 * (no CORS header is ever emitted), so it cannot forge a mutating call.
 */
export class TokenStore {
  private readonly issued = new Map<string, number>()

  /**
   * @param ttlMs - how long one token stays valid.
   * @param maxEntries - how many live tokens are kept before the oldest go.
   * @param now - clock seam for tests.
   */
  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Mint one token.
   * @returns the token, which the page keeps in memory for its own calls.
   */
  issue(): string {
    this.prune()
    const token = randomBytes(16).toString('hex')
    this.issued.set(token, this.now() + this.ttlMs)
    while (this.issued.size > this.maxEntries) {
      const oldest = this.issued.keys().next()
      if (oldest.done === true) break
      this.issued.delete(oldest.value)
    }
    return token
  }

  /**
   * Whether a presented token is one this store still honours.
   * @param presented - the raw header value, of any type.
   * @returns true only for a live token.
   */
  verify(presented: unknown): boolean {
    if (typeof presented !== 'string' || presented.length === 0) return false
    this.prune()
    const candidate = Buffer.from(presented)
    let matched = false
    // Compare against every live token in constant time rather than probing a
    // map keyed by the candidate, so a wrong token reveals nothing but its own
    // length. The store is bounded, so the loop is bounded too.
    for (const token of this.issued.keys()) {
      const stored = Buffer.from(token)
      if (stored.length !== candidate.length) continue
      matched = timingSafeEqual(stored, candidate) || matched
    }
    return matched
  }

  /** Drop expired tokens. */
  private prune(): void {
    const now = this.now()
    for (const [token, expiresAt] of this.issued) {
      if (expiresAt <= now) this.issued.delete(token)
    }
  }
}

/** A fixed-window counter: one key, a bounded number of events per window. */
export class RateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>()

  /**
   * @param limit - events allowed per window.
   * @param windowMs - window length.
   * @param now - clock seam for tests.
   */
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Charge one event against a key.
   * @param key - the caller identity being limited.
   * @returns true when the event is allowed, false when the window is spent.
   */
  take(key: string): boolean {
    const now = this.now()
    const window = this.windows.get(key)
    if (window === undefined || now - window.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 })
      return true
    }
    if (window.count >= this.limit) return false
    window.count += 1
    return true
  }
}

/**
 * JSON response, never cached: every outcome is a live fact.
 * @param res - the response to write.
 * @param status - HTTP status code.
 * @param payload - the JSON-serializable body.
 */
export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(payload))
}

/**
 * 405 with the route's one supported method.
 * @param res - the response to write.
 * @param allow - the method the route does serve.
 */
export function sendMethodNotAllowed(res: ServerResponse, allow: 'GET' | 'POST'): void {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

/**
 * Empty success response.
 * @param res - the response to write.
 */
export function sendNoContent(res: ServerResponse): void {
  res.statusCode = 204
  res.setHeader('cache-control', 'no-store')
  res.end()
}

/**
 * Collect a bounded request body as UTF-8 text.
 * @param req - the request whose body is read exactly once.
 * @returns the text, or null past the ceiling (the remainder is drained).
 */
export async function readBoundedBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  // An http server streams Buffer chunks unless something set an encoding.
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      // Drain the remainder so the refusal is a readable response, not a cut socket.
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}

/**
 * Parse a request body into a plain JSON object.
 * @param text - the raw body text.
 * @returns the object, or undefined when the body is not a JSON object.
 */
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    // Swallows the parse error: a non-JSON body is exactly the undefined case.
    return undefined
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  return body as Record<string, unknown>
}

/**
 * Read one bounded string field.
 * @param body - the parsed body.
 * @param field - the member name.
 * @param maxLength - longest accepted value.
 * @returns the value, or undefined when absent, mistyped, empty, or too long.
 */
export function readStringField(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
): string | undefined {
  const value = body[field]
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return undefined
  return value
}

/**
 * Read one integer field inside a closed range.
 * @param body - the parsed body.
 * @param field - the member name.
 * @param min - smallest accepted value.
 * @param max - largest accepted value.
 * @returns the integer, or undefined when absent, mistyped, or out of range.
 */
export function readBoundedIntField(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number | undefined {
  const value = body[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return undefined
  return value < min || value > max ? undefined : value
}

/**
 * Whether a body is exactly `application/json`.
 * @param req - the request whose content type is judged.
 * @returns true when the essence is application/json.
 */
export function isJsonRequest(req: IncomingMessage): boolean {
  // String(undefined) is 'undefined', which never matches.
  return String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}
