import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Crown,
  ListTodo,
  Pause,
  Play,
  Square,
  Trash2
} from 'lucide-react'
import type {
  Agent,
  AgentState,
  MessageLog,
  Skill,
  Trigger
} from '../../../shared/orchestra'
import { useOrchestra } from '../state/orchestra'
import { defaultAgentColor } from '../../lib/agent'
import { relativeTime } from '../../lib/time'
import type { InspectorTabKey } from './index'

interface Props {
  agent: Agent
  onSwitchTab: (tab: InspectorTabKey) => void
}

/**
 * Visual vocabulary for the "state pill". Mirrors AgentCard so the card and
 * the inspector hero never disagree about what "running" looks like.
 */
const STATE_DOT: Record<AgentState, string> = {
  idle: 'bg-[var(--color-status-idle)]',
  running: 'bg-[var(--color-status-running)] animate-pulse',
  paused: 'bg-[var(--color-status-thinking)]',
  error: 'bg-[var(--color-status-attention)]'
}

const STATE_LABEL: Record<AgentState, string> = {
  idle: 'idle',
  running: 'running',
  paused: 'paused',
  error: 'error'
}

/**
 * Quick-action button — same shape for every action so the row scans as a
 * single toolbar. Icon-on-the-left + label keeps it labeled (per spec) while
 * still echoing AgentCard's floating actions.
 */
function ActionButton({
  icon: Icon,
  label,
  onClick,
  tone = 'default',
  title
}: {
  icon: typeof Pause
  label: string
  onClick: () => void
  tone?: 'default' | 'accent' | 'danger'
  title?: string
}) {
  const base =
    'flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-[11px] font-medium transition'
  const byTone =
    tone === 'danger'
      ? 'border-status-attention/40 bg-status-attention/10 text-status-attention hover:bg-status-attention/20'
      : tone === 'accent'
        ? 'border-accent-500/40 bg-accent-500/10 text-accent-400 hover:bg-accent-500/20'
        : 'border-border-soft bg-bg-2 text-text-2 hover:border-border-mid hover:text-text-1 hover:bg-bg-3'
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={`${base} ${byTone}`}
    >
      <Icon size={12} strokeWidth={1.75} aria-hidden />
      <span>{label}</span>
    </button>
  )
}

/**
 * Link-button shared by every "See all →" / "Open console →" affordance.
 * Consolidated so they stay visually identical across sections.
 */
function SeeMoreLink({
  label,
  onClick
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-sm px-1 py-0.5 font-mono text-[10px] text-text-3 hover:text-accent-400"
    >
      <span>{label}</span>
      <ArrowRight size={10} strokeWidth={1.75} aria-hidden />
    </button>
  )
}

/** Thin card wrapper — single source of truth for the section chrome. */
function SectionCard({
  title,
  action,
  children
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-sm border border-border-soft bg-bg-1 p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="df-label">{title}</h3>
        {action}
      </header>
      {children}
    </section>
  )
}

/** Tick-driven shim over the shared helper so re-render cadence stays
 *  under the Overview component's control. */
const relTime = (iso: string, now: number): string =>
  relativeTime(iso, new Date(now))

/**
 * Read the skills/triggers files off the main-process bridge. Both are
 * optional — the bridge may be unwired in early bootstraps, in which case
 * the preview renders an empty state. We never block the tab on these.
 */
async function safeReadSkills(agentId: string): Promise<Skill[]> {
  const fn = window.api?.orchestra?.agent?.readSkills
  if (!fn) return []
  try {
    const res = await fn(agentId)
    if (!res.ok) return []
    return Array.isArray(res.value) ? res.value : []
  } catch {
    return []
  }
}

async function safeReadTriggers(agentId: string): Promise<Trigger[]> {
  const fn = window.api?.orchestra?.agent?.readTriggers
  if (!fn) return []
  try {
    const res = await fn(agentId)
    if (!res.ok) return []
    return Array.isArray(res.value) ? res.value : []
  } catch {
    return []
  }
}

