/**
 * Deployment configuration of the sidebar tools plugin, and the defaults a
 * deployment that says nothing gets: a sandboxed shell, loopback callers only,
 * and every bound the routes enforce.
 *
 * @module @deepseek-ai/dsh-client-ui-sidebar-tools/config
 */

import z from '@deepseek-ai/schemastery'

/** Confinement selection for a terminal this plugin starts. */
export type TerminalModeConfig = 'read-only' | 'workspace-write' | 'session' | 'danger-full-access'

/** Sidebar tools configuration. */
export interface Config {
  /**
   * Confinement for a GUI terminal. `session` follows the Session's own mode;
   * every explicit mode is clamped so a terminal is never wider than the
   * Session it was opened from.
   */
  readonly mode: TerminalModeConfig
  /**
   * Whether terminal routes serve callers outside loopback. Off by default: the
   * pane hands out a shell running as this host's user, so a LAN-exposed or
   * proxied deployment must opt in deliberately.
   */
  readonly allowRemote: boolean
  /** Absolute shell to launch; empty resolves `pwsh`/`powershell` or `$SHELL`/bash. */
  readonly shellPath: string
  /** Extra shell argv; empty means this platform's quiet defaults. */
  readonly shellArgs: string[]
  /** Columns requested when the pane reports no size. */
  readonly defaultCols: number
  /** Largest accepted column request. */
  readonly maxCols: number
  /** Rows requested when the pane reports no size. */
  readonly defaultRows: number
  /** Largest accepted row request. */
  readonly maxRows: number
  /** Screen frames are coalesced into at most one per interval. */
  readonly frameIntervalMs: number
  /** Serialized-byte ceiling for one frame; rows past it are dropped. */
  readonly frameMaxBytes: number
  /** A stream client whose socket buffer exceeds this is dropped, never buffered further. */
  readonly clientBufferMaxBytes: number
  /** How long a terminal survives its last reader leaving. */
  readonly detachGraceMs: number
  /** How long a terminal survives with no input and no output. */
  readonly idleTimeoutMs: number
  /** Absolute lifetime of one terminal. */
  readonly maxLifeMs: number
  /** Live terminals across the process. */
  readonly maxSessions: number
  /** Open requests allowed per minute per caller address. */
  readonly maxOpensPerMinute: number
  /** Input bytes accepted per second per terminal. */
  readonly maxInputBytesPerSecond: number
  /** Lifetime of one CSRF token. */
  readonly csrfTokenTtlMs: number
  /** Live CSRF tokens kept at once. */
  readonly csrfTokenMaxEntries: number
  /** Emulator scrollback depth: how many lines above the visible screen the host keeps, which is exactly how far the pane can scroll back. */
  readonly scrollbackLines: number
  /** Carry SGR color runs in frames. */
  readonly color: boolean
  /** Answer terminal queries; pwsh's line editor needs the replies. */
  readonly vtReplies: boolean
}

/** Validated configuration, with every default filled in. */
export const Config: z<Config> = z.object({
  mode: z.union(['read-only', 'workspace-write', 'session', 'danger-full-access']).default('workspace-write'),
  allowRemote: z.boolean().default(false),
  shellPath: z.string().default(''),
  shellArgs: z.array(z.string()).default([]),
  defaultCols: z.natural().min(20).max(400).default(100),
  maxCols: z.natural().min(20).max(400).default(400),
  defaultRows: z.natural().min(5).max(200).default(30),
  maxRows: z.natural().min(5).max(200).default(200),
  frameIntervalMs: z.natural().min(8).max(1000).default(40),
  frameMaxBytes: z.natural().min(4096).max(4 * 1024 * 1024).default(256 * 1024),
  clientBufferMaxBytes: z.natural().min(4096).max(16 * 1024 * 1024).default(512 * 1024),
  detachGraceMs: z.natural().min(0).max(600_000).default(15_000),
  idleTimeoutMs: z.natural().min(0).max(86_400_000).default(3_600_000),
  maxLifeMs: z.natural().min(0).max(604_800_000).default(28_800_000),
  maxSessions: z.natural().min(1).max(64).default(8),
  maxOpensPerMinute: z.natural().min(1).max(600).default(10),
  maxInputBytesPerSecond: z.natural().min(1024).max(4 * 1024 * 1024).default(256 * 1024),
  csrfTokenTtlMs: z.natural().min(60_000).max(86_400_000).default(3_600_000),
  csrfTokenMaxEntries: z.natural().min(1).max(1024).default(64),
  scrollbackLines: z.natural().min(0).max(100_000).default(1000),
  color: z.boolean().default(true),
  vtReplies: z.boolean().default(true),
})
