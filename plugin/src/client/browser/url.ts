/**
 * What the browser pane is allowed to load, and what it must refuse.
 *
 * The pane embeds third-party pages, so the policy is a closed list: http and
 * https only, no embedded credentials, nothing longer than a sane address, and
 * never this interface's own origin — a frame of the app inside the app would
 * be the one case where a sandboxed document could reach the app's own APIs.
 */

/** Why an address was refused. */
export type AddressProblem =
  | 'empty'
  | 'unsupported'
  | 'credentials'
  | 'same-origin'
  | 'too-long'

/** Either a loadable address, or the reason there is none. */
export type AddressResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly problem: AddressProblem }

/** Longest address the pane accepts. */
const MAX_ADDRESS_LENGTH = 2048

/** Schemes a frame may load; everything else is refused by name. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

/**
 * Schemes that name themselves without an authority, so a bare `host:port` is
 * never mistaken for one. They are refused by {@link ALLOWED_SCHEMES} anyway;
 * this pattern exists so `localhost:5173` stays an address.
 */
const NAMED_SCHEME = /^(?:javascript|data|blob|file|about|chrome|view-source|ftp|mailto|tel|ws|wss):/i

/** A scheme written with an authority, which is how an explicit address opens. */
const SCHEME_WITH_AUTHORITY = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//

/**
 * Whether a host is a local address that should default to plain http.
 * @param host - the parsed hostname.
 * @returns true for loopback names and hosts without a dot.
 */
function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || !host.includes('.')
}

/**
 * Turn what a person typed into an address this pane may load.
 * @param input - the raw text.
 * @param pageOrigin - this interface's own origin, which is never embeddable.
 * @returns the address to load, or the problem with it.
 */
export function normalizeAddress(input: string, pageOrigin: string): AddressResult {
  const text = input.trim()
  if (text === '') return { ok: false, problem: 'empty' }
  if (text.length > MAX_ADDRESS_LENGTH) return { ok: false, problem: 'too-long' }
  let candidate = text
  if (!SCHEME_WITH_AUTHORITY.test(candidate) && !NAMED_SCHEME.test(candidate)) {
    // No scheme: a bare host, or a host:port like `localhost:5173`.
    const host = candidate.split(/[/?#]/, 1)[0] ?? ''
    candidate = `${isLocalHost(host.split(':', 1)[0] ?? host) ? 'http' : 'https'}://${candidate}`
  }
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    // Swallows the parse error: an unparsable address has exactly one meaning.
    return { ok: false, problem: 'unsupported' }
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) return { ok: false, problem: 'unsupported' }
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, problem: 'credentials' }
  if (pageOrigin !== '' && parsed.origin === pageOrigin) return { ok: false, problem: 'same-origin' }
  return { ok: true, url: parsed.href }
}

/** Where a phrase goes when it is not an address; `{query}` is the slot. */
export const DEFAULT_SEARCH_URL = 'https://duckduckgo.com/?q={query}'

/** Names that mean this machine, so a bare word for one stays an address. */
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Whether one bare word is a phrase rather than a host. A word with no dot,
 * port, or slash is what a search box is for; the loopback names, a `host:port`,
 * and anything with a dot stay addresses.
 * @param text - the trimmed input.
 * @returns true when the word should be searched for.
 */
function isBareWord(text: string): boolean {
  return /^[^\s./:]+$/.test(text) && !LOOPBACK_NAMES.has(text.toLowerCase())
}

/**
 * Turn what a person typed into something the pane can load: an address when it
 * is one, a search for the phrase otherwise. A refusal that names a scheme, a
 * credential, or this interface's own origin stays a refusal — a phrase is the
 * only input that becomes a query.
 * @param input - the raw text.
 * @param pageOrigin - this interface's own origin, which is never embeddable.
 * @param searchUrl - a search template carrying the `{query}` slot.
 * @returns the address to load, or the problem with it.
 */
export function resolveAddress(
  input: string,
  pageOrigin: string,
  searchUrl: string = DEFAULT_SEARCH_URL,
): AddressResult {
  const direct = normalizeAddress(input, pageOrigin)
  if (direct.ok && !isBareWord(input.trim())) return direct
  if (!direct.ok && direct.problem !== 'unsupported') return direct
  const text = input.trim()
  // An explicit scheme is a mistyped address, not a query: `javascript:…` must
  // never come back as a search for its own text.
  if (NAMED_SCHEME.test(text) || SCHEME_WITH_AUTHORITY.test(text)) return direct
  return { ok: true, url: searchUrl.replace('{query}', encodeURIComponent(text)) }
}
