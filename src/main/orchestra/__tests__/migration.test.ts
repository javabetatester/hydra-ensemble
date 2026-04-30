import { describe, expect, it } from 'vitest'
import type { Agent, Team } from '../../../shared/orchestra'
import {
  type LegacyOrchestraSliceV1,
  type LegacyOrchestraSliceV2,
  isV1Snapshot,
  isV2Snapshot,
  migrateV1ToV2,
  migrateV2ToV3
} from '../migration'

function makeTeam(partial: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    slug: 'acme',
    name: 'Acme',
    worktreePath: '/tmp/acme',
    safeMode: 'prompt',
    defaultModel: 'claude-opus-4-7',
    apiKeyRef: 'default',
    mainAgentId: null,
    canvas: { zoom: 1, panX: 0, panY: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial
  }
}

function makeAgent(partial: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    instanceId: 'team-1',
    teamId: 'team-1',
    slug: 'lead',
    name: 'Lead',
    role: 'eng',
    description: '',
    position: { x: 0, y: 0 },
    model: '',
    maxTokens: 8192,
    soulPath: 'agents/lead/soul.md',
    skillsPath: 'agents/lead/skills.yaml',
    triggersPath: 'agents/lead/triggers.yaml',
    state: 'idle',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial
  }
}

function emptyV1(): LegacyOrchestraSliceV1 {
  return {
    schemaVersion: 1,
    settings: {
      enabled: false,
      apiKeyProvider: 'keychain',
      onboardingDismissed: false
    },
    teams: [],
    agents: [],
    edges: [],
    tasks: [],
    routes: [],
    messageLog: []
  }
}

describe('isV1Snapshot', () => {
  it('treats schemaVersion absent as v1 when teams[] is present', () => {
    expect(isV1Snapshot({ teams: [] })).toBe(true)
  })
  it('treats schemaVersion === 1 as v1', () => {
    expect(isV1Snapshot({ schemaVersion: 1, teams: [] })).toBe(true)
  })
  it('treats schemaVersion === 2 as already migrated', () => {
    expect(isV1Snapshot({ schemaVersion: 2, teams: [] })).toBe(false)
  })
  it('treats schemaVersion === 3 as already migrated', () => {
    expect(isV1Snapshot({ schemaVersion: 3, teams: [] })).toBe(false)
  })
  it('rejects non-object inputs', () => {
    expect(isV1Snapshot(null)).toBe(false)
    expect(isV1Snapshot('hi')).toBe(false)
    expect(isV1Snapshot({})).toBe(false)
  })
})

describe('isV2Snapshot', () => {
  it('matches schemaVersion === 2', () => {
    expect(isV2Snapshot({ schemaVersion: 2 })).toBe(true)
  })
  it('does not match v1 or v3', () => {
    expect(isV2Snapshot({ schemaVersion: 1 })).toBe(false)
    expect(isV2Snapshot({ schemaVersion: 3 })).toBe(false)
  })
  it('rejects non-object inputs', () => {
    expect(isV2Snapshot(null)).toBe(false)
    expect(isV2Snapshot('hi')).toBe(false)
  })
})

