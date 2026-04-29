/**
 * Shared types for Orchestra mode. Imported by main, renderer, preload.
 *
 * See PRD.md §7 for vocabulary and PLAN.md §2 for the data model rationale.
 */

export type UUID = string
export type ISO = string

export type Priority = 'P0' | 'P1' | 'P2' | 'P3'
export type SafeMode = 'strict' | 'prompt' | 'yolo'
export type AgentState = 'idle' | 'running' | 'paused' | 'error'
export type TaskStatus =
  | 'queued'
  | 'routing'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'failed'
export type TriggerKind = 'manual' | 'tag' | 'path' | 'event' | 'schedule'
export type DelegationMode = 'auto' | 'approve'
export type SecretStorage = 'keychain' | 'safeStorage'
export type MessageKind =
  | 'delegation'
  | 'status'
  | 'output'
  | 'error'
  | 'approval_request'

export interface OrchestraSettings {
  /** Master feature flag. Until true, Orchestra UI does not mount. */
  enabled: boolean
  apiKeyProvider: SecretStorage
  onboardingDismissed: boolean
}

export interface Team {
  id: UUID
  slug: string
  name: string
  worktreePath: string
  safeMode: SafeMode
  defaultModel: string
  /** MVP: always 'default'. v2 lets multiple keys be bound per team. */
  apiKeyRef: string
  mainAgentId: UUID | null
  canvas: { zoom: number; panX: number; panY: number }
  createdAt: ISO
  updatedAt: ISO
}

/** Which backend the runner should use for this agent.
 *  - `claude-cli`   — spawn `claude -p` and reuse the OAuth login in ~/.claude
 *  - `anthropic-api` — call Anthropic SDK with ANTHROPIC_API_KEY
 *  - `inherit`      — pick automatically: API if a key is set, else CLI
 *
 *  Keeping this field optional on Agent so pre-existing teams load
 *  without migration; absence means 'inherit'. */
export type AgentProvider = 'inherit' | 'claude-cli' | 'anthropic-api'

export interface Agent {
  id: UUID
  teamId: UUID
  slug: string
  name: string
  role: string
  description: string
  position: { x: number; y: number }
  color?: string
  /** If empty, falls back to Team.defaultModel. */
  model: string
  maxTokens: number
  /** Per-agent provider override. Undefined == 'inherit'. */
  provider?: AgentProvider
  soulPath: string
  skillsPath: string
  triggersPath: string
  state: AgentState
  lastActiveAt?: ISO
  createdAt: ISO
}

export interface Skill {
  name: string
  tags: string[]
  /** [0.5, 2.0] — multiplies score when a task tag matches. */
  weight: number
  description?: string
}

export interface Trigger {
  id: UUID
  kind: TriggerKind
  pattern: string
  priority: number
  /** Optional filter expression, MVP ignores it for non-`event`/`schedule`. */
  when?: string
  enabled: boolean
}

export interface ReportingEdge {
  id: UUID
  teamId: UUID
  parentAgentId: UUID
  childAgentId: UUID
  delegationMode: DelegationMode
}

export interface Task {
  id: UUID
  teamId: UUID
  title: string
  body: string
  priority: Priority
  tags: string[]
  sourceEvent?: { type: string; payload: Record<string, unknown> }
  status: TaskStatus
  assignedAgentId: UUID | null
  parentTaskId: UUID | null
  blockedReason?: string
  createdAt: ISO
  updatedAt: ISO
  finishedAt?: ISO
}

export interface Route {
  id: UUID
  taskId: UUID
  chosenAgentId: UUID
  candidateAgentIds: UUID[]
  score: number
  reason: string
  at: ISO
}

export interface MessageLog {
  id: UUID
  teamId: UUID
  taskId: UUID | null
  fromAgentId: UUID | 'system' | 'user'
  toAgentId: UUID | 'broadcast'
  kind: MessageKind
  content: string
  at: ISO
}

/** Shape of `store.orchestra` in the JSON store. */
export interface OrchestraStoreSlice {
  settings: OrchestraSettings
  teams: Team[]
  agents: Agent[]
  edges: ReportingEdge[]
  tasks: Task[]
  routes: Route[]
  messageLog: MessageLog[]
  /** Reserved for future forward-compat. */
  schemaVersion: 1
}

