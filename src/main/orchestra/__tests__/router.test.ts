import { describe, expect, it } from 'vitest'
import { Router, type RouterDeps } from '../router'
import type {
  Agent,
  Priority,
  Skill,
  Task,
  Trigger,
  UUID
} from '../../../shared/orchestra'

// ---------------------------------------------------------------- fixtures

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  const id = overrides.id ?? 'a1'
  return {
    id,
    instanceId: 'team-1',
    teamId: 'team-1',
    slug: id,
    name: id,
    role: 'eng',
    description: '',
    position: { x: 0, y: 0 },
    model: '',
    maxTokens: 8192,
    soulPath: `agents/${id}/soul.md`,
    skillsPath: `agents/${id}/skills.yaml`,
    triggersPath: `agents/${id}/triggers.yaml`,
    state: 'idle',
    createdAt: '2026-04-20T10:00:00.000Z',
    ...overrides
  }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 't1',
    instanceId: 'team-1',
    teamId: 'team-1',
    title: 'do stuff',
    body: '',
    priority: overrides.priority ?? 'P2',
    tags: [],
    status: 'queued',
    assignedAgentId: null,
    parentTaskId: null,
    createdAt: overrides.createdAt ?? '2026-04-21T12:00:00.000Z',
    updatedAt: '2026-04-21T12:00:00.000Z',
    ...overrides
  }
}

/** Build a RouterDeps spy that returns configurable per-agent scores. */
function makeDeps(opts: {
  agents: Agent[]
  scores: Record<UUID, number>
  descendants?: Record<UUID, UUID[]>
  mainAgent?: Agent
  triggers?: Record<UUID, Trigger[]>
  skills?: Record<UUID, Skill[]>
}): RouterDeps & {
  calls: { readTriggers: number; readSkills: number; score: number }
} {
  const calls = { readTriggers: 0, readSkills: 0, score: 0 }
  return {
    calls,
    async readTriggers(agent: Agent): Promise<Trigger[]> {
      calls.readTriggers++
      return opts.triggers?.[agent.id] ?? []
    },
    async readSkills(agent: Agent): Promise<Skill[]> {
      calls.readSkills++
      return opts.skills?.[agent.id] ?? []
    },
    listAgents(teamId: UUID): Agent[] {
      return opts.agents.filter((a) => a.teamId === teamId)
    },
    descendants(agentId: UUID): Set<UUID> {
      return new Set(opts.descendants?.[agentId] ?? [])
    },
    mainAgentOf(_teamId: UUID): Agent | undefined {
      return opts.mainAgent
    },
    scoreForAgent(triggers, ctx): { score: number; matchedTriggerIds: string[] } {
      calls.score++
      const score = opts.scores[ctx.agent.id] ?? 0
      return {
        score,
        matchedTriggerIds: triggers.map((t) => t.id)
      }
    }
  }
}

// ----------------------------------------------------------------- pickAgent

describe('Router.pickAgent', () => {
  it('picks the single matching agent', async () => {
    const a1 = makeAgent({ id: 'a1' })
    const a2 = makeAgent({ id: 'a2' })
    const deps = makeDeps({
      agents: [a1, a2],
      scores: { a1: 5, a2: 0 }
    })
    const router = new Router(deps)

    const result = await router.pickAgent(makeTask())

    expect(result.chosen.id).toBe('a1')
    expect(result.score).toBe(5)
    expect(result.reason).toBe('scored')
    expect(result.candidates).toEqual([{ id: 'a1', score: 5 }])
  })

  it('higher score wins when multiple agents match', async () => {
    const a1 = makeAgent({ id: 'a1' })
    const a2 = makeAgent({ id: 'a2' })
    const deps = makeDeps({
      agents: [a1, a2],
      scores: { a1: 3, a2: 9 }
    })
    const router = new Router(deps)

    const result = await router.pickAgent(makeTask())

    expect(result.chosen.id).toBe('a2')
    expect(result.score).toBe(9)
    expect(result.candidates.map((c) => c.id)).toEqual(['a2', 'a1'])
  })

  it('tiebreak: older lastActiveAt wins on equal score', async () => {
    const older = makeAgent({
      id: 'older',
      lastActiveAt: '2026-04-20T08:00:00.000Z'
    })
    const newer = makeAgent({
      id: 'newer',
      lastActiveAt: '2026-04-21T08:00:00.000Z'
    })
    const deps = makeDeps({
      agents: [newer, older],
      scores: { newer: 5, older: 5 }
    })
    const router = new Router(deps)

    const result = await router.pickAgent(makeTask())

    expect(result.chosen.id).toBe('older')
  })

  it('falls back to main when no agent scores > 0', async () => {
    const a1 = makeAgent({ id: 'a1' })
    const main = makeAgent({ id: 'main' })
    const deps = makeDeps({
      agents: [a1, main],
      scores: { a1: 0, main: 0 },
      mainAgent: main
    })
    const router = new Router(deps)

    const result = await router.pickAgent(makeTask())

    expect(result.chosen.id).toBe('main')
    expect(result.score).toBe(0)
    expect(result.reason).toBe('fallback:no-match')
  })

  it("throws 'no main agent set' when nothing scores and no main exists", async () => {
    const a1 = makeAgent({ id: 'a1' })
    const deps = makeDeps({
      agents: [a1],
      scores: { a1: 0 }
    })
    const router = new Router(deps)

    await expect(router.pickAgent(makeTask())).rejects.toThrow(
      /no main agent set/
    )
  })

  it('ignores paused agents when collecting candidates', async () => {
    const active = makeAgent({ id: 'active' })
    const paused = makeAgent({ id: 'paused', state: 'paused' })
    const deps = makeDeps({
      agents: [active, paused],
      scores: { active: 4, paused: 99 }
    })
    const router = new Router(deps)

    const result = await router.pickAgent(makeTask())

    expect(result.chosen.id).toBe('active')
    expect(result.candidates.map((c) => c.id)).toEqual(['active'])
  })
})

