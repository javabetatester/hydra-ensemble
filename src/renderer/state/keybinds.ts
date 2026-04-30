import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { matchesCombo } from '../lib/keybind'
import { hasMod } from '../lib/platform'

/**
 * Action registry — the canonical set of things the app can do that
 * deserve a keybind. Add a new action here and the help overlay picks
 * it up automatically (default + current key + recorder).
 */
export interface Action {
  id: string
  label: string
  group: string
  /** Default combo (see lib/keybind for format). */
  default: string
}

export const ACTIONS: Action[] = [
  // Sessions
  { id: 'session.new', label: 'New session (picker)', group: 'Sessions', default: 'mod+n' },
  { id: 'session.quickSpawn', label: 'Quick-spawn (active cwd)', group: 'Sessions', default: 'mod+shift+n' },
  { id: 'session.close', label: 'Close active session', group: 'Sessions', default: 'mod+w' },
  { id: 'session.next', label: 'Next session', group: 'Sessions', default: 'mod+]' },
  { id: 'session.prev', label: 'Previous session', group: 'Sessions', default: 'mod+[' },

  // Projects
  { id: 'project.next', label: 'Next project', group: 'Projects', default: 'mod+tab' },
  { id: 'project.prev', label: 'Previous project', group: 'Projects', default: 'mod+shift+tab' },

  // Orchestrator
  { id: 'orchestra.newTaskInProject', label: 'New orchestrator task in current project', group: 'Orchestrator', default: 'mod+shift+o' },

  // Panels
  { id: 'panel.terminals', label: 'Terminals panel', group: 'Panels', default: 'mod+backquote' },
  { id: 'drawer.projects', label: 'Projects drawer', group: 'Panels', default: 'mod+t' },
  { id: 'panel.dashboard', label: 'Dashboard', group: 'Panels', default: 'mod+d' },
  { id: 'panel.editor', label: 'Code editor', group: 'Panels', default: 'mod+e' },
  { id: 'panel.sessions', label: 'Hide sessions/activity panel', group: 'Panels', default: 'mod+q' },
  { id: 'palette.open', label: 'Command palette', group: 'Panels', default: 'mod+k' },
  { id: 'help.open', label: 'Help overlay', group: 'Panels', default: '?' },

  // Editor — scoped to the editor pane. `editor.closeTab` shares the
  // mod+w combo with `session.close`; the dispatcher prefers the
  // editor binding when the editor is focused, otherwise falls back to
  // session.close. Documented in the README and in this block.
  { id: 'editor.save', label: 'Save file', group: 'Editor', default: 'mod+s' },
  { id: 'editor.saveAll', label: 'Save all files', group: 'Editor', default: 'mod+alt+s' },
  { id: 'editor.closeTab', label: 'Close active tab', group: 'Editor', default: 'mod+w' },
  { id: 'editor.nextTab', label: 'Next tab', group: 'Editor', default: 'mod+alt+]' },
  { id: 'editor.prevTab', label: 'Previous tab', group: 'Editor', default: 'mod+alt+[' },
  { id: 'editor.focusTree', label: 'Focus file tree', group: 'Editor', default: 'mod+1' },
  { id: 'editor.focusEditor', label: 'Focus code editor', group: 'Editor', default: 'mod+2' },
  { id: 'editor.toggleSidebar', label: 'Toggle file sidebar', group: 'Editor', default: 'mod+b' },
  { id: 'editor.commentToggle', label: 'Toggle line comment', group: 'Editor', default: 'mod+/' },
  { id: 'editor.gotoLine', label: 'Go to line', group: 'Editor', default: 'mod+g' },
  { id: 'editor.toggleVim', label: 'Toggle vim mode', group: 'Editor', default: '' }
]

interface KeybindsState {
  /** action id -> combo. Missing key means use the default from ACTIONS. */
  overrides: Record<string, string>
  /** action id currently being re-bound (next keypress captures); null otherwise. */
  recording: string | null

  setBind: (id: string, combo: string) => void
  clearBind: (id: string) => void // remove the override + clear the action so it has no combo
  resetBind: (id: string) => void // restore the default
  startRecording: (id: string) => void
  stopRecording: () => void
}

export const useKeybinds = create<KeybindsState>()(
  persist(
    (set) => ({
      overrides: {},
      recording: null,

      setBind: (id, combo) =>
        set((s) => ({ overrides: { ...s.overrides, [id]: combo }, recording: null })),

      clearBind: (id) => set((s) => ({ overrides: { ...s.overrides, [id]: '' } })),

      resetBind: (id) =>
        set((s) => {
          const next = { ...s.overrides }
          delete next[id]
          return { overrides: next }
        }),

      startRecording: (id) => set({ recording: id }),
      stopRecording: () => set({ recording: null })
    }),
    { name: 'hydra.keybinds' }
  )
)

/** Resolve current combo for an action (override > default > '' if cleared). */
export function resolveBind(actionId: string, overrides: Record<string, string>): string {
  if (actionId in overrides) return overrides[actionId] ?? ''
  return ACTIONS.find((a) => a.id === actionId)?.default ?? ''
}

/** All action ids together with their effective combo. */
export function allBindings(overrides: Record<string, string>): Array<{ action: Action; combo: string }> {
  return ACTIONS.map((action) => ({ action, combo: resolveBind(action.id, overrides) }))
}

/**
 * True when the incoming KeyboardEvent matches any registered keybind —
 * either a user-bound ACTION combo or the hardcoded session-jump mod+1..9.
 * Lets the xterm `attachCustomKeyEventHandler` swallow events that the
 * app already handles, so the shortcut doesn't also leak as literal text
 * into the PTY.
 */
export function isBoundEvent(e: KeyboardEvent): boolean {
  // Hardcoded session jump (App.tsx keeps this out of ACTIONS because
  // nine slots would clutter the keybind editor). Check both `e.key`
  // and `e.code` so this still catches the event when xterm is focused
  // — some layouts / browsers hand us the `Digit1`…`Digit0` code only.
  if (hasMod(e) && !e.shiftKey) {
    if (/^[0-9]$/.test(e.key)) return true
    if (/^Digit[0-9]$/.test(e.code)) return true
  }
  const { overrides } = useKeybinds.getState()
  for (const action of ACTIONS) {
    const combo = resolveBind(action.id, overrides)
    if (combo && matchesCombo(e, combo)) return true
  }
  return false
}
