/**
 * AgentPresence — floating "who's online" column for Orchestra agents.
 *
 * Anchors in the bottom-left of the canvas, just above CanvasToolbar
 * (which sits at bottom-4 left-4 with z-30). We stack at bottom-16 left-4
 * so the two blocks don't overlap at 1x zoom, and share z-30 to stay
 * above the react-flow pane but below modals / context menus (z-[60]+).
 *
 * The outer wrapper is `pointer-events-none` so empty gaps between pills
 * never eat canvas drags; each pill opts back in with `pointer-events-auto`.
 *
 * Presence is a *view* of Orchestra state, not its own slice: running
 * agents come from `agents.filter(state === 'running')` and the current
 * task per agent comes from `tasks.find(assignedAgentId === a.id)` picking
 * whichever is `in_progress` / `routing` / `blocked` (same set AgentCard's
 * subStatus uses, so both surfaces stay in sync).
 *
 * Enter animation = slide-in-from-left; exit animation = fade-out. We keep
 * a short-lived "exiting" set so agents that flip off `running` animate out
 * for ~180ms before being unmounted. Without this, pills would just pop
 * when work finishes and the column would feel jumpy.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { Agent, Task, UUID } from '../../shared/orchestra'
import { defaultAgentColor } from '../lib/agent'
import { useOrchestra } from './state/orchestra'

interface Props {}

/** Keep the column short so it never competes with TaskDrawer / Inspector
 *  for vertical space. Overflow collapses into a "+N more" counter. */
const MAX_VISIBLE = 5

/** Matches the CSS transition duration for the exit fade. Bumping this
 *  requires updating the inline style below as well. */
const EXIT_MS = 180

/** Tasks that count as "currently being worked on" for presence purposes.
 *  `done` / `failed` are terminal and shouldn't drive the pulsing cursor. */
const ACTIVE_TASK_STATUSES: ReadonlySet<Task['status']> = new Set([
  'in_progress',
  'routing',
  'blocked'
])

/** Pick the active task for an agent — prefer freshly-updated work over
 *  anything that's been sitting around, so a switch of focus updates the
 *  pill label quickly. */
function pickCurrentTask(tasks: Task[], agentId: UUID): Task | null {
  let best: Task | null = null
  for (const t of tasks) {
    if (t.assignedAgentId !== agentId) continue
    if (!ACTIVE_TASK_STATUSES.has(t.status)) continue
    if (!best || t.updatedAt.localeCompare(best.updatedAt) > 0) best = t
  }
  return best
}

function initialOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  // Fall back to first code point (handles accented letters and emoji
  // names without slicing a surrogate pair in half).
  const first = Array.from(trimmed)[0] ?? '?'
  return first.toUpperCase()
}

