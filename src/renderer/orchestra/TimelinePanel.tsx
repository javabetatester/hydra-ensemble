/**
 * TimelinePanel — compact gantt-style view of task lifecycle over the last
 * 60 minutes. One row per agent on the active team; each task becomes a bar
 * positioned horizontally by (createdAt → finishedAt/updatedAt), colored by
 * status. Clicking a bar opens the task drawer.
 *
 * Rendering is pure divs + inline styles (percent-based positioning) so it
 * reflows on panel resize without measuring or pulling in a chart lib.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Agent, Task, TaskStatus, UUID } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'

/** Rolling window for the timeline. 60 min matches the header label; changing
 *  one without the other would mislead the user. */
const WINDOW_MS = 60 * 60 * 1000
/** Tick every 10 min → 7 gridlines (0, 10, 20, 30, 40, 50, 60). */
const TICK_MS = 10 * 60 * 1000
/** Height per agent row; driven by spec and matched by the tick-label column
 *  so the gutter lines up with row centers. */
const ROW_HEIGHT_PX = 20
/** Minimum bar width so a sub-second task is still clickable on the grid. */
const MIN_BAR_PERCENT = 0.4
/** Tick the "now" cursor at 30 s — fast enough to feel live, slow enough to
 *  avoid gratuitous re-renders while the panel is idle. */
const TICK_INTERVAL_MS = 30_000

/** Status → Tailwind background class. Shared by the bars and the legend so
 *  the two never drift. */
const STATUS_COLOR: Record<TaskStatus, string> = {
  queued: 'bg-bg-3',
  routing: 'bg-bg-3',
  in_progress: 'bg-accent-500/60 animate-pulse',
  blocked: 'bg-amber-500/60',
  done: 'bg-emerald-500/60',
  failed: 'bg-red-500/60'
}

/** Compact ms → "1.2s" / "47s" / "4m" / "1h" formatter. Mirrors the style
 *  used in TasksHistoryPanel so durations read the same across panels. */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const sec = ms / 1000
  if (sec < 10) return `${sec.toFixed(1)}s`
  if (sec < 60) return `${Math.round(sec)}s`
  const min = sec / 60
  if (min < 60) return `${Math.round(min)}m`
  const hr = min / 60
  return `${hr.toFixed(1)}h`
}

/** Resolve the "end" timestamp of a task for bar sizing. Tasks that haven't
 *  finished yet extend to `now` so in-progress bars grow visually as time
 *  passes — the bar stops when the task does. */
function resolveEndMs(task: Task, nowMs: number): number {
  if (task.finishedAt) {
    const t = new Date(task.finishedAt).getTime()
    if (!Number.isNaN(t)) return t
  }
  const isTerminal = task.status === 'done' || task.status === 'failed'
  if (isTerminal) {
    const t = new Date(task.updatedAt).getTime()
    if (!Number.isNaN(t)) return t
  }
  return nowMs
}

interface TimelineBar {
  task: Task
  /** Left edge as % of window (0-100). Clamped to [0, 100]. */
  leftPct: number
  /** Width as % of window. Always ≥ MIN_BAR_PERCENT when rendered. */
  widthPct: number
  durationMs: number
  colorClass: string
}

