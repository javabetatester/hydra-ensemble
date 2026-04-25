import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Plus,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Terminal,
  FolderPlus,
  AlertTriangle,
  Network,
  Filter,
  Construction,
  Files
} from 'lucide-react'
import { useProjects } from '../../state/projects'
import { useSessions } from '../../state/sessions'
import { useEditor } from '../../state/editor'
import { useSlidePanel } from '../../state/panels'
import { useOrchestra } from '../../orchestra/state/orchestra'
import { getActiveView } from '../editor/CodeMirrorView'
import WorktreeItem from './WorktreeItem'
import CreateWorktreeDialog from './CreateWorktreeDialog'
import SessionStatePill from '../SessionStatePill'
import AgentAvatar from '../AgentAvatar'
import FileTree from '../editor/FileTree'
import type { SessionMeta } from '../../../shared/types'

const AGENT_GROUP_COLLAPSED_KEY = 'hydra.sidebar.agentGroupCollapsed'

function readCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(AGENT_GROUP_COLLAPSED_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

function writeCollapsedGroups(groups: Set<string>): void {
  try {
    localStorage.setItem(AGENT_GROUP_COLLAPSED_KEY, JSON.stringify(Array.from(groups)))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

function groupKey(s: SessionMeta): string {
  return s.worktreePath ?? s.cwd
}

function groupLabel(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

interface SectionHeaderProps {
  open: boolean
  onToggle: () => void
  icon?: ReactNode
  label: string
  action?: ReactNode
}

function SectionHeader({ open, onToggle, icon, label, action }: SectionHeaderProps) {
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="mb-1 flex items-center justify-between px-2 py-0.5">
      <button
        type="button"
        onClick={onToggle}
        className="flex flex-1 items-center gap-1 rounded-sm text-[10px] font-medium uppercase tracking-wider text-text-4 transition-colors hover:text-text-2"
      >
        <Chevron size={12} strokeWidth={1.75} className="text-text-4" />
        {icon}
        <span>{label}</span>
      </button>
      {action}
    </div>
  )
}

export default function Sidebar() {
  const projects = useProjects((s) => s.projects)
  const currentPath = useProjects((s) => s.currentPath)
  const worktrees = useProjects((s) => s.worktrees)
  const loadingWorktrees = useProjects((s) => s.loadingWorktrees)
  const error = useProjects((s) => s.error)
  const addProject = useProjects((s) => s.addProject)
  const createWorktree = useProjects((s) => s.createWorktree)
  const removeWorktree = useProjects((s) => s.removeWorktree)

  const sessions = useSessions((s) => s.sessions)
  const activeSessionId = useSessions((s) => s.activeId)
  const setActiveSession = useSessions((s) => s.setActive)
  const createSession = useSessions((s) => s.createSession)
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  )
  const filesRoot = activeSession?.worktreePath ?? activeSession?.cwd ?? null

  /** Per-worktree session stats: total sessions tied to it + how many are
   *  in an active state (thinking/generating). Drives the WorktreeItem
   *  marker so the user sees at a glance which worktrees have agents
   *  working in them right now. */
  const worktreeStats = useMemo(() => {
    const map = new Map<string, { count: number; active: number }>()
    for (const s of sessions) {
      const key = s.worktreePath ?? s.cwd
      const existing = map.get(key) ?? { count: 0, active: 0 }
      existing.count += 1
      if (s.state === 'thinking' || s.state === 'generating') existing.active += 1
      map.set(key, existing)
    }
    return map
  }, [sessions])

  const orchestraEnabled = useOrchestra((s) => s.settings.enabled)
  const orchestraTeams = useOrchestra((s) => s.teams)
  const orchestraAgents = useOrchestra((s) => s.agents)
  const setOrchestraSettings = useOrchestra((s) => s.setSettings)
  const setOrchestraOverlayOpen = useOrchestra((s) => s.setOverlayOpen)
  const setOrchestraActiveTeam = useOrchestra((s) => s.setActiveTeam)

  const [showCreate, setShowCreate] = useState(false)
  const [worktreesOpen, setWorktreesOpen] = useState(true)
  const [filesOpen, setFilesOpen] = useState(true)
  // Orchestrador starts COLLAPSED on every app launch — same pattern
  // as the toolkit drawer. The DEVELOPING badge is already attention-
  // grabbing; we don't also need the section auto-expanded forcing
  // its content into the user's face every cold start.
  const [orchestraOpen, setOrchestraOpen] = useState(false)
  const [agentsOpen, setAgentsOpen] = useState(true)
  const [agentFilter, setAgentFilter] = useState('')
  const [collapsedAgentGroups, setCollapsedAgentGroups] = useState<Set<string>>(() =>
    readCollapsedGroups()
  )

  useEffect(() => {
    writeCollapsedGroups(collapsedAgentGroups)
  }, [collapsedAgentGroups])

  const toggleAgentGroup = (key: string): void => {
    setCollapsedAgentGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const agentGroups = useMemo(() => {
    const normalizedFilter = agentFilter.trim().toLowerCase()
    const filtered = normalizedFilter
      ? sessions.filter((s) => s.name.toLowerCase().includes(normalizedFilter))
      : sessions
    const byGroup = new Map<string, SessionMeta[]>()
    for (const s of filtered) {
      const key = groupKey(s)
      const bucket = byGroup.get(key)
      if (bucket) bucket.push(s)
      else byGroup.set(key, [s])
    }
    return Array.from(byGroup.entries())
      .map(([path, items]) => ({ path, items }))
      .sort((a, b) => groupLabel(a.path).localeCompare(groupLabel(b.path)))
  }, [sessions, agentFilter])

  const orchestraRunningAgents = useMemo(
    () => orchestraAgents.filter((a) => a.state === 'running').length,
    [orchestraAgents]
  )
  const teamActivity = useMemo(() => {
    const byTeam = new Map<string, boolean>()
    for (const t of orchestraTeams) byTeam.set(t.id, false)
    for (const a of orchestraAgents) {
      if (a.state === 'running' && byTeam.has(a.teamId)) byTeam.set(a.teamId, true)
    }
    return byTeam
  }, [orchestraTeams, orchestraAgents])

  const copyToClipboard = (value: string): void => {
    void navigator.clipboard?.writeText(value).catch(() => undefined)
  }

  const openSessionForWorktree = async (path: string, branch: string): Promise<void> => {
    const existing = sessions.find((s) => s.worktreePath === path || s.cwd === path)
    if (existing) {
      setActiveSession(existing.id)
      return
    }
    await createSession({ cwd: path, worktreePath: path, branch, name: branch || undefined })
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border-soft bg-bg-2 text-text-2">
      {/* Header row kept short and deliberately brand-less — the main
          app header already shows "Hydra Ensemble". Duplicating it here
          created a double-logo artefact when the drawer opened. Shows
          the drawer's purpose ("projects") as the title instead. */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-soft px-3">
        <span className="df-label">projects</span>
      </header>

      <div className="df-scroll flex-1 overflow-y-auto py-2">
        {projects.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-bg-3 text-text-3">
              <FolderPlus size={18} strokeWidth={1.5} />
            </div>
            <div className="mb-3 text-xs text-text-4">no projects yet</div>
            <button
              type="button"
              onClick={() => void addProject()}
              className="df-lift inline-flex items-center gap-1.5 rounded-md bg-accent-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-600"
            >
              <Plus size={14} strokeWidth={1.75} />
              <span>open project</span>
            </button>
          </div>
        ) : (
          <>
            {/* ACTIVE AGENTS — sessions grouped by worktree/cwd */}
            <SectionHeader
              open={agentsOpen}
              onToggle={() => setAgentsOpen((v) => !v)}
              icon={<Terminal size={11} strokeWidth={1.75} className="text-text-4" />}
              label="Active agents"
              action={
                <span className="text-[10px] font-mono text-text-4">{sessions.length}</span>
              }
            />
            {agentsOpen && (
              <div className="mb-3 flex flex-col gap-0.5 px-1">
                <div className="mb-1 flex items-center gap-1.5 rounded-sm bg-bg-3/60 px-2 py-1">
                  <Filter size={11} strokeWidth={1.75} className="shrink-0 text-text-4" />
                  <input
                    type="text"
                    value={agentFilter}
                    onChange={(e) => setAgentFilter(e.target.value)}
                    placeholder="filter agents…"
                    className="min-w-0 flex-1 bg-transparent text-[11px] text-text-2 placeholder:text-text-4 focus:outline-none"
                    aria-label="Filter active agents by name"
                  />
                </div>
                {sessions.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-text-4">no active agents</div>
                ) : agentGroups.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-text-4">no matches</div>
                ) : (
                  agentGroups.map(({ path, items }) => {
                    const collapsed = collapsedAgentGroups.has(path)
                    const GroupChevron = collapsed ? ChevronRight : ChevronDown
                    return (
                      <div key={path} className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => toggleAgentGroup(path)}
                          className="group flex items-center gap-1.5 rounded-sm px-2 py-1 text-left text-xs text-text-2 transition-colors hover:bg-bg-3 hover:text-text-1"
                          title={path}
                          aria-expanded={!collapsed}
                        >
                          <GroupChevron
                            size={12}
                            strokeWidth={1.75}
                            className="shrink-0 text-text-4"
                          />
                          <span className="flex-1 truncate">{groupLabel(path)}</span>
                          <span className="shrink-0 rounded-sm bg-bg-3 px-1.5 py-0.5 font-mono text-[10px] text-text-4 group-hover:bg-accent-500/15 group-hover:text-accent-500">
                            {items.length}
                          </span>
                        </button>
                        {!collapsed && (
                          <div className="flex flex-col gap-0.5">
                            {items.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => setActiveSession(s.id)}
                                className="group flex items-center gap-2 rounded-sm py-1 pl-6 pr-2 text-left text-xs text-text-2 transition-colors hover:bg-bg-3 hover:text-text-1"
                                title={s.worktreePath ?? s.cwd}
                              >
                                <AgentAvatar session={s} size={18} ring={false} />
                                <span className="flex-1 truncate">{s.name}</span>
                                <SessionStatePill state={s.state} label={false} />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {currentPath && (
              <>
                {/* WORKTREES */}
                <SectionHeader
                  open={worktreesOpen}
                  onToggle={() => setWorktreesOpen((v) => !v)}
                  icon={<GitBranch size={11} strokeWidth={1.75} className="text-text-4" />}
                  label="Worktrees"
                  action={
                    <button
                      type="button"
                      onClick={() => setShowCreate((v) => !v)}
                      className="flex h-5 w-5 items-center justify-center rounded text-text-4 transition-colors hover:bg-bg-3 hover:text-text-1"
                      title="new worktree"
                      aria-label="new worktree"
                    >
                      <Plus size={12} strokeWidth={1.75} />
                    </button>
                  }
                />
                {worktreesOpen && (
                  <div className="mb-3 flex flex-col gap-0.5 px-1">
                    {showCreate && (
                      <CreateWorktreeDialog
                        onSubmit={async (name, base) => {
                          await createWorktree(name, base)
                          setShowCreate(false)
                        }}
                        onCancel={() => setShowCreate(false)}
                      />
                    )}
                    {loadingWorktrees && worktrees.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-text-4">loading…</div>
                    ) : worktrees.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-text-4">no worktrees</div>
                    ) : (
                      worktrees.map((wt) => {
                        const stats = worktreeStats.get(wt.path) ?? { count: 0, active: 0 }
                        return (
                          <WorktreeItem
                            key={wt.path}
                            worktree={wt}
                            hasSession={stats.count > 0}
                            sessionCount={stats.count}
                            activeCount={stats.active}
                            onOpenSession={() =>
                              void openSessionForWorktree(wt.path, wt.branch)
                            }
                            onRemove={() => void removeWorktree(wt.path)}
                            onCopyPath={() => copyToClipboard(wt.path)}
                          />
                        )
                      })
                    )}
                  </div>
                )}

              </>
            )}

            {/* FILES — files of the active agent's worktree. Reroots
                automatically when the user switches agents or worktrees;
                clicking a file opens it in the editor pane (and reveals
                the editor if it was hidden). */}
            {activeSession && filesRoot && (
              <>
                <SectionHeader
                  open={filesOpen}
                  onToggle={() => setFilesOpen((v) => !v)}
                  icon={<Files size={11} strokeWidth={1.75} className="text-text-4" />}
                  label="Files"
                />
                {filesOpen && (
                  <div
                    className="mb-3 mx-1 overflow-hidden rounded-sm border border-border-soft bg-bg-2/40"
                    style={{ height: 320 }}
                  >
                    <FileTree
                      root={filesRoot}
                      sessionId={activeSession.id}
                      breadcrumb={null}
                      onOpenFile={(p) => {
                        // Open file → reveal the slide-panel editor →
                        // focus CodeMirror on the next frame so the
                        // buffer has time to mount before we hand it
                        // focus. openEditor() flips the editor store's
                        // own flag; useSlidePanel.open('editor') is what
                        // actually reveals the right-side pane.
                        void useEditor
                          .getState()
                          .openFile(p)
                          .then(() => {
                            useEditor.getState().openEditor()
                            useSlidePanel.getState().open('editor')
                            requestAnimationFrame(() => {
                              getActiveView()?.focus()
                            })
                          })
                      }}
                    />
                  </div>
                )}
              </>
            )}

            {/* DEVELOPING ZONE — wraps the experimental Orchestrador surface
                so users see at a glance that everything inside is still WIP. */}
            <div
              className={`df-fade-in relative mx-1 mb-3 rounded-sm border border-dashed bg-status-thinking/[0.03] p-1 pt-3 ${
                orchestraRunningAgents > 0
                  ? 'border-accent-500/40 shadow-[0_0_0_1px_rgba(99,102,241,0.18)]'
                  : 'border-status-thinking/30'
              }`}
            >
              <span className="absolute -top-2 left-2 flex items-center gap-1 bg-bg-2 px-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-status-thinking">
                <Construction size={10} strokeWidth={1.75} className="text-status-thinking" />
                <span>Developing</span>
                <span
                  className="ml-0.5 h-1 w-1 animate-pulse rounded-full bg-status-thinking"
                  aria-hidden
                />
              </span>

              <SectionHeader
                open={orchestraOpen}
                onToggle={() => setOrchestraOpen((v) => !v)}
                icon={<Network size={11} strokeWidth={1.75} className="text-text-4" />}
                label="Orchestrador"
              />
              {orchestraOpen && (
                <div className="flex flex-col gap-0.5 px-1">
                  {!orchestraEnabled ? (
                    <div className="group flex items-center gap-2 rounded-sm px-2 py-1 text-xs text-text-4 transition-colors hover:bg-bg-3 hover:text-text-2">
                      <button
                        type="button"
                        onClick={() => {
                          void setOrchestraSettings({ enabled: true })
                          setOrchestraOverlayOpen(true)
                        }}
                        className="flex flex-1 items-center gap-2 text-left"
                        title="Enable Orchestrador"
                      >
                        <Network size={14} strokeWidth={1.75} />
                        <span className="flex-1 truncate">Orchestrador</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void setOrchestraSettings({ enabled: true })
                          setOrchestraOverlayOpen(true)
                        }}
                        className="hidden rounded-sm bg-bg-3 px-1.5 py-0.5 text-[10px] font-medium text-text-2 transition-colors hover:bg-accent-500/15 hover:text-accent-500 group-hover:inline-flex"
                      >
                        Enable
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setOrchestraOverlayOpen(true)}
                        className="group flex items-center gap-2 rounded-sm px-2 py-1 text-left text-xs text-text-2 transition-colors hover:bg-bg-3 hover:text-text-1"
                        title="Open Orchestrador overlay"
                      >
                        <Network size={14} strokeWidth={1.75} />
                        <span className="flex-1 truncate">Orchestrador</span>
                      </button>
                      {orchestraTeams.length === 0 ? (
                        <div className="px-2 py-2 text-[11px] italic text-text-4">
                          No teams yet — open the overlay to create one.
                        </div>
                      ) : (
                        <>
                          {orchestraTeams.slice(0, 4).map((t) => {
                            const active = teamActivity.get(t.id) === true
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                  setOrchestraActiveTeam(t.id)
                                  setOrchestraOverlayOpen(true)
                                }}
                                className="group flex items-center gap-2 rounded-sm py-1 pl-6 pr-2 text-left text-xs text-text-2 transition-colors hover:bg-bg-3 hover:text-text-1"
                                title={t.name}
                              >
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    active
                                      ? 'animate-pulse bg-accent-500'
                                      : 'bg-text-4'
                                  }`}
                                  aria-hidden
                                />
                                <span className="flex-1 truncate">{t.name}</span>
                              </button>
                            )
                          })}
                          {orchestraTeams.length > 4 && (
                            <div className="py-0.5 pl-6 pr-2 text-[10px] text-text-4">
                              +{orchestraTeams.length - 4} more
                            </div>
                          )}
                        </>
                      )}
                      {orchestraAgents.length > 0 && (
                        <div className="py-0.5 pl-6 pr-2 font-mono text-[10px] text-text-4">
                          {orchestraAgents.length} agents · {orchestraRunningAgents} running
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {error && (
        <footer className="flex items-start gap-2 border-t border-border-soft bg-status-attention/5 px-3 py-2 text-[11px] text-status-attention">
          <AlertTriangle size={12} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span className="break-words">ipc unavailable: {error}</span>
        </footer>
      )}
    </aside>
  )
}
