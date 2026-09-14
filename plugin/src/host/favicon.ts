/**
 * The site logo the browser tab's chip shows, fetched by THIS HOST rather than
 * by the reader's browser.
 *
 * The browser cannot have the real logo any other way. A plain `<img>` to the
 * site would carry that site's cookies — the one thing this plugin promises never
 * to do — and an anonymous one needs CORS the site does not grant, which is why
 * the chip would otherwise fall back to a letter.
 *
 * Because the reader's browser asks this host to fetch a third party's bytes,
 * every request is bounded twice over. The address policy refuses a hostname that
 * is textually private, and — the part that matters against DNS rebinding — the
 * name is resolved here, EVERY answer must be a public address, and the socket is
 * then pinned to the address that was checked. A name that re-resolves after the
 * check therefore cannot reach the reader's own network: the connection never
 * consults DNS again.
 *
 * Everything else is bounded too: no credentials, at most three redirects with
 * the whole check repeated on each hop, a short deadline, a byte ceiling, and
 * image bytes only. This is a logo lookup, not a proxy.
 *
 * @module @deepseek-ai/dsh-client-ui-sidebar-tools/host/favicon
 */

import { lookup as resolveName } from 'node:dns/promises'
import { request as insecureRequest } from 'node:http'
import { request as secureRequest } from 'node:https'
import { isIP } from 'node:net'
import type { RequestOptions } from 'node:https'

/** Longest origin this fetcher accepts. */
const MAX_ORIGIN_LENGTH = 300

/** Ceiling on the bytes one image may weigh. */
const MAX_IMAGE_BYTES = 256 * 1024

/** Ceiling on the page HTML read while looking for a declared icon. */
const MAX_PAGE_BYTES = 128 * 1024

/** How long a site's answer is reused. */
const TTL_MS = 60 * 60 * 1000

/** How long a refusal is remembered, so a missing logo is not retried per paint. */
const FAILURE_TTL_MS = 5 * 60 * 1000

/** How many origins are remembered at once. */
const MAX_ENTRIES = 32

/** How many redirects one lookup follows before giving up. */
const MAX_HOPS = 3

/** Deadline for one request, resolution included. */
const REQUEST_TIMEOUT_MS = 5000

/**
 * What this lookup calls itself. A neutral product token: sites and their CDNs
 * answer an unidentified client with 403 often enough that naming the request
 * matters, and this says what it is for.
 */
const USER_AGENT = 'Mozilla/5.0 (compatible; DSH-SidebarTools-Favicon/1.0)'

/** One image, as it was received. */
export interface FaviconAsset {
  readonly body: Buffer
  readonly contentType: string
}

/** One response, as this module needs it. */
export interface FaviconResponse {
  readonly status: number
  readonly location: string | null
  readonly contentType: string | null
  readonly body: Buffer
}

/**
 * One guarded GET, injected so a spec can drive the lookup without a socket.
 * @param url - the absolute address to fetch.
 * @param accept - what this caller is willing to receive.
 * @param origin - the origin the reader opened, which may be private.
 * @param cap - the byte ceiling for this response.
 * @returns the response, or undefined when the site refused or failed.
 */
export type FaviconRequest = (
  url: string,
  accept: string,
  origin: string,
  cap: number,
) => Promise<FaviconResponse | undefined>

/**
 * Read the origin a favicon request names, or nothing when it is not one.
 * @param value - the raw query value.
 * @returns the origin, which is all a caller may ask for.
 */
export function readFaviconOrigin(value: string | null): string | undefined {
  if (value === null || value.length === 0 || value.length > MAX_ORIGIN_LENGTH) return undefined
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  if (parsed.username !== '' || parsed.password !== '') return undefined
  // An origin and nothing else: no path, no query, no fragment.
  if (parsed.origin !== value) return undefined
  return parsed.origin
}

/**
 * Whether a hostname is textually a private or loopback name.
 *
 * A cheap first filter only: it cannot see where a name resolves, which is why
 * {@link resolveForConnection} checks the addresses again before any socket opens.
 * @param host - the hostname to judge.
 * @returns true when the host is private, loopback, or link-local by name.
 */