export const DEFAULT_ORCHESTRA_STATE: OrchestraStoreSlice = {
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
  messageLog: [],
  schemaVersion: 1
}

// ---------------------------------------------------------------------------
// Events streamed from main to renderer via `orchestra:event`
// ---------------------------------------------------------------------------

export type OrchestraEvent =
  | { kind: 'team.changed'; team: Team }
  | { kind: 'team.deleted'; teamId: UUID }
  | { kind: 'agent.changed'; agent: Agent }
  | { kind: 'agent.deleted'; agentId: UUID }
  | { kind: 'edge.changed'; edge: ReportingEdge }
  | { kind: 'edge.deleted'; edgeId: UUID }
  | { kind: 'task.changed'; task: Task }
  | { kind: 'route.added'; route: Route }
  | { kind: 'messageLog.appended'; entry: MessageLog }
  | { kind: 'apiKey.changed' }

// ---------------------------------------------------------------------------
// IPC method payloads — one interface per method for clarity
// ---------------------------------------------------------------------------

export interface NewTeamInput {
  name: string
  worktreePath: string
  safeMode?: SafeMode
  defaultModel?: string
}

export interface NewAgentInput {
  teamId: UUID
  position: { x: number; y: number }
  name: string
  role: string
  description?: string
  model?: string
  color?: string
  /** Starter preset that pre-fills soul / skills / triggers on disk. */
  preset?: 'blank' | 'reviewer' | 'dev' | 'qa' | 'pm'
}

export interface UpdateAgentInput {
  id: UUID
  patch: Partial<
    Pick<
      Agent,
      | 'name'
      | 'role'
      | 'description'
      | 'position'
      | 'color'
      | 'model'
      | 'maxTokens'
      | 'provider'
    >
  >
}

export interface NewEdgeInput {
  teamId: UUID
  parentAgentId: UUID
  childAgentId: UUID
  delegationMode?: DelegationMode
}

export interface SubmitTaskInput {
  teamId: UUID
  title: string
  body: string
  priority?: Priority
  tags?: string[]
  sourceEvent?: Task['sourceEvent']
  /** When set, router skips scoring and dispatches directly to this agent. */
  assignedAgentId?: UUID
}

// ---------------------------------------------------------------------------
// Team generation from prompt
// ---------------------------------------------------------------------------

/**
 * Input for the prompt-to-team generator. The output is a `TeamExportV1`
 * that the renderer hands to `importProvision` if the user accepts it.
 */
export interface GenerateTeamInput {
  /** Free-text description of the team the user wants. */
  prompt: string
  /** Cap on agents in the generated team. Default 6. */
  maxAgents?: number
  /** Model used to generate. Default `claude-sonnet-4-6`. */
  modelId?: string
}

// ---------------------------------------------------------------------------
// Team export / import
// ---------------------------------------------------------------------------

export interface TeamExportAgent {
  slug: string
  name: string
  role: string
  description: string
  position: { x: number; y: number }
  color?: string
  model: string
  maxTokens: number
  provider?: AgentProvider
  /** True when this agent was the team's mainAgent at export time. */
  isMain: boolean
  soul: string
  skills: Skill[]
  triggers: Array<Omit<Trigger, 'id'>>
}

export interface TeamExportEdge {
  parentSlug: string
  childSlug: string
  delegationMode: DelegationMode
}

/**
 * Self-contained snapshot of a team — agents, edges, and all config files
 * inlined. Importable on any Hydra instance; IDs are regenerated, the user
 * picks a new worktreePath.
 */
export interface TeamExportV1 {
  formatVersion: 1
  exportedAt: ISO
  team: {
    name: string
    safeMode: SafeMode
    defaultModel: string
    claudeMd: string
    canvas: { zoom: number; panX: number; panY: number }
  }
  agents: TeamExportAgent[]
  edges: TeamExportEdge[]
}

// ---------------------------------------------------------------------------
// Consistent result envelope — matches existing Hydra conventions
// ---------------------------------------------------------------------------

export type OrchestraResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string }
