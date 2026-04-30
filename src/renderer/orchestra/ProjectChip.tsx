/**
 * ProjectChip — header chip showing the project the active team is
 * bound to, with a dropdown menu listing all known projects (with
 * team counters) and a "Open in Dashboard" CTA that exits the
 * orchestrator while preserving project context.
 *
 * Phase-4 of the orchestrator UI proposal. Mirror affordance to the
 * breadcrumb's project crumb: the breadcrumb is the path label, this
 * chip is the switch.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ExternalLink, Folder } from 'lucide-react'
import { useOrchestra } from './state/orchestra'
import { useProjects } from '../state/projects'

function basename(p: string): string {
  if (!p) return ''
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** Inline-menu cap. Beyond this we fall back to a "More projects…"
 *  link that pops the global drawer (Ctrl+T) instead of growing the
 *  dropdown indefinitely. */
const INLINE_CAP = 6

export default function ProjectChip() {
  const teams = useOrchestra((s) => s.teams)
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const setActiveTeam = useOrchestra((s) => s.setActiveTeam)
  const setOverlayOpen = useOrchestra((s) => s.setOverlayOpen)
  const projects = useProjects((s) => s.projects)
  const setCurrentProject = useProjects((s) => s.setCurrent)

  const activeTeam = useMemo(
    () => teams.find((t) => t.id === activeTeamId) ?? null,
    [teams, activeTeamId]
  )

  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Outside-click + Escape close the menu. mousedown so a same-tick
  // re-open from a downstream handler can't race the close.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  /** Counts teams per project worktreePath. Recomputed when teams
   *  change — cheap (linear in team count) and saves us from passing
   *  `teams[]` into every menu item render. */
  const teamCountByPath = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of teams) {
      const k = t.worktreePath || ''
      map.set(k, (map.get(k) ?? 0) + 1)
    }
    return map
  }, [teams])

  if (!activeTeam?.worktreePath) return null

  const activePath = activeTeam.worktreePath
  const inlineProjects = projects.slice(0, INLINE_CAP)
  const overflow = projects.length - inlineProjects.length

  const switchToProject = (path: string): void => {
    // Find the first team in the destination project and activate it
    // so the canvas updates without a flash of "no team selected".
    const team = teams.find((t) => t.worktreePath === path)
    if (team) setActiveTeam(team.id)
    void setCurrentProject(path)
    setOpen(false)
  }

  const exitToDashboard = (): void => {
    void setCurrentProject(activePath)
    setOverlayOpen(false)
    setOpen(false)
  }

  const openProjectsDrawer = (): void => {
    setOpen(false)
    window.dispatchEvent(new CustomEvent('orchestra:open-projects-drawer'))
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex h-7 min-w-0 items-center gap-1.5 rounded-sm border px-2 text-[11px] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-400 ${
          open
            ? 'border-accent-500/40 bg-accent-500/10 text-accent-200'
            : 'border-border-soft bg-bg-3/40 text-text-2 hover:border-border-mid hover:bg-bg-3 hover:text-text-1'
        }`}
        title={activePath}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Project ${activePath}`}
      >
        <Folder
          size={12}
          strokeWidth={1.75}
          className="shrink-0 text-accent-400"
          aria-hidden
        />
        <span className="max-w-[180px] truncate font-mono text-[11px]">
          {basename(activePath)}
        </span>
        <ChevronDown
          size={11}
          strokeWidth={1.75}
          className="shrink-0 text-text-4"
          aria-hidden
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Switch project"
          className="absolute left-0 top-full z-50 mt-1 w-[260px] overflow-hidden rounded-sm border border-border-mid bg-bg-2 py-1 shadow-pop"
        >
          <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-text-4">
            switch project
          </div>
          {inlineProjects.length === 0 ? (
            <div className="px-2 py-2 text-[11px] text-text-3">No projects yet.</div>
          ) : (
            <div className="flex flex-col">
              {inlineProjects.map((p) => {
                const count = teamCountByPath.get(p.path) ?? 0
                const isActive = p.path === activePath
                return (
                  <button
                    key={p.path}
                    type="button"
                    role="menuitem"
                    onClick={() => switchToProject(p.path)}
                    title={p.path}
                    className={`flex items-center gap-2 px-2 py-1.5 text-left text-[11px] transition-colors ${
                      isActive
                        ? 'bg-accent-500/10 text-accent-200'
                        : 'text-text-2 hover:bg-bg-3 hover:text-text-1'
                    }`}
                  >
                    <Folder
                      size={11}
                      strokeWidth={1.75}
                      className={`shrink-0 ${isActive ? 'text-accent-400' : 'text-text-4'}`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {basename(p.path)}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-text-4">
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {overflow > 0 ? (
            <button
              type="button"
              role="menuitem"
              onClick={openProjectsDrawer}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] text-text-3 hover:bg-bg-3 hover:text-text-1"
            >
              <span className="min-w-0 flex-1 truncate">
                More projects… ({overflow})
              </span>
            </button>
          ) : null}
          <div className="my-1 h-px bg-border-soft" />
          <button
            type="button"
            role="menuitem"
            onClick={exitToDashboard}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] text-text-2 hover:bg-bg-3 hover:text-text-1"
          >
            <ExternalLink
              size={11}
              strokeWidth={1.75}
              className="shrink-0 text-text-4"
              aria-hidden
            />
            <span>Open in Dashboard</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