export function isPrivateHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local')) return true
  return isIP(name) !== 0 && !isPublicAddress(name)
}

/**
 * Whether an address is one this host is willing to open a socket to.
 *
 * Private, loopback, link-local, carrier-grade NAT, documentation, benchmark,
 * multicast, and reserved ranges are all refused — the cloud metadata service
 * lives in link-local, and a logo lookup has no business reaching any of them.
 * @param address - an IPv4 or IPv6 address, as DNS or a literal reports it.
 * @returns true when the address is publicly routable.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false
    if (a === 203 && b === 0 && c === 113) return false
    if (a >= 224) return false
    return true
  }
  if (family === 6) {
    const lower = address.toLowerCase()
    if (lower === '::' || lower === '::1') return false
    // An IPv4-mapped or NAT64 address carries an IPv4 address inside it.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped !== null) return isPublicAddress(mapped[1] ?? '')
    if (/^fe[89ab]/.test(lower)) return false
    if (lower.startsWith('fc') || lower.startsWith('fd')) return false
    if (lower.startsWith('ff')) return false
    return true
  }
  return false
}

/**
 * Resolve a name to the address the socket must use.
 *
 * Every answer has to be acceptable, not merely one of them: a public name that
 * also resolves inside the reader's network is exactly the rebinding this check
 * exists to stop, and the answer returned here is the one the socket is pinned
 * to, so a later change of the zone cannot move the connection.
 * @param hostname - the name from the address being fetched.
 * @param allowPrivate - true for the origin the reader opened themselves.
 * @returns the address and its family.
 * @throws when the name does not resolve or any answer is not public.
 */
export async function resolveForConnection(
  hostname: string,
  allowPrivate: boolean,
): Promise<{ address: string; family: number }> {
  const literal = isIP(hostname)
  if (literal !== 0) {
    if (!allowPrivate && !isPublicAddress(hostname)) throw new Error('favicon: non-public address')
    return { address: hostname, family: literal }
  }
  const answers = await resolveName(hostname, { all: true, verbatim: true })
  if (answers.length === 0) throw new Error('favicon: unresolvable host')
  for (const answer of answers) {
    if (!allowPrivate && !isPublicAddress(answer.address)) throw new Error('favicon: non-public address')
  }
  const chosen = answers[0]
  if (chosen === undefined) throw new Error('favicon: unresolvable host')
  return { address: chosen.address, family: chosen.family }
}

/**
 * The bytes an icon format starts with, for hosts that mislabel them.
 * @param body - the bytes received.
 * @returns an image content type, or undefined when this is not an image.
 */
export function sniffImage(body: Buffer): string | undefined {
  const head = body.subarray(0, 5).toString('latin1').toLowerCase()
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'image/svg+xml'
  if (body[0] === 0x00 && body[1] === 0x00 && body[2] === 0x01 && body[3] === 0x00) return 'image/x-icon'
  if (body[0] === 0x89 && body[1] === 0x50) return 'image/png'
  if (body[0] === 0x47 && body[1] === 0x49 && body[2] === 0x46) return 'image/gif'
  if (body[0] === 0xff && body[1] === 0xd8) return 'image/jpeg'
  if (body[0] === 0x42 && body[1] === 0x4d) return 'image/bmp'
  if (body.subarray(0, 4).toString('latin1') === 'RIFF') return 'image/webp'
  return undefined
}

/**
 * One GET whose socket is pinned to a checked address.
 * @param url - the absolute address to fetch.
 * @param accept - what this caller is willing to receive.
 * @param origin - the origin the reader opened, which may be private.
 * @param cap - the byte ceiling for this response.
 * @returns the response, or undefined when the site refused or failed.
 */