describe('migrateV2ToV3', () => {
  function emptyV2(): LegacyOrchestraSliceV2 {
    return {
      schemaVersion: 2,
      settings: {
        enabled: false,
        apiKeyProvider: 'keychain',
        onboardingDismissed: false
      },
      teams: [],
      templates: [],
      instances: [],
      agents: [],
      edges: [],
      tasks: [],
      routes: [],
      messageLog: []
    }
  }

  it('bumps schemaVersion to 3 and leaves empty arrays untouched', () => {
    const out = migrateV2ToV3(emptyV2())
    expect(out.schemaVersion).toBe(3)
    expect(out.agents).toEqual([])
    expect(out.edges).toEqual([])
    expect(out.messageLog).toEqual([])
  })

  it('backfills instanceId on agents, edges, and messageLog from teamId', () => {
    const v2 = emptyV2()
    v2.agents = [
      {
        id: 'agent-1',
        teamId: 'team-1',
        slug: 'lead',
        name: 'Lead',
        role: 'eng',
        description: '',
        position: { x: 0, y: 0 },
        model: '',
        maxTokens: 8192,
        soulPath: 'agents/lead/soul.md',
        skillsPath: 'agents/lead/skills.yaml',
        triggersPath: 'agents/lead/triggers.yaml',
        state: 'idle',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    v2.edges = [
      {
        id: 'edge-1',
        teamId: 'team-1',
        parentAgentId: 'agent-1',
        childAgentId: 'agent-2',
        delegationMode: 'auto'
      }
    ]
    v2.messageLog = [
      {
        id: 'm1',
        teamId: 'team-1',
        taskId: 'task-1',
        fromAgentId: 'agent-1',
        toAgentId: 'agent-2',
        kind: 'output',
        content: 'hello',
        at: '2026-01-01T00:00:00.000Z'
      }
    ]
    const out = migrateV2ToV3(v2)
    expect(out.agents[0]!.instanceId).toBe('team-1')
    expect(out.edges[0]!.instanceId).toBe('team-1')
    expect(out.messageLog[0]!.instanceId).toBe('team-1')
  })

  it('is idempotent — running on its own output produces the same slice', () => {
    const v2 = emptyV2()
    v2.agents = [
      {
        id: 'agent-1',
        teamId: 'team-1',
        slug: 'lead',
        name: 'Lead',
        role: 'eng',
        description: '',
        position: { x: 0, y: 0 },
        model: '',
        maxTokens: 8192,
        soulPath: 'agents/lead/soul.md',
        skillsPath: 'agents/lead/skills.yaml',
        triggersPath: 'agents/lead/triggers.yaml',
        state: 'idle',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const a = migrateV2ToV3(v2)
    // Re-running on a cast-back v2 shape (the function only reads
    // `teamId`, so this is fine) yields the same data.
    const b = migrateV2ToV3({
      ...v2,
      agents: a.agents,
      edges: a.edges,
      messageLog: a.messageLog
    })
    expect(b).toEqual(a)
  })
})

describe('migrateV1ToV2', () => {
  it('produces an empty v3 slice from an empty v1', () => {
    const v1 = emptyV1()
    const v2 = migrateV1ToV2(v1)
    expect(v2.schemaVersion).toBe(3)
    expect(v2.templates).toEqual([])
    expect(v2.instances).toEqual([])
    expect(v2.teams).toEqual([])
  })

  it('builds one template + one instance per legacy team', () => {
    const v1 = emptyV1()
    v1.teams = [makeTeam(), makeTeam({ id: 'team-2', slug: 'beta', name: 'Beta', worktreePath: '/tmp/beta' })]
    const v2 = migrateV1ToV2(v1)
    expect(v2.templates).toHaveLength(2)
    expect(v2.instances).toHaveLength(2)
    expect(v2.templates.map((t) => t.id).sort()).toEqual(['team-1-tpl', 'team-2-tpl'])
    expect(v2.instances.map((i) => i.id).sort()).toEqual(['team-1', 'team-2'])
  })

  it('preserves instance.id == legacy team.id so foreign keys keep resolving', () => {
    const v1 = emptyV1()
    v1.teams = [makeTeam()]
    v1.agents = [makeAgent()]
    v1.tasks = [
      {
        id: 'task-1',
        teamId: 'team-1',
        title: 't',
        body: 'b',
        priority: 'P2',
        tags: [],
        status: 'queued',
        assignedAgentId: null,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const v2 = migrateV1ToV2(v1)
    const instance = v2.instances[0]!
    expect(instance.id).toBe('team-1')
    expect(v2.tasks[0]!.teamId).toBe(instance.id)
    expect(v2.tasks[0]!.instanceId).toBe(instance.id)
    expect(v2.agents[0]!.teamId).toBe(instance.id)
  })

  it('backfills task.instanceId from the legacy task.teamId', () => {
    const v1 = emptyV1()
    v1.teams = [makeTeam(), makeTeam({ id: 'team-2', slug: 'b', worktreePath: '/x' })]
    v1.tasks = [
      {
        id: 'a',
        teamId: 'team-1',
        title: 'a',
        body: '',
        priority: 'P2',
        tags: [],
        status: 'queued',
        assignedAgentId: null,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'b',
        teamId: 'team-2',
        title: 'b',
        body: '',
        priority: 'P2',
        tags: [],
        status: 'queued',
        assignedAgentId: null,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const v2 = migrateV1ToV2(v1)
    expect(v2.tasks.map((t) => t.instanceId)).toEqual(['team-1', 'team-2'])
  })

  it('resolves mainAgentId to mainAgentSlug on the template', () => {
    const v1 = emptyV1()
    v1.teams = [makeTeam({ mainAgentId: 'agent-1' })]
    v1.agents = [makeAgent({ slug: 'lead' })]
    const v2 = migrateV1ToV2(v1)
    expect(v2.templates[0]!.mainAgentSlug).toBe('lead')
  })

  it('emits null mainAgentSlug when the team has no main agent', () => {
    const v1 = emptyV1()
    v1.teams = [makeTeam({ mainAgentId: null })]
    const v2 = migrateV1ToV2(v1)
    expect(v2.templates[0]!.mainAgentSlug).toBeNull()
  })

  it('seeds projectPath and worktreePath on the instance from the legacy worktreePath', () => {
    const v1 = emptyV1()
    v1.teams = [makeTeam({ worktreePath: '/home/user/project-a' })]
    const v2 = migrateV1ToV2(v1)
    const instance = v2.instances[0]!
    expect(instance.projectPath).toBe('/home/user/project-a')
    expect(instance.worktreePath).toBe('/home/user/project-a')
    expect(instance.templateId).toBe('team-1-tpl')
  })

  it('is deterministic — running twice on the same v1 yields equal output', () => {
    const v1 = emptyV1()
    v1.teams = [makeTeam(), makeTeam({ id: 'team-2', slug: 'b', worktreePath: '/x' })]
    const a = migrateV1ToV2(v1)
    const b = migrateV1ToV2(v1)
    expect(a).toEqual(b)
  })
})
