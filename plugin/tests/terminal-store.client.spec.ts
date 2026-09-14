/**
 * The terminal pane's store: what each frame, status, and failure does to a
 * tab's bucket — and that a bucket nobody started is never silently created.
 */
import { describe, expect, it } from 'vitest'
import { createTerminalStore } from '../src/client/terminal/store.ts'

const TAB = 'tab-1' as never

/**
 * One store instance, as the framework would mint one per session.
 * @returns the instance.
 */
function instance(): ReturnType<ReturnType<typeof createTerminalStore>['create']> {
  return createTerminalStore().create()
}

describe('terminal store', () => {
  it('starts one tab empty and forgets it on request', () => {
    const store = instance()
    store.actions.start(TAB)
    expect(store.getSnapshot().byTab[TAB]).toEqual({
      terminalId: undefined,
      sandbox: undefined,
      screen: undefined,
      status: undefined,
      failure: undefined,
      reconnecting: false,
      history: { lines: [], from: 0, screen: undefined },
    })
    store.actions.forget(TAB)
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('refuses to write into a bucket nobody started', () => {
    const store = instance()
    expect(() => { store.actions.frame(TAB, { kind: 'screen', seq: 1, rows: [], cursor: { x: 0, y: 0, visible: false }, alt: false, base: 0 }) })
      .toThrow(/no terminal state/)
  })

  it('records the published terminal and clears any earlier failure', () => {
    const store = instance()
    store.actions.start(TAB)
    store.actions.failed(TAB, { code: 'sandbox-unavailable', message: 'x' })
    store.actions.opened(TAB, 'a'.repeat(32), { mode: 'workspace-write', enforcement: 'partial', workspaceRoot: '/work' })
    const state = store.getSnapshot().byTab[TAB]
    expect(state?.terminalId).toBe('a'.repeat(32))
    expect(state?.sandbox?.mode).toBe('workspace-write')
    expect(state?.failure).toBeUndefined()
  })

  it('keeps the newest screen and the shell status', () => {
    const store = instance()
    store.actions.start(TAB)
    const first = { kind: 'screen' as const, seq: 1, rows: ['one'], cursor: { x: 0, y: 0, visible: true }, alt: false, base: 0 }
    const second = { kind: 'screen' as const, seq: 2, rows: ['two'], cursor: { x: 1, y: 0, visible: true }, alt: false, base: 1 }
    store.actions.frame(TAB, first)
    store.actions.frame(TAB, second)
    store.actions.status(TAB, { kind: 'exited', exitCode: 3, signal: null })
    const state = store.getSnapshot().byTab[TAB]
    expect(state?.screen?.rows).toEqual(['two'])
    expect(state?.screen?.alt).toBe(false)
    // The row that left the screen is retained, which is the pane's scrollback.
    expect(state?.history.lines).toEqual([{ text: 'one' }])
    expect(state?.status).toEqual({ kind: 'exited', exitCode: 3, signal: null })
  })

  it('tracks a reconnecting stream and a transport failure', () => {
    const store = instance()
    store.actions.start(TAB)
    store.actions.reconnecting(TAB, true)
    expect(store.getSnapshot().byTab[TAB]?.reconnecting).toBe(true)
    store.actions.failed(TAB, { code: 'transport', message: '' })
    expect(store.getSnapshot().byTab[TAB]?.failure).toEqual({ code: 'transport', message: '' })
  })

  it('remembers the confinement the pane asked for', () => {
    const store = instance()
    store.actions.start(TAB)
    expect(store.getSnapshot().byTab[TAB]?.mode).toBeUndefined()
    store.actions.mode(TAB, 'read-only')
    expect(store.getSnapshot().byTab[TAB]?.mode).toBe('read-only')
  })
})