export default function AgentPresence(_props: Props): JSX.Element | null {
  const agents = useOrchestra((s) => s.agents)
  const tasks = useOrchestra((s) => s.tasks)
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const selectAgent = useOrchestra((s) => s.selectAgent)
  const setInspectorOpen = useOrchestra((s) => s.setInspectorOpen)

  // Scope to the active team so switching teams doesn't bleed ghost pills
  // from the previous canvas.
  const runningAgents = useMemo<Agent[]>(() => {
    if (!activeTeamId) return []
    return agents.filter((a) => a.teamId === activeTeamId && a.state === 'running')
  }, [agents, activeTeamId])

  const visible = runningAgents.slice(0, MAX_VISIBLE)
  const overflow = Math.max(0, runningAgents.length - MAX_VISIBLE)

  // Track agents that *just* left `running` so we can play their exit
  // animation before unmounting. The ref-based timers make sure a second
  // flip doesn't leak handles (restart / clear on re-entry).
  const [exiting, setExiting] = useState<Map<UUID, Agent>>(new Map())
  const exitTimers = useRef<Map<UUID, ReturnType<typeof setTimeout>>>(new Map())
  const prevRunningIds = useRef<Set<UUID>>(new Set())

  useEffect(() => {
    const currentIds = new Set(runningAgents.map((a) => a.id))

    // Detect transitions running -> not-running and snapshot the agent so
    // the exiting pill can still render name/color after it disappears
    // from the `agents` list (e.g. deleted while running).
    const justLeft: Array<[UUID, Agent]> = []
    for (const prevId of prevRunningIds.current) {
      if (!currentIds.has(prevId)) {
        const snapshot = agents.find((a) => a.id === prevId)
        if (snapshot) justLeft.push([prevId, snapshot])
      }
    }

    // If an agent re-enters running while its exit animation is still
    // playing, cancel the timer and drop it from the exiting set so the
    // next render shows it as a live pill, not a fading ghost.
    let next = exiting
    let mutated = false
    for (const id of currentIds) {
      if (next.has(id)) {
        if (!mutated) {
          next = new Map(next)
          mutated = true
        }
        next.delete(id)
        const t = exitTimers.current.get(id)
        if (t) {
          clearTimeout(t)
          exitTimers.current.delete(id)
        }
      }
    }

    if (justLeft.length > 0) {
      if (!mutated) {
        next = new Map(next)
        mutated = true
      }
      for (const [id, snap] of justLeft) {
        next.set(id, snap)
        const existing = exitTimers.current.get(id)
        if (existing) clearTimeout(existing)
        const handle = setTimeout(() => {
          setExiting((cur) => {
            if (!cur.has(id)) return cur
            const m = new Map(cur)
            m.delete(id)
            return m
          })
          exitTimers.current.delete(id)
        }, EXIT_MS)
        exitTimers.current.set(id, handle)
      }
    }

    if (mutated) setExiting(next)
    prevRunningIds.current = currentIds
  }, [runningAgents, agents, exiting])

  // Flush any pending exit timers on unmount so we don't setState on a
  // dead component during a team switch.
  useEffect(() => {
    const timers = exitTimers.current
    return () => {
      for (const h of timers.values()) clearTimeout(h)
      timers.clear()
    }
  }, [])

  const handleClick = (agentId: UUID): void => {
    selectAgent(agentId)
    setInspectorOpen(true)
  }

  // Merge live + exiting, de-duped (live wins). Exiting agents render with
  // `data-exit` which the style block below keys off.
  type Entry = { agent: Agent; exiting: boolean }
  const entries: Entry[] = []
  const seen = new Set<UUID>()
  for (const a of visible) {
    entries.push({ agent: a, exiting: false })
    seen.add(a.id)
  }
  for (const [id, a] of exiting) {
    if (seen.has(id)) continue
    entries.push({ agent: a, exiting: true })
  }

  if (entries.length === 0 && overflow === 0) return null

  return (
    <>
      {/* Keyframes scoped via unique class prefixes — avoids bloating the
       *  global stylesheet for a component-local animation and keeps us
       *  inside the "no new deps" rule. */}
      <style>{`
        @keyframes ap-slide-in-left {
          from { opacity: 0; transform: translateX(-12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes ap-fade-out {
          from { opacity: 1; transform: translateX(0); }
          to   { opacity: 0; transform: translateX(-6px); }
        }
        @keyframes ap-cursor-blink {
          0%, 45%  { opacity: 1; }
          50%, 95% { opacity: 0.15; }
          100%     { opacity: 1; }
        }
        .ap-enter { animation: ap-slide-in-left 180ms ease-out both; }
        .ap-exit  { animation: ap-fade-out 180ms ease-in both; pointer-events: none; }
        .ap-cursor { animation: ap-cursor-blink 1s ease-in-out infinite; }
      `}</style>

      <div
        className="pointer-events-none absolute bottom-16 left-4 z-30 flex flex-col items-start gap-1"
        aria-label="Active agents"
      >
        {entries.map(({ agent, exiting: isExit }) => {
          const color = agent.color || defaultAgentColor(agent.id)
          const task = isExit ? null : pickCurrentTask(tasks, agent.id)
          return (
            <button
              key={agent.id}
              type="button"
              onClick={() => !isExit && handleClick(agent.id)}
              disabled={isExit}
              aria-label={`Focus agent ${agent.name}${task ? ` — ${task.title}` : ''}`}
              title={task ? `${agent.name} · ${task.title}` : agent.name}
              className={[
                'pointer-events-auto flex max-w-[260px] items-center gap-1.5',
                'rounded-full border border-border-soft bg-bg-2/90 py-0.5 pl-0.5 pr-2',
                'text-[11px] text-text-1 shadow-pop backdrop-blur-md',
                'transition-colors hover:border-border-mid hover:bg-bg-3',
                isExit ? 'ap-exit' : 'ap-enter'
              ].join(' ')}
            >
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              >
                {initialOf(agent.name)}
              </span>
              <span className="truncate font-medium">{agent.name}</span>
              {task ? (
                <>
                  <span className="text-text-4" aria-hidden="true">·</span>
                  <span className="flex min-w-0 items-center gap-1 text-text-3">
                    <Loader2
                      size={10}
                      strokeWidth={2.5}
                      className="shrink-0 animate-spin"
                      style={{ color }}
                      aria-hidden="true"
                    />
                    <span className="truncate italic">
                      &ldquo;{task.title}&rdquo;
                    </span>
                    {/* Blinking "cursor" dot — a filled circle that mimics a
                     *  terminal cursor next to the task title. */}
                    <span
                      className="ap-cursor inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                  </span>
                </>
              ) : null}
            </button>
          )
        })}
        {overflow > 0 ? (
          <div
            className="pointer-events-auto flex items-center gap-1 rounded-full border border-border-soft bg-bg-2/90 px-2 py-0.5 text-[11px] text-text-3 shadow-pop backdrop-blur-md"
            aria-label={`${overflow} more running agents`}
          >
            +{overflow} more
          </div>
        ) : null}
      </div>
    </>
  )
}
