/**
 * TeamSwitcher — compact dropdown used in the Orchestra header to switch
 * between teams without leaving the current view.
 *
 * Rendered in place of the plain `activeTeam.name` span in `OrchestraView`;
 * clicking the label opens a popover listing every team plus creation
 * shortcuts. The popover is keyboard-navigable (Arrow Up/Down + Enter),
 * closes on Escape or click-outside, and dispatches two window events when
 * the user picks a creation affordance:
 *
 *   - `orchestra:new-team`       → host opens the blank-team flow
 *   - `orchestra:open-templates` → host opens the templates dialog
 *
 * Reads state from `useOrchestra` — no props are accepted.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, Search, Users, Wand2 } from 'lucide-react'
import { useOrchestra } from './state/orchestra'
import type { Agent, Team } from '../../shared/orchestra'

type DotTone = 'running' | 'error' | 'neutral'

/**
 * Resolves the dot colour for a team based on its agents' dominant state.
 * `running` takes precedence over `error`, matching how the Inspector and
 * TeamRail prioritise "work in progress" over "something failed earlier".
 */
function teamDotTone(teamAgents: Agent[]): DotTone {
  let hasError = false
  for (const a of teamAgents) {
    if (a.state === 'running') return 'running'
    if (a.state === 'error') hasError = true
  }
  return hasError ? 'error' : 'neutral'
}

function Dot({ tone }: { tone: DotTone }) {
  const cls =
    tone === 'running'
      ? 'bg-accent-400 animate-pulse'
      : tone === 'error'
        ? 'bg-red-500'
        : 'bg-text-4/60'
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} aria-hidden />
}

interface Props {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function TeamSwitcher(_props: Props = {}) {
  const teams = useOrchestra((s) => s.teams)
  const agents = useOrchestra((s) => s.agents)
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const setActiveTeam = useOrchestra((s) => s.setActiveTeam)

  const [open, setOpen] = useState<boolean>(false)
  const [query, setQuery] = useState<string>('')
  const [highlight, setHighlight] = useState<number>(0)

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const activeTeam = useMemo<Team | null>(
    () => teams.find((t) => t.id === activeTeamId) ?? null,
    [teams, activeTeamId]
  )

  // Group agents per team once — O(n) scan beats N × filter() for every row
  // when a workspace has many teams.
  const agentsByTeam = useMemo(() => {
    const map = new Map<string, Agent[]>()
    for (const a of agents) {
      const list = map.get(a.teamId)
      if (list) list.push(a)
      else map.set(a.teamId, [a])
    }
    return map
  }, [agents])

  const filteredTeams = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return teams
    return teams.filter((t) => t.name.toLowerCase().includes(q))
  }, [teams, query])

  // Reset highlight + query whenever the popover opens, and focus the search
  // input so the user can start filtering immediately.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setHighlight(0)
    const id = window.setTimeout(() => {
      searchRef.current?.focus()
    }, 0)
    return () => {
      window.clearTimeout(id)
    }
  }, [open])

  // Keep the highlight in range when the filtered list shrinks.
  useEffect(() => {
    if (highlight >= filteredTeams.length) {
      setHighlight(Math.max(0, filteredTeams.length - 1))
    }
  }, [filteredTeams.length, highlight])

  // Click-outside + Escape. Using `mousedown` (not `click`) so a downstream
  // handler can't reopen the popover on the same tick.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const w = wrapperRef.current
      if (!w) return
      if (!w.contains(e.target as Node)) setOpen(false)
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

  const pickTeam = (id: string): void => {
    setActiveTeam(id)
    setOpen(false)
  }

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(0, filteredTeams.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = filteredTeams[highlight]
      if (target) pickTeam(target.id)
    }
  }

  const fireNewTeam = (): void => {
    setOpen(false)
    window.dispatchEvent(new CustomEvent('orchestra:new-team'))
  }

  const fireOpenTemplates = (): void => {
    setOpen(false)
    window.dispatchEvent(new CustomEvent('orchestra:open-templates'))
  }

  const label = activeTeam ? activeTeam.name : 'Pick a team'

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-text-2 hover:text-text-1"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={activeTeam ? `Switch team (current: ${activeTeam.name})` : 'Pick a team'}
      >
        <span className="truncate max-w-[160px]">{label}</span>
        <ChevronDown size={11} strokeWidth={1.75} className="text-text-4 shrink-0" />
      </button>

      {open ? (
        <div
          className="absolute top-full left-0 mt-1 w-[260px] rounded-sm border border-border-mid bg-bg-2 shadow-pop z-50"
          onKeyDown={onListKeyDown}
          role="dialog"
          aria-label="Switch team"
        >
          {/* Search */}
          <div className="flex items-center gap-1.5 border-b border-border-soft px-2 py-1.5">
            <Search size={12} strokeWidth={1.75} className="text-text-4 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHighlight(0)
              }}
              placeholder="Filter teams…"
              className="w-full bg-transparent text-xs text-text-1 placeholder:text-text-4 outline-none"
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {/* Teams list */}
          <div className="df-scroll max-h-[320px] overflow-y-auto py-1">
            {filteredTeams.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-text-4">
                {teams.length === 0 ? 'No teams yet.' : 'No matches.'}
              </div>
            ) : (
              filteredTeams.map((t, idx) => {
                const teamAgents = agentsByTeam.get(t.id) ?? []
                const tone = teamDotTone(teamAgents)
                const isActive = t.id === activeTeamId
                const isHighlighted = idx === highlight
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => pickTeam(t.id)}
                    onMouseEnter={() => setHighlight(idx)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                      isHighlighted ? 'bg-bg-3' : 'hover:bg-bg-3'
                    }`}
                    role="option"
                    aria-selected={isActive}
                  >
                    <Dot tone={tone} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs text-text-1">{t.name}</span>
                      <span className="font-mono text-[10px] text-text-4">
                        {teamAgents.length} {teamAgents.length === 1 ? 'agent' : 'agents'}
                      </span>
                    </span>
                    {isActive ? (
                      <Check
                        size={12}
                        strokeWidth={2}
                        className="text-accent-400 shrink-0"
                        aria-label="active team"
                      />
                    ) : null}
                  </button>
                )
              })
            )}
          </div>

          {/* Divider + creation affordances */}
          <div className="border-t border-border-soft py-1">
            <button
              type="button"
              onClick={fireNewTeam}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-2 hover:bg-bg-3 hover:text-text-1"
            >
              <Plus size={12} strokeWidth={1.75} className="text-text-4 shrink-0" />
              <span>New team</span>
              <Users size={11} strokeWidth={1.75} className="ml-auto text-text-4 shrink-0" />
            </button>
            <button
              type="button"
              onClick={fireOpenTemplates}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-2 hover:bg-bg-3 hover:text-text-1"
            >
              <Wand2 size={12} strokeWidth={1.75} className="text-text-4 shrink-0" />
              <span>Open from template</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
