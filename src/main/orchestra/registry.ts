import { randomUUID } from 'node:crypto'
import {
  DEFAULT_ORCHESTRA_STATE,
  type Agent,
  type NewAgentInput,
  type NewEdgeInput,
  type NewTeamInput,
  type OrchestraStoreSlice,
  type ReportingEdge,
  type SafeMode,
  type Team,
  type TeamInstance,
  type TeamTemplate,
  type UUID,
  type UpdateAgentInput
} from '../../shared/orchestra'
import { getStore, patchStore } from '../store'

/** Deterministic id of the dedicated template paired with a legacy team
 *  during the template/instance split. Phase 5 retires this scheme. */
function templateIdFor(teamId: UUID): UUID {
  return `${teamId}-tpl`
}

/**
 * Storage surface the registry needs. Matches `project/manager.ts` so tests
 * can swap the Electron-bound store for an in-memory one.
 */
export interface OrchestraStore {
  read(): OrchestraStoreSlice
  write(next: OrchestraStoreSlice): void
}

export const electronOrchestraStore: OrchestraStore = {
  read: () => getStore().orchestra,
  write: (next) => patchStore({ orchestra: next })
}

export function createMemoryOrchestraStore(
  seed: Partial<OrchestraStoreSlice> = {}
): OrchestraStore {
  let state: OrchestraStoreSlice = { ...DEFAULT_ORCHESTRA_STATE, ...seed }
  return {
    read: () => state,
    write: (next) => {
      state = next
    }
  }
}

const DEFAULT_MODEL = 'claude-opus-4-7'
const DEFAULT_SAFE_MODE: SafeMode = 'prompt'
const DEFAULT_API_KEY_REF = 'default'
const DEFAULT_MAX_TOKENS = 8192

/** Kebab-case `name`, disambiguating against `existing` by appending `-2`, `-3`, ... */
export function slugify(name: string, existing: string[]): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const root = base.length > 0 ? base : 'untitled'
  const taken = new Set(existing)
  if (!taken.has(root)) return root
  let n = 2
  while (taken.has(`${root}-${n}`)) n++
  return `${root}-${n}`
}

export class OrchestraRegistry {
  constructor(private readonly store: OrchestraStore = electronOrchestraStore) {}

  private read(): OrchestraStoreSlice {
    return this.store.read()
  }

  private write(next: OrchestraStoreSlice): void {
    this.store.write(next)
  }

  // teams

  listTeams(): Team[] {
    return [...this.read().teams]
  }

  getTeam(id: UUID): Team | undefined {
    return this.read().teams.find((t) => t.id === id)
  }

  createTeam(input: NewTeamInput): Team {
    const name = input.name?.trim() ?? ''
    if (name.length === 0) throw new Error('empty name')

    const state = this.read()
    const slug = slugify(name, state.teams.map((t) => t.slug))
    const now = new Date().toISOString()
    const team: Team = {
      id: randomUUID(),
      slug,
      name,
      worktreePath: input.worktreePath,
      safeMode: input.safeMode ?? DEFAULT_SAFE_MODE,
      defaultModel: input.defaultModel ?? DEFAULT_MODEL,
      apiKeyRef: DEFAULT_API_KEY_REF,
      mainAgentId: null,
      canvas: { zoom: 1, panX: 0, panY: 0 },
      createdAt: now,
      updatedAt: now
    }
    const template: TeamTemplate = {
      id: templateIdFor(team.id),
      slug,
      name,
      safeMode: team.safeMode,
      defaultModel: team.defaultModel,
      apiKeyRef: team.apiKeyRef,
      mainAgentSlug: null,
      canvas: { ...team.canvas },
      createdAt: now,
      updatedAt: now
    }
    const instance: TeamInstance = {
      id: team.id,
      templateId: template.id,
      projectPath: team.worktreePath,
      worktreePath: team.worktreePath,
      createdAt: now
    }
    this.write({
      ...state,
      teams: [...state.teams, team],
      templates: [...state.templates, template],
      instances: [...state.instances, instance]
    })
    return { ...team }
  }

