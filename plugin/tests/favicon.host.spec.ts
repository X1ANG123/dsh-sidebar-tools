/**
 * The host-side logo lookup: address policy, the DNS-resolved and pinned socket,
 * the declared-icon parse, redirects, and the cache. The double stands in for the
 * guarded GET, so what is asserted here is the lookup's own decisions.
 */
import { describe, expect, it } from 'vitest'
import {
  FaviconCache, iconCandidates, isPrivateHost, isPublicAddress, readFaviconOrigin, resolveForConnection,
  type FaviconRequest,
} from '../src/host/favicon.ts'

/** What one address answers in a double. */
interface Answer {
  status?: number
  location?: string
  contentType?: string
  body?: Uint8Array
}

/**
 * A guarded-GET double driven by an address table.
 * @param table - what each address answers; anything else refuses.
 * @returns the request, the addresses asked for, and the ceilings offered.
 */
function responder(table: Record<string, Answer>): { request: FaviconRequest; urls: string[]; caps: number[] } {
  const urls: string[] = []
  const caps: number[] = []
  const request: FaviconRequest = async (url, _accept, _origin, cap) => {
    urls.push(url)
    caps.push(cap)
    const answer = table[url]
    if (answer === undefined) return undefined
    return {
      status: answer.status ?? 200,
      location: answer.location ?? null,
      contentType: answer.contentType ?? 'image/png',
      body: Buffer.from(answer.body ?? new Uint8Array([1, 2, 3])),
    }
  }
  return { request, urls, caps }
}

/**
 * The same double, answering every address the same way.
 * @param answer - what every address answers.
 * @returns the request and the addresses asked for.
 */
function blanket(answer: Answer | 'fail'): { request: FaviconRequest; urls: string[] } {
  return responder(new Proxy({}, {
    get: (_target, _key) => (answer === 'fail' ? undefined : answer),
  }) as Record<string, Answer>)
}

/** A page source declaring one icon. */
function pageDeclaring(href: string): Uint8Array {
  return new TextEncoder().encode(`<html><head><link rel="icon" href="${href}"></head></html>`)
}

describe('readFaviconOrigin', () => {
  it('accepts an http(s) origin and nothing longer', () => {
    expect(readFaviconOrigin('https://example.com')).toBe('https://example.com')
    expect(readFaviconOrigin('http://localhost:5173')).toBe('http://localhost:5173')
  })

  it('refuses a path, a scheme, credentials, or nothing at all', () => {
    for (const value of ['https://example.com/x', 'https://example.com/?a=1', 'ftp://example.com', 'https://u:p@example.com', '', 'not a url']) {
      expect(readFaviconOrigin(value), String(value)).toBeUndefined()
    }
    expect(readFaviconOrigin(null)).toBeUndefined()
  })
})

describe('isPublicAddress', () => {
  it('refuses every address a lookup must never reach', () => {
    for (const address of [
      '127.0.0.1', '0.0.0.0', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.4',
      '169.254.169.254', '100.64.0.1', '192.0.0.1', '198.18.0.1', '203.0.113.5', '224.0.0.1', '255.255.255.255',
      '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1',
    ]) {
      expect(isPublicAddress(address), address).toBe(false)
    }
  })

  it('accepts publicly routable addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(address), address).toBe(true)
    }
  })

  it('backs the textual hostname filter', () => {
    for (const host of ['localhost', 'foo.local', '127.0.0.1', '10.1.2.3', '[::1]']) {
      expect(isPrivateHost(host), host).toBe(true)
    }
    for (const host of ['example.com', 'cdn.example.com', '8.8.8.8']) {
      expect(isPrivateHost(host), host).toBe(false)
    }
  })
})

describe('resolveForConnection', () => {
  it('pins a literal address, and refuses one that is not public', async () => {
    await expect(resolveForConnection('127.0.0.1', false)).rejects.toThrow(/non-public/)
    await expect(resolveForConnection('169.254.169.254', false)).rejects.toThrow(/non-public/)
    expect(await resolveForConnection('127.0.0.1', true)).toEqual({ address: '127.0.0.1', family: 4 })
    expect(await resolveForConnection('8.8.8.8', false)).toEqual({ address: '8.8.8.8', family: 4 })
  })

  it('refuses a name that does not resolve', async () => {
    // `.invalid` is reserved and never resolves, so this needs no network.
    await expect(resolveForConnection('nothing.invalid', false)).rejects.toThrow()
  })
})

