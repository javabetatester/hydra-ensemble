/**
 * ProjectChip — header chip showing the project the active team is
 * bound to. Phase-1 skeleton; the project switcher menu is wired in a
 * later commit. Keeps a redundancy with the breadcrumb's project crumb
 * on purpose: the chip is for switching, the crumb is for path
 * context (nav-state-active per ui-ux-pro-max).
 */

import { ChevronDown, Folder } from 'lucide-react'
import { useMemo } from 'react'
import { useOrchestra } from './state/orchestra'

function basename(p: string): string {
  if (!p) return ''
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export default function ProjectChip() {
  const teams = useOrchestra((s) => s.teams)
  const activeTeamId = useOrchestra((s) => s.activeTeamId)

  const activeTeam = useMemo(
    () => teams.find((t) => t.id === activeTeamId) ?? null,
    [teams, activeTeamId]
  )

  if (!activeTeam?.worktreePath) return null

  return (
    <button
      type="button"
      // The dropdown menu lands in a follow-up commit. Until then the
      // chip is a passive label — clickable for the future affordance
      // but currently a no-op so the rest of the chrome refactor can
      // ship behind it.
      className="flex h-7 min-w-0 items-center gap-1.5 rounded-sm border border-border-soft bg-bg-3/40 px-2 text-[11px] text-text-2 hover:border-border-mid hover:bg-bg-3 hover:text-text-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-400"
      title={activeTeam.worktreePath}
      aria-label={`Project ${activeTeam.worktreePath}`}
    >
      <Folder
        size={12}
        strokeWidth={1.75}
        className="shrink-0 text-accent-400"
        aria-hidden
      />
      <span className="max-w-[180px] truncate font-mono text-[11px]">
        {basename(activeTeam.worktreePath)}
      </span>
      <ChevronDown
        size={11}
        strokeWidth={1.75}
        className="shrink-0 text-text-4"
        aria-hidden
      />
    </button>
  )
}
