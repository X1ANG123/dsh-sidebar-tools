/**
 * The two rules that decide what a GUI terminal may touch: a terminal is never
 * wider than the Session it was opened from, and a confined mode with no
 * provider refuses to start instead of running unconfined.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { Config } from '../src/config.ts'
import { clampMode, resolveTerminalTarget } from '../src/host/session.ts'
import { testConfig } from './fixtures.ts'

describe('clampMode', () => {
  const modes: readonly SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']

  it('narrows to the Session and never widens it', () => {
    const expected: Record<SandboxMode, Record<SandboxMode, SandboxMode>> = {
      'read-only': {
        'read-only': 'read-only',
        'workspace-write': 'read-only',
        'danger-full-access': 'read-only',
      },
      'workspace-write': {
        'read-only': 'read-only',
        'workspace-write': 'workspace-write',
        'danger-full-access': 'workspace-write',
      },
      'danger-full-access': {
        'read-only': 'read-only',
        'workspace-write': 'workspace-write',
        'danger-full-access': 'danger-full-access',
      },
    }
    for (const requested of modes) {
      for (const session of modes) {
        expect(clampMode(requested, session), `${requested} vs ${session}`).toBe(expected[requested][session])
      }
    }
  })
})

describe('the plugin defaults', () => {
  it('ships a sandboxed terminal and loopback-only callers', () => {
    const config = Config({} as Config)
    expect(config.mode).toBe('workspace-write')
    expect(config.allowRemote).toBe(false)
    expect(config.color).toBe(true)
    expect(config.maxSessions).toBeGreaterThan(0)
  })
})

describe('resolveTerminalTarget', () => {
  /**
   * A composition context whose only real behaviour is the policy lookup.
   * @param options - which providers exist and what the Session's mode is.
   * @returns the fake context and the spies the assertions read.
   */
  function context(options: {
    sessionMode?: SandboxMode
    agent?: boolean
    shell?: boolean
    sandbox?: boolean
  } = {}): { ctx: Context; confine: ReturnType<typeof vi.fn>; resolveExecutable: ReturnType<typeof vi.fn> } {
    const sessionMode = options.sessionMode ?? 'workspace-write'
    const confine = vi.fn((argv: readonly string[]) => ({
      argv: ['confined', ...argv],
      enforcement: 'partial' as const,
      denialSignatures: [],
      runnerFailureRules: [],
    }))
    const resolveExecutable = vi.fn(async (name: string) => `/usr/bin/${name}`)
    const ctx = {
      agents: {
        get: (id: string) => (options.agent === false || id !== 'session-1'
          ? undefined
          : { id, session: { id } }),
      },
      sandboxPolicy: {
        resolve: (request: { session: { id: string }; mode?: SandboxMode }) => ({
          mode: request.mode ?? sessionMode,
          workspaceRoot: '/work',
          sessionId: request.session.id,
        }),
      },
      subprocess: {
        resolveExecutable: options.shell === false
          ? vi.fn(async () => { throw new Error('not found') })
          : resolveExecutable,
      },
      get: (name: string) => (name === 'sandbox' && options.sandbox !== false ? { confine } : undefined),
    } as unknown as Context
    return { ctx, confine, resolveExecutable }
  }

  it('defaults to a confined shell in the Session workspace', async () => {
    const { ctx, confine } = context()
    const result = await resolveTerminalTarget(ctx, testConfig(), 'session-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(confine).toHaveBeenCalledTimes(1)
    expect(result.target.cwd).toBe('/work')
    expect(result.target.sandbox).toEqual({ mode: 'workspace-write', enforcement: 'partial', workspaceRoot: '/work' })
    expect(result.target.argv[0]).toBe('confined')
  })

  it('narrows to a read-only Session', async () => {
    const { ctx } = context({ sessionMode: 'read-only' })
    const result = await resolveTerminalTarget(ctx, testConfig(), 'session-1')
    expect(result.ok && result.target.sandbox.mode).toBe('read-only')
  })

  it('does not inherit a full-access Session by default', async () => {
    const { ctx, confine } = context({ sessionMode: 'danger-full-access' })
    const result = await resolveTerminalTarget(ctx, testConfig(), 'session-1')
    expect(result.ok && result.target.sandbox.mode).toBe('workspace-write')
    expect(confine).toHaveBeenCalledTimes(1)
  })

  it('follows a full-access Session only when configured to', async () => {
    const { ctx, confine } = context({ sessionMode: 'danger-full-access' })
    const result = await resolveTerminalTarget(ctx, testConfig({ mode: 'session' }), 'session-1')
    expect(result.ok && result.target.sandbox.mode).toBe('danger-full-access')
    expect(result.ok && result.target.sandbox.enforcement).toBe('none')
    expect(confine).not.toHaveBeenCalled()
  })

  it('honours the pane’s own choice, still clamped to the Session', async () => {
    // Narrowing is always allowed, whatever the deployment configured.
    const writable = context({ sessionMode: 'workspace-write' })
    const narrowed = await resolveTerminalTarget(writable.ctx, testConfig(), 'session-1', 'read-only')
    expect(narrowed.ok && narrowed.target.sandbox.mode).toBe('read-only')

    // `session` follows the Session, and a pane may ask for it explicitly.
    const full = context({ sessionMode: 'danger-full-access' })
    const followed = await resolveTerminalTarget(full.ctx, testConfig({ mode: 'read-only' }), 'session-1', 'session')
    expect(followed.ok && followed.target.sandbox.mode).toBe('danger-full-access')

    // A read-only Session refuses to widen even when the pane asks it to.
    const readOnly = context({ sessionMode: 'read-only' })
    const clamped = await resolveTerminalTarget(readOnly.ctx, testConfig(), 'session-1', 'workspace-write')
    expect(clamped.ok && clamped.target.sandbox.mode).toBe('read-only')
  })

  it('refuses to start a confined shell with no sandbox provider', async () => {
    const { ctx } = context({ sandbox: false })
    const result = await resolveTerminalTarget(ctx, testConfig(), 'session-1')
    expect(result).toEqual({
      ok: false,
      code: 'sandbox-unavailable',
      message: expect.stringContaining('refusing to run unconfined'),
    })
  })

  it('refuses a Session with no live agent', async () => {
    const { ctx } = context({ agent: false })
    const result = await resolveTerminalTarget(ctx, testConfig(), 'session-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('session-not-live')
  })

  it('refuses when no shell resolves', async () => {
    const { ctx } = context({ shell: false })
    const result = await resolveTerminalTarget(ctx, testConfig(), 'session-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('shell-unavailable')
  })

  it('keeps a configured shell out of startup profiles', async () => {
    const { ctx, resolveExecutable } = context()
    const result = await resolveTerminalTarget(ctx, testConfig({ shellPath: '/bin/zsh' }), 'session-1')
    expect(resolveExecutable).not.toHaveBeenCalled()
    expect(result.ok && result.target.argv).toContain('-i')
  })
})
