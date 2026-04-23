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
import { resolveClaudePath } from '../claude/resolve'

/** Check whether the claude binary exists on disk. Caches the first hit
 *  so task dispatch isn't gated on filesystem lookups. Uses the same
 *  multi-path resolver the classic SessionManager relies on, so Orchestra
 *  picks up the binary even when PATH is narrow (Electron launched from
 *  a .desktop entry, macOS dock icon without a login shell, etc.). */
let claudeCliCache: string | null | undefined
function resolvedClaudePath(): string | null {
  if (claudeCliCache !== undefined) return claudeCliCache
  claudeCliCache = resolveClaudePath()
  return claudeCliCache
}
async function claudeCliAvailable(): Promise<boolean> {
  return resolvedClaudePath() !== null
}
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

    let chosenId: UUID
    let candidates: UUID[]
    let score: number
    let reason: string
    // Explicit assignment (user picked an agent from the New Task dialog or a
    // parent agent delegated via tool). Skip trigger scoring — the user's
    // intent wins. Router still runs for the reporting-line validation so
    // delegation can't leak outside the DAG; but for top-level user submits
    // the agent is taken at face value.
    if (input.assignedAgentId) {
      const target = this.registry.getAgent(input.assignedAgentId)
      if (!target || target.teamId !== team.id) {
        return this.failTask(task.id, 'assigned agent not in team')
      }
      chosenId = target.id
      candidates = [target.id]
      score = Number.POSITIVE_INFINITY
      reason = 'explicit:user'
    } else {
      try {
        const pick = await this.router.pickAgent(task)
        chosenId = pick.chosen.id
        candidates = pick.candidates.map((c) => c.id)
        score = pick.score
        reason = pick.reason
      } catch (err) {
        return this.failTask(task.id, (err as Error).message || 'routing failed')
      }
    }

    const route: Route = {
      id: randomUUID(),
      taskId: task.id,
      chosenAgentId: chosenId,
      candidateAgentIds: candidates,
      score,
      reason,
      at: new Date().toISOString()
    }
    this.appendRoute(route)
    const routing = this.patchTask(task.id, {
      assignedAgentId: chosenId,
      status: 'routing'
    })
    this.emit({ kind: 'task.changed', task: routing })
    this.emit({ kind: 'route.added', route })

    // API key is no longer a hard requirement — without one, the agent
    // runner falls back to spawning `claude -p`, which inherits the
    // OAuth login from ~/.claude. Only block if there's no key AND no
    // claude binary on PATH.
    if (!this.apiKey && !(await claudeCliAvailable())) {
      // eslint-disable-next-line no-console
      console.warn(
        '[orchestra] no ANTHROPIC_API_KEY set and no `claude` binary resolvable. ' +
          'Install the Claude Code CLI or open Providers → Anthropic API.'
      )
      return this.failTask(
        routing.id,
        'no API key and claude CLI not found — open Providers to set one up'
      )
    }

    const host = await this.hostFor(chosenId)
    if (!host) return this.failTask(routing.id, 'agent not found')

    const topology = await this.buildTopologySnapshot(chosenId, team.id)
    const result = await host.runTask(routing, [topology])
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

  /**
   * Build the topology snapshot that tells an agent who they are, who their
   * manager(s) and direct reports are, who their teammates are, and HOW to
   * delegate. Appended to the system prompt before the current task so the
   * model always sees this context when choosing to call `delegate_task`.
   */
  private async buildTopologySnapshot(
    agentId: UUID,
    teamId: UUID
  ): Promise<string> {
    const team = this.registry.getTeam(teamId)
    const self = this.registry.getAgent(agentId)
    if (!team || !self) return ''

    const edges = this.registry.listEdges(teamId)
    const allAgents = this.registry.listAgents(teamId)
    const byId = new Map(allAgents.map((a) => [a.id, a]))

    const reports = edges
      .filter((e) => e.parentAgentId === agentId)
      .map((e) => ({ agent: byId.get(e.childAgentId), edge: e }))
      .filter((r): r is { agent: Agent; edge: ReportingEdge } => !!r.agent)

    const managers = edges
      .filter((e) => e.childAgentId === agentId)
      .map((e) => byId.get(e.parentAgentId))
      .filter((a): a is Agent => !!a)

    const relatedIds = new Set<UUID>([
      ...reports.map((r) => r.agent.id),
      ...managers.map((m) => m.id)
    ])
    const teammates = allAgents.filter(
      (a) => a.id !== agentId && !relatedIds.has(a.id)
    )

    const selfSkills = await this.safeReadSkills(self, team.slug)
    const skillSummary = selfSkills.length
      ? selfSkills.flatMap((s) => s.tags).join(', ')
      : ''

    const sections: string[] = []

    const selfLines = [`## Your role`, `- id: ${self.id}`, `- name: ${self.name}`]
    if (self.role) selfLines.push(`- role: ${self.role}`)
    if (self.description) selfLines.push(`- description: ${self.description}`)
    if (skillSummary) selfLines.push(`- skills: ${skillSummary}`)
    sections.push(selfLines.join('\n'))

    if (managers.length > 0) {
      const lines = [`## Your manager(s)`]
      for (const m of managers) {
        lines.push(`- **${m.name}** (role: ${m.role || 'n/a'}, id: ${m.id})`)
      }
      sections.push(lines.join('\n'))
    }

    if (reports.length > 0) {
      const lines = [`## Your direct reports`]
      for (const r of reports) {
        const skills = await this.safeReadSkills(r.agent, team.slug)
        const tags = skills.flatMap((s) => s.tags).join(', ')
        lines.push(
          `- **${r.agent.name}** (role: ${r.agent.role || 'n/a'}, id: ${r.agent.id})`
        )
        if (tags) lines.push(`  skills: ${tags}`)
        lines.push(`  delegation: ${r.edge.delegationMode}`)
        if (r.agent.description) {
          lines.push(`  description: ${r.agent.description}`)
        }
      }
      sections.push(lines.join('\n'))
    }

    if (teammates.length > 0) {
      const lines = [`## Your teammates`]
      for (const t of teammates) {
        lines.push(`- **${t.name}** (role: ${t.role || 'n/a'})`)
      }
      sections.push(lines.join('\n'))
    }

    sections.push(
      [
        `## Delegation protocol`,
        `- Only delegate to a **direct report** listed above.`,
        `- Use the \`delegate_task\` tool. Pass \`toAgentId\` (exact id from the list), \`reason\`, \`title\`, \`body\`, optional \`priority\` (P0-P3), optional \`tags\`.`,
        `- If no report matches the skills needed, DO the work yourself.`,
        `- After delegating, stop — the child agent will continue.`
      ].join('\n')
    )

    sections.push(
      [
        `## Task completion`,
        `- When you finish a turn AND the task is complete, end with a final message summarising what you did. Do not call any more tools.`,
        `- If blocked, write a clear blocker message and stop.`
      ].join('\n')
    )

    return sections.join('\n\n')
  }

  private async safeReadSkills(agent: Agent, teamSlug: string): Promise<Skill[]> {
    try {
      return await readSkills(teamSlug, agent.slug)
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
    if (!team) return null
    // OK to spawn the host with an empty apiKey — the runner will then
    // route through the claude CLI path (OAuth). See agent-runner.ts.

    const host = new AgentHost({
      agent,
      team,
      apiKey: this.apiKey ?? '',
      claudePath: resolvedClaudePath() ?? undefined,
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