describe('iconCandidates', () => {
  const PAGE = 'https://docs.example.com/guide/'

  it('reads the icons a page declares, resolving and ordering them', () => {
    const html = [
      '<link rel="mask-icon" href="/mask.svg">',
      '<link rel="apple-touch-icon" href="/touch.png">',
      '<link rel="shortcut icon" href="icon.ico">',
      "<link rel='icon' href='/assets/logo.svg'>",
      '<link rel="stylesheet" href="/style.css">',
      '<link rel="icon" href="/assets/logo.svg">',
    ].join('')
    expect(iconCandidates(html, PAGE)).toEqual([
      'https://docs.example.com/guide/icon.ico',
      'https://docs.example.com/assets/logo.svg',
      'https://docs.example.com/touch.png',
      'https://docs.example.com/mask.svg',
    ])
  })

  it('ignores what is not a usable icon address', () => {
    const html = [
      '<link rel="icon" href="data:image/png;base64,AAAA">',
      '<link rel="icon" href="javascript:alert(1)">',
      '<link rel="preload" href="/x.ico">',
    ].join('')
    expect(iconCandidates(html, PAGE)).toEqual([])
  })
})

describe('FaviconCache', () => {
  it('fetches one origin once and then serves the cache', async () => {
    const { request, urls, caps } = responder({ 'https://example.com/favicon.ico': {} })
    const cache = new FaviconCache(request)
    const first = await cache.of('https://example.com')
    const second = await cache.of('https://example.com')
    expect(first?.contentType).toBe('image/png')
    expect(second?.body).toEqual(first?.body)
    expect(urls).toEqual(['https://example.com/favicon.ico'])
    expect(caps[0]).toBe(256 * 1024)
  })

  it('remembers a refusal briefly instead of asking again per paint', async () => {
    const { request, urls } = blanket('fail')
    const cache = new FaviconCache(request)
    await cache.of('https://example.com')
    // The three well-known paths, then the page that would declare one.
    expect(urls).toEqual([
      'https://example.com/favicon.ico',
      'https://example.com/favicon.png',
      'https://example.com/apple-touch-icon.png',
      'https://example.com/',
    ])
    await cache.of('https://example.com')
    expect(urls).toHaveLength(4)
  })

  it('falls back to the icon the page declares, under the page ceiling', async () => {
    const { request, urls, caps } = responder({
      'https://docs.example.com/': { contentType: 'text/html; charset=utf-8', body: pageDeclaring('/assets/logo.svg') },
      'https://docs.example.com/assets/logo.svg': { contentType: 'image/svg+xml' },
    })
    const asset = await new FaviconCache(request).of('https://docs.example.com')
    expect(asset?.contentType).toBe('image/svg+xml')
    expect(urls).toEqual([
      'https://docs.example.com/favicon.ico',
      'https://docs.example.com/favicon.png',
      'https://docs.example.com/apple-touch-icon.png',
      'https://docs.example.com/',
      'https://docs.example.com/assets/logo.svg',
    ])
    expect(caps[3]).toBe(128 * 1024)
  })

  it('follows a redirect to the site’s real home', async () => {
    const { request, urls } = responder({
      'https://google.com/favicon.ico': { status: 301, location: 'https://www.google.com/favicon.ico' },
      'https://www.google.com/favicon.ico': { contentType: 'image/x-icon' },
    })
    const asset = await new FaviconCache(request).of('https://google.com')
    expect(asset?.contentType).toBe('image/x-icon')
    expect(urls).toEqual(['https://google.com/favicon.ico', 'https://www.google.com/favicon.ico'])
  })

  it('refuses a redirect aimed at a private address before asking for it', async () => {
    const { request, urls } = responder({
      'https://site.example/favicon.ico': { status: 302, location: 'http://10.0.0.1/logo.png' },
    })
    expect(await new FaviconCache(request).of('https://site.example')).toBeUndefined()
    expect(urls).not.toContain('http://10.0.0.1/logo.png')
  })

  it('shows an icon a host mislabelled, because the bytes say what it is', async () => {
    const { request } = responder({
      'https://example.com/favicon.ico': { contentType: 'text/plain', body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]) },
    })
    expect((await new FaviconCache(request).of('https://example.com'))?.contentType).toBe('image/png')
  })

  it('refuses an empty answer', async () => {
    const { request } = responder({ 'https://example.com/favicon.ico': { body: new Uint8Array() } })
    expect(await new FaviconCache(request).of('https://example.com')).toBeUndefined()
  })
})