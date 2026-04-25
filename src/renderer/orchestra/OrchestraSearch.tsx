/**
 * OrchestraSearch — Cmd+P / slash-triggered command palette scoped to the
 * Orchestra view. Fuzzy searches agents, tasks and teams from the shared
 * store and dispatches the appropriate selection action:
 *   · agent  → selectAgent(id, false) + setInspectorOpen(true)
 *   · task   → setTaskDrawer(id)
 *   · team   → setActiveTeam(id)
 *
 * The palette is a centered overlay (640px, top-20%), intentionally smaller
 * than a full-screen search so the canvas beneath stays visible. Input is
 * autofocused, Enter activates the top (highlighted) result, Arrow keys
 * move the cursor across all visible rows regardless of group, Esc or a
 * backdrop click closes.
 *
 * Matching strategy is deliberately minimal for MVP: case-insensitive
 * substring match against a concatenated searchable string per item.
 * Score is `-indexOf` so earlier matches rank higher. No tie-breaking, no
 * external fuzzy lib — we avoid adding a dependency.
 *
 * Per-group cap is 5; an additional "+N more" non-interactive row is
 * shown when the match count exceeds the cap. With an empty query we
 * surface the 3 most recent items of each group by `createdAt`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ListTodo, Search, User, Users, X } from 'lucide-react'
import type { Agent, Task, Team } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'

interface Props {
  open: boolean
  onClose: () => void
}

type ResultKind = 'agent' | 'task' | 'team'

interface AgentResult {
  kind: 'agent'
  id: string
  item: Agent
  score: number
}
interface TaskResult {
  kind: 'task'
  id: string
  item: Task
  score: number
}
interface TeamResult {
  kind: 'team'
  id: string
  item: Team
  score: number
}
type Result = AgentResult | TaskResult | TeamResult

/** Per-group visible cap before collapsing to "+N more". */
const GROUP_CAP = 5
/** Per-group count when query is empty (recent items). */
const EMPTY_CAP = 3

/** Case-insensitive substring score; -1 means no match. Score is `-idx`
 *  so that earlier matches (smaller idx) sort above later ones when we
 *  descend-sort by score. */
function scoreMatch(haystack: string, needle: string): number {
  if (!needle) return 0
  const idx = haystack.toLowerCase().indexOf(needle.toLowerCase())
  return idx === -1 ? -1 : -idx
}

function agentSearchText(a: Agent): string {
  return `${a.name} ${a.role} ${a.description}`
}
function taskSearchText(t: Task): string {
  return `${t.title} ${t.body} ${t.tags.join(' ')}`
}
function teamSearchText(t: Team): string {
  return `${t.name} ${t.slug}`
}

/** Sort by createdAt DESC. Items without a timestamp sink. */
function byRecent<T extends { createdAt?: string }>(a: T, b: T): number {
  const av = a.createdAt ?? ''
  const bv = b.createdAt ?? ''
  if (av === bv) return 0
  return av < bv ? 1 : -1
}

