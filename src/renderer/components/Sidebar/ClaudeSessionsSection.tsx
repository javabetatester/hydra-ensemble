import { useEffect, type ReactNode } from 'react'
import { GitBranch, MessageSquare, Play, RefreshCw } from 'lucide-react'
import { useClaudeSessions } from '../../state/claude-sessions'
import { useSessions } from '../../state/sessions'
import { relativeTime } from '../../lib/time'

/**
 * Inline list of past Claude Code sessions for a project, rendered
 * inside the project row (not as a standalone sidebar section). Shows
 * title, relative time, branch, message count, and a Resume button.
 *
 * Renamed from "Claude Sessions" to "Agent Sessions" in the UI, but
 * the filename stays for import stability.
 */

interface Props {
  projectPath: string
}

export default function AgentSessionsList({ projectPath }: Props): ReactNode {
  const sessions = useClaudeSessions((s) => s.sessions)
  const loading = useClaudeSessions((s) => s.loading)
  const loadedFor = useClaudeSessions((s) => s.loadedFor)
  const error = useClaudeSessions((s) => s.error)
  const refresh = useClaudeSessions((s) => s.refresh)
  const resume = useClaudeSessions((s) => s.resume)

  const claudeSessionCount = useSessions(
    (s) => s.sessions.filter((sess) => (sess.provider ?? 'claude') === 'claude').length
  )

  useEffect(() => {
    void refresh(projectPath)
  }, [projectPath, refresh])

  useEffect(() => {
    void refresh(projectPath)
  }, [claudeSessionCount, projectPath, refresh])

  const isStale = loadedFor !== projectPath && loading
  const visible = isStale ? [] : sessions

  return (
    <div className="flex flex-col gap-0.5 pl-4">
      {/* Sub-header */}
      <div className="flex items-center justify-between py-0.5 pl-2 pr-1">
        <span className="text-[9px] font-medium uppercase tracking-wider text-text-4">
          Agent sessions
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void refresh(projectPath)
          }}
          className="flex h-4 w-4 items-center justify-center rounded text-text-4 transition-colors hover:bg-bg-3 hover:text-text-1"
          title="refresh sessions"
          aria-label="refresh sessions"
          disabled={loading}
        >
          <RefreshCw
            size={9}
            strokeWidth={1.75}
            className={loading ? 'animate-spin' : ''}
          />
        </button>
      </div>

      {error ? (
        <div className="px-2 py-1 text-[10px] text-status-attention">{error}</div>
      ) : loading && visible.length === 0 ? (
        <div className="px-2 py-1 text-[10px] text-text-4">loading…</div>
      ) : visible.length === 0 ? (
        <div className="px-2 py-1 text-[10px] text-text-4">no previous sessions</div>
      ) : (
        <div
          className="df-scroll overflow-y-auto"
          style={{ maxHeight: 5 * 40 }}
        >
          {visible.map((session) => (
            <div
              key={session.sessionId}
              className="group flex items-start gap-1.5 rounded-sm px-2 py-1 text-left text-[11px] text-text-2 transition-colors hover:bg-bg-3"
              title={`${session.title || session.sessionId}\n${session.sessionId}`}
            >
              <MessageSquare
                size={11}
                strokeWidth={1.75}
                className="mt-0.5 shrink-0 text-accent-400"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate leading-tight text-text-2">
                  {session.title || <em className="text-text-4">untitled</em>}
                </span>
                <div className="mt-0.5 flex items-center gap-1 text-[9px] text-text-4">
                  <span>{relativeTime(session.mtime)}</span>
                  {session.gitBranch && (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-0.5 truncate">
                        <GitBranch size={8} strokeWidth={1.75} />
                        <span className="truncate">{session.gitBranch}</span>
                      </span>
                    </>
                  )}
                  {session.messageCount > 0 && (
                    <>
                      <span>·</span>
                      <span>{session.messageCount} msg</span>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void resume(projectPath, session.sessionId)
                }}
                className="mt-0.5 hidden shrink-0 items-center gap-0.5 rounded-sm bg-bg-3 px-1 py-0.5 text-[9px] font-medium text-text-2 transition-all hover:bg-accent-500/15 hover:text-accent-500 group-hover:inline-flex"
                title={`resume claude --resume ${session.sessionId}`}
                aria-label="resume session"
              >
                <Play size={8} strokeWidth={2} />
                <span>Resume</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
