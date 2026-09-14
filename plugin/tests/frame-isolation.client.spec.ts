/**
 * The frame-isolation guard. The embedded page is the one document in this
 * interface that a third party controls, so what the pane grants it is asserted
 * from the source: the sandbox constant, the feature denials, and the absence of
 * any message bridge are all things a later edit could quietly undo.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/client/browser/BrowserBody.tsx', import.meta.url), 'utf8')

/**
 * The module's code with its prose removed: a source scan must judge what the
 * component does, not what its comments say about it.
 * @returns the source without block or line comments.
 */
function code(): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** The sandbox constant as the source declares it. */
function sandbox(): string {
  return /const FRAME_SANDBOX = '([^']*)'/.exec(source)?.[1] ?? ''
}

describe('the embedded frame', () => {
  it('grants the site its own origin, forms, scripts, and popups', () => {
    // Nothing less than this is usable: an opaque-origin document throws on
    // storage access and sends `Origin: null`, which every site's own API
    // refuses, so the pane would only ever draw a static shell. Popups are
    // granted because a page's links are the page's business.
    expect(sandbox()).toBe('allow-forms allow-scripts allow-same-origin allow-popups')
  })

  it('never lets a frame or its popup escape the sandbox', () => {
    for (const capability of [
      'allow-popups-to-escape-sandbox', 'allow-top-navigation',
      'allow-top-navigation-by-user-activation', 'allow-modals', 'allow-downloads', 'allow-presentation',
    ]) {
      expect(sandbox(), capability).not.toContain(capability)
    }
  })

  it('still refuses this interface’s own origin as an address', () => {
    // With the site's own origin granted, the pane's refusal to frame us is the
    // second half of the pair: the web server refuses to be framed at all.
    expect(code()).toContain('resolveAddress(state.draft, window.location.origin)')
  })

  it('falls back to an opaque origin where isolation is unavailable', () => {
    // No cookie reaches a framed site either way: an engine without
    // credential-less support gets the sandbox that keeps no storage at all.
    expect(/const FRAME_SANDBOX_STRICT = '([^']*)'/.exec(source)?.[1]).toBe('allow-forms allow-scripts')
    expect(code()).toContain('credentiallessSupported()')
  })

  it('asks for the credential-less frame attribute', () => {
    expect(source).toContain("credentialless: ''")
  })

  it('denies the powerful features a page may ask for', () => {
    expect(source).toContain("camera 'none'")
    expect(source).toContain("microphone 'none'")
    expect(source).toContain("geolocation 'none'")
    expect(source).toContain("clipboard-read 'none'")
    expect(source).toContain("usb 'none'")
    expect(source).toContain("serial 'none'")
  })

  it('sends no referrer to the embedded site', () => {
    expect(source).toContain('referrerPolicy="no-referrer"')
  })

  it('carries no message bridge in either direction', () => {
    expect(code()).not.toMatch(/postMessage/)
    expect(code()).not.toMatch(/addEventListener\(\s*'message'/)
    expect(code()).not.toMatch(/onMessage/)
  })

  it('opens an external link without handing over the opener', () => {
    expect(code()).toContain('target="_blank"')
    expect(code()).toContain('rel="noopener noreferrer"')
  })

  it('never renders remote content as markup', () => {
    expect(code()).not.toMatch(/dangerouslySetInnerHTML/)
    expect(code()).not.toMatch(/srcDoc/)
  })
})
