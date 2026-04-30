import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetShapeOnlyWarning,
  matches,
  scoreForAgent,
  scoreForTrigger,
  type ScoreContext
} from '../trigger-engine'
import type { Agent, Skill, Task, Trigger } from '../../../shared/orchestra'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAgent(patch: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    instanceId: 'team-1',
    teamId: 'team-1',
    slug: 'alpha',
    name: 'Alpha',
    role: 'dev',
    description: '',
    position: { x: 0, y: 0 },
    model: 'claude-opus-4-7',
    maxTokens: 8192,
    soulPath: 'agents/alpha/soul.md',
    skillsPath: 'agents/alpha/skills.yaml',
    triggersPath: 'agents/alpha/triggers.yaml',
    state: 'idle',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...patch
  }
}

function makeTask(patch: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    instanceId: 'team-1',
    teamId: 'team-1',
    title: 'T',
    body: '',
    priority: 'P2',
    tags: [],
    status: 'queued',
    assignedAgentId: null,
    parentTaskId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch
  }
}

function makeTrigger(patch: Partial<Trigger> = {}): Trigger {
  return {
    id: 't-1',
    kind: 'tag',
    pattern: 'review',
    priority: 5,
    enabled: true,
    ...patch
  }
}

function ctx(patch: Partial<ScoreContext> = {}): ScoreContext {
  return {
    agent: makeAgent(),
    task: makeTask(),
    skills: [],
    now: new Date('2026-01-01T00:00:00.000Z'),
    ...patch
  }
}

// ---------------------------------------------------------------------------
// matches
// ---------------------------------------------------------------------------

describe('matches — manual', () => {
  it('matches when task has an assigned agent', () => {
    const t = makeTrigger({ kind: 'manual', pattern: '' })
    expect(matches(t, makeTask({ assignedAgentId: 'agent-1' }))).toBe(true)
  })

  it('does not match when task is unassigned', () => {
    const t = makeTrigger({ kind: 'manual', pattern: '' })
    expect(matches(t, makeTask({ assignedAgentId: null }))).toBe(false)
  })
})

describe('matches — tag (case-insensitive)', () => {
  it('matches on exact case and uppercase', () => {
    const t = makeTrigger({ kind: 'tag', pattern: 'Review' })
    expect(matches(t, makeTask({ tags: ['REVIEW'] }))).toBe(true)
    expect(matches(t, makeTask({ tags: ['review'] }))).toBe(true)
    expect(matches(t, makeTask({ tags: ['code'] }))).toBe(false)
  })
})

