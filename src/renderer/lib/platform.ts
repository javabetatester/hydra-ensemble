/**
 * Platform-aware shortcut helpers.
 *
 * On Linux (Hyprland, GNOME, KDE…) Super+N is reserved by the window manager
 * for workspace switches, so the app must NOT treat metaKey as the modifier
 * — that would either steal the keystroke or fight the WM. Only macOS uses
 * Cmd (metaKey) for app-level shortcuts; everywhere else we use Ctrl.
 */

export const isMac = (): boolean => {
  if (typeof window === 'undefined' || !window.api?.platform) return false
  return window.api.platform.os === 'darwin'
}

export const isLinux = (): boolean => {
  if (typeof window === 'undefined' || !window.api?.platform) return false
  return window.api.platform.os === 'linux'
}

export const isWin = (): boolean => {
  if (typeof window === 'undefined' || !window.api?.platform) return false
  return window.api.platform.os === 'win32'
}

/** Symbol used for the primary modifier in keyboard hints. */
export const modSymbol = (): string => (isMac() ? '⌘' : 'Ctrl+')

/** Shift symbol — uppercase arrow on macOS, "Shift+" elsewhere. */
export const shiftSymbol = (): string => (isMac() ? '⇧' : 'Shift+')

/** Format a key combo like ('1') -> '⌘1' (mac) or 'Ctrl+1' (others). */
export const fmtShortcut = (key: string, opts?: { shift?: boolean }): string => {
  const shift = opts?.shift ? shiftSymbol() : ''
  return modSymbol() + shift + key
}

/**
 * True if the event carries the platform's primary modifier.
 *
 * macOS: Cmd (metaKey) — and we also accept Ctrl as an alias.
 * Linux + Windows: Ctrl ONLY. We deliberately ignore metaKey so the WM's
 * Super-based shortcuts (Hyprland workspace switch, Windows Start menu)
 * are never intercepted.
 */
export const hasMod = (e: { metaKey: boolean; ctrlKey: boolean }): boolean => {
  if (isMac()) return e.metaKey || e.ctrlKey
  return e.ctrlKey && !e.metaKey
}