// --------------------------------------------------------- enqueue / dequeue

describe('Router queue', () => {
  function emptyRouter(): Router {
    return new Router(
      makeDeps({ agents: [], scores: {} })
    )
  }

  function taskAt(id: string, priority: Priority, createdAt: string): Task {
    return makeTask({ id, priority, createdAt })
  }

  it('P0 comes before P1 even when P1 was inserted earlier', () => {
    const router = emptyRouter()
    const agentId = 'a1'
    router.enqueue(agentId, taskAt('p1', 'P1', '2026-04-21T10:00:00.000Z'))
    router.enqueue(agentId, taskAt('p0', 'P0', '2026-04-21T11:00:00.000Z'))
    router.enqueue(agentId, taskAt('p2', 'P2', '2026-04-21T09:00:00.000Z'))

    expect(router.peek(agentId)?.id).toBe('p0')
    expect(router.dequeue(agentId)?.id).toBe('p0')
    expect(router.dequeue(agentId)?.id).toBe('p1')
    expect(router.dequeue(agentId)?.id).toBe('p2')
    expect(router.dequeue(agentId)).toBeUndefined()
  })

  it('FIFO within the same priority level (createdAt ASC)', () => {
    const router = emptyRouter()
    const agentId = 'a1'
    router.enqueue(agentId, taskAt('later', 'P1', '2026-04-21T12:00:00.000Z'))
    router.enqueue(agentId, taskAt('earlier', 'P1', '2026-04-21T09:00:00.000Z'))

    expect(router.dequeue(agentId)?.id).toBe('earlier')
    expect(router.dequeue(agentId)?.id).toBe('later')
  })

  it('cancel removes the task and returns true; false when absent', () => {
    const router = emptyRouter()
    const agentId = 'a1'
    router.enqueue(agentId, taskAt('alive', 'P2', '2026-04-21T09:00:00.000Z'))

    expect(router.cancel(agentId, 'ghost')).toBe(false)
    expect(router.cancel(agentId, 'alive')).toBe(true)
    expect(router.peek(agentId)).toBeUndefined()
    // Second cancel on the same id is a no-op.
    expect(router.cancel(agentId, 'alive')).toBe(false)
  })

  it('peek/dequeue return undefined for an unknown agent', () => {
    const router = emptyRouter()
    expect(router.peek('missing')).toBeUndefined()
    expect(router.dequeue('missing')).toBeUndefined()
    expect(router.cancel('missing', 'anything')).toBe(false)
  })
})

// ------------------------------------------------------------- delegation

describe('Router.validateDelegation', () => {
  it('allows a direct child', () => {
    const deps = makeDeps({
      agents: [],
      scores: {},
      descendants: { parent: ['child'] }
    })
    const router = new Router(deps)

    expect(router.validateDelegation('parent', 'child')).toEqual({ ok: true })
  })

  it('allows a transitive descendant', () => {
    const deps = makeDeps({
      agents: [],
      scores: {},
      descendants: { root: ['mid', 'leaf'] }
    })
    const router = new Router(deps)

    expect(router.validateDelegation('root', 'leaf')).toEqual({ ok: true })
  })

  it('rejects an unrelated agent', () => {
    const deps = makeDeps({
      agents: [],
      scores: {},
      descendants: { parent: ['child'] }
    })
    const router = new Router(deps)

    expect(router.validateDelegation('parent', 'stranger')).toEqual({
      ok: false,
      error: 'target not reachable in DAG'
    })
  })
})
