/**
 * The pane grammar as CSS text. These declarations were lifted from
 * `ui-sidebar-files` so both panes compute one style; the assertions below are
 * what keeps the lift honest — a pane that drifts back to its own padding, type
 * scale, or literal color fails here rather than in a screenshot nobody reads.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/Pane.module.css', import.meta.url)), 'utf8')

/**
 * One rule's declarations.
 * @param selector - the class selector, without its dot.
 * @returns the declaration block's text.
 */
function rule(selector: string): string {
  const match = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`).exec(css)
  if (match === null) throw new Error(`Pane.module.css has no .${selector} rule`)
  return match[1] ?? ''
}

describe('Pane.module.css', () => {
  it('sizes the body as a scrolling column of the panel', () => {
    const body = rule('body')
    expect(body).toContain('display: flex')
    expect(body).toContain('flex: 1 1 auto')
    expect(body).toContain('flex-direction: column')
    expect(body).toContain('min-height: 0')
    expect(body).toContain('overflow: auto')
    expect(body).toContain('padding: 4px 0 8px')
    expect(body).toContain('font-size: var(--dsh-content-font-size-secondary, 13px)')
    expect(body).toContain('line-height: 1.5')
  })

  it('lets content own its scrolling without restating the body', () => {
    expect(rule('noScroll')).toContain('overflow: hidden')
  })

  it('lays the header row out with the panel’s spacing and label tone', () => {
    const header = rule('header')
    expect(header).toContain('gap: 6px')
    expect(header).toContain('align-items: center')
    expect(header).toContain('padding: 4px 10px')
    expect(header).toContain('color: var(--dsw-alias-label-secondary)')
    expect(header).toContain('font-weight: 500')
  })

  it('gives the icon control the 24px square geometry and the hover surface', () => {
    const button = rule('iconButton')
    expect(button).toContain('width: 24px')
    expect(button).toContain('height: 24px')
    expect(button).toContain('border-radius: 6px')
    expect(button).toContain('background: transparent')
    expect(button).toContain('border: 0')
    expect(css).toContain('.iconButton:hover:not(:disabled)')
    expect(css).toContain('background: var(--dsw-alias-interactive-bg-hover)')
  })

  it('draws the blocked state and its lines through tokens only', () => {
    expect(rule('status')).toContain('padding: 12px 10px')
    const line = rule('statusLine')
    expect(line).toContain('color: var(--dsw-alias-label-secondary)')
    expect(line).toContain('font-size: var(--dsh-content-font-size-secondary, 13px)')
    expect(line).toContain('line-height: 1.6')
  })

  it('carries no literal color, so both themes come from the theme owner', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\brgba?\(/)
    expect(css).not.toMatch(/\bhsla?\(/)
  })
})
