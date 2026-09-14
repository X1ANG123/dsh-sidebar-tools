/**
 * The browser pane's store: address bookkeeping, history stepping, and the two
 * pieces of state that only exist to warn the reader.
 */
import { describe, expect, it } from 'vitest'
import { createBrowserStore } from '../src/client/browser/store.ts'

const TAB = 'tab-1' as never

/**
 * One store instance, as the framework would mint one per session.
 * @returns the instance.
 */
function instance(): ReturnType<ReturnType<typeof createBrowserStore>['create']> {
  return createBrowserStore().create()
}

describe('browser store', () => {
  it('starts one tab empty and forgets it on request', () => {
    const store = instance()
    store.actions.start(TAB)
    expect(store.getSnapshot().byTab[TAB]).toMatchObject({ url: '', history: [], index: -1, hint: false })
    store.actions.forget(TAB)
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('keeps the address bar text separate from the loaded address', () => {
    const store = instance()
    store.actions.start(TAB)
    store.actions.draft(TAB, 'example.com')
    expect(store.getSnapshot().byTab[TAB]).toMatchObject({ draft: 'example.com', url: '' })
  })

  it('truncates the forward history when a new address is visited', () => {
    const store = instance()
    store.actions.start(TAB)
    store.actions.visited(TAB, 'https://a.test/')
    store.actions.visited(TAB, 'https://b.test/')
    store.actions.step(TAB, -1)
    store.actions.visited(TAB, 'https://c.test/')
    const state = store.getSnapshot().byTab[TAB]
    expect(state?.history).toEqual(['https://a.test/', 'https://c.test/'])
    expect(state?.index).toBe(1)
    expect(state?.url).toBe('https://c.test/')
  })

  it('steps only inside the history it has', () => {
    const store = instance()
    store.actions.start(TAB)
    store.actions.visited(TAB, 'https://a.test/')
    store.actions.step(TAB, -1)
    store.actions.step(TAB, 1)
    expect(store.getSnapshot().byTab[TAB]?.url).toBe('https://a.test/')
    store.actions.step(TAB, 5)
    expect(store.getSnapshot().byTab[TAB]?.url).toBe('https://a.test/')
  })

  it('records a refusal without losing the address being edited', () => {
    const store = instance()
    store.actions.start(TAB)
    store.actions.draft(TAB, 'javascript:alert(1)')
    store.actions.refused(TAB, 'unsupported')
    const state = store.getSnapshot().byTab[TAB]
    expect(state?.problem).toBe('unsupported')
    expect(state?.draft).toBe('javascript:alert(1)')
    expect(state?.url).toBe('')
  })

  it('reloads by nonce and clears the embed hint on every navigation', () => {
    const store = instance()
    store.actions.start(TAB)
    store.actions.visited(TAB, 'https://a.test/')
    store.actions.hint(TAB, true)
    store.actions.visited(TAB, 'https://b.test/')
    expect(store.getSnapshot().byTab[TAB]?.hint).toBe(false)
    const before = store.getSnapshot().byTab[TAB]?.nonce ?? -1
    store.actions.reload(TAB)
    expect(store.getSnapshot().byTab[TAB]?.nonce).toBe(before + 1)
  })

  it('refuses to write into a bucket nobody started', () => {
    const store = instance()
    expect(() => { store.actions.visited(TAB, 'https://a.test/') }).toThrow(/no browser state/)
  })
})
