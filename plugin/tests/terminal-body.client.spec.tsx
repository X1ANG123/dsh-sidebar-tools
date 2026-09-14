// @vitest-environment jsdom
/**
 * The terminal body over a real store and a scripted transport: it opens one
 * terminal with the measured grid, draws the frames it is given, forwards keys,
 * and says what happened when the shell goes away.
 */
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { TerminalBody, type TerminalBodyProps } from '../src/client/terminal/TerminalBody.tsx'
import { TerminalTitle, type TerminalTitleProps } from '../src/client/terminal/TerminalTitle.tsx'
import type { TerminalFaceHandlers } from '../src/client/terminal/face.ts'
import { createTerminalStore } from '../src/client/terminal/store.ts'
import { zh } from '../src/client/locales.ts'
import type { TerminalModeChoice } from '../src/shared.ts'

afterEach(cleanup)

const SESSION = 's-test'
const TAB = 'tab-1'
const TERMINAL = 'a'.repeat(32)

/** A selector hook bound to one store instance, as the framework binds it. */
function hookOf(instance: { subscribe: (fn: () => void) => () => void; getSnapshot: () => unknown }) {
  return function useSelector<S>(select: (state: never) => S): S {
    return select(useSyncExternalStore(instance.subscribe, instance.getSnapshot) as never)
  }
}

/**
 * Mount-ready props over one store instance and a recording transport.
 * @param cwd - the session's workspace; `null` for a session without one.
 * @returns the props plus the hands a spec inspects.
 */
function harness(cwd: string | null = '/work') {
  const instance = createTerminalStore().create()
  const controller = new AbortController()
  const calls: TerminalFaceHandlers[] = []
  const openTerminal = vi.fn((
    _tab: string,
    _session: string,
    _cols: number,
    _rows: number,
    handlers: TerminalFaceHandlers,
    _mode?: TerminalModeChoice,
  ) => {
    calls.push(handlers)
  })
  const sendInput = vi.fn(async () => { /* accepted by default */ })
  const signalTerminal = vi.fn()
  const closeTerminal = vi.fn()
  const sessions = { byId: cwd === null ? {} : { [SESSION]: { cwd } } }
  const shared = {
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'pane-1' },
      tab: {
        id: TAB,
        kind: 'terminal',
        contentId: 'terminal',
        title: zh['terminal.title'],
        visible: true,
        navigation: { address: 'terminal', params: undefined, revision: 1 },
        signal: controller.signal,
        actions: { openResource: vi.fn(), openTab: vi.fn(), close: vi.fn() },
      },
    }),
    sessionId: SESSION,
    useSessions: <S,>(select: (state: typeof sessions) => S): S => select(sessions),
    useStore: hookOf(instance),
    actions: instance.actions,
    openTerminal,
    sendInput,
    signalTerminal,
    closeTerminal,
    t: makeTranslate(zh),
  }
  return {
    shared,
    controller,
    openTerminal,
    sendInput,
    closeTerminal,
    /** The handlers the body handed the transport, once it opened one. */
    handlers: (): TerminalFaceHandlers | undefined => calls[0],
  }
}

