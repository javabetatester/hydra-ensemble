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
import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react'
import { useOrchestra } from './state/orchestra'

const STORAGE_KEYS = {
  minimap: 'hydra.orchestra.view.minimap',
  toolbar: 'hydra.orchestra.view.toolbar',
  tasksPanel: 'hydra.orchestra.view.tasksPanel'
} as const

type ViewKey = keyof typeof STORAGE_KEYS

interface ViewToggle {
  key: ViewKey
  label: string
  /** Default ON — users expect a full canvas on first run and explicitly
   *  hide chrome, not the other way round. */
  defaultOn: boolean
}

const VIEW_TOGGLES: ViewToggle[] = [
  { key: 'minimap', label: 'Show minimap', defaultOn: true },
  { key: 'toolbar', label: 'Show toolbar', defaultOn: true },
  { key: 'tasksPanel', label: 'Show tasks panel', defaultOn: true }
]

function readFlag(key: ViewKey, defaultOn: boolean): boolean {
  if (typeof window === 'undefined') return defaultOn
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[key])
    if (raw === null) return defaultOn
    return raw !== 'false'
  } catch {
    return defaultOn
  }
}

function writeFlag(key: ViewKey, on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS[key], on ? 'true' : 'false')
  } catch {
    /* localStorage unavailable — tolerate it silently; in-memory state still
     *  reflects the toggle for the rest of the session. */
  }
}

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

  // Scope the live pill counters to the active team — otherwise a global
  // count would mislead the user on multi-team workspaces.
  const { teamAgentCount, teamTaskCount } = useMemo(() => {
    if (!activeTeam) return { teamAgentCount: 0, teamTaskCount: 0 }
    let a = 0
    let t = 0
    for (const ag of agents) if (ag.teamId === activeTeam.id) a++
    for (const tk of tasks) if (tk.teamId === activeTeam.id) t++
    return { teamAgentCount: a, teamTaskCount: t }
  }, [activeTeam, agents, tasks])

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

  // View dropdown — toggles hydrate lazily from localStorage on mount so the
  // layout the user left with is the layout they come back to.
  const [viewOpen, setViewOpen] = useState<boolean>(false)
  const [flags, setFlags] = useState<Record<ViewKey, boolean>>(() => ({
    minimap: readFlag('minimap', true),
    toolbar: readFlag('toolbar', true),
    tasksPanel: readFlag('tasksPanel', true)
  }))

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

  const toggleFlag = (key: ViewKey): void => {
    setFlags((prev) => {
      const next = !prev[key]
      writeFlag(key, next)
      return { ...prev, [key]: next }
    })
  }

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

  const anyFlagOff = !flags.minimap || !flags.toolbar || !flags.tasksPanel
  const ViewIcon = anyFlagOff ? EyeOff : Eye

  return (
    <div
      className="flex h-7 w-full items-center justify-between gap-2 border-b border-border-soft bg-bg-2 px-3 py-1 text-[11px] text-text-3"
      role="navigation"
      aria-label="Orchestra breadcrumb"
    >
      {/* Left: breadcrumb trail */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className="rounded-sm px-1 py-0.5 text-text-4 hover:text-text-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-400"
          tabIndex={0}
          role="link"
          aria-label="Orchestra"
        >
          Orchestra
        </span>

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

      {/* Right: live pill + View dropdown (only when a team is active) */}
      {activeTeam ? (
        <div ref={wrapperRef} className="relative flex shrink-0 items-center gap-2">
          <span
            className="rounded-sm bg-bg-3 px-1.5 py-0.5 font-mono text-[10px] text-text-2"
            aria-live="polite"
            title="Agents and tasks in the active team"
          >
            {teamAgentCount} {teamAgentCount === 1 ? 'agent' : 'agents'} ·{' '}
            {teamTaskCount} {teamTaskCount === 1 ? 'task' : 'tasks'}
          </span>

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
              className="absolute right-0 top-full z-50 mt-1 w-[180px] rounded-sm border border-border-mid bg-bg-2 py-1 shadow-pop"
              role="menu"
              aria-label="Orchestra view toggles"
            >
              {VIEW_TOGGLES.map((t) => {
                const on = flags[t.key]
                const Icon = on ? Eye : EyeOff
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    onClick={() => toggleFlag(t.key)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] text-text-2 hover:bg-bg-3 hover:text-text-1 focus:outline-none"
                  >
                    <Icon
                      size={12}
                      strokeWidth={1.75}
                      className={`shrink-0 ${on ? 'text-accent-400' : 'text-text-4'}`}
                      aria-hidden
                    />
                    <span className="flex-1 truncate">{t.label}</span>
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
