import * as React from 'react'
import Kbd from './Kbd'
import { isMac } from '../lib/platform'

interface ShortcutProps {
  /** Keys in lowercase, e.g. `['mod', 'k']` or `['shift', '?']`. `mod`
   *  renders ⌘ on mac and Ctrl elsewhere. */
  keys: ReadonlyArray<string>
  size?: 'sm' | 'md'
}

/** Single source of truth for rendering a keyboard combo. Avoids the
 *  `fmtShortcut → <kbd>` string pattern that's duplicated across the
 *  codebase with subtle formatting drift. Each key gets its own Kbd so
 *  the visual grouping matches conventions users expect (⌘ ⇧ K), and
 *  platform substitution happens in ONE place. */
export default function Shortcut({ keys, size = 'sm' }: ShortcutProps) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((raw, i) => (
        <Kbd key={`${raw}-${i}`} size={size}>
          {renderKey(raw)}
        </Kbd>
      ))}
    </span>
  )
}

function renderKey(raw: string): React.ReactNode {
  const k = raw.toLowerCase()
  if (k === 'mod') return isMac() ? '⌘' : 'Ctrl'
  if (k === 'shift') return '⇧'
  if (k === 'alt' || k === 'option') return isMac() ? '⌥' : 'Alt'
  if (k === 'ctrl') return isMac() ? '⌃' : 'Ctrl'
  if (k === 'enter') return '⏎'
  if (k === 'esc' || k === 'escape') return 'Esc'
  if (k === 'space') return 'Space'
  // Single letter keys render uppercase to match real key-cap legends.
  return raw.length === 1 ? raw.toUpperCase() : raw
}
