import { useEffect, useMemo, useState } from 'react'
import { GitBranch, Folder, Edit3, RotateCw, Bot, Sparkles } from 'lucide-react'
import type { SessionMeta } from '../../shared/types'
import AgentAvatar from './AgentAvatar'
import SessionStatePill from './SessionStatePill'
import AgentEditDialog from './AgentEditDialog'
import { defaultAgentColor, hexAlpha } from '../lib/agent'
import { formatModel } from './StatusBar'
import { useProjects } from '../state/projects'

interface Props {
  session: SessionMeta
  onRestart?: () => void
}

/**
 * Compact strip rendered above the active terminal. Conveys "you are inside
 * agent X's workspace" with avatar, name, branch, and live sub-status.
 */
export default function ActiveAgentBar({ session, onRestart }: Props) {
  const [editing, setEditing] = useState<SessionMeta | null>(null)
  const [, force] = useState(0)
  const accent = session.accentColor || defaultAgentColor(session.id)
  const projects = useProjects((s) => s.projects)
  /** Project label derived from the session's cwd: friendly name when
   *  the cwd matches a known project, basename otherwise. */
  const projectName = useMemo(() => {
    if (!session.cwd) return ''
    const matched = projects.find((p) => p.path === session.cwd)
    if (matched) return matched.name
    const parts = session.cwd.split(/[/\\]/).filter(Boolean)
    return parts[parts.length - 1] ?? ''
  }, [session.cwd, projects])

  // Cheap re-render so the live sub-status feels alive (clock dots).
  useEffect(() => {
    if (session.state !== 'thinking' && session.state !== 'generating') return
    const t = setInterval(() => force((n) => n + 1), 700)
    return () => clearInterval(t)
  }, [session.state])

  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-border-soft bg-bg-2 px-3 py-2"
      style={{ boxShadow: `inset 0 -2px 0 0 ${hexAlpha(accent, 0.45)}` }}
    >
      <button
        type="button"
        onClick={() => setEditing(session)}
        className="flex items-center gap-2.5 rounded-sm px-1 py-0.5 transition hover:bg-bg-3"
        title="edit agent"
      >
        <AgentAvatar session={session} size={26} />
        <div className="flex min-w-0 flex-col text-left leading-tight">
          <span className="flex min-w-0 items-center gap-1.5">
            {session.provider && session.provider !== 'claude' ? (
              <span
                className="shrink-0 rounded-sm bg-bg-3 p-0.5 text-text-3"
                title={`agent: ${session.provider}`}
                aria-label={`agent: ${session.provider}`}
              >
                {session.provider === 'copilot' ? (
                  <Bot size={11} strokeWidth={1.75} />
                ) : (
                  <Sparkles size={11} strokeWidth={1.75} />
                )}
              </span>
            ) : null}
            <span className="truncate text-sm font-semibold text-text-1">{session.name}</span>
          </span>
          {session.description ? (
            <span className="truncate text-[11px] italic text-text-3">{session.description}</span>
          ) : (
            <span className="font-mono text-[10px] text-text-4">/{session.id.slice(0, 8)}</span>
          )}
        </div>
      </button>

      {/* Project chip lives on the LEFT next to the session identity so
          repo context is the first thing the user sees, not the last.
          Branch follows it (still left-side). */}
      {projectName ? (
        <span
          className="flex items-center gap-1.5 font-mono text-[11px] text-text-3"
          title={session.cwd}
        >
          <Folder size={12} strokeWidth={1.75} className="text-text-4" />
          <span className="text-text-2">{projectName}</span>
        </span>
      ) : null}
      {session.branch ? (
        <>
          <span className="font-mono text-[11px] text-text-4">·</span>
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-text-3">
            <GitBranch size={12} strokeWidth={1.75} className="text-text-4" />
            <span className="text-text-2">{session.branch}</span>
          </span>
        </>
      ) : null}

      {session.subStatus ? (
        <div className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[11px] text-text-3">
          <span className="text-text-4">{session.subStatus}</span>
          {session.subTarget ? (
            <span className="truncate text-text-2">{session.subTarget}</span>
          ) : null}
          {(session.state === 'thinking' || session.state === 'generating') ? (
            <BlinkingDots />
          ) : null}
        </div>
      ) : null}

      {/* Right cluster — input status (state pill) + model. Edit and
          restart actions hang at the very end. */}
      <div className="ml-auto flex shrink-0 items-center gap-3 text-[11px] text-text-3">
        <SessionStatePill state={session.state ?? 'idle'} />
        <span className="h-5 w-px bg-border-soft" aria-hidden />
        <span className="font-mono">
          <span className="text-text-4">model</span>{' '}
          <span className="text-text-2">{formatModel(session.model)}</span>
        </span>
        <button
          type="button"
          onClick={() => setEditing(session)}
          className="rounded-sm p-1 text-text-4 hover:bg-bg-3 hover:text-text-1"
          title="edit agent"
          aria-label="edit agent"
        >
          <Edit3 size={12} strokeWidth={1.75} />
        </button>
        {onRestart ? (
          <button
            type="button"
            onClick={onRestart}
            className="rounded-sm p-1 text-text-4 hover:bg-bg-3 hover:text-text-1"
            title="restart"
            aria-label="restart"
          >
            <RotateCw size={12} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      <AgentEditDialog session={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function BlinkingDots() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN((v) => (v + 1) % 4), 400)
    return () => clearInterval(t)
  }, [])
  return <span className="font-mono text-text-4">{'.'.repeat(n)}</span>
}