export default function OrchestraSearch({ open, onClose }: Props): React.ReactElement | null {
  const agents = useOrchestra((s) => s.agents)
  const tasks = useOrchestra((s) => s.tasks)
  const teams = useOrchestra((s) => s.teams)
  const selectAgent = useOrchestra((s) => s.selectAgent)
  const setInspectorOpen = useOrchestra((s) => s.setInspectorOpen)
  const setTaskDrawer = useOrchestra((s) => s.setTaskDrawer)
  const setActiveTeam = useOrchestra((s) => s.setActiveTeam)

  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Reset query + cursor every time the palette reopens so the user
  // never sees stale state from a previous invocation.
  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      // Focus deferred to the next tick — the input is conditionally
      // rendered, so focusing during the same render would miss it.
      queueMicrotask(() => inputRef.current?.focus())
    }
  }, [open])

  // Whenever query changes the visible list reshuffles; keep cursor at 0
  // to avoid pointing past the end.
  useEffect(() => {
    setCursor(0)
  }, [query])

  const { agentResults, taskResults, teamResults, totalAgents, totalTasks, totalTeams } =
    useMemo(() => {
      const q = query.trim()

      if (!q) {
        // Empty query: top N recent of each group.
        const agentsRecent = [...agents].sort(byRecent).slice(0, EMPTY_CAP)
        const tasksRecent = [...tasks].sort(byRecent).slice(0, EMPTY_CAP)
        const teamsRecent = [...teams].sort(byRecent).slice(0, EMPTY_CAP)
        return {
          agentResults: agentsRecent.map<AgentResult>((a) => ({
            kind: 'agent',
            id: a.id,
            item: a,
            score: 0
          })),
          taskResults: tasksRecent.map<TaskResult>((t) => ({
            kind: 'task',
            id: t.id,
            item: t,
            score: 0
          })),
          teamResults: teamsRecent.map<TeamResult>((t) => ({
            kind: 'team',
            id: t.id,
            item: t,
            score: 0
          })),
          totalAgents: agentsRecent.length,
          totalTasks: tasksRecent.length,
          totalTeams: teamsRecent.length
        }
      }

      const matchedAgents: AgentResult[] = []
      for (const a of agents) {
        const s = scoreMatch(agentSearchText(a), q)
        if (s !== -1) matchedAgents.push({ kind: 'agent', id: a.id, item: a, score: s })
      }
      const matchedTasks: TaskResult[] = []
      for (const t of tasks) {
        const s = scoreMatch(taskSearchText(t), q)
        if (s !== -1) matchedTasks.push({ kind: 'task', id: t.id, item: t, score: s })
      }
      const matchedTeams: TeamResult[] = []
      for (const t of teams) {
        const s = scoreMatch(teamSearchText(t), q)
        if (s !== -1) matchedTeams.push({ kind: 'team', id: t.id, item: t, score: s })
      }

      // Descending score = earlier-matching items rank higher.
      matchedAgents.sort((a, b) => b.score - a.score)
      matchedTasks.sort((a, b) => b.score - a.score)
      matchedTeams.sort((a, b) => b.score - a.score)

      return {
        agentResults: matchedAgents.slice(0, GROUP_CAP),
        taskResults: matchedTasks.slice(0, GROUP_CAP),
        teamResults: matchedTeams.slice(0, GROUP_CAP),
        totalAgents: matchedAgents.length,
        totalTasks: matchedTasks.length,
        totalTeams: matchedTeams.length
      }
    }, [agents, tasks, teams, query])

  // Flat list of cursor-addressable rows in display order. Group headers
  // and "+N more" rows are NOT included — only actual results.
  const flatResults = useMemo<Result[]>(
    () => [...agentResults, ...taskResults, ...teamResults],
    [agentResults, taskResults, teamResults]
  )

  const activate = useCallback(
    (r: Result) => {
      if (r.kind === 'agent') {
        selectAgent(r.id, false)
        setInspectorOpen(true)
      } else if (r.kind === 'task') {
        setTaskDrawer(r.id)
      } else {
        setActiveTeam(r.id)
      }
      onClose()
    },
    [onClose, selectAgent, setInspectorOpen, setTaskDrawer, setActiveTeam]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => (flatResults.length === 0 ? 0 : (c + 1) % flatResults.length))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) =>
          flatResults.length === 0 ? 0 : (c - 1 + flatResults.length) % flatResults.length
        )
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const target = flatResults[cursor]
        if (target) activate(target)
      }
    },
    [activate, cursor, flatResults, onClose]
  )

  if (!open) return null

  const cursorIdFor = (kind: ResultKind, id: string): boolean => {
    const target = flatResults[cursor]
    return !!target && target.kind === kind && target.id === id
  }

  const renderGroupHeader = (
    label: string,
    icon: React.ReactElement,
    extra?: number
  ): React.ReactElement => (
    <div className="flex items-center gap-2 px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-3">
      <span className="opacity-70">{icon}</span>
      <span>{label}</span>
      {extra != null && extra > 0 ? (
        <span className="ml-auto font-normal normal-case tracking-normal opacity-60">
          {extra} hidden
        </span>
      ) : null}
    </div>
  )

  const hasAgents = agentResults.length > 0
  const hasTasks = taskResults.length > 0
  const hasTeams = teamResults.length > 0
  const hasAny = hasAgents || hasTasks || hasTeams

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        // Only close when the backdrop itself is clicked; clicks bubbling
        // from children must not dismiss the palette.
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Orchestrador search"
    >
      <div
        className="mt-[20vh] w-[640px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border-mid bg-bg-2 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-2 border-b border-border-mid px-3 py-2">
          <Search size={16} className="shrink-0 text-text-3" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents, tasks, teams..."
            className="flex-1 bg-transparent text-sm text-text-1 placeholder-text-3 outline-none"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="Close search"
          >
            <X size={14} />
          </button>
        </div>

        {/* Results list */}
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {!hasAny ? (
            <div className="px-3 py-6 text-center text-xs text-text-3">No results</div>
          ) : (
            <>
              {hasAgents && (
                <div>
                  {renderGroupHeader('Agents', <User size={12} />)}
                  {agentResults.map((r) => {
                    const selected = cursorIdFor('agent', r.id)
                    return (
                      <button
                        key={`agent-${r.id}`}
                        type="button"
                        onClick={() => activate(r)}
                        onMouseEnter={() => {
                          const idx = flatResults.findIndex(
                            (x) => x.kind === 'agent' && x.id === r.id
                          )
                          if (idx !== -1) setCursor(idx)
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                          selected ? 'bg-bg-3 text-text-1' : 'text-text-2 hover:bg-bg-3'
                        }`}
                      >
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase text-text-1"
                          style={{ background: r.item.color ?? '#4b5563' }}
                          aria-hidden
                        >
                          {r.item.name.slice(0, 1)}
                        </span>
                        <span className="truncate font-medium">{r.item.name}</span>
                        <span className="truncate text-xs text-text-3">{r.item.role}</span>
                      </button>
                    )
                  })}
                  {totalAgents > GROUP_CAP && (
                    <div className="px-3 py-1 text-xs italic text-text-3">
                      +{totalAgents - GROUP_CAP} more
                    </div>
                  )}
                </div>
              )}

              {hasTasks && (
                <div>
                  {renderGroupHeader('Tasks', <ListTodo size={12} />)}
                  {taskResults.map((r) => {
                    const selected = cursorIdFor('task', r.id)
                    return (
                      <button
                        key={`task-${r.id}`}
                        type="button"
                        onClick={() => activate(r)}
                        onMouseEnter={() => {
                          const idx = flatResults.findIndex(
                            (x) => x.kind === 'task' && x.id === r.id
                          )
                          if (idx !== -1) setCursor(idx)
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                          selected ? 'bg-bg-3 text-text-1' : 'text-text-2 hover:bg-bg-3'
                        }`}
                      >
                        <span className="shrink-0 rounded border border-border-mid bg-bg-3 px-1.5 py-[1px] text-[10px] font-semibold text-text-2">
                          {r.item.priority}
                        </span>
                        <span className="truncate font-medium">{r.item.title}</span>
                        {r.item.tags.length > 0 && (
                          <span className="truncate text-xs text-text-3">
                            {r.item.tags.slice(0, 3).join(', ')}
                          </span>
                        )}
                      </button>
                    )
                  })}
                  {totalTasks > GROUP_CAP && (
                    <div className="px-3 py-1 text-xs italic text-text-3">
                      +{totalTasks - GROUP_CAP} more
                    </div>
                  )}
                </div>
              )}

              {hasTeams && (
                <div>
                  {renderGroupHeader('Teams', <Users size={12} />)}
                  {teamResults.map((r) => {
                    const selected = cursorIdFor('team', r.id)
                    return (
                      <button
                        key={`team-${r.id}`}
                        type="button"
                        onClick={() => activate(r)}
                        onMouseEnter={() => {
                          const idx = flatResults.findIndex(
                            (x) => x.kind === 'team' && x.id === r.id
                          )
                          if (idx !== -1) setCursor(idx)
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                          selected ? 'bg-bg-3 text-text-1' : 'text-text-2 hover:bg-bg-3'
                        }`}
                      >
                        <Users size={14} className="shrink-0 text-text-3" aria-hidden />
                        <span className="truncate font-medium">{r.item.name}</span>
                        <span className="truncate text-xs text-text-3">{r.item.slug}</span>
                      </button>
                    )
                  })}
                  {totalTeams > GROUP_CAP && (
                    <div className="px-3 py-1 text-xs italic text-text-3">
                      +{totalTeams - GROUP_CAP} more
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
