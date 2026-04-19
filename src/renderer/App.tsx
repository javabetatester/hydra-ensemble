import { useEffect, useMemo, useState } from 'react'
import {
  Code2,
  FolderTree,
  GitPullRequest,
  HelpCircle,
  LayoutDashboard,
  Terminal as TerminalIcon,
  Wand2
} from 'lucide-react'
import SessionPane from './components/SessionPane'
import StatusBar from './components/StatusBar'
import Dashboard from './components/Dashboard'
import Sidebar from './components/Sidebar'
import CodeEditor from './components/CodeEditor'
import PRInspector from './components/PRInspector'
import VoiceButton from './components/VoiceButton'
import SessionsPanel from './components/SessionsPanel'
import ToolkitGrid from './components/ToolkitGrid'
import ActiveAgentBar from './components/ActiveAgentBar'
import ToolkitEditorDialog from './components/Toolkit/EditorDialog'
import WatchdogPanel from './components/Watchdog/Panel'
import WatchdogRuleDialog from './components/Watchdog/RuleDialog'
import Toasts from './components/Toasts'
import CommandPalette from './components/CommandPalette'
import HelpOverlay from './components/HelpOverlay'
import NewSessionDialog from './components/NewSessionDialog'
import TerminalsPanel from './components/TerminalsPanel'
import WindowControls from './components/WindowControls'
import { useSpawnDialog } from './state/spawn'
import { useSlidePanel } from './state/panels'
import { isMac } from './lib/platform'
import { useSessions } from './state/sessions'
import { useSessionsUi } from './state/sessionsExtra'
import { useEditor } from './state/editor'
import { useProjects } from './state/projects'
import { useGh } from './state/gh'
import { useToolkit } from './state/toolkit'
import { useWatchdog } from './state/watchdog'
import { fmtShortcut, hasMod } from './lib/platform'

