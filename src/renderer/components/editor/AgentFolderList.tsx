import { useMemo, useState } from 'react'
import { ChevronRight, Folder, FolderOpen, Plus } from 'lucide-react'
import { useSessions } from '../../state/sessions'
import { useProjects } from '../../state/projects'
import SessionStatePill from '../SessionStatePill'
import { defaultAgentColor, isAvatarUrl } from '../../lib/agent'
import type { SessionMeta } from '../../../shared/types'

interface Props {
  /** Called when the user activates a session row. Defaults to
   *  `useSessions.setActive(sessionId)` so the component is drop-in
   *  without wiring — callers can override to intercept (e.g. also
   *  close a side panel, open the editor, etc.). */
  onOpen?: (sessionId: string) => void
}

interface FolderGroup {
  /** Absolute path of the folder this group represents. */
  path: string
  /** Last path segment — the "folder name" shown in the header. */
  name: string
  /** Sessions rooted in this folder (worktreePath ?? cwd === path). */
  sessions: SessionMeta[]
  /** True when we also know this path from the projects/worktrees list.
   *  Folders that only appear because a session lives there still render,
   *  but we tag "known" ones so future integrations can style them. */
  known: boolean
}

/** Last non-empty segment of a POSIX or Windows path. */
function baseName(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** Preferred root for a session — the worktree when present, otherwise
 *  the cwd. Mirrors what `CodeEditor` does for the file tree. */
function sessionRoot(s: SessionMeta): string {
  return s.worktreePath ?? s.cwd
}

/**
 * Inverted "workspace" view: instead of a file tree rooted at one folder,
 * we list every folder that has at least one session in it, with that
 * folder's sessions nested under it. Lets the user jump between agents
 * grouped by where they're running.
 *
 * Folders without any sessions (projects/worktrees the user has registered
 * but no agent is active in) still render as collapsed rows so the user
 * can spin up a new session there with one click — hence `known`.
 */
export default function AgentFolderList({ onOpen }: Props) {
  const sessions = useSessions((s) => s.sessions)
  const activeId = useSessions((s) => s.activeId)
  const setActive = useSessions((s) => s.setActive)
  const projects = useProjects((s) => s.projects)
  const worktrees = useProjects((s) => s.worktrees)

  // Collapsed-state per folder path. We collapse empty-known folders by
  // default, and keep folders with sessions expanded by default.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const groups = useMemo<FolderGroup[]>(() => {
    const map = new Map<string, FolderGroup>()

    // Seed with every known project + worktree path so the user can see
    // folders they've registered even when no agent is running there.
    for (const p of projects) {
      map.set(p.path, {
        path: p.path,
        name: p.name || baseName(p.path),
        sessions: [],
        known: true
      })
    }
    for (const w of worktrees) {
      if (!map.has(w.path)) {
        map.set(w.path, {
          path: w.path,
          name: baseName(w.path),
          sessions: [],
          known: true
        })
      }
    }

    // Bucket sessions by their root. Sessions rooted at a path we never
    // saw in projects/worktrees still get their own (transient) group —
    // that's the whole point of "inverted view: folders with agents".
    for (const s of sessions) {
      const root = sessionRoot(s)
      const existing = map.get(root)
      if (existing) {
        existing.sessions.push(s)
      } else {
        map.set(root, {
          path: root,
          name: baseName(root),
          sessions: [s],
          known: false
        })
      }
    }

    const list = Array.from(map.values())
    // Folders with sessions first (descending count), then known empty
    // folders, then transient unknowns. Stable alpha tiebreak by name.
    list.sort((a, b) => {
      if (a.sessions.length !== b.sessions.length) {
        return b.sessions.length - a.sessions.length
      }
      if (a.known !== b.known) return a.known ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return list
  }, [sessions, projects, worktrees])

  const handleOpen = (id: string): void => {
    if (onOpen) onOpen(id)
    else setActive(id)
  }

  const toggle = (path: string, hasSessions: boolean): void => {
    setCollapsed((prev) => {
      // Default state: expanded when the group has sessions, collapsed
      // when empty. `prev[path]` is undefined until the user touches it.
      const current = prev[path] ?? !hasSessions
      return { ...prev, [path]: !current }
    })
  }

  if (groups.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <Folder size={28} strokeWidth={1.25} className="text-text-4" />
        <div className="text-xs text-text-2">no agents running</div>
        <div className="text-[11px] text-text-4">
          start one from the command palette or <span className="font-mono">+ new session</span>.
        </div>
      </div>
    )
  }

  // Early-out for the "no sessions anywhere" case — still show the
  // registered folders so the user can start one, but flag the empty
  // state at the top.
  const anySessions = groups.some((g) => g.sessions.length > 0)

  return (
    <div className="df-scroll flex min-h-0 flex-1 flex-col overflow-y-auto py-1.5">
      {!anySessions ? (
        <div className="mx-2 mb-2 rounded-md border border-border-soft bg-bg-2 px-3 py-2 text-[11px] text-text-3">
          no agents running — pick a folder below to start one.
        </div>
      ) : null}
      {groups.map((g) => {
        const hasSessions = g.sessions.length > 0
        const isCollapsed = collapsed[g.path] ?? !hasSessions
        return (
          <FolderRow
            key={g.path}
            group={g}
            collapsed={isCollapsed}
            onToggle={() => toggle(g.path, hasSessions)}
            onOpen={handleOpen}
            activeId={activeId}
          />
        )
      })}
    </div>
  )
}

