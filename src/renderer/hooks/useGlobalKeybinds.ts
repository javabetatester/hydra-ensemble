import { useEffect } from 'react'
import { useKeybinds, resolveBind } from '../state/keybinds'
import { comboFromEvent, matchesCombo } from '../lib/keybind'
import { hasMod } from '../lib/platform'
import { useRightPanel, type PanelKind } from '../state/panels'
import { useOrchestraPanels } from '../state/orchestraPanels'

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
  /** Whether the Orchestrator overlay is currently mounted (vs just
   *  enabled). Used to make `Ctrl+Q` and `Ctrl+Shift+O` context-aware
   *  switches between the orchestrator and classic layouts. */
  orchestraOpen: boolean
  toggleOrchestra: () => void
  setOrchestraOpen: (v: boolean) => void
  setOrchestraSettings: (patch: { enabled: boolean }) => Promise<void>
  showSpawn: () => void
  createSession: (opts: { cwd?: string }) => Promise<unknown>
  destroySession: (id: string) => Promise<void>
  activeId: string | null
  sessions: ReadonlyArray<{ id: string; cwd: string; worktreePath?: string }>
  setActive: (id: string) => void
  togglePanelFor: (id: PanelKind) => void
  setDrawerOpen: (next: (v: boolean) => boolean) => void
  activePanel: PanelKind | null
  toggleTerminals: () => void
  contextCwd: string | null
  setPaletteOpen: (next: (v: boolean) => boolean) => void
  setHelpOpen: (next: (v: boolean) => boolean) => void
  /** Project cycling */
  projects: ReadonlyArray<{ path: string }>
  currentProjectPath: string | null
  setCurrentProject: (path: string) => Promise<void>
  lastActiveByProject: Record<string, string>
  /** Orchestrator: open the New-Task dialog scoped to a project. */
  showNewOrchestraTask: (ctx?: { projectPath?: string }) => void
}