export default function App() {
  const [claudePath, setClaudePath] = useState<string | null | undefined>(undefined)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const spawnOpen = useSpawnDialog((s) => s.open)
  const showSpawn = useSpawnDialog((s) => s.show)
  const hideSpawn = useSpawnDialog((s) => s.hide)

  const sessions = useSessions((s) => s.sessions)
  const activeId = useSessions((s) => s.activeId)
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId]
  )
  const initSessions = useSessions((s) => s.init)
  const createSession = useSessions((s) => s.createSession)
  const destroySession = useSessions((s) => s.destroySession)
  const setActive = useSessions((s) => s.setActive)

  const activePanel = useSlidePanel((s) => s.current)
  const openPanel = useSlidePanel((s) => s.open)
  const closePanel = useSlidePanel((s) => s.close)
  const togglePanelFor = useSlidePanel((s) => s.toggle)

  const initToolkit = useToolkit((s) => s.init)
  const initWatchdog = useWatchdog((s) => s.init)
  const initProjects = useProjects((s) => s.init)
  const currentProject = useProjects((s) => s.projects.find((p) => p.path === s.currentPath))

  // Keep useGh's cwd in sync when the PR panel is active so refresh works.
  const ghCwd = useGh((s) => s.cwd)
  const openGh = useGh((s) => s.openPanel)
  const closeGh = useGh((s) => s.closePanel)

  const contextCwd =
    activeSession?.worktreePath ?? activeSession?.cwd ?? currentProject?.path ?? null

  useEffect(() => {
    void initSessions()
    void initToolkit()
    void initWatchdog()
    void initProjects()
    void window.api.claude.resolvePath().then(setClaudePath)
  }, [initSessions, initToolkit, initWatchdog, initProjects])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // '?' toggles the keyboard help overlay from anywhere, as long as
      // the user isn't typing in an input — in which case '?' is a real
      // character they meant to type.
      if (e.key === '?' && !hasMod(e)) {
        const t = e.target as HTMLElement | null
        const tag = t?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return
        e.preventDefault()
        setHelpOpen((v) => !v)
        return
      }
      // hasMod ignores Super (metaKey) on Linux/Windows so we don't
      // collide with Hyprland/GNOME/KDE/Win Super+N workspace shortcuts.
      if (!hasMod(e)) return
      const key = e.key.toLowerCase()
      // e.code is layout-independent — important because ABNT2 keyboards
      // don't produce the backtick/apostrophe characters where a US
      // layout would. Using code lets the same shortcut work everywhere.
      const code = e.code

      if (key === 'k' && !e.shiftKey) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (key === 'd' && !e.shiftKey) {
        e.preventDefault()
        togglePanelFor('dashboard')
        return
      }
      if (key === 'e' && !e.shiftKey) {
        e.preventDefault()
        togglePanelFor('editor')
        return
      }
      if (key === 'p' && !e.shiftKey) {
        // ⌘P toggles the projects drawer.
        e.preventDefault()
        setDrawerOpen((v) => !v)
        return
      }
      if (key === 't' && !e.shiftKey) {
        // ⌘T opens the Terminals panel — fast path for spawning a shell
        // next to the agents, matching the user's muscle memory from
        // VS Code / Cursor.
        e.preventDefault()
        togglePanelFor('terminals')
        return
      }
      if (key === 'n' && !e.shiftKey) {
        // ⌘N opens the new-session picker dialog (project + worktree).
        // ⌘⇧N quick-spawns with the active context.
        e.preventDefault()
        showSpawn()
        return
      }
      if (key === 'n' && e.shiftKey) {
        e.preventDefault()
        void createSession({ cwd: contextCwd ?? undefined })
        return
      }
      if (key === 'w' && !e.shiftKey) {
        if (!activeId) return
        e.preventDefault()
        void destroySession(activeId)
        return
      }
      if (/^[0-9]$/.test(e.key) && !e.shiftKey) {
        const idx = e.key === '0' ? 9 : Number.parseInt(e.key, 10) - 1
        const target = sessions[idx]
        if (!target) return
        e.preventDefault()
        setActive(target.id)
        return
      }
      if (e.key === '[' && !e.shiftKey) {
        if (!activeId) return
        e.preventDefault()
        const i = sessions.findIndex((s) => s.id === activeId)
        const prev = sessions[(i - 1 + sessions.length) % sessions.length]
        if (prev) setActive(prev.id)
        return
      }
      if (e.key === ']' && !e.shiftKey) {
        if (!activeId) return
        e.preventDefault()
        const i = sessions.findIndex((s) => s.id === activeId)
        const next = sessions[(i + 1) % sessions.length]
        if (next) setActive(next.id)
        return
      }
      // Backtick alias — some US-muscle-memory users still expect ⌘` for
      // the terminal panel. Using e.code so the key is recognised on
      // ABNT2 layouts where the physical key produces apostrophe.
      if ((code === 'Backquote' || e.key === '`' || e.key === "'") && !e.shiftKey) {
        e.preventDefault()
        togglePanelFor('terminals')
        return
      }
      if (key === 'p' && e.shiftKey) {
        // ⌘⇧P opens the PR inspector (kept shift to avoid clashing with
        // the new ⌘P projects drawer).
        if (!contextCwd) return
        e.preventDefault()
        if (activePanel === 'pr') {
          closePanel()
        } else {
          openGh(contextCwd)
          openPanel('pr')
        }
        return
      }
      if (key === 'w' && e.shiftKey) {
        e.preventDefault()
        togglePanelFor('watchdogs')
      }
    }
    // capture: true so we intercept BEFORE xterm.js (which has its own
    // keydown handler on the focused terminal element) eats the keystroke.
    // Without this, every shortcut (⌘T, ⌘D, ⌘E, ⌘`, ⌘1..9, ?) is silently
    // swallowed when an agent terminal has focus.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    togglePanelFor,
    openPanel,
    closePanel,
    activePanel,
    createSession,
    destroySession,
    activeId,
    sessions,
    setActive,
    openGh,
    showSpawn,
    contextCwd
  ])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-0 text-text-1">
      {/* Project drawer (collapsible) */}
      <div
        className={`shrink-0 overflow-hidden border-r border-border-soft transition-[width] duration-200 ${
          drawerOpen ? 'w-64' : 'w-0'
        }`}
      >
        <Sidebar />
      </div>

      {/* Main column: header, terminal, status bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={`flex h-11 shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 ${
            isMac() ? 'pl-20 pr-3' : 'pl-3 pr-3'
          }`}
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div
            className="flex items-center gap-3"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-sm bg-accent-500 df-pulse" />
              <span className="flex items-baseline gap-1.5 font-mono text-sm font-semibold tracking-tight">
                <span className="text-text-1">Hydra</span>
                <span className="text-accent-400">Ensemble</span>
                <span className="text-text-4">v0.1</span>
              </span>
            </div>
            <span className="h-5 w-px bg-border-soft" aria-hidden />
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition ${
                drawerOpen
                  ? 'border-border-mid bg-bg-4 text-text-1'
                  : 'border-transparent text-text-3 hover:bg-bg-3 hover:text-text-1'
              }`}
              title="toggle projects (Cmd/Ctrl+P)"
            >
              <FolderTree size={12} strokeWidth={1.75} />
              <span className="font-mono">
                {currentProject?.name ?? 'projects'}
              </span>
            </button>
          </div>

          <div
            className="flex items-center gap-3"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <div className="flex items-center gap-0.5">
            <HeaderButton
              icon={<GitPullRequest size={13} strokeWidth={1.75} />}
              label="PRs"
              shortcut={fmtShortcut('P', { shift: true })}
              active={activePanel === 'pr'}
              onClick={() => {
                if (activePanel === 'pr') closePanel()
                else if (contextCwd) {
                  openGh(contextCwd)
                  openPanel('pr')
                }
              }}
              disabled={!contextCwd}
            />
            <HeaderButton
              icon={<Wand2 size={13} strokeWidth={1.75} />}
              label="watchdogs"
              shortcut={fmtShortcut('W', { shift: true })}
              active={activePanel === 'watchdogs'}
              onClick={() => togglePanelFor('watchdogs')}
            />
            <HeaderButton
              icon={<Code2 size={13} strokeWidth={1.75} />}
              label="editor"
              shortcut={fmtShortcut('E')}
              active={activePanel === 'editor'}
              onClick={() => togglePanelFor('editor')}
            />
            <HeaderButton
              icon={<LayoutDashboard size={13} strokeWidth={1.75} />}
              label="dashboard"
              shortcut={fmtShortcut('D')}
              active={activePanel === 'dashboard'}
              onClick={() => togglePanelFor('dashboard')}
            />
            <HeaderButton
              icon={<TerminalIcon size={13} strokeWidth={1.75} />}
              label="terminals"
              shortcut={`${fmtShortcut('').slice(0, -1)}\``}
              active={activePanel === 'terminals'}
              onClick={() => togglePanelFor('terminals')}
            />
            <HeaderButton
              icon={<HelpCircle size={13} strokeWidth={1.75} />}
              label="?"
              shortcut="?"
              onClick={() => setHelpOpen(true)}
            />
            <div className="ml-2 flex items-center gap-1.5 border-l border-border-soft pl-3 font-mono text-[10px]">
              <span className="text-text-4">os</span>
              <span className="text-text-2">{window.api.platform.os}</span>
              <span className="text-text-4">/</span>
              <span className="text-text-4">claude</span>
              <span
                className={
                  claudePath === undefined
                    ? 'text-text-4'
                    : claudePath === null
                      ? 'text-status-attention'
                      : 'text-status-generating'
                }
              >
                {claudePath === undefined
                  ? '?'
                  : claudePath === null
                    ? 'missing'
                    : 'ok'}
              </span>
            </div>
            </div>
            {/* Vertical separator + extra breathing room before the OS controls
                so they don't crowd the os/claude badge on Linux/Windows. */}
            <span className="h-5 w-px bg-border-soft" aria-hidden />
            <WindowControls />
          </div>
        </header>

        <main className="relative flex min-h-0 flex-1">
          {/* Terminal area — shrinks when editor pane slides in */}
          <div className="relative flex min-w-0 flex-1 flex-col bg-bg-1">
            {sessions.length === 0 ? <EmptyMain claudePath={claudePath} /> : null}
            {sessions.length > 0 ? (
              <>
                {activeSession ? <ActiveAgentBar session={activeSession} /> : null}
                <div className="relative min-h-0 flex-1 overflow-hidden">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      className="absolute inset-0"
                      style={{ display: s.id === activeId ? 'block' : 'none' }}
                    >
                      <SessionPane session={s} visible={s.id === activeId} />
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {activeSession ? <VoiceButton /> : null}
          </div>

          {/* Unified slide pane — hosts whichever of editor / dashboard /
              watchdogs / PR is currently active. Width animates to 52% on
              open, 0% on close. One slot, mutually exclusive. */}
          <div
            className="relative flex shrink-0 flex-col overflow-hidden border-l transition-[width,border-color,opacity] duration-300 ease-out"
            style={{
              width: activePanel ? '52%' : '0%',
              borderLeftColor: activePanel ? 'var(--color-border-mid)' : 'transparent',
              opacity: activePanel ? 1 : 0
            }}
            aria-hidden={!activePanel}
          >
            <div
              className="absolute inset-0 transition-transform duration-300 ease-out"
              style={{ transform: activePanel ? 'translateX(0)' : 'translateX(8%)' }}
            >
              <CodeEditor
                open={activePanel === 'editor'}
                onClose={closePanel}
                mode="inline"
              />
              <Dashboard
                open={activePanel === 'dashboard'}
                onClose={closePanel}
                mode="inline"
              />
              <WatchdogPanel
                open={activePanel === 'watchdogs'}
                onClose={closePanel}
                mode="inline"
              />
              <PRInspector
                cwd={contextCwd}
                open={activePanel === 'pr'}
                onClose={() => {
                  closeGh()
                  closePanel()
                }}
                mode="inline"
              />
              <TerminalsPanel open={activePanel === 'terminals'} onClose={closePanel} />
            </div>
          </div>

          {/* Right panel: sessions takes remaining space at top, toolkit
              hugs the bottom sized to its own content (capped at 55% so
              huge toolkits don't push sessions out). */}
          <div className="flex w-80 shrink-0 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <SessionsPanel />
            </div>
            <div
              className="flex shrink-0 flex-col overflow-hidden border-t border-border-soft"
              style={{ maxHeight: '55%' }}
            >
              <ToolkitGrid
                cwd={contextCwd}
                projectName={currentProject?.name}
                branch={activeSession?.branch}
              />
            </div>
          </div>
        </main>

        <StatusBar />
      </div>

      {/* True overlays (not slide panels) */}
      <ToolkitEditorDialog />
      <WatchdogRuleDialog />
      <Toasts />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <NewSessionDialog open={spawnOpen} onClose={hideSpawn} />
    </div>
  )
}

