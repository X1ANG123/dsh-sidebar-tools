/**
 * The address policy the browser pane enforces before it loads anything: a
 * closed list of schemes, no embedded credentials, nothing unbounded, and never
 * this interface's own origin.
 */
import { describe, expect, it } from 'vitest'
import { normalizeAddress, resolveAddress } from '../src/client/browser/url.ts'

const ORIGIN = 'http://127.0.0.1:3080'

describe('normalizeAddress', () => {
  it('adds a scheme, choosing plain http for a local host', () => {
    expect(normalizeAddress('example.com', ORIGIN)).toEqual({ ok: true, url: 'https://example.com/' })
    expect(normalizeAddress('localhost', ORIGIN)).toEqual({ ok: true, url: 'http://localhost/' })
    expect(normalizeAddress('localhost:5173', ORIGIN)).toEqual({ ok: true, url: 'http://localhost:5173/' })
    expect(normalizeAddress('127.0.0.1:8080/x', ORIGIN)).toEqual({ ok: true, url: 'http://127.0.0.1:8080/x' })
    expect(normalizeAddress('docs.local', ORIGIN)).toEqual({ ok: true, url: 'https://docs.local/' })
  })

  it('keeps an explicit http or https address', () => {
    expect(normalizeAddress('http://example.com/a?b=1#c', ORIGIN))
      .toEqual({ ok: true, url: 'http://example.com/a?b=1#c' })
    expect(normalizeAddress('https://example.com', ORIGIN)).toEqual({ ok: true, url: 'https://example.com/' })
  })

  it('refuses every scheme a frame must not load', () => {
    for (const address of [
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'blob:http://example.com/x',
      'file:///etc/passwd',
      'about:blank',
      'chrome://settings',
      'view-source:https://example.com',
      'ftp://example.com',
    ]) {
      expect(normalizeAddress(address, ORIGIN), address).toEqual({ ok: false, problem: 'unsupported' })
    }
  })

  it('refuses this interface’s own origin, which could reach its own APIs', () => {
    expect(normalizeAddress('http://127.0.0.1:3080/', ORIGIN)).toEqual({ ok: false, problem: 'same-origin' })
    expect(normalizeAddress('http://127.0.0.1:3080/gui-terminal/token', ORIGIN))
      .toEqual({ ok: false, problem: 'same-origin' })
    // A different port is a different origin, and a legitimate thing to view.
    expect(normalizeAddress('http://127.0.0.1:5173/', ORIGIN).ok).toBe(true)
  })

  it('refuses embedded credentials and unbounded input', () => {
    expect(normalizeAddress('https://user:pass@example.com', ORIGIN)).toEqual({ ok: false, problem: 'credentials' })
    expect(normalizeAddress('https://user@example.com', ORIGIN)).toEqual({ ok: false, problem: 'credentials' })
    expect(normalizeAddress(`https://example.com/${'x'.repeat(2100)}`, ORIGIN)).toEqual({ ok: false, problem: 'too-long' })
    expect(normalizeAddress('', ORIGIN)).toEqual({ ok: false, problem: 'empty' })
    expect(normalizeAddress('   ', ORIGIN)).toEqual({ ok: false, problem: 'empty' })
  })

  it('refuses what is not an address at all', () => {
    for (const address of ['http://', 'https:// space', '://example.com']) {
      expect(normalizeAddress(address, ORIGIN).ok, address).toBe(false)
    }
  })
})

describe('resolveAddress', () => {
  it('searches for a phrase, which is what the field promises', () => {
    expect(resolveAddress('hello world', ORIGIN))
      .toEqual({ ok: true, url: 'https://duckduckgo.com/?q=hello%20world' })
    expect(resolveAddress('  终端 滚动  ', ORIGIN))
      .toEqual({ ok: true, url: `https://duckduckgo.com/?q=${encodeURIComponent('终端 滚动')}` })
    // One bare word is a phrase; a name for this machine is not.
    expect(resolveAddress('hello', ORIGIN)).toEqual({ ok: true, url: 'https://duckduckgo.com/?q=hello' })
    expect(resolveAddress('localhost', ORIGIN)).toEqual({ ok: true, url: 'http://localhost/' })
    expect(resolveAddress('127.0.0.1', ORIGIN)).toEqual({ ok: true, url: 'http://127.0.0.1/' })
  })

  it('still loads anything that is an address', () => {
    expect(resolveAddress('example.com', ORIGIN)).toEqual({ ok: true, url: 'https://example.com/' })
    expect(resolveAddress('localhost:5173', ORIGIN)).toEqual({ ok: true, url: 'http://localhost:5173/' })
  })

  it('takes a search template from the caller', () => {
    expect(resolveAddress('hello', ORIGIN, 'https://search.example/?q={query}'))
      .toEqual({ ok: true, url: 'https://search.example/?q=hello' })
  })

  it('keeps every real refusal a refusal rather than a query', () => {
    // A mistyped scheme must not come back as a search for its own text.
    expect(resolveAddress('javascript:alert(1)', ORIGIN)).toEqual({ ok: false, problem: 'unsupported' })
    expect(resolveAddress('data:text/html,<b>x</b>', ORIGIN)).toEqual({ ok: false, problem: 'unsupported' })
    expect(resolveAddress(`${ORIGIN}/gui-terminal/token`, ORIGIN)).toEqual({ ok: false, problem: 'same-origin' })
    expect(resolveAddress('https://user:pass@example.com', ORIGIN)).toEqual({ ok: false, problem: 'credentials' })
    expect(resolveAddress('', ORIGIN)).toEqual({ ok: false, problem: 'empty' })
  })
})