  renameTeam(id: UUID, name: string): Team {
    const trimmed = name?.trim() ?? ''
    if (trimmed.length === 0) throw new Error('empty name')
    const state = this.read()
    const team = state.teams.find((t) => t.id === id)
    if (!team) throw new Error('team not found')
    const now = new Date().toISOString()
    const updated: Team = { ...team, name: trimmed, updatedAt: now }
    const tplId = templateIdFor(id)
    this.write({
      ...state,
      teams: state.teams.map((t) => (t.id === id ? updated : t)),
      templates: state.templates.map((tpl) =>
        tpl.id === tplId ? { ...tpl, name: trimmed, updatedAt: now } : tpl
      )
    })
    return { ...updated }
  }

  setSafeMode(id: UUID, safeMode: SafeMode): Team {
    const state = this.read()
    const team = state.teams.find((t) => t.id === id)
    if (!team) throw new Error('team not found')
    const now = new Date().toISOString()
    const updated: Team = { ...team, safeMode, updatedAt: now }
    const tplId = templateIdFor(id)
    this.write({
      ...state,
      teams: state.teams.map((t) => (t.id === id ? updated : t)),
      templates: state.templates.map((tpl) =>
        tpl.id === tplId ? { ...tpl, safeMode, updatedAt: now } : tpl
      )
    })
    return { ...updated }
  }

  deleteTeam(id: UUID): void {
    const state = this.read()
    if (!state.teams.some((t) => t.id === id)) return
    const tplId = templateIdFor(id)
    this.write({
      ...state,
      teams: state.teams.filter((t) => t.id !== id),
      templates: state.templates.filter((tpl) => tpl.id !== tplId),
      instances: state.instances.filter((inst) => inst.id !== id),
      agents: state.agents.filter((a) => a.teamId !== id),
      edges: state.edges.filter((e) => e.teamId !== id),
      tasks: state.tasks.filter((t) => t.teamId !== id),
      routes: state.routes.filter((r) => {
        const task = state.tasks.find((x) => x.id === r.taskId)
        return task ? task.teamId !== id : true
      }),
      messageLog: state.messageLog.filter((m) => m.teamId !== id)
    })
  }

  // agents

  listAgents(teamId?: UUID): Agent[] {
    const { agents } = this.read()
    return teamId ? agents.filter((a) => a.teamId === teamId) : [...agents]
  }

  getAgent(id: UUID): Agent | undefined {
    return this.read().agents.find((a) => a.id === id)
  }

  createAgent(input: NewAgentInput): Agent {
    const name = input.name?.trim() ?? ''
    if (name.length === 0) throw new Error('empty name')
    const state = this.read()
    const team = state.teams.find((t) => t.id === input.teamId)
    if (!team) throw new Error('team not found')

    const teamAgents = state.agents.filter((a) => a.teamId === input.teamId)
    const slug = slugify(name, teamAgents.map((a) => a.slug))
    const now = new Date().toISOString()
    const agent: Agent = {
      id: randomUUID(),
      teamId: input.teamId,
      slug,
      name,
      role: input.role,
      description: input.description ?? '',
      position: input.position,
      color: input.color,
      model: input.model ?? '',
      maxTokens: DEFAULT_MAX_TOKENS,
      soulPath: `agents/${slug}/soul.md`,
      skillsPath: `agents/${slug}/skills.yaml`,
      triggersPath: `agents/${slug}/triggers.yaml`,
      state: 'idle',
      createdAt: now
    }

    const isFirstAgent = teamAgents.length === 0
    const updatedTeam: Team = isFirstAgent
      ? { ...team, mainAgentId: agent.id, updatedAt: now }
      : team

    const tplId = templateIdFor(team.id)
    this.write({
      ...state,
      agents: [...state.agents, agent],
      teams: isFirstAgent
        ? state.teams.map((t) => (t.id === team.id ? updatedTeam : t))
        : state.teams,
      templates: isFirstAgent
        ? state.templates.map((tpl) =>
            tpl.id === tplId
              ? { ...tpl, mainAgentSlug: agent.slug, updatedAt: now }
              : tpl
          )
        : state.templates
    })
    return { ...agent }
  }

  updateAgent(input: UpdateAgentInput): Agent {
    const state = this.read()
    const agent = state.agents.find((a) => a.id === input.id)
    if (!agent) throw new Error('agent not found')
    const updated: Agent = { ...agent, ...input.patch }
    this.write({
      ...state,
      agents: state.agents.map((a) => (a.id === input.id ? updated : a))
    })
    return { ...updated }
  }