function EmptyMain({ claudePath }: { claudePath: string | null | undefined }) {
  const isCreating = useSessions((s) => s.isCreating)
  const projects = useProjects((s) => s.projects)
  const currentPath = useProjects((s) => s.currentPath)
  const addProject = useProjects((s) => s.addProject)

  return (
    <div className="df-hero-bg df-scroll flex flex-1 items-center justify-center overflow-y-auto px-8 py-12">
      <div className="w-full max-w-2xl df-fade-in">
        {/* Hero */}
        <div className="mb-8 text-center">
          <div className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center">
            <div className="absolute inset-0 animate-ping rounded-full bg-accent-500/20" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500/30 to-accent-700/30 ring-1 ring-accent-500/40">
              <div className="h-3 w-3 rounded-full bg-accent-400 df-pulse" />
            </div>
          </div>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-text-1">
            Run Claude agents in parallel.
          </h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-text-3">
            Each session runs with its own{' '}
            <code className="rounded bg-bg-3 px-1.5 py-0.5 font-mono text-[11px] text-text-2">
              CLAUDE_CONFIG_DIR
            </code>{' '}
            so they never collide on history, JSONL, or MCP state.
          </p>
        </div>

        {/* Quickstart steps */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Step
            num={1}
            title="Pick a project"
            body={
              currentPath
                ? `Active: ${currentPath.split(/[/\\]/).filter(Boolean).pop() ?? currentPath}`
                : projects.length > 0
                  ? `${projects.length} saved`
                  : 'Open a directory to scope sessions and worktrees.'
            }
            done={!!currentPath || projects.length > 0}
            action={
              !currentPath ? (
                <button
                  type="button"
                  onClick={() => void addProject()}
                  className="text-[11px] font-medium text-accent-400 hover:text-accent-200"
                >
                  open directory →
                </button>
              ) : null
            }
          />
          <Step
            num={2}
            title="Spawn a session"
            body="A shell launches inside the project directory and execs claude — isolated per session."
            done={false}
          />
          <Step
            num={3}
            title="Watch them work"
            body="Status pills update live: thinking, generating, awaiting input, needs attention."
            done={false}
          />
        </div>

        {/* Primary CTA */}
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => useSpawnDialog.getState().show()}
            disabled={isCreating || claudePath === null}
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-gradient-to-br from-accent-500 to-accent-600 px-5 py-2.5 text-sm font-semibold text-white shadow-card transition df-lift hover:from-accent-400 hover:to-accent-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <span className="relative">
              {isCreating ? 'spawning…' : 'Spawn first session'}
            </span>
            <span className="relative ml-1 rounded bg-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/85">
              ⌘T
            </span>
          </button>
          {claudePath === null ? (
            <p className="text-xs text-status-attention">
              claude binary not found in PATH — install Claude Code first.
            </p>
          ) : (
            <p className="text-[11px] text-text-4">
              Tip:{' '}
              <kbd className="rounded bg-bg-3 px-1 py-0.5 font-mono">
                {fmtShortcut('B')}
              </kbd>{' '}
              toggles the project drawer ·{' '}
              <kbd className="rounded bg-bg-3 px-1 py-0.5 font-mono">
                {fmtShortcut('D')}
              </kbd>{' '}
              opens the dashboard ·{' '}
              <kbd className="rounded bg-bg-3 px-1 py-0.5 font-mono">?</kbd> shows all shortcuts
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Step({
  num,
  title,
  body,
  done,
  action
}: {
  num: number
  title: string
  body: string
  done: boolean
  action?: React.ReactNode
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-3 transition ${
        done
          ? 'border-accent-500/30 bg-accent-500/5'
          : 'border-border-soft bg-bg-3'
      }`}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
            done
              ? 'bg-accent-500 text-white'
              : 'bg-bg-4 text-text-3 ring-1 ring-inset ring-border-mid'
          }`}
        >
          {done ? '✓' : num}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-text-2">
          {title}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-text-3">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

interface HeaderButtonProps {
  icon: React.ReactNode
  label: string
  shortcut?: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
}

function HeaderButton({ icon, label, shortcut, onClick, disabled, active }: HeaderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`group flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-3 ${
        active
          ? 'border-accent-500/40 bg-accent-500/10 text-accent-200'
          : 'border-transparent text-text-3 hover:border-border-soft hover:bg-bg-3 hover:text-text-1'
      }`}
    >
      {icon}
      <span className="font-mono">{label}</span>
    </button>
  )
}
