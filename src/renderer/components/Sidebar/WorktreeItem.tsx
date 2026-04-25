import { useState } from 'react'
import { GitBranch, CornerDownRight, Copy, Trash2, Terminal } from 'lucide-react'
import type { Worktree } from '../../../shared/types'
import ContextMenu, { type ContextMenuItem } from '../ContextMenu'

interface WorktreeItemProps {
  worktree: Worktree
  hasSession: boolean
  /** Total sessions tied to this worktree (running + idle). */
  sessionCount?: number
  /** Sessions currently in 'thinking' or 'generating' — i.e. an agent
   *  is actively working in this worktree right now. */
  activeCount?: number
  onOpenSession: () => void
  onRemove: () => void
  onCopyPath: () => void
}

export default function WorktreeItem({
  worktree,
  hasSession,
  sessionCount = 0,
  activeCount = 0,
  onOpenSession,
  onRemove,
  onCopyPath
}: WorktreeItemProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const branch = worktree.branch || 'detached'
  const items: ContextMenuItem[] = [
    {
      label: hasSession ? 'Switch to session' : 'Open session',
      onSelect: onOpenSession,
      icon: <Terminal size={14} strokeWidth={1.75} />
    },
    {
      label: 'Copy path',
      onSelect: onCopyPath,
      icon: <Copy size={14} strokeWidth={1.75} />
    },
    {
      label: 'Remove worktree',
      onSelect: onRemove,
      danger: true,
      disabled: worktree.isMain || worktree.isBare,
      icon: <Trash2 size={14} strokeWidth={1.75} />
    }
  ]

  return (
    <>
      <div
        className="group flex items-center gap-1.5 rounded-sm py-1 pl-6 pr-2 text-xs text-text-2 transition-colors hover:bg-bg-3 hover:text-text-1"
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title={worktree.path}
      >
        <GitBranch
          size={12}
          strokeWidth={1.75}
          className={
            worktree.isMain
              ? 'shrink-0 text-accent-400'
              : 'shrink-0 text-text-4'
          }
          aria-hidden
        />
        <button
          type="button"
          onClick={onOpenSession}
          className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left"
        >
          <span className="truncate font-mono text-text-1">{branch}</span>
          {worktree.isMain && (
            <span className="shrink-0 rounded-sm bg-bg-3 px-1 text-[9px] font-medium uppercase tracking-wider text-text-4">
              main
            </span>
          )}
          {activeCount > 0 ? (
            <span
              className="ml-0.5 flex shrink-0 items-center gap-1"
              title={`${activeCount} agent${activeCount > 1 ? 's' : ''} working`}
              aria-label={`${activeCount} agent${activeCount > 1 ? 's' : ''} working`}
            >
              <span className="relative flex h-2 w-2 items-center justify-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-status-thinking opacity-60" />
                <span className="relative h-2 w-2 rounded-full bg-status-thinking" />
              </span>
              {sessionCount > 1 && (
                <span className="rounded-sm bg-status-thinking/15 px-1 py-px font-mono text-[9px] font-medium text-status-thinking">
                  {sessionCount}
                </span>
              )}
            </span>
          ) : hasSession ? (
            <span
              className="ml-0.5 flex shrink-0 items-center gap-1"
              title={`${sessionCount} idle session${sessionCount > 1 ? 's' : ''}`}
              aria-label={`${sessionCount} idle session${sessionCount > 1 ? 's' : ''}`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-4" />
              {sessionCount > 1 && (
                <span className="rounded-sm bg-bg-3 px-1 py-px font-mono text-[9px] text-text-4">
                  {sessionCount}
                </span>
              )}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onOpenSession}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-4 opacity-0 transition hover:bg-bg-4 hover:text-accent-400 group-hover:opacity-100"
          title={hasSession ? 'switch to session' : 'open session'}
          aria-label={hasSession ? 'switch to session' : 'open session'}
        >
          <CornerDownRight size={12} strokeWidth={1.75} />
        </button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onDismiss={() => setMenu(null)} />}
    </>
  )
}
