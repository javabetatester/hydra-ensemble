/**
 * RouteExplain — "why this agent?" block inside TaskDrawer.
 *
 * Reads the Route record for the given task from the orchestra store and
 * renders a compact explanation of which agent the router chose and why.
 *
 * Visual treatments by reason kind:
 *   · `fallback:*`     — neutral "auto-routed to main agent" framing with a
 *                        "Configure triggers" CTA. No scoring noise — the
 *                        router didn't score anything, it just defaulted.
 *   · `explicit:user`  — "Assigned directly by you". No candidate list.
 *   · `delegation:*`   — "Delegated by <from>". Keeps candidate context.
 *   · `scored`         — classic score + candidate table.
 *
 * No card wrapper — this sits inline inside TaskDrawer's sections.
 *
 * See PRD.md §10.F6 (delegation) and PLAN.md §7 (router + Route entries).
 */
import { useMemo } from 'react'
import { ArrowRight, CornerDownRight, Route as RouteIcon, Settings, UserCheck } from 'lucide-react'
import type { Route } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'

interface Props {
  taskId: string
}

/** Reason prefix classifies the visual treatment of the reason line. */
type ReasonKind = 'fallback' | 'delegation' | 'scored' | 'explicit'

function classifyReason(reason: string): ReasonKind {
  if (reason.startsWith('fallback:')) return 'fallback'
  if (reason.startsWith('delegation:')) return 'delegation'
  if (reason === 'explicit:user') return 'explicit'
  return 'scored'
}

/** Parses the Route.score distribution per candidate.
 *  Router persists a single aggregate score on Route but we want per-candidate
 *  numbers for the table. Until the Route shape exposes a map we derive a
 *  plausible distribution: chosen agent = Route.score, others = 0. If/when
 *  the main side adds per-candidate scores we update this helper only. */
function perCandidateScore(route: Route, agentId: string): number {
  if (agentId === route.chosenAgentId) return route.score
  return 0
}

/** Extracts the "from" participant for a delegation reason string.
 *  Reason shape is `delegation:<fromAgentId>` by convention. Returns the
 *  agent's display name when resolvable, else the raw id, else empty. */
function delegationFrom(
  reason: string,
  agents: ReadonlyArray<{ id: string; name: string }>
): string {
  const fromId = reason.slice('delegation:'.length).trim()
  if (!fromId) return ''
  const a = agents.find((x) => x.id === fromId)
  return a?.name ?? fromId
}

