import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Plus,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Terminal,
  FolderPlus,
  AlertTriangle
} from 'lucide-react'
import { useProjects } from '../../state/projects'
import { useSessions } from '../../state/sessions'
import ProjectItem from './ProjectItem'
import WorktreeItem from './WorktreeItem'
import CreateWorktreeDialog from './CreateWorktreeDialog'
import SessionStatePill from '../SessionStatePill'

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
  const init = useProjects((s) => s.init)
  const addProject = useProjects((s) => s.addProject)
  const removeProject = useProjects((s) => s.removeProject)
  const setCurrent = useProjects((s) => s.setCurrent)
  const createWorktree = useProjects((s) => s.createWorktree)
  const removeWorktree = useProjects((s) => s.removeWorktree)

  const sessions = useSessions((s) => s.sessions)
  const setActiveSession = useSessions((s) => s.setActive)
  const createSession = useSessions((s) => s.createSession)

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [worktreesOpen, setWorktreesOpen] = useState(true)
  const [sessionsOpen, setSessionsOpen] = useState(true)

  useEffect(() => {
    void init()
  }, [init])

  // Auto-expand the active project so its worktrees are visible by default.
  useEffect(() => {
    if (currentPath) {
      setExpandedProjects((prev) => {
        if (prev.has(currentPath)) return prev
        const next = new Set(prev)
        next.add(currentPath)
        return next
      })
    }
  }, [currentPath])

  const projectSessions = useMemo(() => {
    if (!currentPath) return []
    return sessions.filter(
      (s) => s.cwd === currentPath || s.worktreePath?.startsWith(currentPath)
    )
  }, [sessions, currentPath])

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
      {/* Brand */}
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-soft px-3">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-400 df-pulse" aria-hidden />
        <span className="text-sm font-semibold tracking-tight text-text-1">
          Conductor
        </span>
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
            {/* PROJECTS */}
            <SectionHeader
              open={projectsOpen}
              onToggle={() => setProjectsOpen((v) => !v)}
              label="Projects"
              action={
                <button
                  type="button"
                  onClick={() => void addProject()}
                  className="flex h-5 w-5 items-center justify-center rounded text-text-4 transition-colors hover:bg-bg-3 hover:text-text-1"
                  title="open project"
                  aria-label="open project"
                >
                  <Plus size={12} strokeWidth={1.75} />
                </button>
              }
            />
            {projectsOpen && (
              <div className="mb-3 flex flex-col gap-0.5 px-1">
                {projects.map((p) => {
                  const expanded = expandedProjects.has(p.path)
                  const active = p.path === currentPath
                  return (
                    <ProjectItem
                      key={p.path}
                      project={p}
                      active={active}
                      expanded={expanded}
                      onSelect={() => void setCurrent(p.path)}
                      onToggleExpand={() =>
                        setExpandedProjects((prev) => {
                          const next = new Set(prev)
                          if (next.has(p.path)) next.delete(p.path)
                          else next.add(p.path)
                          return next
                        })
                      }
                      onRemove={() => void removeProject(p.path)}
                      onCopyPath={() => copyToClipboard(p.path)}
                    />
                  )
                })}
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
                      worktrees.map((wt) => (
                        <WorktreeItem
                          key={wt.path}
                          worktree={wt}
                          hasSession={sessions.some(
                            (s) => s.worktreePath === wt.path || s.cwd === wt.path
                          )}
                          onOpenSession={() =>
                            void openSessionForWorktree(wt.path, wt.branch)
                          }
                          onRemove={() => void removeWorktree(wt.path)}
                          onCopyPath={() => copyToClipboard(wt.path)}
                        />
                      ))
                    )}
                  </div>
                )}

                {/* SESSIONS */}
                <SectionHeader
                  open={sessionsOpen}
                  onToggle={() => setSessionsOpen((v) => !v)}
                  icon={<Terminal size={11} strokeWidth={1.75} className="text-text-4" />}
                  label="Sessions"
                />
                {sessionsOpen && (
                  <div className="flex flex-col gap-0.5 px-1">
                    {projectSessions.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-text-4">no sessions</div>
                    ) : (
                      projectSessions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setActiveSession(s.id)}
                          className="group flex items-center gap-2 rounded-sm py-1 pl-6 pr-2 text-left text-xs text-text-2 transition-colors hover:bg-bg-3 hover:text-text-1"
                          title={s.worktreePath ?? s.cwd}
                        >
                          <SessionStatePill state={s.state} label={false} />
                          <span className="flex-1 truncate">{s.name}</span>
                          {s.branch && (
                            <span className="shrink-0 truncate font-mono text-[10px] text-text-4">
                              {s.branch}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
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