  deleteAgent(id: UUID): void {
    const state = this.read()
    const agent = state.agents.find((a) => a.id === id)
    if (!agent) return

    const remainingAgents = state.agents.filter((a) => a.id !== id)
    const remainingEdges = state.edges.filter(
      (e) => e.parentAgentId !== id && e.childAgentId !== id
    )

    const team = state.teams.find((t) => t.id === agent.teamId)
    let teams = state.teams
    let templates = state.templates
    if (team && team.mainAgentId === id) {
      // Reassign to the next-oldest surviving agent in the team, or null.
      const candidates = remainingAgents
        .filter((a) => a.teamId === team.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const nextMain = candidates[0] ?? null
      const now = new Date().toISOString()
      const updatedTeam: Team = {
        ...team,
        mainAgentId: nextMain?.id ?? null,
        updatedAt: now
      }
      teams = state.teams.map((t) => (t.id === team.id ? updatedTeam : t))
      const tplId = templateIdFor(team.id)
      templates = state.templates.map((tpl) =>
        tpl.id === tplId
          ? { ...tpl, mainAgentSlug: nextMain?.slug ?? null, updatedAt: now }
          : tpl
      )
    }

    this.write({
      ...state,
      agents: remainingAgents,
      edges: remainingEdges,
      teams,
      templates
    })
  }

  promoteMain(agentId: UUID): Team {
    const state = this.read()
    const agent = state.agents.find((a) => a.id === agentId)
    if (!agent) throw new Error('agent not found')
    const team = state.teams.find((t) => t.id === agent.teamId)
    if (!team) throw new Error('team not found')
    const now = new Date().toISOString()
    const updated: Team = { ...team, mainAgentId: agentId, updatedAt: now }
    const tplId = templateIdFor(team.id)
    this.write({
      ...state,
      teams: state.teams.map((t) => (t.id === team.id ? updated : t)),
      templates: state.templates.map((tpl) =>
        tpl.id === tplId
          ? { ...tpl, mainAgentSlug: agent.slug, updatedAt: now }
          : tpl
      )
    })
    return { ...updated }
  }

  mainAgentOf(teamId: UUID): Agent | undefined {
    const state = this.read()
    const team = state.teams.find((t) => t.id === teamId)
    if (!team || !team.mainAgentId) return undefined
    return state.agents.find((a) => a.id === team.mainAgentId)
  }

  // edges

  listEdges(teamId?: UUID): ReportingEdge[] {
    const { edges } = this.read()
    return teamId ? edges.filter((e) => e.teamId === teamId) : [...edges]
  }

  createEdge(input: NewEdgeInput): ReportingEdge {
    if (input.parentAgentId === input.childAgentId) throw new Error('self-edge')
    const state = this.read()
    const parent = state.agents.find((a) => a.id === input.parentAgentId)
    const child = state.agents.find((a) => a.id === input.childAgentId)
    if (!parent || !child) throw new Error('agent not found')
    if (parent.teamId !== input.teamId || child.teamId !== input.teamId) {
      throw new Error('same team')
    }

    // Cycle check: from child forward, ensure we never reach parent.
    if (this.reachableFrom(input.childAgentId, state.edges).has(input.parentAgentId)) {
      throw new Error('cycle')
    }

    const edge: ReportingEdge = {
      id: randomUUID(),
      teamId: input.teamId,
      parentAgentId: input.parentAgentId,
      childAgentId: input.childAgentId,
      delegationMode: input.delegationMode ?? 'auto'
    }
    this.write({ ...state, edges: [...state.edges, edge] })
    return { ...edge }
  }

  deleteEdge(id: UUID): void {
    const state = this.read()
    if (!state.edges.some((e) => e.id === id)) return
    this.write({ ...state, edges: state.edges.filter((e) => e.id !== id) })
  }

  /** Transitive closure of descendants reachable from `agentId` (exclusive). */
  descendants(agentId: UUID): Set<UUID> {
    return this.reachableFrom(agentId, this.read().edges)
  }

  private reachableFrom(start: UUID, edges: ReportingEdge[]): Set<UUID> {
    const out = new Set<UUID>()
    const queue: UUID[] = [start]
    const seen = new Set<UUID>([start])
    while (queue.length > 0) {
      const node = queue.shift() as UUID
      for (const e of edges) {
        if (e.parentAgentId !== node) continue
        if (seen.has(e.childAgentId)) continue
        seen.add(e.childAgentId)
        out.add(e.childAgentId)
        queue.push(e.childAgentId)
      }
    }
    return out
  }
}
