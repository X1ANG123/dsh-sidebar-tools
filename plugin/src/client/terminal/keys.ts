/**
 * Keystroke → terminal bytes.
 *
 * A pure translation, deliberately separate from the component: every mapping
 * is testable without a DOM, and the pane never guesses what a key means. Alt
 * prefixes an escape, Control folds letters into their control bytes, and every
 * cursor-editing key sends the sequence a real terminal sends.
 */

/** The parts of a keyboard event this mapping reads. */
export interface KeyStroke {
  /** `KeyboardEvent.key`. */
  readonly key: string
  /** Whether Control was held. */
  readonly ctrlKey: boolean
  /** Whether Shift was held. */
  readonly shiftKey: boolean
  /** Whether Alt was held. */
  readonly altKey: boolean
  /** Whether Meta (Command/Windows) was held. */
  readonly metaKey: boolean
}

/** Editing and navigation keys, as the escape sequences a terminal expects. */
const SEQUENCES: Readonly<Record<string, string>> = {
  ArrowUp: '\u001b[A',
  ArrowDown: '\u001b[B',
  ArrowRight: '\u001b[C',
  ArrowLeft: '\u001b[D',
  Home: '\u001b[H',
  End: '\u001b[F',
  Insert: '\u001b[2~',
  Delete: '\u001b[3~',
  PageUp: '\u001b[5~',
  PageDown: '\u001b[6~',
  Enter: '\r',
  Backspace: '\u007f',
  Tab: '\t',
  Escape: '\u001b',
}

/**
 * Translate one keystroke into the bytes a terminal receives.
 * @param stroke - the key event's relevant fields.
 * @returns the bytes, or undefined when the pane must not consume this key.
 */
export function keyToBytes(stroke: KeyStroke): string | undefined {
  // Control chords first: they are what interrupts, suspends, and clears.
  if (stroke.ctrlKey && !stroke.altKey && !stroke.metaKey) {
    // Control+Shift belongs to the browser: copy and paste are the conventions
    // a terminal pane must not swallow.
    if (stroke.shiftKey && stroke.key.length === 1) return undefined
    if (stroke.key.length === 1) {
      const code = stroke.key.toLowerCase().charCodeAt(0)
      if (code >= 97 && code <= 122) return String.fromCharCode(code - 96)
      if (stroke.key === '[') return '\u001b'
      if (stroke.key === '\\') return '\u001c'
      if (stroke.key === ']') return '\u001d'
      if (stroke.key === '^') return '\u001e'
      if (stroke.key === '_') return '\u001f'
    }
    // Every other Control chord belongs to the browser (find, reload, copy).
    return undefined
  }
  const base = SEQUENCES[stroke.key]
  if (base !== undefined) return stroke.altKey && !stroke.metaKey ? `\u001b${base}` : base
  if (stroke.metaKey) return undefined
  // Printable input: a single character, modifiers already applied by the
  // keyboard layout. Named keys (F1, Shift, …) are longer than one character.
  if (stroke.key.length === 1) return stroke.altKey ? `\u001b${stroke.key}` : stroke.key
  return undefined
}