interface FolderRowProps {
  group: FolderGroup
  collapsed: boolean
  onToggle: () => void
  onOpen: (id: string) => void
  activeId: string | null
}

function FolderRow({ group, collapsed, onToggle, onOpen, activeId }: FolderRowProps) {
  const hasSessions = group.sessions.length > 0
  const dim = !hasSessions
  return (
    <div className={`mb-0.5 ${dim ? 'opacity-60' : ''}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-bg-3"
        title={group.path}
      >
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={`shrink-0 text-text-4 transition-transform ${
            collapsed ? '' : 'rotate-90'
          }`}
        />
        {collapsed ? (
          <Folder size={14} strokeWidth={1.75} className="shrink-0 text-accent-400" />
        ) : (
          <FolderOpen size={14} strokeWidth={1.75} className="shrink-0 text-accent-400" />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-text-1">{group.name}</span>
            {hasSessions ? (
              <span className="shrink-0 rounded-sm border border-border-soft bg-bg-3 px-1 py-px font-mono text-[9px] text-text-3">
                {group.sessions.length}
              </span>
            ) : null}
          </div>
          <span className="truncate font-mono text-[10px] text-text-4" title={group.path}>
            {group.path}
          </span>
        </div>
      </button>
      {!collapsed ? (
        <div className="pb-1">
          {hasSessions ? (
            group.sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                active={s.id === activeId}
                onOpen={onOpen}
              />
            ))
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-1.5 py-1 pl-9 pr-2 text-left text-[11px] text-text-3 hover:bg-bg-3 hover:text-text-1"
              title={`start a new session in ${group.path}`}
              disabled
            >
              <Plus size={11} strokeWidth={2} className="shrink-0 text-text-4" />
              <span className="truncate">new session here</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}

interface SessionRowProps {
  session: SessionMeta
  active: boolean
  onOpen: (id: string) => void
}

function SessionRow({ session, active, onOpen }: SessionRowProps) {
  const accent = session.accentColor ?? defaultAgentColor(session.id)
  // Prefer the image avatar when the session has one set; otherwise fall
  // back to an accent-tinted dot. Emoji avatars render as-is inline.
  const avatar = session.avatar
  const isImage = isAvatarUrl(avatar)
  return (
    <button
      type="button"
      onClick={() => onOpen(session.id)}
      className={`flex h-8 w-full items-center gap-2 py-1 pl-6 pr-2 text-left text-xs hover:bg-bg-3 ${
        active ? 'bg-accent-500/15 text-text-1' : 'text-text-2'
      }`}
      title={`${session.name}${session.branch ? ` · ${session.branch}` : ''}`}
    >
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-border-soft"
        style={{ backgroundColor: isImage ? undefined : accent }}
      >
        {isImage ? (
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : avatar ? (
          <span className="text-[10px] leading-none">{avatar}</span>
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="truncate">{session.name}</span>
        {session.branch ? (
          <span className="ml-1 font-mono text-[10px] text-text-4">· {session.branch}</span>
        ) : null}
      </span>
      <SessionStatePill state={session.state} />
    </button>
  )
}
