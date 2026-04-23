import { useEffect } from 'react'
import { useKeybinds, resolveBind } from '../state/keybinds'
import { comboFromEvent, matchesCombo } from '../lib/keybind'
import { hasMod } from '../lib/platform'
import type { PanelKind } from '../state/panels'

/**
 * Global keybind dispatcher previously embedded in App.tsx.
 *
 * All app-wide shortcuts land here — window-level capture-phase listener,
 * xterm-textarea bypass, session-jump 1..9, recording mode for the
 * keybind editor. Extracted so App.tsx is about composition, not
 * keyboard plumbing. See docs/FRONTEND_REFACTOR_PROPOSAL.md.
 */
export interface GlobalKeybindDeps {
  orchestraEnabled: boolean
  toggleOrchestra: () => void
  setOrchestraOpen: (v: boolean) => void
  setOrchestraSettings: (patch: { enabled: boolean }) => Promise<void>
  showSpawn: () => void
  createSession: (opts: { cwd?: string }) => Promise<unknown>
  destroySession: (id: string) => Promise<void>
  activeId: string | null
  sessions: ReadonlyArray<{ id: string }>
  setActive: (id: string) => void
  togglePanelFor: (id: PanelKind) => void
  setDrawerOpen: (next: (v: boolean) => boolean) => void
  openPanel: (id: PanelKind) => void
  closePanel: () => void
  activePanel: PanelKind | null
  toggleTerminals: () => void
  openGh: (cwd: string) => void
  contextCwd: string | null
  setPaletteOpen: (next: (v: boolean) => boolean) => void
  setHelpOpen: (next: (v: boolean) => boolean) => void
}

export function useGlobalKeybinds(deps: GlobalKeybindDeps): void {
  const {
    orchestraEnabled,
    toggleOrchestra,
    setOrchestraOpen,
    setOrchestraSettings,
    showSpawn,
    createSession,
    destroySession,
    activeId,
    sessions,
    setActive,
    togglePanelFor,
    setDrawerOpen,
    openPanel,
    closePanel,
    activePanel,
    toggleTerminals,
    openGh,
    contextCwd,
    setPaletteOpen,
    setHelpOpen
  } = deps

  const overrides = useKeybinds((s) => s.overrides)
  const recording = useKeybinds((s) => s.recording)
  const setBind = useKeybinds((s) => s.setBind)

  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'session.new': () => showSpawn(),
      'session.quickSpawn': () =>
        void createSession({ cwd: contextCwd ?? undefined }),
      'session.close': () => {
        if (activeId) void destroySession(activeId)
      },
      'session.next': () => {
        if (!activeId || sessions.length === 0) return
        const i = sessions.findIndex((s) => s.id === activeId)
        const next = sessions[(i + 1) % sessions.length]
        if (next) setActive(next.id)
      },
      'session.prev': () => {
        if (!activeId || sessions.length === 0) return
        const i = sessions.findIndex((s) => s.id === activeId)
        const prev = sessions[(i - 1 + sessions.length) % sessions.length]
        if (prev) setActive(prev.id)
      },
      'panel.terminals': () => toggleTerminals(),
      'drawer.projects': () => setDrawerOpen((v) => !v),
      'panel.dashboard': () => togglePanelFor('dashboard'),
      'panel.editor': () => togglePanelFor('editor'),
      'panel.watchdogs': () => togglePanelFor('watchdogs'),
      'panel.pr': () => {
        if (!contextCwd) return
        if (activePanel === 'pr') closePanel()
        else {
          openGh(contextCwd)
          openPanel('pr')
        }
      },
      'palette.open': () => setPaletteOpen((v) => !v),
      'help.open': () => setHelpOpen((v) => !v),
      'orchestra.open': () => {
        // First press flips the persisted flag on; subsequent presses
        // just toggle the overlay. Avoids asking the user to hand-edit
        // store.json to discover the feature.
        if (!orchestraEnabled) {
          void setOrchestraSettings({ enabled: true })
          setOrchestraOpen(true)
          return
        }
        toggleOrchestra()
      }
    }

    const onKey = (e: KeyboardEvent): void => {
      // Recording mode: capture the next keypress as the binding,
      // unless user pressed Escape (cancel) or it's a modifier-only key.
      if (recording) {
        if (e.key === 'Escape') {
          e.preventDefault()
          useKeybinds.getState().stopRecording()
          return
        }
        const combo = comboFromEvent(e)
        if (combo) {
          e.preventDefault()
          e.stopPropagation()
          setBind(recording, combo)
        }
        return
      }

      // Skip when the user is typing in an input/textarea — avoid hijacking
      // characters like '?' or letters they're typing into a form.
      // Exception: xterm.js mounts a hidden `.xterm-helper-textarea` that
      // gets focus while the terminal is active. Treating that as a form
      // field blocked session-jump (mod+1..9) and the help overlay (?) any
      // time an agent pane was clicked — exactly the "binds don't work in
      // the terminal" report. It's not a real input, so opt it out.
      const t = e.target as HTMLElement | null
      const tag = t?.tagName?.toLowerCase()
      const isXtermTextarea =
        t?.classList?.contains('xterm-helper-textarea') === true
      const inField =
        !isXtermTextarea &&
        (tag === 'input' || tag === 'textarea' || !!t?.isContentEditable)

      // Session jump 1..9 stays hardcoded — too many to expose as actions.
      // Check both `e.key` and `e.code` so xterm (which normalises the
      // key differently) doesn't swallow this before us.
      if (!inField && hasMod(e) && !e.shiftKey) {
        const digitFromKey = /^[0-9]$/.test(e.key) ? e.key : null
        const digitFromCode = /^Digit([0-9])$/.exec(e.code)?.[1] ?? null
        const digit = digitFromKey ?? digitFromCode
        if (digit) {
          const idx = digit === '0' ? 9 : Number.parseInt(digit, 10) - 1
          const target = sessions[idx]
          if (!target) return
          e.preventDefault()
          e.stopPropagation()
          setActive(target.id)
          return
        }
      }

      // Generic dispatcher: walk every action and try to match its
      // current combo. First match wins.
      for (const [id, run] of Object.entries(handlers)) {
        const combo = resolveBind(id, overrides)
        if (!combo) continue
        // The '?' / non-mod bindings shouldn't fire while typing in a field.
        if (inField && !combo.includes('mod+') && !combo.includes('shift+'))
          continue
        if (matchesCombo(e, combo)) {
          e.preventDefault()
          run()
          return
        }
      }
    }

    // capture: true so we intercept BEFORE xterm.js (which has its own
    // keydown handler on the focused terminal element) eats the keystroke.
    // Without this, every shortcut (⌘T, ⌘D, ⌘E, ⌘`, ⌘1..9, ?) is silently
    // swallowed when an agent terminal has focus.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    overrides,
    recording,
    setBind,
    togglePanelFor,
    openPanel,
    closePanel,
    activePanel,
    toggleTerminals,
    createSession,
    destroySession,
    activeId,
    sessions,
    setActive,
    openGh,
    showSpawn,
    contextCwd,
    orchestraEnabled,
    setOrchestraOpen,
    setOrchestraSettings,
    toggleOrchestra,
    setDrawerOpen,
    setPaletteOpen,
    setHelpOpen
  ])
}
