/**
 * TeamRailGroup — collapsible header that groups TeamRail rows by
 * project worktreePath. Renders nothing of substance on its own; the
 * row list is the parent's responsibility.
 *
 * Status dot follows priority: any running > any attention > idle.
 *
 * Phase-2 of the orchestrator UI proposal (issue #12 follow-up).
 */

import { ChevronDown, ChevronRight, Folder } from 'lucide-react'

export type GroupStatus = 'idle' | 'running' | 'attention'

interface Props {
  projectPath: string
  /** Last segment of the path, pre-computed by the parent so this
   *  component stays presentational. */
  basename: string
  teamCount: number
  expanded: boolean
  onToggle: () => void
  status: GroupStatus
}

const DOT_TONE: Record<GroupStatus, string> = {
  idle: 'bg-text-4',
  running: 'bg-accent-400',
  attention: 'bg-status-attention'
}

export default function TeamRailGroup({
  projectPath,
  basename,
  teamCount,
  expanded,
  onToggle,
  status
}: Props) {
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <button
      type="button"
      onClick={onToggle}
      title={projectPath}
      aria-expanded={expanded}
      className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-text-3 hover:bg-bg-3 hover:text-text-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-400"
    >
      <Chevron size={11} strokeWidth={1.75} className="shrink-0 text-text-4" aria-hidden />
      <Folder size={11} strokeWidth={1.75} className="shrink-0 text-accent-400" aria-hidden />
      <span className="min-w-0 flex-1 truncate normal-case tracking-normal">
        {basename}
      </span>
      <span className="shrink-0 font-mono text-[10px] tracking-normal text-text-4">
        {teamCount}
      </span>
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_TONE[status]}`}
        aria-label={`status: ${status}`}
      />
    </button>
  )
}
