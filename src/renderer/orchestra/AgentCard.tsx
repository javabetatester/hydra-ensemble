import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import {
  Crown,
  User,
  Wrench,
  ClipboardCheck,
  ShieldCheck,
  Bug,
  Code2,
  Briefcase,
  ListTodo,
  Pause,
  Play,
  Square,
  Trash2
} from 'lucide-react'
import type { Agent, AgentState } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'

/**
 * Custom react-flow node for an Orchestra agent.
 *
 * Rendered exclusively via `nodeTypes.agent = AgentCard`. Layout, colours and
 * dot semantics follow PRD §11 "Card anatomy".
 */

export type AgentNode = Node<{ agent: Agent; isMain: boolean }, 'agent'>

/** Role -> lucide icon. Unknown roles fall back to the generic user glyph. */
function iconForRole(role: string): typeof User {
  const key = role.trim().toLowerCase()
  if (key.includes('pm') || key.includes('manager')) return Briefcase
  if (key.includes('review')) return ClipboardCheck
  if (key.includes('qa') || key.includes('test')) return Bug
  if (key.includes('security') || key.includes('audit')) return ShieldCheck
  if (key.includes('dev') || key.includes('engineer') || key.includes('backend') || key.includes('frontend')) return Code2
  if (key.includes('ops') || key.includes('infra') || key.includes('devops')) return Wrench
  return User
}

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
 * The reporting graph is a strict pyramid: what sits ABOVE a card manages
 * it, what sits BELOW reports to it. Handles rendered in the body live
 * only on top (inbound target) and bottom (outbound source) — no lateral
 * anchors, so the user can't author a relationship the model doesn't
 * know how to interpret.
 */

