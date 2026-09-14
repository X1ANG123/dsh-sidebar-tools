// @vitest-environment jsdom
/**
 * The pane parts' behavior: structure, accessible names, attribute
 * passthrough, and the control's interaction. Presentation lives in
 * `pane-styles.client.spec.ts`, which reads the stylesheet.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaneBody, PaneHeader, PaneIconButton, PaneStatus, PaneStatusLine } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

describe('PaneBody', () => {
  it('renders its content and passes data attributes through', () => {
    render(<PaneBody data-pane-state="tree" data-pane-root="/w"><span>content</span></PaneBody>)
    const body = screen.getByText('content').parentElement as HTMLElement
    expect(body.tagName).toBe('DIV')
    expect(body.getAttribute('data-pane-state')).toBe('tree')
    expect(body.getAttribute('data-pane-root')).toBe('/w')
  })

  it('carries the call site class alongside its own', () => {
    render(<PaneBody className="mine">x</PaneBody>)
    expect(screen.getByText('x').classList.contains('mine')).toBe(true)
  })
})

describe('PaneHeader', () => {
  it('is the body row that holds a title and its controls', () => {
    render(<PaneHeader><span>title</span><PaneIconButton label="Reload" /></PaneHeader>)
    const header = screen.getByText('title').parentElement as HTMLElement
    expect(header.tagName).toBe('DIV')
    expect(header.querySelector('button')).not.toBeNull()
  })
})

describe('PaneIconButton', () => {
  it('takes its accessible name and tooltip from one required label', () => {
    render(<PaneIconButton label="Reload" />)
    const button = screen.getByRole('button', { name: 'Reload' })
    expect(button.getAttribute('title')).toBe('Reload')
  })

  it('lets a call site suppress the native tooltip', () => {
    render(<PaneIconButton label="Reload" title="" />)
    expect(screen.getByRole('button', { name: 'Reload' }).getAttribute('title')).toBe('')
  })

  it('forwards clicks, data attributes, and the disabled state', () => {
    const onClick = vi.fn()
    render(<PaneIconButton label="Reload" data-pane-reload="" onClick={onClick}>icon</PaneIconButton>)
    const button = screen.getByRole('button', { name: 'Reload' })
    expect(button.getAttribute('data-pane-reload')).toBe('')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    cleanup()
    render(<PaneIconButton label="Reload" disabled onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('PaneStatus', () => {
  it('renders its lines inside one blocked-state block', () => {
    render(
      <PaneStatus data-pane-status="no-workspace">
        <PaneStatusLine>No workspace</PaneStatusLine>
        <PaneStatusLine>Pick one first</PaneStatusLine>
      </PaneStatus>
    )
    const status = screen.getByText('No workspace').parentElement as HTMLElement
    expect(status.getAttribute('data-pane-status')).toBe('no-workspace')
    expect(status.querySelectorAll('p')).toHaveLength(2)
  })
})