export default function OverviewTab({ agent, onSwitchTab }: Props) {
  // Store selectors — kept as small subscriptions so the tab only re-renders
  // when the slices it actually uses change.
  const teams = useOrchestra((s) => s.teams)
  const agents = useOrchestra((s) => s.agents)
  const edges = useOrchestra((s) => s.edges)
  const tasks = useOrchestra((s) => s.tasks)
  const messageLog = useOrchestra((s) => s.messageLog)

  const pauseAgent = useOrchestra((s) => s.pauseAgent)
  const stopAgent = useOrchestra((s) => s.stopAgent)
  const deleteAgent = useOrchestra((s) => s.deleteAgent)
  const promoteMain = useOrchestra((s) => s.promoteMain)
  const setTaskDrawer = useOrchestra((s) => s.setTaskDrawer)

  // Crown — whether this agent is the active team's main. Lookup is cheap
  // enough to avoid a dedicated selector.
  const isMain = useMemo(() => {
    const team = teams.find((t) => t.id === agent.teamId)
    return team?.mainAgentId === agent.id
  }, [teams, agent.teamId, agent.id])

  // Hierarchy derivations from the live edge list.
  const managerAgent = useMemo(() => {
    const up = edges.find((e) => e.childAgentId === agent.id)
    return up ? (agents.find((a) => a.id === up.parentAgentId) ?? null) : null
  }, [edges, agents, agent.id])

  const subordinateCount = useMemo(
    () => edges.filter((e) => e.parentAgentId === agent.id).length,
    [edges, agent.id]
  )

  // Active tasks bucket: in_progress first, then queued. Capped at 3 for the
  // overview preview; full list lives in TasksPanel / TaskDrawer.
  const activeTasks = useMemo(() => {
    const mine = tasks.filter(
      (t) =>
        t.assignedAgentId === agent.id &&
        (t.status === 'in_progress' ||
          t.status === 'queued' ||
          t.status === 'routing' ||
          t.status === 'blocked')
    )
    // in_progress / routing / blocked before queued so the user sees live
    // work at the top. Within each bucket we keep insertion order.
    const weight = (s: string): number =>
      s === 'in_progress' ? 0 : s === 'routing' ? 1 : s === 'blocked' ? 2 : 3
    return mine
      .slice()
      .sort((a, b) => weight(a.status) - weight(b.status))
      .slice(0, 3)
  }, [tasks, agent.id])

  // Latest activity — last 5 messages produced by (or targeted at) this agent.
  // We walk the log in reverse so the newest is first without reallocating.
  const latestActivity = useMemo<MessageLog[]>(() => {
    const out: MessageLog[] = []
    for (let i = messageLog.length - 1; i >= 0 && out.length < 5; i--) {
      const m = messageLog[i]
      if (!m) continue
      if (m.fromAgentId !== agent.id && m.toAgentId !== agent.id) continue
      out.push(m)
    }
    return out
  }, [messageLog, agent.id])

  // Skills / triggers live on disk — load async, keep a stable preview slice.
  const [skills, setSkills] = useState<Skill[]>([])
  const [triggers, setTriggers] = useState<Trigger[]>([])
  useEffect(() => {
    let cancelled = false
    void safeReadSkills(agent.id).then((v) => {
      if (!cancelled) setSkills(v)
    })
    void safeReadTriggers(agent.id).then((v) => {
      if (!cancelled) setTriggers(v)
    })
    return () => {
      cancelled = true
    }
  }, [agent.id])

  // `now` is snapshotted once per render for relative times. If we ever want
  // the timestamps to tick live, wrap this in a 1-minute interval.
  const now = Date.now()

  const dotColor = agent.color || defaultAgentColor(agent.id)

  const onDelete = (): void => {
    const ok = window.confirm(
      `Delete agent "${agent.name}"? This removes the agent from the team ` +
        `and cannot be undone.`
    )
    if (!ok) return
    void deleteAgent(agent.id)
  }

  const onAssignTask = (): void => {
    // Bridge into the top-level NewTaskDialog via the same DOM event the
    // AgentCard's quick actions use — keeps the two entry points in lockstep.
    window.dispatchEvent(
      new CustomEvent('orchestra:new-task', {
        detail: { assignedAgentId: agent.id }
      })
    )
  }

  const onPauseResume = (): void => {
    if (agent.state === 'running') {
      void pauseAgent(agent.id)
      return
    }
    if (agent.state === 'paused') {
      // No dedicated resumeAgent in the store yet — mirror AgentCard and
      // emit the DOM event so a top-level listener can bridge to the main
      // process once the resume IPC lands.
      window.dispatchEvent(
        new CustomEvent('orchestra:resume-agent', {
          detail: { agentId: agent.id }
        })
      )
      return
    }
    // Idle / error: no-op. Left un-disabled to keep layout stable; the button
    // label already tells the user the state it operates on.
  }

  const pauseResumeLabel =
    agent.state === 'running' ? 'Pause' : agent.state === 'paused' ? 'Resume' : 'Pause'
  const PauseResumeIcon = agent.state === 'paused' ? Play : Pause

  return (
    <div className="df-scroll flex flex-col gap-3 p-3">
      {/* 1. Hero — agent identity + live state pill */}
      <section className="rounded-sm border border-border-soft bg-bg-1 p-3">
        <div className="flex items-start gap-3">
          <span
            className="mt-1 block h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: dotColor }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-text-1">
                {agent.name}
              </h2>
              {isMain ? (
                <Crown
                  size={13}
                  strokeWidth={1.75}
                  className="shrink-0 text-accent-400"
                  aria-label="main agent"
                />
              ) : null}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-text-3">
              {agent.role || 'no role'}
            </div>
            {agent.description ? (
              <p className="mt-1.5 line-clamp-2 text-[11px] text-text-3">
                {agent.description}
              </p>
            ) : null}
          </div>
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-border-soft bg-bg-2 px-2 py-0.5"
            title={`state: ${STATE_LABEL[agent.state]}`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${STATE_DOT[agent.state]}`}
              aria-hidden
            />
            <span className="font-mono text-[10px] text-text-2">
              {STATE_LABEL[agent.state]}
            </span>
          </span>
        </div>
      </section>

      {/* 2. Quick actions */}
      <section className="rounded-sm border border-border-soft bg-bg-1 p-3">
        <div className="mb-2 df-label">quick actions</div>
        <div
          className="flex flex-wrap gap-1.5"
          role="toolbar"
          aria-label="agent quick actions"
        >
          <ActionButton
            icon={PauseResumeIcon}
            label={pauseResumeLabel}
            onClick={onPauseResume}
            title={
              agent.state === 'running'
                ? 'Pause agent'
                : agent.state === 'paused'
                  ? 'Resume agent'
                  : 'Pause / resume (no-op while idle)'
            }
          />
          <ActionButton
            icon={Square}
            label="Stop"
            onClick={() => void stopAgent(agent.id)}
          />
          <ActionButton
            icon={ListTodo}
            label="Assign task"
            tone="accent"
            onClick={onAssignTask}
          />
          {!isMain ? (
            <ActionButton
              icon={Crown}
              label="Promote to main"
              onClick={() => void promoteMain(agent.id)}
            />
          ) : null}
          <ActionButton
            icon={Trash2}
            label="Delete"
            tone="danger"
            onClick={onDelete}
          />
        </div>
      </section>

      {/* 3. Hierarchy */}
      <SectionCard title="hierarchy">
        <dl className="space-y-1 text-[11px]">
          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-text-4">Reports to</dt>
            <dd className="truncate text-text-2">
              {managerAgent ? managerAgent.name : '—'}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-text-4">Manages</dt>
            <dd className="truncate text-text-2">
              {subordinateCount > 0
                ? `${subordinateCount} ${subordinateCount === 1 ? 'agent' : 'agents'}`
                : '—'}
            </dd>
          </div>
        </dl>
      </SectionCard>

      {/* 4. Skills preview */}
      <SectionCard
        title="skills"
        action={
          <SeeMoreLink
            label="See all"
            onClick={() => onSwitchTab('skills')}
          />
        }
      >
        {skills.length === 0 ? (
          <p className="text-[11px] text-text-4">No skills defined.</p>
        ) : (
          <ul className="space-y-1.5">
            {skills.slice(0, 3).map((s, i) => (
              <li key={`${s.name}-${i}`} className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-[11px] text-text-1">
                  {s.name || '(unnamed)'}
                </span>
                {s.tags.slice(0, 4).map((t) => (
                  <span
                    key={t}
                    className="rounded-sm bg-bg-3 px-1.5 py-0.5 font-mono text-[10px] text-text-3"
                  >
                    {t}
                  </span>
                ))}
                <span className="ml-auto font-mono text-[10px] text-text-4">
                  {s.weight.toFixed(1)}x
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* 5. Triggers preview */}
      <SectionCard
        title="triggers"
        action={
          <SeeMoreLink
            label="See all"
            onClick={() => onSwitchTab('triggers')}
          />
        }
      >
        {triggers.length === 0 ? (
          <p className="text-[11px] text-text-4">No triggers defined.</p>
        ) : (
          <ul className="space-y-1">
            {triggers.slice(0, 3).map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 text-[11px]"
                title={t.pattern}
              >
                <span className="shrink-0 rounded-sm bg-bg-3 px-1.5 py-0.5 font-mono text-[10px] text-text-3">
                  {t.kind}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-text-2">
                  {t.pattern || <em className="text-text-4">—</em>}
                </span>
                {!t.enabled ? (
                  <span className="shrink-0 font-mono text-[10px] text-text-4">
                    off
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* 6. Latest activity */}
      <SectionCard
        title="latest activity"
        action={
          <SeeMoreLink
            label="Open runtime"
            onClick={() => onSwitchTab('runtime')}
          />
        }
      >
        {latestActivity.length === 0 ? (
          <p className="text-[11px] text-text-4">No activity yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {latestActivity.map((m) => (
              <li key={m.id} className="flex items-baseline gap-2 text-[11px]">
                <span className="shrink-0 rounded-sm bg-bg-3 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-4">
                  {m.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-2" title={m.content}>
                  {m.content}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-text-4">
                  {relTime(m.at, now)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* 7. Active tasks */}
      <SectionCard
        title="active tasks"
        action={
          activeTasks.length > 0 ? (
            <span className="font-mono text-[10px] text-text-4">
              {activeTasks.length} shown
            </span>
          ) : undefined
        }
      >
        {activeTasks.length === 0 ? (
          <p className="text-[11px] text-text-4">No active or queued tasks.</p>
        ) : (
          <ul className="space-y-1">
            {activeTasks.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setTaskDrawer(t.id)}
                  className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-[11px] hover:bg-bg-3"
                  title={`Open "${t.title}"`}
                >
                  <span
                    className="shrink-0 rounded-sm bg-bg-3 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-3"
                    aria-label={`status ${t.status}`}
                  >
                    {t.status.replace('_', ' ')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-text-1">
                    {t.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-text-4">
                    {t.priority}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}
