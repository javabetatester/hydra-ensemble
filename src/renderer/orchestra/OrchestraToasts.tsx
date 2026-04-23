/**
 * OrchestraToasts — invisible side-effect observer that watches `useOrchestra`
 * state and auto-fires toasts on meaningful transitions.
 *
 * Mounted once inside OrchestraView, this component renders `null`. All work
 * happens in a single `useEffect` that diffs the current snapshot against a
 * `useRef` of the previous snapshot to detect:
 *
 *   1. task  status  -> 'done'    (info)
 *   2. task  status  -> 'failed'  (error, includes blockedReason)
 *   3. agent state   -> 'error'   (error)
 *   4. route         reason starts with 'delegation:'  (info, new entry)
 *   5. messageLog    kind === 'approval_request'        (attention, new entry)
 *
 * Toasts are pushed imperatively via `useToasts.getState().push` so this
 * component does NOT subscribe to the toasts store (avoids re-render churn
 * every time a toast pops/expires).
 */
import { useEffect, useRef, type ReactElement } from 'react'
import type {
  Agent,
  MessageLog,
  Route,
  Task,
  UUID
} from '../../shared/orchestra'
import { useToasts } from '../state/toasts'
import { useOrchestra } from './state/orchestra'

/** Per-task snapshot: just the status we care about diffing. */
type TaskSnapshot = Task['status']

/** Per-agent snapshot: the lifecycle state we care about diffing. */
type AgentSnapshot = Agent['state']

/** Shortens long approval bodies so the toast stays one-glance readable. */
const APPROVAL_BODY_LIMIT = 80

const excerpt = (text: string, limit: number): string =>
  text.length > limit ? `${text.slice(0, limit)}...` : text

/**
 * Given an ordered list of entities, return the slice of entries whose ids
 * were NOT present in `seenIds`. Used for append-only lists (routes,
 * messageLog) where new items always arrive at the tail and previously-seen
 * items can be ignored.
 */
const newEntries = <T extends { id: UUID }>(
  list: T[],
  seenIds: Set<UUID>
): T[] => list.filter((item) => !seenIds.has(item.id))

export default function OrchestraToasts(): ReactElement | null {
  const tasks = useOrchestra((s) => s.tasks)
  const agents = useOrchestra((s) => s.agents)
  const routes = useOrchestra((s) => s.routes)
  const messageLog = useOrchestra((s) => s.messageLog)

  // Previous snapshots. These are populated on first run so the initial
  // render never fires a cascade of toasts for pre-existing state (e.g.
  // tasks already `done` from a prior session that just rehydrated).
  const taskStatusRef = useRef<Map<UUID, TaskSnapshot> | null>(null)
  const agentStateRef = useRef<Map<UUID, AgentSnapshot> | null>(null)
  const seenRouteIdsRef = useRef<Set<UUID> | null>(null)
  const seenMessageIdsRef = useRef<Set<UUID> | null>(null)

  useEffect(() => {
    const push = useToasts.getState().push

    const prevTasks = taskStatusRef.current
    const prevAgents = agentStateRef.current
    const prevRoutes = seenRouteIdsRef.current
    const prevMessages = seenMessageIdsRef.current

    // First run: seed snapshots only, no toasts. This prevents the
    // component from storming the user with toasts for state that was
    // already true before it mounted.
    const isFirstRun =
      prevTasks === null ||
      prevAgents === null ||
      prevRoutes === null ||
      prevMessages === null

    // --- Build the next snapshots up-front so we can early-return cleanly.
    const nextTaskStatus = new Map<UUID, TaskSnapshot>()
    for (const t of tasks) nextTaskStatus.set(t.id, t.status)

    const nextAgentState = new Map<UUID, AgentSnapshot>()
    for (const a of agents) nextAgentState.set(a.id, a.state)

    const nextRouteIds = new Set<UUID>()
    for (const r of routes) nextRouteIds.add(r.id)

    const nextMessageIds = new Set<UUID>()
    for (const m of messageLog) nextMessageIds.add(m.id)

    if (isFirstRun) {
      taskStatusRef.current = nextTaskStatus
      agentStateRef.current = nextAgentState
      seenRouteIdsRef.current = nextRouteIds
      seenMessageIdsRef.current = nextMessageIds
      return
    }

    // --- 1 & 2. Task status transitions ---------------------------------
    for (const task of tasks) {
      const prev = prevTasks.get(task.id)
      if (prev === task.status) continue

      if (task.status === 'done') {
        push({
          kind: 'info',
          title: 'Task done',
          body: task.title
        })
      } else if (task.status === 'failed') {
        const reason = task.blockedReason ?? ''
        push({
          kind: 'error',
          title: 'Task failed',
          body: `${task.title} · ${reason}`
        })
      }
    }

    // --- 3. Agent entering error state ----------------------------------
    for (const agent of agents) {
      const prev = prevAgents.get(agent.id)
      if (prev === agent.state) continue
      if (agent.state === 'error') {
        push({
          kind: 'error',
          title: 'Agent error',
          body: `Agent ${agent.name} entered error state`
        })
      }
    }

    // --- 4. New delegation routes ---------------------------------------
    const freshRoutes: Route[] = newEntries(routes, prevRoutes)
    for (const route of freshRoutes) {
      if (!route.reason.startsWith('delegation:')) continue
      // `reason` is produced by main as `delegation:<fromSlugOrName>-><toSlugOrName>`;
      // resolve display names defensively so a missing agent doesn't crash.
      const payload = route.reason.slice('delegation:'.length)
      const [fromLabel, toLabel] = payload.includes('->')
        ? payload.split('->').map((s) => s.trim())
        : [payload.trim(), resolveAgentName(agents, route.chosenAgentId)]
      push({
        kind: 'info',
        title: 'Delegation',
        body: `Delegated: ${fromLabel} -> ${toLabel}`
      })
    }

    // --- 5. New approval_request messages -------------------------------
    const freshMessages: MessageLog[] = newEntries(messageLog, prevMessages)
    for (const entry of freshMessages) {
      if (entry.kind !== 'approval_request') continue
      push({
        kind: 'attention',
        title: 'Approval pending',
        body: excerpt(entry.content, APPROVAL_BODY_LIMIT)
      })
    }

    // --- Commit next snapshots ------------------------------------------
    taskStatusRef.current = nextTaskStatus
    agentStateRef.current = nextAgentState
    seenRouteIdsRef.current = nextRouteIds
    seenMessageIdsRef.current = nextMessageIds
  }, [tasks, agents, routes, messageLog])

  return null
}

/**
 * Best-effort agent label lookup. Falls back to a truncated id so the toast
 * still conveys *something* when the agent has been deleted between
 * dispatch and render.
 */
function resolveAgentName(agents: Agent[], id: UUID): string {
  const hit = agents.find((a) => a.id === id)
  if (hit) return hit.name
  return id.slice(0, 8)
}
