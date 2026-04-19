import { useEffect, useMemo, useState } from 'react'
import {
  Code2,
  FolderTree,
  GitPullRequest,
  LayoutDashboard,
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
import Toasts from './components/Toasts'
import { useSessions } from './state/sessions'
import { useSessionsUi } from './state/sessionsExtra'
import { useEditor } from './state/editor'
import { useProjects } from './state/projects'
import { useGh } from './state/gh'
import { useToolkit } from './state/toolkit'
import { useWatchdog } from './state/watchdog'

export default function App() {
  const [claudePath, setClaudePath] = useState<string | null | undefined>(undefined)
  const [drawerOpen, setDrawerOpen] = useState(false)

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

  const dashboardOpen = useSessionsUi((s) => s.dashboardOpen)
  const closeDashboard = useSessionsUi((s) => s.closeDashboard)
  const toggleDashboard = useSessionsUi((s) => s.toggleDashboard)

  const editorOpen = useEditor((s) => s.editorOpen)
  const closeEditor = useEditor((s) => s.closeEditor)
  const toggleEditor = useEditor((s) => s.toggleEditor)

  const initToolkit = useToolkit((s) => s.init)
  const initWatchdog = useWatchdog((s) => s.init)
  const togglePanel = useWatchdog((s) => s.togglePanel)
  const initProjects = useProjects((s) => s.init)
  const currentProject = useProjects((s) => s.projects.find((p) => p.path === s.currentPath))

  const ghOpen = useGh((s) => s.open)
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
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()

      if (key === 'd' && !e.shiftKey) {
        e.preventDefault()
        toggleDashboard()
        return
      }
      if (key === 'e' && !e.shiftKey) {
        e.preventDefault()
        toggleEditor()
        return
      }
      if (key === 'b' && !e.shiftKey) {
        e.preventDefault()
        setDrawerOpen((v) => !v)
        return
      }
      if (key === 't' && !e.shiftKey) {
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
      if (e.key === '`' && !e.shiftKey) {
        e.preventDefault()
        void window.api.quickTerm.toggle()
        return
      }
      if (key === 'p' && e.shiftKey) {
        if (!contextCwd) return
        e.preventDefault()
        if (ghOpen) closeGh()
        else openGh(contextCwd)
        return
      }
      if (key === 'w' && e.shiftKey) {
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    toggleDashboard,
    toggleEditor,
    createSession,
    destroySession,
    activeId,
    sessions,
    setActive,
    ghOpen,
    openGh,
    closeGh,
    togglePanel,
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
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 px-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-sm bg-accent-500 df-pulse" />
              <span className="font-display text-sm font-semibold tracking-tight text-text-1">
                Hydra Ensemble
              </span>
              <span className="font-mono text-[10px] text-text-4">v0.1</span>
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
              title="toggle projects (Cmd/Ctrl+B)"
            >
              <FolderTree size={12} strokeWidth={1.75} />
              <span className="font-mono">
                {currentProject?.name ?? 'projects'}
              </span>
            </button>
          </div>

          <div className="flex items-center gap-0.5">
            <HeaderButton
              icon={<GitPullRequest size={13} strokeWidth={1.75} />}
              label="PRs"
              shortcut="⌘⇧P"
              onClick={() => contextCwd && openGh(contextCwd)}
              disabled={!contextCwd}
            />
            <HeaderButton
              icon={<Wand2 size={13} strokeWidth={1.75} />}
              label="watchdogs"
              shortcut="⌘⇧W"
              onClick={togglePanel}
            />
            <HeaderButton
              icon={<Code2 size={13} strokeWidth={1.75} />}
              label="editor"
              shortcut="⌘E"
              onClick={toggleEditor}
            />
            <HeaderButton
              icon={<LayoutDashboard size={13} strokeWidth={1.75} />}
              label="dashboard"
              shortcut="⌘D"
              onClick={toggleDashboard}
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
        </header>

        <main className="relative flex min-h-0 flex-1">
          {/* Terminal area */}
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

          {/* Right panel: sessions on top (auto-size, capped), toolkit fills rest */}
          <div className="flex w-80 shrink-0 flex-col overflow-hidden">
            <div
              className="flex shrink-0 flex-col overflow-hidden"
              style={{ maxHeight: '55%' }}
            >
              <SessionsPanel />
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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

      {/* Overlays */}
      <Dashboard open={dashboardOpen} onClose={closeDashboard} />
      <CodeEditor open={editorOpen} onClose={closeEditor} />
      <PRInspector cwd={contextCwd} open={ghOpen} onClose={closeGh} />
      <WatchdogPanel />
      <ToolkitEditorDialog />
      <Toasts />
    </div>
  )
}

function EmptyMain({ claudePath }: { claudePath: string | null | undefined }) {
  const create = useSessions((s) => s.createSession)
  const isCreating = useSessions((s) => s.isCreating)
  const projects = useProjects((s) => s.projects)
  const currentPath = useProjects((s) => s.currentPath)
  const addProject = useProjects((s) => s.addProject)
  const cwd =
    useProjects((s) => s.projects.find((p) => p.path === s.currentPath)?.path) ?? null

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
            onClick={() => void create({ cwd: cwd ?? undefined })}
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
              Tip: <kbd className="rounded bg-bg-3 px-1 py-0.5 font-mono">⌘B</kbd> toggles the
              project drawer ·{' '}
              <kbd className="rounded bg-bg-3 px-1 py-0.5 font-mono">⌘D</kbd> opens the dashboard
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
}

function HeaderButton({ icon, label, shortcut, onClick, disabled }: HeaderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      className="group flex items-center gap-1.5 rounded-sm border border-transparent px-2 py-1 text-xs text-text-3 transition hover:border-border-soft hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-3"
    >
      {icon}
      <span className="font-mono">{label}</span>
    </button>
  )
}
