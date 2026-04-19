/**
 * Keybind serialization helpers.
 *
 * Combo format: lowercase tokens joined with `+`.
 *   - `mod` = Cmd on macOS, Ctrl on Linux/Windows (resolved at match time)
 *   - `shift`, `alt`
 *   - key: lowercase letter, digit, named special (`tab`, `space`, `escape`,
 *     `arrowup`, `?`, `backquote`, `[`, `]`, `\``, etc).
 *
 * Examples: `mod+t`, `mod+shift+p`, `mod+`, `?`, `escape`.
 */
import { isMac } from './platform'

export const MOD_TOKEN = 'mod'

export interface ParsedCombo {
  mod: boolean
  shift: boolean
  alt: boolean
  key: string
}

export function parseCombo(combo: string): ParsedCombo {
  const tokens = combo.toLowerCase().split('+').map((s) => s.trim())
  let mod = false
  let shift = false
  let alt = false
  let key = ''
  for (const t of tokens) {
    if (t === MOD_TOKEN) mod = true
    else if (t === 'shift') shift = true
    else if (t === 'alt') alt = true
    else if (t.length > 0) key = t
  }
  return { mod, shift, alt, key }
}

export function formatCombo(combo: string): string {
  const { mod, shift, alt, key } = parseCombo(combo)
  const parts: string[] = []
  if (mod) parts.push(isMac() ? '⌘' : 'Ctrl')
  if (shift) parts.push(isMac() ? '⇧' : 'Shift')
  if (alt) parts.push(isMac() ? '⌥' : 'Alt')
  if (key) parts.push(prettyKey(key))
  return parts.join(isMac() ? '' : '+')
}

function prettyKey(key: string): string {
  switch (key) {
    case 'arrowup': return '↑'
    case 'arrowdown': return '↓'
    case 'arrowleft': return '←'
    case 'arrowright': return '→'
    case 'enter': return '↵'
    case 'escape': return 'Esc'
    case 'space': return 'Space'
    case 'backspace': return '⌫'
    case 'delete': return 'Del'
    case 'backquote': return '`'
    default: return key.length === 1 ? key.toUpperCase() : key
  }
}

/** Convert a live KeyboardEvent into a normalised combo string. */
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = []
  // Mod: ctrl on Linux/Win, cmd-or-ctrl on macOS.
  const hasMod = isMac() ? (e.metaKey || e.ctrlKey) : (e.ctrlKey && !e.metaKey)
  if (hasMod) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')

  // Use e.code for layout-independence on letters / digits / Backquote.
  let key = ''
  if (e.code === 'Backquote') key = 'backquote'
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase()
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  else if (e.key === '?') key = '?'
  else if (e.key === '[') key = '['
  else if (e.key === ']') key = ']'
  else if (e.key === '/') key = '/'
  else key = e.key.toLowerCase()

  // Discard modifier-only events (when the user is just holding shift).
  if (key === 'shift' || key === 'control' || key === 'meta' || key === 'alt' || key === '') {
    return ''
  }

  parts.push(key)
  return parts.join('+')
}

/** True if the live event matches the bound combo. */
export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false
  return comboFromEvent(e) === combo.toLowerCase()
}
