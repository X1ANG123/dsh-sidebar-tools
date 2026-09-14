/**
 * Wire vocabulary both halves of the sidebar tools plugin share: route paths,
 * request and frame shapes, and the bounds the host enforces on everything the
 * browser sends. Nothing here reaches a Node builtin or a Cordis service, so the
 * browser bundle inlines it unchanged.
 */

/** Route prefix every GUI terminal route lives under. */
export const GUI_TERMINAL_PREFIX = '/gui-terminal'

/** Issues one CSRF token for the page that will drive a terminal. */
export const TOKEN_ROUTE = `${GUI_TERMINAL_PREFIX}/token`
/** Opens one terminal session for a live Session. */
export const OPEN_ROUTE = `${GUI_TERMINAL_PREFIX}/open`
/** Streams screen frames for one terminal session. */
export const STREAM_ROUTE = `${GUI_TERMINAL_PREFIX}/stream`
/** Writes bytes into one terminal. */
export const INPUT_ROUTE = `${GUI_TERMINAL_PREFIX}/input`
/** Delivers one signal to one terminal's foreground group. */
export const SIGNAL_ROUTE = `${GUI_TERMINAL_PREFIX}/signal`
/** Closes one terminal. */
export const CLOSE_ROUTE = `${GUI_TERMINAL_PREFIX}/close`

/** Header carrying the per-page CSRF token on every mutating route. */
export const CSRF_HEADER = 'x-gui-terminal-token'

/** Largest request body any route here accepts; anything larger is hostile. */
export const MAX_BODY_BYTES = 64 * 1024
/** Longest accepted session or terminal id. */
export const MAX_ID_LENGTH = 128
/** Longest accepted input payload: one keystroke burst or paste. */
export const MAX_INPUT_LENGTH = 32 * 1024

/** Grid bounds a client may ask for. */
export const MIN_COLS = 20
/** Largest accepted column count. */
export const MAX_COLS = 400
/** Smallest accepted row count. */
export const MIN_ROWS = 5
/** Largest accepted row count. */
export const MAX_ROWS = 200

/** SGR attribute bits carried by one screen run. */
export const ATTR_BOLD = 1
/** Dim (`SGR 2`). */
export const ATTR_DIM = 2
/** Italic (`SGR 3`). */
export const ATTR_ITALIC = 4
/** Underline (`SGR 4`). */
export const ATTR_UNDERLINE = 8
/** Strikethrough (`SGR 9`). */
export const ATTR_STRIKETHROUGH = 16
/** Hidden (`SGR 8`). */
export const ATTR_HIDDEN = 32

/**
 * One style-homogeneous span of a row, in string order. Segments carry their
 * own text so a wide character never has to be reconciled with a column index.
 */
export interface TerminalRun {
  /** The span's characters, exactly as the emulator reports them. */
  readonly text: string
  /** Foreground: palette index, or `0xRRGGBB` when `fgRgb` is set. */
  readonly fg?: number
  /** Background: palette index, or `0xRRGGBB` when `bgRgb` is set. */
  readonly bg?: number
  /** The foreground is a 24-bit value rather than a palette index. */
  readonly fgRgb?: boolean
  /** The background is a 24-bit value rather than a palette index. */
  readonly bgRgb?: boolean
  /** Attribute bits from the `ATTR_*` set; absent means none. */
  readonly a?: number
}

/** The visible screen after one emulator update. */
export interface TerminalScreenFrame {
  readonly kind: 'screen'
  /** Monotonic frame counter within one terminal. */
  readonly seq: number
  /** One string per visible row, trailing blanks trimmed. */
  readonly rows: readonly string[]
  /** Cursor position and whether the pane should draw it. */
  readonly cursor: { readonly x: number; readonly y: number; readonly visible: boolean }
  /** True while the alternate (full-screen) buffer is active. */
  readonly alt: boolean
  /**
   * How many retained lines sit above this screen in the host's buffer. A frame
   * whose `base` grew carried that many lines into history, which is what lets
   * the pane scroll back through output it has already drawn.
   */
  readonly base: number
  /** Style runs per row; present only when the deployment enables color. */
  readonly runs?: readonly (readonly TerminalRun[])[]
}

/** Top-level terminal process status. */
export type TerminalStatus =
  | { readonly kind: 'running' }
  | { readonly kind: 'exited'; readonly exitCode: number | null; readonly signal: string | null }

/** Terminal process status frame. */
export interface TerminalStatusFrame {
  readonly kind: 'status'
  readonly status: TerminalStatus
}

/** One out-of-band failure reported on the stream. */
export interface TerminalErrorFrame {
  readonly kind: 'error'
  readonly message: string
}

/** Every frame a stream may carry. */
export type TerminalFrame = TerminalScreenFrame | TerminalStatusFrame | TerminalErrorFrame

/** Effective confinement facts the pane reports honestly. */
export interface TerminalSandboxInfo {
  /** File-effect mode this terminal runs under. */
  readonly mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  /** How completely the host enforces that mode. */
  readonly enforcement: 'full' | 'partial' | 'none'
  /** Directory the shell starts in. */
  readonly workspaceRoot: string
}

/** Machine-readable refusal codes. */
export type TerminalErrorCode =
  | 'bad-request'
  | 'unsupported-media-type'
  | 'payload-too-large'
  | 'forbidden'
  | 'rate-limited'
  | 'session-not-live'
  | 'unknown-terminal'
  | 'limit-reached'
  | 'shell-unavailable'
  | 'sandbox-unavailable'

/** A refused operation: never a partial success. */
export interface TerminalFailure {
  readonly ok: false
  readonly code: TerminalErrorCode
  readonly message: string
}

/** A published terminal: its id, its shell, and its confinement facts. */
export interface TerminalOpened {
  readonly ok: true
  readonly terminalId: string
  readonly shell: string
  readonly cols: number
  readonly rows: number
  readonly sandbox: TerminalSandboxInfo
}

/** What `open` answers. */
export type TerminalOpenResult = TerminalOpened | TerminalFailure

/** Signals the pane may ask for, matching the subprocess terminal vocabulary. */
export type TerminalSignalName = 'SIGINT' | 'SIGTERM'

/** The one read-only route that serves a framed site's logo to the tab chip. */
export const FAVICON_ROUTE = '/gui-terminal/favicon'

/** Query parameter naming the origin whose logo is asked for. */
export const FAVICON_ORIGIN_PARAM = 'origin'

/**
 * Confinement a pane may ask for when it opens a terminal.
 *
 * `session` follows the Session's own mode; every other choice is still clamped
 * so a terminal is never wider than the Session it belongs to, which is why the
 * pane can offer this picker without being able to widen anything.
 */
export type TerminalModeChoice = 'read-only' | 'workspace-write' | 'session'

/** Every mode choice a pane may send, in the order a picker lists them. */
export const TERMINAL_MODE_CHOICES: readonly TerminalModeChoice[] = ['read-only', 'workspace-write', 'session']
