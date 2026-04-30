import { describe, expect, it } from 'vitest'
import type { Agent, Team } from '../../../shared/orchestra'
import {
  type LegacyOrchestraSliceV1,
  isV1Snapshot,
  migrateV1ToV2
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
  it('rejects non-object inputs', () => {
    expect(isV1Snapshot(null)).toBe(false)
    expect(isV1Snapshot('hi')).toBe(false)
    expect(isV1Snapshot({})).toBe(false)
  })
})

describe('migrateV1ToV2', () => {
  it('produces an empty v2 slice from an empty v1', () => {
    const v1 = emptyV1()
    const v2 = migrateV1ToV2(v1)
    expect(v2.schemaVersion).toBe(2)
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
    expect(v2.agents[0]!.teamId).toBe(instance.id)
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