describe('matches — path with glob', () => {
  it('matches body containing `path: src/foo.go` against **/*.go', () => {
    const t = makeTrigger({ kind: 'path', pattern: '**/*.go' })
    expect(matches(t, makeTask({ body: 'please fix\npath: src/foo.go thanks' }))).toBe(true)
  })

  it('returns false when no candidate path is in body', () => {
    const t = makeTrigger({ kind: 'path', pattern: '**/*.go' })
    expect(matches(t, makeTask({ body: 'no path hints here' }))).toBe(false)
  })

  it('picks up bare repo-rooted tokens', () => {
    const t = makeTrigger({ kind: 'path', pattern: 'internal/domain/**' })
    expect(
      matches(t, makeTask({ body: 'touch internal/domain/delivery/foo.go' }))
    ).toBe(true)
  })

  it('single star does not cross path separators', () => {
    const t = makeTrigger({ kind: 'path', pattern: 'src/*.go' })
    expect(matches(t, makeTask({ body: 'path: src/nested/foo.go' }))).toBe(false)
    expect(matches(t, makeTask({ body: 'path: src/foo.go' }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// event / schedule — shape-only
// ---------------------------------------------------------------------------

describe('event/schedule triggers are shape-only', () => {
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    __resetShapeOnlyWarning()
    spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
  })

  afterEach(() => {
    spy.mockRestore()
  })

  it('match returns false and score is 0; warn fires once', () => {
    const ev = makeTrigger({ id: 'ev', kind: 'event', pattern: 'pr.opened' })
    const sch = makeTrigger({ id: 'sch', kind: 'schedule', pattern: '0 9 * * *' })
    expect(matches(ev, makeTask())).toBe(false)
    expect(matches(sch, makeTask())).toBe(false)
    expect(scoreForTrigger(ev, ctx())).toBe(0)
    expect(scoreForTrigger(sch, ctx())).toBe(0)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('event triggers are shape-only in MVP')
  })
})

// ---------------------------------------------------------------------------
// scoreForTrigger — disabled short-circuit & manual strictness
// ---------------------------------------------------------------------------

describe('scoreForTrigger', () => {
  it('returns 0 without matching when trigger is disabled', () => {
    const t = makeTrigger({ enabled: false, pattern: 'review' })
    const c = ctx({ task: makeTask({ tags: ['review'] }) })
    expect(scoreForTrigger(t, c)).toBe(0)
  })

  it('manual kind only scores when assignedAgentId === agent.id', () => {
    const t = makeTrigger({ kind: 'manual', pattern: '', priority: 10 })
    const matched = ctx({ task: makeTask({ assignedAgentId: 'agent-1' }) })
    const other = ctx({ task: makeTask({ assignedAgentId: 'agent-2' }) })
    expect(scoreForTrigger(t, matched)).toBe(10)
    expect(scoreForTrigger(t, other)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// skillBoost
// ---------------------------------------------------------------------------

describe('skillBoost', () => {
  it('sums weights for skills whose tags overlap task tags', () => {
    const skills: Skill[] = [
      { name: 'go', tags: ['go', 'backend'], weight: 1.5 },
      { name: 'ts', tags: ['typescript'], weight: 1.0 },
      { name: 'react', tags: ['react'], weight: 0.8 }
    ]
    const t = makeTrigger({ kind: 'tag', pattern: 'review', priority: 5 })
    const c = ctx({
      task: makeTask({ tags: ['review', 'backend', 'react'] }),
      skills
    })
    // base 5 + (go 1.5 + react 0.8) = 7.3; recency 0 (no lastActiveAt)
    expect(scoreForTrigger(t, c)).toBeCloseTo(7.3, 5)
  })

  it('matching is case-insensitive', () => {
    const skills: Skill[] = [{ name: 'go', tags: ['Go'], weight: 2 }]
    const t = makeTrigger({ kind: 'tag', pattern: 'review', priority: 0 })
    const c = ctx({ task: makeTask({ tags: ['REVIEW', 'GO'] }), skills })
    expect(scoreForTrigger(t, c)).toBeCloseTo(2, 5)
  })
})

// ---------------------------------------------------------------------------
// recencyPenalty
// ---------------------------------------------------------------------------

describe('recencyPenalty', () => {
  it('caps at -3 for ancient lastActiveAt', () => {
    const agent = makeAgent({ lastActiveAt: '2000-01-01T00:00:00.000Z' })
    const t = makeTrigger({ kind: 'tag', pattern: 'x', priority: 0 })
    const c = ctx({ agent, task: makeTask({ tags: [] }), now: new Date('2026-01-01T00:00:00.000Z') })
    // no match (priority 0 * 0), no boost, just the capped penalty
    expect(scoreForTrigger(t, c)).toBe(-3)
  })

  it('is 0 when lastActiveAt is missing', () => {
    const agent = makeAgent({ lastActiveAt: undefined })
    const t = makeTrigger({ kind: 'manual', pattern: '', priority: 4 })
    const c = ctx({ agent, task: makeTask({ assignedAgentId: 'agent-1' }) })
    expect(scoreForTrigger(t, c)).toBe(4)
  })

  it('applies fractional penalty under the cap', () => {
    const now = new Date('2026-01-01T01:00:00.000Z') // 1h later
    const agent = makeAgent({ lastActiveAt: '2026-01-01T00:00:00.000Z' })
    const t = makeTrigger({ kind: 'manual', pattern: '', priority: 0 })
    const c = ctx({
      agent,
      task: makeTask({ assignedAgentId: 'agent-1' }),
      now
    })
    // 60min => -0.5 * 1 = -0.5
    expect(scoreForTrigger(t, c)).toBeCloseTo(-0.5, 5)
  })
})

// ---------------------------------------------------------------------------
// scoreForAgent — aggregation
// ---------------------------------------------------------------------------

describe('scoreForAgent', () => {
  it('returns best score and matched trigger ids sorted desc by score', () => {
    const triggers: Trigger[] = [
      { id: 'low', kind: 'tag', pattern: 'review', priority: 2, enabled: true },
      { id: 'hi', kind: 'tag', pattern: 'review', priority: 9, enabled: true },
      { id: 'off', kind: 'tag', pattern: 'review', priority: 99, enabled: false },
      { id: 'miss', kind: 'tag', pattern: 'nomatch', priority: 50, enabled: true }
    ]
    const c = ctx({ task: makeTask({ tags: ['review'] }) })
    const res = scoreForAgent(triggers, c)
    expect(res.score).toBe(9)
    expect(res.matchedTriggerIds).toEqual(['hi', 'low'])
  })

  it('returns 0 score and empty list when nothing fires', () => {
    const triggers: Trigger[] = [
      { id: 'a', kind: 'tag', pattern: 'none', priority: 5, enabled: true }
    ]
    const c = ctx({ task: makeTask({ tags: ['other'] }) })
    const res = scoreForAgent(triggers, c)
    expect(res.score).toBe(0)
    expect(res.matchedTriggerIds).toEqual([])
  })
})
