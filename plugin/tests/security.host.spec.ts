/**
 * The host-side request primitives, asserted where they are load-bearing: a
 * token that must expire and stay bounded, a limiter that must actually limit,
 * a loopback test that must not accept a LAN address, and body readers that must
 * refuse rather than buffer.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  isJsonRequest,
  isLoopbackAddress,
  parseJsonObject,
  RateLimiter,
  readBoundedBody,
  readBoundedIntField,
  readStringField,
  sendJson,
  TokenStore,
} from '../src/host/security.ts'

describe('isLoopbackAddress', () => {
  it('accepts the loopback forms Node reports and nothing else', () => {
    for (const address of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
      expect(isLoopbackAddress(address), address).toBe(true)
    }
    for (const address of [undefined, '', '10.0.0.5', '192.168.1.7', '128.0.0.1', '::ffff:10.0.0.5', 'localhost']) {
      expect(isLoopbackAddress(address), String(address)).toBe(false)
    }
  })
})

describe('TokenStore', () => {
  it('issues distinct tokens it can verify, and refuses everything else', () => {
    const store = new TokenStore(60_000, 8)
    const token = store.issue()
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    expect(store.verify(token)).toBe(true)
    expect(store.verify(store.issue())).toBe(true)
    expect(store.verify('')).toBe(false)
    expect(store.verify(token.toUpperCase())).toBe(false)
    expect(store.verify(token.slice(0, -1))).toBe(false)
    expect(store.verify(undefined)).toBe(false)
    expect(store.verify(42)).toBe(false)
  })

  it('expires a token once its lifetime passes', () => {
    let now = 1_000
    const store = new TokenStore(100, 4, () => now)
    const token = store.issue()
    expect(store.verify(token)).toBe(true)
    now += 101
    expect(store.verify(token)).toBe(false)
  })

  it('keeps at most the configured number of live tokens', () => {
    const store = new TokenStore(60_000, 2)
    const first = store.issue()
    store.issue()
    store.issue()
    // The oldest leaves; the newest two — one of them just minted — remain.
    expect(store.verify(first)).toBe(false)
    expect(store.verify(store.issue())).toBe(true)
  })
})

describe('RateLimiter', () => {
  it('allows the limit, refuses the next, and refills in the next window', () => {
    let now = 0
    const limiter = new RateLimiter(2, 1_000, () => now)
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(false)
    // Another key has its own window.
    expect(limiter.take('b')).toBe(true)
    now += 1_000
    expect(limiter.take('a')).toBe(true)
  })
})

describe('body readers', () => {
  /**
   * A request whose body arrives as the given chunks.
   * @param chunks - the chunks the reader will see.
   * @returns the fake request, plus the resume spy.
   */
  function request(chunks: readonly string[]): { req: never; resume: ReturnType<typeof vi.fn> } {
    const resume = vi.fn()
    const req = {
      resume,
      async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
        for (const chunk of chunks) yield Buffer.from(chunk)
      },
    }
    return { req: req as never, resume }
  }

  it('reads a small body', async () => {
    await expect(readBoundedBody(request(['{"a":1}']).req)).resolves.toBe('{"a":1}')
  })

  it('refuses past the ceiling and drains the rest instead of cutting the socket', async () => {
    const { req, resume } = request(['x'.repeat(70 * 1024), 'tail'])
    await expect(readBoundedBody(req)).resolves.toBeNull()
    expect(resume).toHaveBeenCalled()
  })

  it('parses a JSON object and rejects everything else', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 })
    expect(parseJsonObject('[1]')).toBeUndefined()
    expect(parseJsonObject('null')).toBeUndefined()
    expect(parseJsonObject('"text"')).toBeUndefined()
    expect(parseJsonObject('{')).toBeUndefined()
  })

  it('bounds string and integer fields', () => {
    const body = { id: 'abc', empty: '', long: 'x'.repeat(9), n: 5, big: 900, float: 1.5, text: 'str' }
    expect(readStringField(body, 'id', 8)).toBe('abc')
    expect(readStringField(body, 'empty', 8)).toBeUndefined()
    expect(readStringField(body, 'long', 8)).toBeUndefined()
    expect(readStringField(body, 'n', 8)).toBeUndefined()
    expect(readBoundedIntField(body, 'n', 1, 10)).toBe(5)
    expect(readBoundedIntField(body, 'big', 1, 10)).toBeUndefined()
    expect(readBoundedIntField(body, 'float', 1, 10)).toBeUndefined()
    expect(readBoundedIntField(body, 'text', 1, 10)).toBeUndefined()
  })

  it('accepts only an application/json content type', () => {
    expect(isJsonRequest({ headers: { 'content-type': 'application/json' } } as never)).toBe(true)
    expect(isJsonRequest({ headers: { 'content-type': 'application/json; charset=utf-8' } } as never)).toBe(true)
    expect(isJsonRequest({ headers: { 'content-type': 'application/json-patch+json' } } as never)).toBe(false)
    expect(isJsonRequest({ headers: { 'content-type': 'text/plain' } } as never)).toBe(false)
    expect(isJsonRequest({ headers: {} } as never)).toBe(false)
  })
})

describe('sendJson', () => {
  it('never caches and never sniffs', () => {
    const headers = new Map<string, string>()
    const res = {
      statusCode: 0,
      setHeader: (name: string, value: string) => { headers.set(name.toLowerCase(), value) },
      end: vi.fn(),
    }
    sendJson(res as never, 409, { ok: false, code: 'x' })
    expect(res.statusCode).toBe(409)
    expect(headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(headers.get('cache-control')).toBe('no-store')
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.end).toHaveBeenCalledWith('{"ok":false,"code":"x"}')
  })
})