describe('TerminalBody', () => {
  it('opens exactly one terminal, with the bounds it measured', () => {
    const test = harness()
    render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    expect(test.openTerminal).toHaveBeenCalledTimes(1)
    const [tab, session, cols, rows] = test.openTerminal.mock.calls[0] ?? []
    expect(tab).toBe(TAB)
    expect(session).toBe(SESSION)
    expect(cols).toBeGreaterThanOrEqual(20)
    expect(rows).toBeGreaterThanOrEqual(5)
    expect(screen.getByText(zh['terminal.starting'])).toBeDefined()
  })

  it('opens nothing when the session has no workspace', () => {
    const test = harness(null)
    render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    expect(test.openTerminal).not.toHaveBeenCalled()
  })

  it('draws the frames it is given, with the confinement it was told', () => {
    const test = harness()
    render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    act(() => {
      test.handlers()?.opened(TERMINAL, { mode: 'workspace-write', enforcement: 'partial', workspaceRoot: '/work' })
    })
    act(() => {
      test.handlers()?.frame({
        kind: 'screen', seq: 1, rows: ['hello world'], cursor: { x: 11, y: 0, visible: true }, alt: false, base: 0,
      })
    })
    expect(screen.getByRole('log').textContent).toContain('hello world')
    expect(screen.getByText(/workspace-write/)).toBeDefined()
    expect(screen.getByText(/partial|部分/)).toBeDefined()
  })

  it('gives the keyboard back on a click but leaves a drag-selection alone', () => {
    const test = harness()
    render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    act(() => { test.handlers()?.opened(TERMINAL, { mode: 'workspace-write', enforcement: 'full', workspaceRoot: '/work' }) })
    const grid = screen.getByRole('log')
    const sink = screen.getByLabelText(zh['terminal.input'])

    sink.blur()
    fireEvent.mouseUp(grid)
    expect(document.activeElement).toBe(sink)

    // Selecting terminal text must survive the click that made the selection.
    sink.blur()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(grid)
    selection?.removeAllRanges()
    selection?.addRange(range)
    expect(selection?.isCollapsed).toBe(false)
    fireEvent.mouseUp(grid)
    expect(document.activeElement).not.toBe(sink)
    selection?.removeAllRanges()
  })

  it('copies the retained output, so an error can be pasted out', async () => {
    const test = harness()
    render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    act(() => { test.handlers()?.opened(TERMINAL, { mode: 'workspace-write', enforcement: 'full', workspaceRoot: '/work' }) })
    act(() => {
      test.handlers()?.frame({
        kind: 'screen', seq: 1, rows: ['boom: it broke'], cursor: { x: 0, y: 0, visible: true }, alt: false, base: 0,
      })
    })
    let copied = ''
    // The async Clipboard API is the path a real browser takes; intercept it.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async (text: string) => { copied = text }) },
    })
    fireEvent.click(screen.getByRole('button', { name: zh['terminal.copy'] }))
    await act(async () => { await Promise.resolve() })
    expect(copied).toContain('boom: it broke')
  })

  it('keeps Control+C as the interrupt until terminal text is selected', () => {
    const test = harness()
    render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    act(() => { test.handlers()?.opened(TERMINAL, { mode: 'workspace-write', enforcement: 'full', workspaceRoot: '/work' }) })
    act(() => {
      test.handlers()?.frame({
        kind: 'screen', seq: 1, rows: ['selected text'], cursor: { x: 0, y: 0, visible: true }, alt: false, base: 0,
      })
    })
    const sink = screen.getByLabelText(zh['terminal.input'])
    fireEvent.keyDown(sink, { key: 'c', ctrlKey: true })
    expect(test.sendInput).toHaveBeenCalledWith(TAB, TERMINAL, '\u0003')

    // With a selection inside the terminal, the same chord belongs to the browser.
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(screen.getByRole('log'))
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.keyDown(sink, { key: 'c', ctrlKey: true })
    expect(test.sendInput).toHaveBeenCalledTimes(1)
    selection?.removeAllRanges()
  })

  it('keeps the output that scrolled off the screen above the live screen', () => {
    const test = harness()
    render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    act(() => { test.handlers()?.opened(TERMINAL, { mode: 'workspace-write', enforcement: 'full', workspaceRoot: '/work' }) })
    act(() => {
      test.handlers()?.frame({
        kind: 'screen', seq: 1, rows: ['first', 'second'], cursor: { x: 0, y: 1, visible: true }, alt: false, base: 0,
      })
    })
    act(() => {
      test.handlers()?.frame({
        kind: 'screen', seq: 2, rows: ['second', 'third'], cursor: { x: 0, y: 1, visible: true }, alt: false, base: 1,
      })
    })
    const log = screen.getByRole('log')
    // The line that left the screen is still in the pane, above the live ones.
    expect(log.textContent).toContain('first')
    expect(log.textContent).toContain('third')
    expect(log.querySelectorAll('[data-terminal-history]')).toHaveLength(1)
  })

  it('forwards keystrokes as terminal bytes', () => {
    const test = harness()
    render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    act(() => { test.handlers()?.opened(TERMINAL, { mode: 'workspace-write', enforcement: 'full', workspaceRoot: '/work' }) })
    const sink = screen.getByLabelText(zh['terminal.input'])
    fireEvent.keyDown(sink, { key: 'a' })
    fireEvent.keyDown(sink, { key: 'Enter' })
    fireEvent.keyDown(sink, { key: 'c', ctrlKey: true })
    expect(test.sendInput.mock.calls).toEqual([
      [TAB, TERMINAL, 'a'],
      [TAB, TERMINAL, '\r'],
      [TAB, TERMINAL, '\u0003'],
    ])
    // A key the browser owns is never swallowed.
    fireEvent.keyDown(sink, { key: 'r', ctrlKey: true, shiftKey: true })
    expect(test.sendInput).toHaveBeenCalledTimes(3)
  })

  it('reopens under the confinement the picker asks for', () => {
    const test = harness()
    render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    act(() => { test.handlers()?.opened(TERMINAL, { mode: 'workspace-write', enforcement: 'partial', workspaceRoot: '/work' }) })
    const picker = screen.getByRole('button', {
      name: zh['terminal.modeCycle'].replace('{mode}', zh['terminal.modeDefault']),
    })
    fireEvent.click(picker)
    // A mode change is a new shell: the old one was confined at spawn.
    expect(test.closeTerminal).toHaveBeenCalledWith(TAB, TERMINAL)
    expect(test.openTerminal).toHaveBeenCalledTimes(2)
    expect(test.openTerminal.mock.calls[1]?.[5]).toBe('read-only')
  })

  it('takes the keyboard as soon as it is the visible tab', () => {
    const test = harness()
    render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    act(() => { test.handlers()?.opened(TERMINAL, { mode: 'workspace-write', enforcement: 'full', workspaceRoot: '/work' }) })
    // Without this the pane would look live and swallow every keystroke.
    expect(document.activeElement).toBe(screen.getByLabelText(zh['terminal.input']))
  })

  it('says so when the host refuses a keystroke, instead of looking dead', async () => {
    const test = harness()
    test.sendInput.mockRejectedValueOnce(new Error('bad-request'))
    render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    act(() => { test.handlers()?.opened(TERMINAL, { mode: 'workspace-write', enforcement: 'full', workspaceRoot: '/work' }) })
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText(zh['terminal.input']), { key: 'a' })
      // The refusal arrives on a microtask; act flushes it with the write.
      await Promise.resolve()
    })
    expect(screen.getByText(zh['error.inputRejected'])).toBeDefined()
  })

  it('says why a terminal could not start, in the pane’s own words', () => {
    const test = harness()
    const view = render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    act(() => { test.handlers()?.failed('sandbox-unavailable', 'no provider') })
    expect(screen.getByText(zh['error.sandboxUnavailable'])).toBeDefined()
    expect(view.container.querySelector('[data-terminal-screen]')).toBeNull()
  })

  it('reports the shell’s exit and offers another one', () => {
    const test = harness()
    render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    act(() => { test.handlers()?.opened(TERMINAL, { mode: 'workspace-write', enforcement: 'full', workspaceRoot: '/work' }) })
    act(() => {
      test.handlers()?.status({ kind: 'status', status: { kind: 'exited', exitCode: 0, signal: null } })
    })
    expect(screen.getByText(zh['terminal.exited'].replace('{code}', '0'))).toBeDefined()
    // The chip follows the shell, which the record captured at open time cannot.
    render(<TerminalTitle {...test.shared as unknown as TerminalTitleProps} />)
    expect(screen.getByText(zh['terminal.titleExited'])).toBeDefined()
  })

  it('closes its terminal when the tab record goes away', () => {
    const test = harness()
    render(<TerminalBody {...test.shared as unknown as TerminalBodyProps} />)
    act(() => { test.handlers()?.opened(TERMINAL, { mode: 'workspace-write', enforcement: 'full', workspaceRoot: '/work' }) })
    // The record's signal is the tab's lifetime: a hidden or unmounted pane
    // keeps its shell, exactly as a Session switch keeps its surface.
    test.controller.abort()
    expect(test.closeTerminal).toHaveBeenCalledWith(TAB, TERMINAL)
  })
})
