/**
 * OrchestraBreadcrumb — Linear-style compact command strip pinned to the top
 * of the Orchestra view.
 *
 * Layout (left → right):
 *   Orchestra  /  <team name>  /  <context label>                 [pill] [View ▾]
 *
 * - `Orchestra` is a muted, non-interactive crumb anchoring the trail.
 * - The team crumb shows the active team name; when no team is active it acts
 *   as a call-to-action and dispatches `orchestra:new-team` so the host can
 *   open the blank-team flow (mirrors `TeamSwitcher` / `TeamRail`).
 * - The context crumb resolves to the selected agent's name, else
 *   `Task: <title>` when a task drawer is open, else nothing — the separator
 *   is only rendered when there is context to show.
 *
 * The right cluster is only mounted when there IS an active team:
 *   - a live pill summarising `N agents · M tasks` scoped to that team
 *   - a `View` dropdown with three toggles that persist under
 *     `hydra.orchestra.view.minimap`, `hydra.orchestra.view.toolbar`,
 *     `hydra.orchestra.view.tasksPanel` so the chosen layout survives
 *     reloads. The dropdown closes on outside click or Escape.
 *
 * Parent integration wiring (top-header mount, keybind, and consuming the
 * persisted toggles in the canvas chrome) is expected to happen in the
 * surrounding Orchestra header — this component is intentionally self
 * contained. `Ctrl+/` to focus the breadcrumb is left as a TODO because the
 * parent owns the global keybind routing (see `useOrchestraKeybinds`).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, Folder } from 'lucide-react'
import { useOrchestra } from './state/orchestra'
import { useOrchestraPanels } from '../state/orchestraPanels'

/** Last segment of a unix/windows path, or the full string if it has no
 *  separators. Used to render a compact "project" crumb. */