export const pinnedRequest: FaviconRequest = async (url, accept, origin, cap) => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  const secure = parsed.protocol === 'https:'
  if (!secure && parsed.protocol !== 'http:') return undefined
  let target: { address: string; family: number }
  try {
    target = await resolveForConnection(parsed.hostname, parsed.origin === origin)
  } catch {
    // An unresolvable name, or one that resolves anywhere private, is a refusal.
    return undefined
  }
  return await new Promise<FaviconResponse | undefined>((resolve) => {
    const send = secure ? secureRequest : insecureRequest
    const options = {
      hostname: parsed.hostname,
      port: parsed.port === '' ? undefined : Number(parsed.port),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: { accept, 'user-agent': USER_AGENT, 'accept-language': 'en' },
      // The socket opens to the address that was checked. The name still rides
      // in the Host header and the TLS SNI, so a public certificate is required.
      lookup: (_host: string, _options: object, callback: (error: Error | null, address: string, family: number) => void): void => {
        callback(null, target.address, target.family)
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    } as RequestOptions
    const request = send(options, (response) => {
      const chunks: Buffer[] = []
      let total = 0
      response.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > cap) {
          response.destroy()
          resolve(undefined)
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          location: typeof response.headers.location === 'string' ? response.headers.location : null,
          contentType: typeof response.headers['content-type'] === 'string' ? response.headers['content-type'] : null,
          body: Buffer.concat(chunks),
        })
      })
      response.on('error', () => { resolve(undefined) })
    })
    request.on('error', () => { resolve(undefined) })
    request.end()
  })
}

/**
 * Every icon a page declares, in the order it should be tried.
 *
 * Plain `icon` links come first, then the touch icons a page keeps for mobile;
 * a `mask-icon` is a monochrome silhouette, so it is tried last. Hrefs are
 * resolved against the page and de-duplicated.
 * @param html - the page source.
 * @param pageUrl - the page's own address, which relative hrefs resolve against.
 * @returns absolute icon addresses.
 */
export function iconCandidates(html: string, pageUrl: string): string[] {
  /** Rank: icons first, apple touch icons next, everything else last. */
  const rank = (rel: string): number => {
    const tokens = rel.toLowerCase().split(/\s+/)
    if (tokens.includes('icon')) return tokens.includes('mask-icon') ? 2 : 0
    if (tokens.some(token => token.startsWith('apple-touch-icon'))) return 1
    return 3
  }
  const found: { url: string; rank: number; at: number }[] = []
  const seen = new Set<string>()
  for (const [at, tag] of [...html.matchAll(/<link\b[^>]*>/gi)].entries()) {
    const attributes = new Map<string, string>()
    for (const match of tag[0].matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attributes.set((match[1] ?? '').toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '')
    }
    const rel = attributes.get('rel') ?? ''
    const href = attributes.get('href') ?? ''
    if (href === '' || !/icon/i.test(rel)) continue
    let url: string
    try {
      url = new URL(href, pageUrl).href
    } catch {
      // A href no URL parser accepts is not an icon this lookup can fetch.
      continue
    }
    if (!url.startsWith('http:') && !url.startsWith('https:')) continue
    if (seen.has(url)) continue
    seen.add(url)
    found.push({ url, rank: rank(rel), at })
  }
  return found
    .sort((left, right) => left.rank - right.rank || left.at - right.at)
    .map(entry => entry.url)
}

/** One cached answer: the asset, or the moment a refusal may be forgotten. */
interface Entry {
  readonly asset: FaviconAsset | undefined
  readonly at: number
}

/**
 * The logo cache, one entry per origin.
 */
export class FaviconCache {
  private readonly entries = new Map<string, Entry>()

  /**
   * @param request - the guarded GET to use, injected so a spec can drive it.
   */
  constructor(private readonly request: FaviconRequest = pinnedRequest) {}

