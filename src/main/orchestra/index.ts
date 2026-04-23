/**
 * OrchestraCore — facade that wires registry, disk, secrets, trigger-engine,
 * router, message-log, and agent-host together for the IPC layer.
 *
 * Tasks and Routes are not owned by the registry (which only tracks
 * teams/agents/edges), so the facade persists them directly through the
 * JSON store slice. See PLAN.md §4.2.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  OrchestraRegistry,
  electronOrchestraStore,
  type OrchestraStore
} from './registry'
import {
  createAgentFolder,
  createTeamFolder,
  deleteAgentFolder,
  deleteTeamFolder,
  orchestraRoot,
  readSkills,
  readSoul,
  readTeamClaudeMd,
  readTriggers,
  teamDir,
  writeSkills,
  writeSoul,
  writeTeamClaudeMd,
  writeTriggers
} from './disk'
import {
  clearApiKey as secretsClearApiKey,
  getApiKey as secretsGetApiKey,
  setApiKey as secretsSetApiKey,
  testApiKey as secretsTestApiKey
} from './secrets'
import { scoreForAgent } from './trigger-engine'
import { Router, type RouterDeps } from './router'
import { MessageLogStore } from './message-log'
import { AgentHost, type DelegateRequestPayload } from './agent-host'
import { getStore, patchStore } from '../store'
import type {
  Agent,
  MessageLog,
  NewAgentInput,
  NewEdgeInput,
  NewTeamInput,
  OrchestraEvent,
  OrchestraStoreSlice,
  ReportingEdge,
  Route,
  SafeMode,
  SecretStorage,
  Skill,
  SubmitTaskInput,
  Task,
  Team,
  Trigger,
  UUID,
  UpdateAgentInput
} from '../../shared/orchestra'

const NO_API_KEY_REASON = 'no_api_key'
const TASKS_CAP = 500
const ROUTES_CAP = 500
const LOG_CAP = 2000

export interface OrchestraCoreOptions {
  store?: OrchestraStore
}

type SubmitInput = SubmitTaskInput & { parentTaskId?: UUID }

export class OrchestraCore {
  private readonly registry: OrchestraRegistry
  private readonly router: Router
  private readonly log: MessageLogStore
  private readonly hosts = new Map<UUID, AgentHost>()

  private apiKey: string | null = null
  private unsubscribeLog: (() => void) | null = null
  private started = false

  constructor(
    private readonly emit: (event: OrchestraEvent) => void,
    options: OrchestraCoreOptions = {}
  ) {
    this.registry = new OrchestraRegistry(options.store ?? electronOrchestraStore)

    const deps: RouterDeps = {
      readTriggers: (agent) => this.safeRead(agent, readTriggers) as Promise<Trigger[]>,
      readSkills: (agent) => this.safeRead(agent, readSkills) as Promise<Skill[]>,
      listAgents: (teamId) => this.registry.listAgents(teamId),
      descendants: (agentId) => this.registry.descendants(agentId),
      mainAgentOf: (teamId) => this.registry.mainAgentOf(teamId),
      scoreForAgent: (triggers, ctx) => scoreForAgent(triggers, ctx)
    }
    this.router = new Router(deps)

    this.log = new MessageLogStore({
      rootDir: orchestraRoot(),
      cap: LOG_CAP,
      teamSlugOf: (teamId) => {
        const team = this.registry.getTeam(teamId)
        if (!team) throw new Error(`unknown team: ${teamId}`)
        return team.slug
      }
    })
  }

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    this.unsubscribeLog = this.log.subscribe((entry) => {
      this.emit({ kind: 'messageLog.appended', entry })
    })

    for (const team of this.registry.listTeams()) {
      if (!existsSync(teamDir(team.slug))) {
        try { await createTeamFolder(team.slug) } catch { /* best-effort */ }
      }
    }

    this.apiKey = await secretsGetApiKey()
  }

  async shutdown(): Promise<void> {
    const stops: Array<Promise<void>> = []
    for (const host of this.hosts.values()) stops.push(host.stop('SIGTERM'))
    await Promise.allSettled(stops)
    this.hosts.clear()
    this.unsubscribeLog?.()
    this.unsubscribeLog = null
    await this.log.close()
    this.started = false
  }

  // -------------------------------------------------------------------- teams

  listTeams(): Team[] { return this.registry.listTeams() }

  async createTeam(input: NewTeamInput): Promise<Team> {
    const team = this.registry.createTeam(input)
    try {
      await createTeamFolder(team.slug)
    } catch (err) {
      this.registry.deleteTeam(team.id)
      throw err
    }
    this.emit({ kind: 'team.changed', team })
    return team
  }

  async renameTeam(id: UUID, name: string): Promise<Team> {
    const team = this.registry.renameTeam(id, name)
    this.emit({ kind: 'team.changed', team })
    return team
  }

  async setSafeMode(id: UUID, mode: SafeMode): Promise<Team> {
    const team = this.registry.setSafeMode(id, mode)
    this.emit({ kind: 'team.changed', team })
    return team
  }

  async deleteTeam(id: UUID): Promise<void> {
    const team = this.registry.getTeam(id)
    if (!team) return
    for (const a of this.registry.listAgents(id)) await this.stopHostFor(a.id)
    this.registry.deleteTeam(id)
    try { await deleteTeamFolder(team.slug) } catch { /* best-effort */ }
    this.emit({ kind: 'team.deleted', teamId: id })
  }

  // ------------------------------------------------------------------- agents

  listAgents(teamId: UUID): Agent[] { return this.registry.listAgents(teamId) }

  async createAgent(input: NewAgentInput): Promise<Agent> {
    const team = this.registry.getTeam(input.teamId)
    if (!team) throw new Error('team not found')
    const agent = this.registry.createAgent(input)
    try {
      await createAgentFolder(team.slug, agent.slug, input.preset ?? 'blank')
    } catch (err) {
      this.registry.deleteAgent(agent.id)
      throw err
    }
    this.emit({ kind: 'agent.changed', agent })
    const refreshed = this.registry.getTeam(team.id)
    if (refreshed && refreshed.mainAgentId !== team.mainAgentId) {
      this.emit({ kind: 'team.changed', team: refreshed })
    }
    return agent
  }

  async updateAgent(input: UpdateAgentInput): Promise<Agent> {
    const agent = this.registry.updateAgent(input)
    this.emit({ kind: 'agent.changed', agent })
    return agent
  }

  async deleteAgent(id: UUID): Promise<void> {
    const agent = this.registry.getAgent(id)
    if (!agent) return
    const team = this.registry.getTeam(agent.teamId)
    const previousMainId = team?.mainAgentId ?? null

    await this.stopHostFor(id)
    this.registry.deleteAgent(id)

    if (team) {
      try { await deleteAgentFolder(team.slug, agent.slug) } catch { /* best-effort */ }
      const refreshed = this.registry.getTeam(team.id)
      if (refreshed && refreshed.mainAgentId !== previousMainId) {
        this.emit({ kind: 'team.changed', team: refreshed })
      }
    }
    this.emit({ kind: 'agent.deleted', agentId: id })
  }

  async promoteMain(id: UUID): Promise<Team> {
    const team = this.registry.promoteMain(id)
    this.emit({ kind: 'team.changed', team })
    return team
  }

  async pauseAgent(id: UUID): Promise<Agent> {
    const host = this.hosts.get(id)
    if (host) await host.pause()
    return this.setAgentState(id, 'paused')
  }

  async stopAgent(id: UUID): Promise<Agent> {
    await this.stopHostFor(id)
    return this.setAgentState(id, 'idle')
  }

  // -------------------------------------------------------------------- edges

  listEdges(teamId: UUID): ReportingEdge[] { return this.registry.listEdges(teamId) }

  async createEdge(input: NewEdgeInput): Promise<ReportingEdge> {
    const edge = this.registry.createEdge(input)
    this.emit({ kind: 'edge.changed', edge })
    return edge
  }

  async deleteEdge(id: UUID): Promise<void> {
    this.registry.deleteEdge(id)
    this.emit({ kind: 'edge.deleted', edgeId: id })
  }

  // -------------------------------------------------------------------- tasks

  listTasks(teamId: UUID): Task[] {
    const slice = getStore().orchestra
    return slice.tasks.filter((t) => t.teamId === teamId)
  }

  async submitTask(input: SubmitTaskInput): Promise<Task> {
    const team = this.registry.getTeam(input.teamId)
    if (!team) throw new Error('team not found')

    const now = new Date().toISOString()
    const task: Task = {
      id: randomUUID(),
      teamId: input.teamId,
      title: input.title,
      body: input.body,
      priority: input.priority ?? 'P2',
      tags: input.tags ?? [],
      sourceEvent: input.sourceEvent,
      status: 'queued',
      assignedAgentId: null,
      parentTaskId: (input as SubmitInput).parentTaskId ?? null,
      createdAt: now,
      updatedAt: now
    }
    this.appendTask(task)
    this.emit({ kind: 'task.changed', task })

    let pick: Awaited<ReturnType<Router['pickAgent']>>
    try {
      pick = await this.router.pickAgent(task)
    } catch (err) {
      return this.failTask(task.id, (err as Error).message || 'routing failed')
    }

    const route: Route = {
      id: randomUUID(),
      taskId: task.id,
      chosenAgentId: pick.chosen.id,
      candidateAgentIds: pick.candidates.map((c) => c.id),
      score: pick.score,
      reason: pick.reason,
      at: new Date().toISOString()
    }
    this.appendRoute(route)
    const routing = this.patchTask(task.id, {
      assignedAgentId: pick.chosen.id,
      status: 'routing'
    })
    this.emit({ kind: 'task.changed', task: routing })
    this.emit({ kind: 'route.added', route })

    if (!this.apiKey) return this.failTask(routing.id, NO_API_KEY_REASON)

    const host = await this.hostFor(pick.chosen.id)
    if (!host) return this.failTask(routing.id, 'agent not found')

    const extras = await this.buildSystemPromptExtras(team)
    const result = await host.runTask(routing, extras)
    if (!result.ok) return this.failTask(routing.id, result.error)

    const inProgress = this.patchTask(task.id, { status: 'in_progress' })
    this.emit({ kind: 'task.changed', task: inProgress })
    return inProgress
  }

  async cancelTask(id: UUID): Promise<void> {
    const task = this.findTask(id)
    if (!task) return
    if (task.assignedAgentId) this.router.cancel(task.assignedAgentId, id)
    const cancelled = this.patchTask(id, {
      status: 'failed',
      blockedReason: 'cancelled',
      finishedAt: new Date().toISOString()
    })
    this.emit({ kind: 'task.changed', task: cancelled })
  }

  messageLogForTask(taskId: UUID): MessageLog[] {
    return this.log.listForTask(taskId)
  }

  // --------------------------------------------------------------- agent files

  /**
   * Resolve the (teamSlug, agentSlug) pair for an agent id. Throws a plain
   * Error so IPC wraps it cleanly — lookup failures happen when the
   * renderer still has a stale agent in its cache.
   */
  private resolveAgentPaths(agentId: UUID): { teamSlug: string; agentSlug: string } {
    const agent = this.registry.getAgent(agentId)
    if (!agent) throw new Error('agent not found')
    const team = this.registry.getTeam(agent.teamId)
    if (!team) throw new Error('team not found')
    return { teamSlug: team.slug, agentSlug: agent.slug }
  }

  async readAgentSoul(agentId: UUID): Promise<string> {
    const { teamSlug, agentSlug } = this.resolveAgentPaths(agentId)
    return readSoul(teamSlug, agentSlug)
  }

  async writeAgentSoul(agentId: UUID, text: string): Promise<void> {
    const { teamSlug, agentSlug } = this.resolveAgentPaths(agentId)
    await writeSoul(teamSlug, agentSlug, text)
  }

  async readAgentSkills(agentId: UUID) {
    const { teamSlug, agentSlug } = this.resolveAgentPaths(agentId)
    return readSkills(teamSlug, agentSlug)
  }

  async writeAgentSkills(agentId: UUID, skills: Parameters<typeof writeSkills>[2]): Promise<void> {
    const { teamSlug, agentSlug } = this.resolveAgentPaths(agentId)
    await writeSkills(teamSlug, agentSlug, skills)
  }

  async readAgentTriggers(agentId: UUID) {
    const { teamSlug, agentSlug } = this.resolveAgentPaths(agentId)
    return readTriggers(teamSlug, agentSlug)
  }

  async writeAgentTriggers(agentId: UUID, triggers: Parameters<typeof writeTriggers>[2]): Promise<void> {
    const { teamSlug, agentSlug } = this.resolveAgentPaths(agentId)
    await writeTriggers(teamSlug, agentSlug, triggers)
  }

  async readTeamClaudeMd(teamId: UUID): Promise<string> {
    const team = this.registry.getTeam(teamId)
    if (!team) throw new Error('team not found')
    return readTeamClaudeMd(team.slug)
  }

  async writeTeamClaudeMd(teamId: UUID, text: string): Promise<void> {
    const team = this.registry.getTeam(teamId)
    if (!team) throw new Error('team not found')
    await writeTeamClaudeMd(team.slug, text)
  }

  // -------------------------------------------------------------------- keys

  async setApiKey(value: string, prefer: SecretStorage): Promise<SecretStorage> {
    const storage = await secretsSetApiKey(value, prefer)
    this.apiKey = value
    this.emit({ kind: 'apiKey.changed' })
    return storage
  }

  async testApiKey(): Promise<{ ok: true } | { ok: false; error: string }> {
    return secretsTestApiKey()
  }

  async clearApiKey(): Promise<void> {
    await secretsClearApiKey()
    this.apiKey = null
    this.emit({ kind: 'apiKey.changed' })
  }

  // ---------------------------------------------------------------- internals

  private async safeRead<T>(
    agent: Agent,
    reader: (teamSlug: string, agentSlug: string) => Promise<T[]>
  ): Promise<T[]> {
    const team = this.registry.getTeam(agent.teamId)
    if (!team) return []
    try {
      return await reader(team.slug, agent.slug)
    } catch {
      // Missing/malformed YAML -> no candidates; router falls back to main.
      return []
    }
  }

  private async buildSystemPromptExtras(team: Team): Promise<string[]> {
    try {
      const md = await readTeamClaudeMd(team.slug)
      return md.trim().length > 0 ? [md] : []
    } catch {
      return []
    }
  }

  private async hostFor(agentId: UUID): Promise<AgentHost | null> {
    const existing = this.hosts.get(agentId)
    if (existing) return existing

    const agent = this.registry.getAgent(agentId)
    if (!agent) return null
    const team = this.registry.getTeam(agent.teamId)
    if (!team || !this.apiKey) return null

    const host = new AgentHost({
      agent,
      team,
      apiKey: this.apiKey,
      onMessage: (entry) => { this.log.append(entry) },
      onStateChange: (next) => {
        try {
          const updated = this.registry.updateAgent({
            id: agent.id,
            patch: { state: next, lastActiveAt: new Date().toISOString() } as Partial<Agent>
          })
          this.emit({ kind: 'agent.changed', agent: updated })
        } catch { /* agent deleted mid-flight */ }
      },
      onDelegate: (req) => this.handleDelegate(agent.id, req)
    })
    this.hosts.set(agentId, host)
    await host.start()
    return host
  }

  private async stopHostFor(agentId: UUID): Promise<void> {
    const host = this.hosts.get(agentId)
    if (!host) return
    this.hosts.delete(agentId)
    try { await host.stop('SIGTERM') } catch { /* already dead */ }
  }

  private async handleDelegate(
    fromId: UUID,
    req: DelegateRequestPayload
  ): Promise<{ ok: true; taskId: UUID } | { ok: false; error: string }> {
    const from = this.registry.getAgent(fromId)
    if (!from) return { ok: false, error: 'source agent not found' }

    const validation = this.router.validateDelegation(fromId, req.toAgentId)
    if (!validation.ok) return { ok: false, error: validation.error }

    const parent = this.mostRecentActiveTaskFor(fromId)
    const sub: SubmitInput = {
      teamId: from.teamId,
      title: req.sub.title,
      body: req.sub.body,
      priority: req.sub.priority,
      tags: req.sub.tags,
      sourceEvent: {
        type: 'delegation',
        payload: { from: fromId, reason: req.reason }
      },
      ...(parent ? { parentTaskId: parent.id } : {})
    }
    try {
      const task = await this.submitTask(sub)
      return { ok: true, taskId: task.id }
    } catch (err) {
      return { ok: false, error: (err as Error).message ?? 'delegation failed' }
    }
  }

  private setAgentState(id: UUID, state: Agent['state']): Agent {
    const agent = this.registry.updateAgent({
      id,
      patch: { state } as Partial<Agent>
    })
    this.emit({ kind: 'agent.changed', agent })
    return agent
  }

  // ------------------------------------------------------- task/route storage

  private appendTask(task: Task): void {
    const slice = getStore().orchestra
    const tasks = [...slice.tasks, task]
    this.writeSlice({
      ...slice,
      tasks: tasks.length > TASKS_CAP ? tasks.slice(-TASKS_CAP) : tasks
    })
  }

  private patchTask(id: UUID, patch: Partial<Task>): Task {
    const slice = getStore().orchestra
    const existing = slice.tasks.find((t) => t.id === id)
    if (!existing) throw new Error(`task not found: ${id}`)
    const updated: Task = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString()
    }
    this.writeSlice({
      ...slice,
      tasks: slice.tasks.map((t) => (t.id === id ? updated : t))
    })
    return updated
  }

  private findTask(id: UUID): Task | undefined {
    return getStore().orchestra.tasks.find((t) => t.id === id)
  }

  private appendRoute(route: Route): void {
    const slice = getStore().orchestra
    const routes = [...slice.routes, route]
    this.writeSlice({
      ...slice,
      routes: routes.length > ROUTES_CAP ? routes.slice(-ROUTES_CAP) : routes
    })
  }

  private writeSlice(next: OrchestraStoreSlice): void {
    patchStore({ orchestra: next })
  }

  private failTask(id: UUID, reason: string): Task {
    const failed = this.patchTask(id, {
      status: 'failed',
      blockedReason: reason,
      finishedAt: new Date().toISOString()
    })
    this.emit({ kind: 'task.changed', task: failed })
    return failed
  }

  private mostRecentActiveTaskFor(agentId: UUID): Task | undefined {
    const { tasks } = getStore().orchestra
    let pick: Task | undefined
    for (const t of tasks) {
      if (t.assignedAgentId !== agentId) continue
      if (t.status === 'done' || t.status === 'failed') continue
      if (!pick || t.updatedAt.localeCompare(pick.updatedAt) > 0) pick = t
    }
    return pick
  }
}