function basename(p: string): string {
  if (!p) return ''
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** Toggles surfaced in the View ▾ dropdown. Order here drives the
 *  vertical order in the menu. The toggle key matches the field name
 *  on `useOrchestraPanels` so the wiring stays one-line below. */
type ViewKey = 'templates' | 'projects' | 'tasksPanel' | 'minimap' | 'toolbar'

const VIEW_TOGGLES: ReadonlyArray<{ key: ViewKey; label: string; shortcut?: string }> = [
  { key: 'templates', label: 'Show Templates Library', shortcut: 'Ctrl+Shift+L' },
  { key: 'projects', label: 'Show Projects & Teams', shortcut: 'Ctrl+Shift+P' },
  { key: 'tasksPanel', label: 'Show tasks panel', shortcut: 'Ctrl+Shift+J' },
  { key: 'minimap', label: 'Show minimap' },
  { key: 'toolbar', label: 'Show toolbar' }
]

interface Props {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function OrchestraBreadcrumb(_props: Props = {}) {
  const teams = useOrchestra((s) => s.teams)
  const agents = useOrchestra((s) => s.agents)
  const tasks = useOrchestra((s) => s.tasks)
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const selectedAgentIds = useOrchestra((s) => s.selectedAgentIds)
  const taskDrawerTaskId = useOrchestra((s) => s.taskDrawerTaskId)

  const activeTeam = useMemo(
    () => teams.find((t) => t.id === activeTeamId) ?? null,
    [teams, activeTeamId]
  )

  // Context label: agent selection takes precedence over task drawer so the
  // user always knows what the inspector is talking about.
  const contextLabel = useMemo<string | null>(() => {
    const firstSelected = selectedAgentIds[0]
    if (firstSelected) {
      const ag = agents.find((a) => a.id === firstSelected)
      if (ag) return ag.name
    }
    if (taskDrawerTaskId) {
      const task = tasks.find((t) => t.id === taskDrawerTaskId)
      if (task) return `Task: ${task.title}`
    }
    return null
  }, [agents, tasks, selectedAgentIds, taskDrawerTaskId])

  // View dropdown — backed by `useOrchestraPanels` so the keybinds
  // (Ctrl+Shift+L/P/J) and the menu manipulate the same flags.
  const [viewOpen, setViewOpen] = useState<boolean>(false)
  const panelFlags = useOrchestraPanels((s) => ({
    templates: s.templates,
    projects: s.projects,
    tasksPanel: s.tasksPanel,
    minimap: s.minimap,
    toolbar: s.toolbar
  }))
  const togglePanel = (key: ViewKey): void => {
    const st = useOrchestraPanels.getState()
    switch (key) {
      case 'templates':
        st.toggleTemplates()
        return
      case 'projects':
        st.toggleProjects()
        return
      case 'tasksPanel':
        st.toggleTasksPanel()
        return
      case 'minimap':
        st.toggleMinimap()
        return
      case 'toolbar':
        st.toggleToolbar()
        return
    }
  }

  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Outside-click + Escape closes the View popover. Uses `mousedown` so a
  // same-tick re-open from a downstream handler can't race the close.
  useEffect(() => {
    if (!viewOpen) return
    const onDown = (e: MouseEvent): void => {
      const w = wrapperRef.current
      if (!w) return
      if (!w.contains(e.target as Node)) setViewOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setViewOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [viewOpen])

  const onTeamCrumbClick = (): void => {
    // When there is no active team, the crumb doubles as a CTA so users can
    // start from a blank team without rummaging through the rail.
    if (!activeTeam) {
      window.dispatchEvent(new CustomEvent('orchestra:new-team'))
    }
    // With an active team the click is a no-op here — TeamSwitcher (rendered
    // elsewhere in the header) owns the team-switch popover.
  }

  const teamCrumbLabel = activeTeam ? activeTeam.name : 'New team'

  // TODO: wire Ctrl+/ to focus this breadcrumb once the parent header routes
  // the global keybind via `useOrchestraKeybinds`.

  const anyFlagOff =
    !panelFlags.templates ||
    !panelFlags.projects ||
    !panelFlags.tasksPanel ||
    !panelFlags.minimap ||
    !panelFlags.toolbar
  // The Templates panel defaults to closed, so "any flag off" being
  // true at boot is normal — flip the icon only when the user has
  // hidden something a beginner would expect to be on.
  const userHidSomething =
    !panelFlags.projects ||
    !panelFlags.tasksPanel ||
    !panelFlags.minimap ||
    !panelFlags.toolbar
  const ViewIcon = userHidSomething ? EyeOff : Eye
  void anyFlagOff

  return (
    <div
      className="flex h-[22px] w-full items-center justify-between gap-2 border-b border-border-soft bg-bg-2 px-3 text-[11px] text-text-3"
      role="navigation"
      aria-label="Orchestrador breadcrumb"
    >
      {/* Left: breadcrumb trail */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="rounded-sm px-1 py-0.5 text-text-4 hover:text-text-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-400"
          tabIndex={0}
          role="link"
          aria-label="Orchestrador"
        >
          Orchestrador
        </span>

        {activeTeam?.worktreePath ? (
          <>
            <ChevronRight
              size={11}
              strokeWidth={1.75}
              className="shrink-0 text-text-4"
              aria-hidden
            />
            {/* Project crumb — surfaces which project the active team
                 is bound to. The chip is a non-link label since the
                 project switch lives in the global drawer; the title
                 attribute exposes the full path for paths that exceed
                 the truncation budget. */}
            <span
              className="flex min-w-0 items-center gap-1 rounded-sm bg-bg-3/60 px-1.5 py-0.5 font-mono text-[10px] text-text-2"
              title={activeTeam.worktreePath}
            >
              <Folder
                size={10}
                strokeWidth={1.75}
                className="shrink-0 text-accent-400"
                aria-hidden
              />
              <span className="max-w-[160px] truncate">
                {basename(activeTeam.worktreePath)}
              </span>
            </span>
          </>
        ) : null}

        <ChevronRight
          size={11}
          strokeWidth={1.75}
          className="shrink-0 text-text-4"
          aria-hidden
        />

        <button
          type="button"
          onClick={onTeamCrumbClick}
          className={`truncate rounded-sm px-1 py-0.5 hover:bg-bg-3 hover:text-text-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-400 ${
            activeTeam ? 'text-text-2' : 'text-text-3 italic'
          }`}
          title={
            activeTeam
              ? `Active team: ${activeTeam.name}`
              : 'No team selected — click to create one'
          }
        >
          <span className="max-w-[200px] truncate">{teamCrumbLabel}</span>
        </button>

        {contextLabel ? (
          <>
            <ChevronRight
              size={11}
              strokeWidth={1.75}
              className="shrink-0 text-text-4"
              aria-hidden
            />
            <span
              className="truncate rounded-sm px-1 py-0.5 text-text-2 hover:bg-bg-3 hover:text-text-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-400"
              tabIndex={0}
              title={contextLabel}
            >
              <span className="inline-block max-w-[260px] truncate align-bottom">
                {contextLabel}
              </span>
            </span>
          </>
        ) : null}
      </div>

      {/* Right: View dropdown (only when a team is active). The
           counter pill that lived here moved to the header, removing
           a redundant "N agents · M tasks" instance and freeing the
           breadcrumb to be a pure navigation trail. */}
      {activeTeam ? (
        <div ref={wrapperRef} className="relative flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setViewOpen((v) => !v)}
            className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-text-3 hover:bg-bg-3 hover:text-text-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-400"
            aria-haspopup="menu"
            aria-expanded={viewOpen}
            title="View options"
          >
            <ViewIcon size={11} strokeWidth={1.75} className="shrink-0" aria-hidden />
            <span>View</span>
            <ChevronDown size={11} strokeWidth={1.75} className="shrink-0 text-text-4" />
          </button>

          {viewOpen ? (
            <div
              className="absolute right-0 top-full z-50 mt-1 w-[230px] rounded-sm border border-border-mid bg-bg-2 py-1 shadow-pop"
              role="menu"
              aria-label="Orchestrador view toggles"
            >
              {VIEW_TOGGLES.map((t) => {
                const on = panelFlags[t.key]
                const Icon = on ? Eye : EyeOff
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    onClick={() => togglePanel(t.key)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] text-text-2 hover:bg-bg-3 hover:text-text-1 focus:outline-none"
                  >
                    <Icon
                      size={12}
                      strokeWidth={1.75}
                      className={`shrink-0 ${on ? 'text-accent-400' : 'text-text-4'}`}
                      aria-hidden
                    />
                    <span className="flex-1 truncate">{t.label}</span>
                    {t.shortcut ? (
                      <span className="shrink-0 font-mono text-[9px] text-text-4">
                        {t.shortcut}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