function AgentCardImpl(props: NodeProps<AgentNode>) {
  const { data, selected } = props
  const { agent, isMain } = data
  const RoleIcon = iconForRole(agent.role)
  const updateAgent = useOrchestra((s) => s.updateAgent)
  const edges = useOrchestra((s) => s.edges)
  const agents = useOrchestra((s) => s.agents)
  const promoteMain = useOrchestra((s) => s.promoteMain)
  const pauseAgent = useOrchestra((s) => s.pauseAgent)
  const stopAgent = useOrchestra((s) => s.stopAgent)
  const deleteAgent = useOrchestra((s) => s.deleteAgent)

  // Resolve hierarchy counts straight off the live store so the badges
  // follow every edge add/remove without a dedicated subscription.
  const subordinateCount = edges.filter((e) => e.parentAgentId === agent.id).length
  const managerAgent = (() => {
    const up = edges.find((e) => e.childAgentId === agent.id)
    return up ? agents.find((a) => a.id === up.parentAgentId) : undefined
  })()

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(agent.name)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Sync local draft when the agent's persisted name changes upstream (IPC
  // events from main). Without this, an external rename would be overwritten
  // by the stale draft the next time the user enters edit mode.
  useEffect(() => {
    if (!editing) setDraft(agent.name)
  }, [agent.name, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = useCallback(() => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== agent.name) {
      void updateAgent({ id: agent.id, patch: { name: trimmed } })
    } else {
      setDraft(agent.name)
    }
    setEditing(false)
  }, [draft, agent.id, agent.name, updateAgent])

  const cancel = useCallback(() => {
    setDraft(agent.name)
    setEditing(false)
  }, [agent.name])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        commit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancel()
      }
    },
    [commit, cancel]
  )

  // Live activity: what this agent is working on right now, and the
  // latest "status" or "output" line it produced. Picked straight from
  // the store so the card animates in sync with the timeline.
  const tasks = useOrchestra((s) => s.tasks)
  const messageLog = useOrchestra((s) => s.messageLog)
  const setTaskDrawer = useOrchestra((s) => s.setTaskDrawer)
  const currentTask = tasks.find(
    (t) =>
      t.assignedAgentId === agent.id &&
      (t.status === 'in_progress' || t.status === 'routing' || t.status === 'blocked')
  )
  const latestLine = (() => {
    for (let i = messageLog.length - 1; i >= 0; i--) {
      const m = messageLog[i]
      if (!m) continue
      if (m.fromAgentId !== agent.id) continue
      if (m.kind !== 'status' && m.kind !== 'output') continue
      return m.content
    }
    return null
  })()
  const subStatus: string | null = currentTask
    ? `on "${currentTask.title}"`
    : latestLine
      ? latestLine.slice(0, 72)
      : null

  const ringColor = agent.color ?? 'var(--color-accent-500)'

  return (
    <div
      className={[
        'group relative min-w-[180px] select-none rounded-[var(--radius-md)]',
        'bg-[var(--color-bg-2)] text-[var(--color-text-1)]',
        'border border-[var(--color-border-mid)]',
        'transition-[box-shadow,border-color] duration-150',
        'font-mono text-[12px]'
      ].join(' ')}
      style={{
        boxShadow: selected
          ? `0 0 0 2px ${ringColor} inset`
          : 'var(--shadow-card)'
      }}
      aria-label={`agent ${agent.name} — ${STATE_LABEL[agent.state]}`}
    >
      {/* Single-purpose anchors: top = inbound from my manager; bottom =
          outbound to my subordinates. That asymmetry is what makes the
          graph a strict pyramid. The top dot is only a target; the bottom
          dot is only a source. Both are hit-expanded via padding so the
          user doesn't have to aim a 10-px circle. */}
      <Handle
        id="n-t"
        type="target"
        position={Position.Top}
        className={[
          'absolute !h-3 !w-3 !rounded-full !border-0',
          '!bg-[var(--color-border-mid)] hover:!bg-[var(--color-accent-500)]',
          'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2',
          'opacity-70 group-hover:opacity-100 transition-opacity',
          'z-10'
        ].join(' ')}
        isConnectable
      />
      <Handle
        id="s-s"
        type="source"
        position={Position.Bottom}
        className={[
          'absolute !h-3 !w-3 !rounded-full !border-0',
          '!bg-[var(--color-accent-500)]',
          'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
          'opacity-70 group-hover:opacity-100 transition-opacity',
          selected ? '!opacity-100' : '',
          'z-10'
        ].join(' ')}
        isConnectable
      />

      {/* Floating quick-action strip. Sits outside the top-right border so it
          never overlaps the crown/role icon, and only materialises on hover
          or while the card is selected. Each button stops propagation so the
          click doesn't bubble up into react-flow's drag/select machinery. */}
      <div
        className={[
          'absolute -top-3 -right-1 z-20 flex items-center gap-1',
          'transition-opacity duration-150',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        ].join(' ')}
        role="toolbar"
        aria-label="agent quick actions"
      >
        {!isMain ? (
          <button
            type="button"
            title="Promote to main"
            aria-label="promote to main"
            onClick={(e) => {
              e.stopPropagation()
              void promoteMain(agent.id)
            }}
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-2)] border border-[var(--color-border-mid)] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-bg-3)]"
          >
            <Crown className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          title="Assign task"
          aria-label="assign task"
          onClick={(e) => {
            e.stopPropagation()
            // TODO: top-level NewTaskDialog should subscribe to this event
            // (`orchestra:new-task`) and open itself pre-filled with
            // `assignedAgentId`. Listener not implemented yet.
            window.dispatchEvent(
              new CustomEvent('orchestra:new-task', {
                detail: { assignedAgentId: agent.id }
              })
            )
          }}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-2)] border border-[var(--color-border-mid)] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-bg-3)]"
        >
          <ListTodo className="h-3 w-3" aria-hidden />
        </button>
        {agent.state === 'running' ? (
          <button
            type="button"
            title="Pause"
            aria-label="pause agent"
            onClick={(e) => {
              e.stopPropagation()
              void pauseAgent(agent.id)
            }}
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-2)] border border-[var(--color-border-mid)] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-bg-3)]"
          >
            <Pause className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
        {agent.state === 'paused' ? (
          <button
            type="button"
            title="Resume"
            aria-label="resume agent"
            onClick={(e) => {
              e.stopPropagation()
              // TODO: no dedicated resumeAgent action exists in the store yet.
              // We dispatch a DOM event so a top-level listener can bridge to
              // the main process once the resume IPC handler is wired up.
              window.dispatchEvent(
                new CustomEvent('orchestra:resume-agent', {
                  detail: { agentId: agent.id }
                })
              )
            }}
            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-2)] border border-[var(--color-border-mid)] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-bg-3)]"
          >
            <Play className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          title="Stop"
          aria-label="stop agent"
          onClick={(e) => {
            e.stopPropagation()
            void stopAgent(agent.id)
          }}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-2)] border border-[var(--color-border-mid)] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] hover:bg-[var(--color-bg-3)]"
        >
          <Square className="h-3 w-3" aria-hidden />
        </button>
        <button
          type="button"
          title="Delete"
          aria-label="delete agent"
          onClick={(e) => {
            e.stopPropagation()
            if (window.confirm('Delete this agent?')) {
              void deleteAgent(agent.id)
            }
          }}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-2)] border border-[var(--color-border-mid)] text-[var(--color-text-3)] hover:text-red-400 hover:border-red-400/40 hover:bg-[var(--color-bg-3)]"
        >
          <Trash2 className="h-3 w-3" aria-hidden />
        </button>
      </div>

      <div className="flex items-center gap-2 px-3 pt-2">
        {isMain ? (
          <Crown
            className="h-3.5 w-3.5 text-[var(--color-accent-500)]"
            aria-label="main agent"
          />
        ) : (
          <RoleIcon
            className="h-3.5 w-3.5 text-[var(--color-text-3)]"
            aria-hidden
          />
        )}
        <span className="truncate text-[11px] uppercase tracking-wider text-[var(--color-text-3)]">
          {agent.role || 'agent'}
        </span>
      </div>

      <div
        className="px-3 pb-1 pt-0.5"
        onDoubleClick={(e) => {
          e.stopPropagation()
          setEditing(true)
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            className={[
              'w-full bg-transparent text-[13px] font-semibold',
              'outline-none border-b border-[var(--color-border-mid)]',
              'focus:border-[var(--color-accent-500)]'
            ].join(' ')}
            aria-label="edit agent name"
          />
        ) : (
          <div
            className="truncate text-[13px] font-semibold text-[var(--color-text-1)]"
            title={agent.name}
          >
            {agent.name}
          </div>
        )}
      </div>

      <div className="mx-3 my-1 border-t border-dashed border-[var(--color-border-soft)]" />

      <div className="flex items-center gap-2 px-3 pb-2">
        <span
          className={[
            'inline-block h-2 w-2 rounded-full',
            STATE_DOT[agent.state]
          ].join(' ')}
          aria-hidden
        />
        <span className="text-[11px] text-[var(--color-text-2)]">
          {STATE_LABEL[agent.state]}
        </span>
      </div>

      {subStatus ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (currentTask) setTaskDrawer(currentTask.id)
          }}
          className="block w-full truncate px-3 pb-2 text-left text-[11px] text-[var(--color-text-3)] hover:text-[var(--color-text-1)] disabled:cursor-default"
          disabled={!currentTask}
          title={currentTask ? 'Open task timeline' : subStatus}
        >
          {subStatus}
        </button>
      ) : null}

      {(managerAgent || subordinateCount > 0) ? (
        <div className="flex flex-wrap items-center gap-1 border-t border-[var(--color-border-soft)] px-3 py-1.5 text-[10px]">
          {managerAgent ? (
            <span
              className="rounded-sm bg-[var(--color-bg-3)] px-1.5 py-0.5 text-[var(--color-text-3)]"
              title={`Reports to ${managerAgent.name}`}
            >
              ↑ {managerAgent.name}
            </span>
          ) : null}
          {subordinateCount > 0 ? (
            <span
              className="rounded-sm bg-[var(--color-accent-500)]/15 px-1.5 py-0.5 text-[var(--color-accent-400)]"
              title={`Manages ${subordinateCount} ${subordinateCount === 1 ? 'agent' : 'agents'}`}
            >
              ↓ {subordinateCount}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export const AgentCard = memo(AgentCardImpl)
AgentCard.displayName = 'AgentCard'

export default AgentCard