export default function RouteExplain({ taskId }: Props) {
  const routes = useOrchestra((s) => s.routes)
  const agents = useOrchestra((s) => s.agents)

  // Most recent Route for this task wins — retries append a new entry.
  const route = useMemo<Route | undefined>(() => {
    let latest: Route | undefined
    for (const r of routes) {
      if (r.taskId !== taskId) continue
      if (!latest || r.at > latest.at) latest = r
    }
    return latest
  }, [routes, taskId])

  if (!route) {
    return (
      <div className="rounded-md border border-dashed border-border-soft bg-bg-1 px-3 py-3 text-[11px] text-text-4">
        No route recorded — task was assigned directly.
      </div>
    )
  }

  const chosen = agents.find((a) => a.id === route.chosenAgentId)
  const kind = classifyReason(route.reason)

  // Fallback — the router didn't actually score anything. The task matched
  // no trigger and went to the team lead / main agent by default. We render
  // a clean neutral block with a CTA to configure triggers for the chosen
  // agent so the user can avoid the fallback next time.
  if (kind === 'fallback') {
    const openTriggers = (): void => {
      window.dispatchEvent(
        new CustomEvent('orchestra:open-inspector-triggers', {
          detail: { agentId: route.chosenAgentId }
        })
      )
    }

    return (
      <div className="space-y-2">
        <div className="flex items-start gap-2 text-[11px] text-text-2">
          <RouteIcon
            size={13}
            strokeWidth={1.75}
            className="mt-0.5 shrink-0 text-text-3"
          />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-text-1">
              Auto-routed to main agent
            </div>
            <div className="mt-0.5 text-text-3">
              No trigger matched this task, so Orchestrador sent it to the team
              lead.
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pl-[21px] text-[11px]">
          <span className="df-label">chosen</span>
          <span className="font-semibold text-text-1">
            {chosen?.name ?? 'unknown'}
          </span>
          {chosen?.role ? (
            <span className="text-text-4">· {chosen.role}</span>
          ) : null}
          <span className="ml-auto font-mono text-[10px] italic text-text-4">
            no scoring (fallback)
          </span>
        </div>

        <div className="pl-[21px]">
          <button
            type="button"
            onClick={openTriggers}
            className="inline-flex items-center gap-1 rounded-sm border border-border-soft bg-bg-3 px-1.5 py-0.5 text-[10px] text-text-2 hover:border-accent-500/50 hover:bg-accent-500/10 hover:text-accent-200"
            title={`Configure triggers for ${chosen?.name ?? 'main agent'}`}
          >
            <Settings size={11} strokeWidth={1.75} />
            Configure triggers
          </button>
        </div>
      </div>
    )
  }

  // Explicit — the user picked this agent by hand. No scoring, no candidate
  // list. We keep the block present (vs. hiding it) so the "why" panel is
  // never a confusing empty state.
  if (kind === 'explicit') {
    return (
      <div className="flex items-start gap-2 text-[11px] text-text-2">
        <UserCheck
          size={13}
          strokeWidth={1.75}
          className="mt-0.5 shrink-0 text-accent-400"
        />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-text-1">
            Assigned directly by you
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-text-3">
            <span>Sent to</span>
            <span className="font-semibold text-text-1">
              {chosen?.name ?? 'unknown'}
            </span>
            {chosen?.role ? (
              <span className="text-text-4">· {chosen.role}</span>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  // Scored + delegation share the classic layout (score + candidate table).
  const candidateRows = [...route.candidateAgentIds]
    .map((id) => {
      const a = agents.find((x) => x.id === id)
      return {
        id,
        name: a?.name ?? 'unknown',
        role: a?.role ?? '',
        score: perCandidateScore(route, id),
        isChosen: id === route.chosenAgentId
      }
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.isChosen) return -1
      if (b.isChosen) return 1
      return a.name.localeCompare(b.name)
    })

  const reasonLine =
    kind === 'delegation'
      ? `Delegated by ${delegationFrom(route.reason, agents) || 'another agent'}`
      : route.reason

  const reasonClass = kind === 'delegation' ? 'text-accent-400' : 'text-text-2'

  return (
    <div className="space-y-2">
      {/* Chosen line */}
      <div className="flex items-center gap-2 text-[11px]">
        <span className="df-label">chosen</span>
        <span className="font-semibold text-text-1">
          {chosen?.name ?? 'unknown'}
        </span>
        {chosen?.role ? (
          <span className="text-text-4">· {chosen.role}</span>
        ) : null}
        <span className="ml-auto font-mono text-[11px] text-text-2">
          score {route.score.toFixed(1)}
        </span>
      </div>

      {/* Reason line — icon colored per kind */}
      <div className={`flex items-start gap-1.5 text-[11px] ${reasonClass}`}>
        {kind === 'delegation' ? (
          <CornerDownRight
            size={12}
            strokeWidth={1.75}
            className="mt-0.5 shrink-0"
          />
        ) : (
          <ArrowRight
            size={12}
            strokeWidth={1.75}
            className="mt-0.5 shrink-0 text-text-4"
          />
        )}
        <span className="break-words">{reasonLine}</span>
      </div>

      {/* Candidate list */}
      {candidateRows.length > 0 ? (
        <div className="mt-2">
          <div className="df-label mb-1">candidates considered</div>
          <ul className="space-y-0.5">
            {candidateRows.map((c) => (
              <li
                key={c.id}
                className={`flex items-center gap-2 rounded-sm px-1.5 py-0.5 ${
                  c.isChosen
                    ? 'bg-accent-500/10 text-accent-200'
                    : 'text-text-2'
                }`}
              >
                <span className="flex-1 truncate text-[11px]">
                  {c.name}
                  {c.role ? (
                    <span className="ml-1 text-text-4">· {c.role}</span>
                  ) : null}
                </span>
                <span
                  className={`font-mono text-[11px] ${
                    c.isChosen ? 'text-accent-300' : 'text-text-3'
                  }`}
                >
                  {c.score.toFixed(1)}
                </span>
                {c.isChosen ? (
                  <ArrowRight
                    size={11}
                    strokeWidth={2}
                    className="shrink-0 text-accent-400"
                    aria-label="chosen"
                  />
                ) : (
                  <span className="w-[11px]" aria-hidden />
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