export function useGlobalKeybinds(deps: GlobalKeybindDeps): void {
  const {
    orchestraEnabled,
    orchestraOpen,
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
    activePanel,
    toggleTerminals,
    contextCwd,
    setPaletteOpen,
    setHelpOpen,
    projects,
    currentProjectPath,
    setCurrentProject,
    lastActiveByProject,
    showNewOrchestraTask
  } = deps

  const overrides = useKeybinds((s) => s.overrides)
  const recording = useKeybinds((s) => s.recording)
  const setBind = useKeybinds((s) => s.setBind)

  useEffect(() => {
    /** Restore the last session the user interacted with in `projectPath`.
     *  Falls back to the most recent session in the array if no memory exists. */
    const switchToProjectSession = (projectPath: string): void => {
      // 1. Check remembered session
      const remembered = lastActiveByProject[projectPath]
      if (remembered && sessions.some((s) => s.id === remembered)) {
        setActive(remembered)
        return
      }
      // 2. Fallback: last session in the list belonging to this project
      const fallback = [...sessions].reverse().find(
        (s) => s.cwd === projectPath || s.worktreePath === projectPath
      )
      if (fallback) setActive(fallback.id)
    }

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
      'project.next': () => {
        if (projects.length < 2) return
        const i = projects.findIndex((p) => p.path === currentProjectPath)
        const next = projects[(i + 1) % projects.length]
        if (!next) return
        void setCurrentProject(next.path)
        switchToProjectSession(next.path)
      },
      'project.prev': () => {
        if (projects.length < 2) return
        const i = projects.findIndex((p) => p.path === currentProjectPath)
        const prev = projects[(i - 1 + projects.length) % projects.length]
        if (!prev) return
        void setCurrentProject(prev.path)
        switchToProjectSession(prev.path)
      },
      'panel.terminals': () => toggleTerminals(),
      'drawer.projects': () => setDrawerOpen((v) => !v),
      'panel.dashboard': () => togglePanelFor('dashboard'),
      'panel.editor': () => togglePanelFor('editor'),
      // panel.sessions is the classic-layout toggle; when the
      // orchestrator overlay is up, the same key acts as "exit
      // orchestrator" so users can mirror the open shortcut below.
      'panel.sessions': () => {
        if (orchestraOpen) {
          setOrchestraOpen(false)
          return
        }
        useRightPanel.getState().toggle()
      },
      'palette.open': () => setPaletteOpen((v) => !v),
      'help.open': () => setHelpOpen((v) => !v),
      // orchestra.newTaskInProject is dual-purpose:
      //   - In classic layout: open the orchestrator overlay (no
      //     modal). This is the symmetric counterpart to panel.sessions
      //     above, so Ctrl+Q exits and Ctrl+Shift+O enters.
      //   - In the orchestrator: open NewTaskDialog with the current
      //     project as initial context.
      'orchestra.newTaskInProject': () => {
        if (!orchestraOpen) {
          if (!orchestraEnabled) {
            void setOrchestraSettings({ enabled: true })
          }
          setOrchestraOpen(true)
          return
        }
        showNewOrchestraTask(
          currentProjectPath ? { projectPath: currentProjectPath } : {}
        )
      },
      // Orchestrator panel toggles. No-op outside the orchestrator
      // overlay so they don't intercept Ctrl+Shift+L/P/J in the
      // classic layout (where they'd be jarring no-ops).
      'orchestra.panel.templates': () => {
        if (!orchestraOpen) return
        useOrchestraPanels.getState().toggleTemplates()
      },
      'orchestra.panel.projects': () => {
        if (!orchestraOpen) return
        useOrchestraPanels.getState().toggleProjects()
      },
      'orchestra.panel.dock': () => {
        if (!orchestraOpen) return
        useOrchestraPanels.getState().toggleTasksPanel()
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
      //
      // Editor-scope override: when the editor is the active panel and
      // the user pressed mod+1 or mod+2, defer to editor.focusTree /
      // editor.focusEditor instead of jumping sessions. Without this
      // gate, focusing the file tree would silently swap the active
      // agent — bad surprise for the user.
      if (!inField && hasMod(e) && !e.shiftKey) {
        const digitFromKey = /^[0-9]$/.test(e.key) ? e.key : null
        const digitFromCode = /^Digit([0-9])$/.exec(e.code)?.[1] ?? null
        const digit = digitFromKey ?? digitFromCode
        if (digit) {
          if (
            activePanel === 'editor' &&
            (digit === '1' || digit === '2')
          ) {
            // editor.focusTree / focusEditor will pick this up.
            return
          }
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
      //
      // Editor-scope priority: when the editor pane is active, defer
      // to the editor's own handler for shortcuts that overlap with
      // editor.* actions. The editor's listener runs in the same
      // capture phase but after this one (mounted later), so without
      // this skip the user gets `session.close` instead of
      // `editor.closeTab` and similar wrong-pane outcomes.
      const editorIsActive = activePanel === 'editor'
      const editorOwnedCombos: ReadonlySet<string> = new Set(
        editorIsActive
          ? [
              resolveBind('editor.save', overrides),
              resolveBind('editor.saveAll', overrides),
              resolveBind('editor.closeTab', overrides),
              resolveBind('editor.nextTab', overrides),
              resolveBind('editor.prevTab', overrides),
              resolveBind('editor.focusTree', overrides),
              resolveBind('editor.focusEditor', overrides),
              resolveBind('editor.toggleSidebar', overrides),
              resolveBind('editor.commentToggle', overrides),
              resolveBind('editor.gotoLine', overrides),
              resolveBind('editor.toggleVim', overrides)
            ].filter(Boolean)
          : []
      )
      for (const [id, run] of Object.entries(handlers)) {
        const combo = resolveBind(id, overrides)
        if (!combo) continue
        if (editorIsActive && editorOwnedCombos.has(combo)) continue
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
    activePanel,
    toggleTerminals,
    createSession,
    destroySession,
    activeId,
    sessions,
    setActive,
    showSpawn,
    contextCwd,
    orchestraEnabled,
    setOrchestraOpen,
    setOrchestraSettings,
    toggleOrchestra,
    setDrawerOpen,
    setPaletteOpen,
    setHelpOpen,
    projects,
    currentProjectPath,
    setCurrentProject,
    lastActiveByProject
  ])
}
