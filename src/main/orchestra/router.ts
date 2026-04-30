import type {
  Agent,
  Priority,
  Skill,
  Task,
  Trigger,
  UUID
} from '../../shared/orchestra'

/**
 * Narrow dependency surface the router needs. The real implementations
 * live in `registry.ts`, `trigger-engine.ts`, and `disk.ts`. Keeping them
 * behind an interface keeps this module trivially testable with spy fakes
 * and lets the three modules evolve independently.
 */
export interface RouterDeps {
  readTriggers(agent: Agent): Promise<Trigger[]>
  readSkills(agent: Agent): Promise<Skill[]>
  listAgents(teamId: UUID): Agent[]
  descendants(agentId: UUID): Set<UUID>
  mainAgentOf(teamId: UUID): Agent | undefined
  scoreForAgent(
    triggers: Trigger[],
    ctx: { agent: Agent; task: Task; skills: Skill[]; now?: Date }
  ): { score: number; matchedTriggerIds: string[] }
}

export interface PickResult {
  chosen: Agent
  score: number
  candidates: Array<{ id: UUID; score: number }>
  reason: string
}

export type DelegationValidation =
  | { ok: true }
  | { ok: false; error: string }

/** Priority ranking used by the per-agent queue. Lower rank = higher priority. */
const PRIORITY_RANK: Record<Priority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3
}

/**
 * Compares two tasks for the priority queue. Smaller ranks first; on a tie,
 * older `createdAt` first (FIFO within a priority level).
 */
function compareTasks(a: Task, b: Task): number {
  const ra = PRIORITY_RANK[a.priority]
  const rb = PRIORITY_RANK[b.priority]
  if (ra !== rb) return ra - rb
  return a.createdAt.localeCompare(b.createdAt)
}

/** ISO strings compare lexicographically; older dates come first on ASC. */
function lastActiveAsc(a: Agent, b: Agent): number {
  const ax = a.lastActiveAt ?? ''
  const bx = b.lastActiveAt ?? ''
  if (ax === bx) return 0
  // Missing lastActiveAt => treat as oldest (empty string < any ISO date).
  return ax.localeCompare(bx)
}

export class Router {
  /** Per-agent sorted queue. Array kept sorted on insert; MVP sizes are tiny. */
  private readonly queues = new Map<UUID, Task[]>()

  constructor(private readonly deps: RouterDeps) {}

  // --------------------------------------------------------------- routing

  /**
   * Pure routing decision, no side effects. Reads triggers + skills for each
   * non-paused agent in the team-instance, scores them via
   * `deps.scoreForAgent`, and picks the winner. Falls back to the instance's
   * main agent if nobody scored.
   */
  async pickAgent(task: Task): Promise<PickResult> {
    // Phase 2 of issue #12: prefer `instanceId`, fall back to `teamId`
    // for tasks created before the field was populated. While the
    // template/instance split is in flight the two are equal.
    const targetId = task.instanceId ?? task.teamId
    const activeAgents = this.deps
      .listAgents(targetId)
      .filter((a) => a.state !== 'paused')

    const scored = await Promise.all(
      activeAgents.map(async (agent) => {
        const [triggers, skills] = await Promise.all([
          this.deps.readTriggers(agent),
          this.deps.readSkills(agent)
        ])
        const { score } = this.deps.scoreForAgent(triggers, {
          agent,
          task,
          skills
        })
        return { agent, score }
      })
    )

    const positive = scored.filter((c) => c.score > 0)

    if (positive.length === 0) {
      const main = this.deps.mainAgentOf(targetId)
      if (!main) throw new Error('no main agent set')
      return {
        chosen: main,
        score: 0,
        candidates: [{ id: main.id, score: 0 }],
        reason: 'fallback:no-match'
      }
    }

    positive.sort(
      (a, b) => b.score - a.score || lastActiveAsc(a.agent, b.agent)
    )
    // positive.length > 0 is guaranteed by the fallback branch above.
    const winner = positive[0]!
    return {
      chosen: winner.agent,
      score: winner.score,
      candidates: positive.map((c) => ({ id: c.agent.id, score: c.score })),
      reason: 'scored'
    }
  }

  // ----------------------------------------------------------------- queue

  /** Insert `task` into the agent's priority queue in sorted position. */
  enqueue(agentId: UUID, task: Task): void {
    const queue = this.queues.get(agentId) ?? []
    // Linear insertion; MVP ≤ 50 tasks per agent.
    let i = 0
    while (i < queue.length && compareTasks(queue[i]!, task) <= 0) i++
    queue.splice(i, 0, task)
    this.queues.set(agentId, queue)
  }

  /** Remove the task matching `taskId` from the agent's queue. */
  cancel(agentId: UUID, taskId: UUID): boolean {
    const queue = this.queues.get(agentId)
    if (!queue) return false
    const idx = queue.findIndex((t) => t.id === taskId)
    if (idx === -1) return false
    queue.splice(idx, 1)
    return true
  }

  /** Inspect the next task without removing it. */
  peek(agentId: UUID): Task | undefined {
    const queue = this.queues.get(agentId)
    if (!queue || queue.length === 0) return undefined
    return queue[0]
  }

  /** Remove and return the next task. Undefined if empty. */
  dequeue(agentId: UUID): Task | undefined {
    const queue = this.queues.get(agentId)
    if (!queue || queue.length === 0) return undefined
    return queue.shift()
  }

  // ------------------------------------------------------------ delegation

  /**
   * Validate that `fromAgentId` is allowed to delegate to `toAgentId`. The
   * target must be reachable in the DAG (i.e. a descendant of the source).
   */
  validateDelegation(
    fromAgentId: UUID,
    toAgentId: UUID
  ): DelegationValidation {
    const reachable = this.deps.descendants(fromAgentId)
    if (reachable.has(toAgentId)) return { ok: true }
    return { ok: false, error: 'target not reachable in DAG' }
  }
}