export default function TimelinePanel() {
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const agents = useOrchestra((s) => s.agents)
  const tasks = useOrchestra((s) => s.tasks)
  const setTaskDrawer = useOrchestra((s) => s.setTaskDrawer)

  // Re-render on a timer so the "now" edge slides right and in-progress bars
  // grow. We only touch a number here; React is happy to skip the subtree if
  // nothing else changed.
  const [nowMs, setNowMs] = useState<number>(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(
      () => setNowMs(Date.now()),
      TICK_INTERVAL_MS
    )
    return () => window.clearInterval(id)
  }, [])

  const windowStartMs = nowMs - WINDOW_MS

  // Agents of the active team. Sorted by name so rows are stable across
  // re-renders — the agents array order isn't guaranteed by the store.
  const teamAgents = useMemo<Agent[]>(() => {
    if (!activeTeamId) return []
    return agents
      .filter((a) => a.teamId === activeTeamId)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [agents, activeTeamId])

  // Bucket tasks by assigned agent, keeping only those whose [start, end]
  // interval overlaps the 60 min window. Unassigned tasks have no row to
  // land on so we drop them — the spec anchors bars to assignee rows.
  const barsByAgent = useMemo<Map<UUID, TimelineBar[]>>(() => {
    const map = new Map<UUID, TimelineBar[]>()
    if (!activeTeamId) return map

    for (const task of tasks) {
      if (task.teamId !== activeTeamId) continue
      if (!task.assignedAgentId) continue

      const startMs = new Date(task.createdAt).getTime()
      if (Number.isNaN(startMs)) continue
      const endMs = resolveEndMs(task, nowMs)

      // Discard anything that lives fully outside the window. A task that
      // started before the window but is still running is kept and clipped.
      if (endMs < windowStartMs) continue
      if (startMs > nowMs) continue

      const clippedStart = Math.max(startMs, windowStartMs)
      const clippedEnd = Math.min(endMs, nowMs)
      const leftPct = ((clippedStart - windowStartMs) / WINDOW_MS) * 100
      const rawWidthPct = ((clippedEnd - clippedStart) / WINDOW_MS) * 100
      const widthPct = Math.max(rawWidthPct, MIN_BAR_PERCENT)

      const bar: TimelineBar = {
        task,
        leftPct: Math.max(0, Math.min(100, leftPct)),
        widthPct: Math.max(0, Math.min(100 - leftPct, widthPct)),
        durationMs: Math.max(0, endMs - startMs),
        colorClass: STATUS_COLOR[task.status] ?? 'bg-bg-3'
      }

      const list = map.get(task.assignedAgentId)
      if (list) list.push(bar)
      else map.set(task.assignedAgentId, [bar])
    }

    return map
  }, [tasks, activeTeamId, windowStartMs, nowMs])

  const hasAnyBars = useMemo(() => {
    for (const list of barsByAgent.values()) {
      if (list.length > 0) return true
    }
    return false
  }, [barsByAgent])

  // Tick positions at 0/10/20/30/40/50/60 min. We render 7 marks so the last
  // one sits exactly on the right edge (representing "now").
  const tickPercents = useMemo<number[]>(() => {
    const out: number[] = []
    for (let t = 0; t <= WINDOW_MS; t += TICK_MS) {
      out.push((t / WINDOW_MS) * 100)
    }
    return out
  }, [])

  return (
    <div
      data-coach="timeline-panel"
      className="flex h-full w-full flex-col overflow-hidden border-l border-border-soft bg-bg-2 text-text-1"
    >
      {/* Header — title + window label, matches the other side-panel headers
          so the rail tabs look uniform when this one is mounted. */}
      <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-3 py-2">
        <span className="df-label">timeline</span>
        <span className="font-mono text-[10px] text-text-4">last 60 min</span>
      </header>

      {/* Content */}
      {!activeTeamId ? (
        <EmptyState title="No team selected" />
      ) : teamAgents.length === 0 ? (
        <EmptyState title="No agents on this team." />
      ) : !hasAnyBars ? (
        <EmptyState title="No activity in the last hour." />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Time axis — 60/50/40/30/20/10/now. Aligned with the chart grid
              below via the same left gutter width. */}
          <div className="flex items-end border-b border-border-soft bg-bg-1">
            <div className="w-20 shrink-0 border-r border-border-soft" />
            <div className="relative h-5 flex-1">
              {tickPercents.map((pct, i) => {
                const minutesAgo = 60 - i * 10
                const label = minutesAgo === 0 ? 'now' : `-${minutesAgo}m`
                return (
                  <span
                    key={pct}
                    className="absolute top-0 -translate-x-1/2 font-mono text-[9px] leading-5 text-text-4"
                    style={{ left: `${pct}%` }}
                  >
                    {label}
                  </span>
                )
              })}
            </div>
          </div>

          {/* Agent rows. Uses CSS overflow on the wrapper so long agent
              lists scroll vertically but the horizontal axis stays fixed. */}
          <div className="df-scroll min-h-0 flex-1 overflow-y-auto">
            {teamAgents.map((agent) => {
              const bars = barsByAgent.get(agent.id) ?? []
              return (
                <div
                  key={agent.id}
                  className="flex border-b border-border-soft/60 last:border-b-0"
                  style={{ height: `${ROW_HEIGHT_PX}px` }}
                >
                  {/* Agent name gutter — fixed width keeps chart columns
                      aligned across rows even for long names. */}
                  <div
                    className="flex w-20 shrink-0 items-center truncate border-r border-border-soft bg-bg-1 px-2 font-mono text-[10px] text-text-2"
                    title={agent.name}
                  >
                    {agent.name}
                  </div>

                  {/* Chart cell — absolute-positioned bars + background
                      gridlines. Relative wrapper is the coordinate system
                      for both. */}
                  <div className="relative flex-1">
                    {tickPercents.map((pct, i) => (
                      <span
                        key={pct}
                        aria-hidden
                        className={`absolute top-0 bottom-0 w-px ${
                          i === 0 || i === tickPercents.length - 1
                            ? 'bg-border-soft'
                            : 'bg-border-soft/40'
                        }`}
                        style={{ left: `${pct}%` }}
                      />
                    ))}

                    {bars.map((bar) => (
                      <button
                        key={bar.task.id}
                        type="button"
                        onClick={() => setTaskDrawer(bar.task.id)}
                        title={`${bar.task.title} · ${formatDuration(
                          bar.durationMs
                        )} · ${bar.task.status}`}
                        aria-label={`Task ${bar.task.title}, ${bar.task.status}, ${formatDuration(bar.durationMs)}`}
                        className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-sm transition-opacity hover:opacity-90 focus:outline-none focus:ring-1 focus:ring-accent-500 ${bar.colorClass}`}
                        style={{
                          left: `${bar.leftPct}%`,
                          width: `${Math.max(bar.widthPct, MIN_BAR_PERCENT)}%`
                        }}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** Inline empty-state — matches the centered placeholder style used by the
 *  other Orchestra side-panels so the rail feels cohesive. */
function EmptyState({ title }: { title: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <span className="font-mono text-[11px] text-text-4">{title}</span>
    </div>
  )
}