  /**
   * The logo of one origin, from the cache or looked up once.
   * @param origin - an http(s) origin the pane accepted.
   * @returns the asset, or undefined when the site has no usable one.
   */
  async of(origin: string): Promise<FaviconAsset | undefined> {
    const cached = this.entries.get(origin)
    const ttl = cached?.asset === undefined ? FAILURE_TTL_MS : TTL_MS
    if (cached !== undefined && Date.now() - cached.at < ttl) return cached.asset
    const asset = await this.lookUp(origin)
    this.remember(origin, asset)
    return asset
  }

  /**
   * Try the well-known paths, then whatever the page declares.
   * @param origin - the origin to look up.
   * @returns the first usable image, or undefined.
   */
  private async lookUp(origin: string): Promise<FaviconAsset | undefined> {
    const tried = new Set<string>()
    for (const candidate of [`${origin}/favicon.ico`, `${origin}/favicon.png`, `${origin}/apple-touch-icon.png`]) {
      tried.add(candidate)
      const asset = await this.fetchImage(candidate, origin)
      if (asset !== undefined) return asset
    }
    const page = await this.fetchPage(`${origin}/`)
    if (page === undefined) return undefined
    for (const candidate of iconCandidates(page.html, page.url)) {
      if (tried.has(candidate)) continue
      tried.add(candidate)
      const asset = await this.fetchImage(candidate, origin)
      if (asset !== undefined) return asset
    }
    return undefined
  }

  /**
   * Fetch one image under every limit above.
   * @param url - the image to fetch.
   * @param origin - the origin the reader opened, which same-host icons share.
   * @returns the asset, or undefined.
   */
  private async fetchImage(url: string, origin: string): Promise<FaviconAsset | undefined> {
    const response = await this.follow(url, 'image/*,image/webp,*/*;q=0.8', origin, MAX_IMAGE_BYTES)
    if (response === undefined) return undefined
    const declared = (response.contentType ?? '').split(';')[0]?.trim() ?? ''
    // A host that mislabels its icon still gets its logo shown: the bytes decide,
    // and only image bytes are ever accepted.
    const contentType = declared.toLowerCase().startsWith('image/') ? declared : sniffImage(response.body)
    return contentType === undefined || response.body.byteLength === 0
      ? undefined
      : { body: response.body, contentType }
  }

  /**
   * Fetch the page itself, only to read which icons it declares.
   * @param url - the page address.
   * @returns the source and its final address, or undefined.
   */
  private async fetchPage(url: string): Promise<{ html: string; url: string } | undefined> {
    const response = await this.follow(url, 'text/html,application/xhtml+xml', url, MAX_PAGE_BYTES)
    if (response === undefined) return undefined
    if (!(response.contentType ?? '').toLowerCase().includes('text/html')) return undefined
    return { html: response.body.toString('utf8'), url }
  }

  /**
   * Follow at most {@link MAX_HOPS} redirects, each one re-checked from scratch.
   * @param url - the first address to fetch.
   * @param accept - what this caller is willing to receive.
   * @param origin - the origin the reader opened, exempt from the private check.
   * @param cap - the byte ceiling for this response.
   * @returns the final response, or undefined.
   */
  private async follow(url: string, accept: string, origin: string, cap: number): Promise<FaviconResponse | undefined> {
    let target = url
    for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
      let parsed: URL
      try {
        parsed = new URL(target)
      } catch {
        return undefined
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
      // Cheap textual filter first; the request itself re-checks the resolved
      // addresses of every hop before a socket opens.
      if (parsed.origin !== origin && isPrivateHost(parsed.hostname)) return undefined
      const response = await this.request(parsed.href, accept, origin, cap)
      if (response === undefined) return undefined
      if (response.status >= 300 && response.status < 400) {
        if (response.location === null) return undefined
        target = new URL(response.location, parsed).href
        continue
      }
      return response.status >= 200 && response.status < 300 ? response : undefined
    }
    return undefined
  }

  /**
   * Remember one answer, keeping the cache bounded.
   * @param origin - the origin asked about.
   * @param asset - what the site answered.
   */
  private remember(origin: string, asset: FaviconAsset | undefined): void {
    this.entries.delete(origin)
    this.entries.set(origin, { asset, at: Date.now() })
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }
}