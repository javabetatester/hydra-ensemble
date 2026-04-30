/**
 * Migration of the persisted `orchestra` slice from schema v1 to v2.
 *
 * v1 only knew about `teams[]` (template + instance fused). v2 introduces
 * `templates[]` and `instances[]` while keeping `teams[]` populated for
 * backwards compatibility during the split (see issue #12 and
 * `researchs/proposals/team-template-instance-split.md`). Phase 5 of the
 * plan removes the legacy `teams[]`.
 *
 * Invariants preserved by the migration:
 *
 * - `instance.id === legacy team.id` so existing foreign keys on
 *   `Agent.teamId`, `Task.teamId`, `ReportingEdge.teamId`,
 *   `MessageLog.teamId` keep resolving without any rewrite.
 * - `template.id = "<teamId>-tpl"` — deterministic so repeat runs of
 *   the migration on the same v1 snapshot produce identical v2 output.
 * - `template.mainAgentSlug` resolves the legacy `team.mainAgentId` to
 *   the agent's slug (slugs are stable across instances; ids aren't).
 */

import type {
  Agent,
  MessageLog,
  OrchestraSettings,
  OrchestraStoreSlice,
  ReportingEdge,
  Route,
  Task,
  Team,
  TeamInstance,
  TeamTemplate
} from '../../shared/orchestra'

type LegacyAgentV2 = Omit<Agent, 'instanceId'>
type LegacyEdgeV2 = Omit<ReportingEdge, 'instanceId'>
type LegacyMessageLogV2 = Omit<MessageLog, 'instanceId'>

/** Shape of the persisted slice in schema v2 — frozen so the v2→v3
 *  migration keeps compiling after Agent/ReportingEdge/MessageLog
 *  gain their `instanceId` field. */
export interface LegacyOrchestraSliceV2 {
  schemaVersion: 2
  settings: OrchestraSettings
  teams: Team[]
  templates: TeamTemplate[]
  instances: TeamInstance[]
  agents: LegacyAgentV2[]
  edges: LegacyEdgeV2[]
  tasks: Task[]
  routes: Route[]
  messageLog: LegacyMessageLogV2[]
}

/**
 * Shape of the persisted slice in schema v1 — frozen here so the
 * migration keeps compiling even after the shared types finish moving
 * to v2-only.
 *
 * `tasks` are typed as the legacy shape (no `instanceId`) so the
 * backfill step in `migrateV1ToV2` is the only place that has to know
 * the v1 contract. The shared `Task` type already carries `instanceId`
 * since phase 2; here we keep using `Omit` to model the input.
 */
export interface LegacyOrchestraSliceV1 {
  schemaVersion: 1
  settings: OrchestraSettings
  teams: Team[]
  agents: Agent[]
  edges: ReportingEdge[]
  tasks: Array<Omit<Task, 'instanceId'>>
  routes: Route[]
  messageLog: MessageLog[]
}

export function migrateV1ToV2(v1: LegacyOrchestraSliceV1): OrchestraStoreSlice {
  const templates: TeamTemplate[] = []
  const instances: TeamInstance[] = []

  for (const team of v1.teams) {
    const mainAgent = team.mainAgentId
      ? v1.agents.find((a) => a.id === team.mainAgentId)
      : undefined

    const template: TeamTemplate = {
      id: `${team.id}-tpl`,
      slug: team.slug,
      name: team.name,
      safeMode: team.safeMode,
      defaultModel: team.defaultModel,
      apiKeyRef: team.apiKeyRef,
      mainAgentSlug: mainAgent?.slug ?? null,
      canvas: { ...team.canvas },
      createdAt: team.createdAt,
      updatedAt: team.updatedAt
    }

    const instance: TeamInstance = {
      id: team.id,
      templateId: template.id,
      projectPath: team.worktreePath,
      worktreePath: team.worktreePath,
      createdAt: team.createdAt
    }

    templates.push(template)
    instances.push(instance)
  }

  // Phase 5 (schema v3) requires `instanceId` on Agent/Edge/MessageLog.
  // The v1 → v2 path now goes straight to the v3-shaped slice by also
  // populating those fields here, since `instance.id === team.id` and
  // every record's legacy `teamId` already points at the right place.
  return {
    schemaVersion: 3,
    settings: v1.settings,
    teams: v1.teams.map((t) => ({ ...t })),
    templates,
    instances,
    agents: v1.agents.map((a) => ({ ...a, instanceId: a.teamId })),
    edges: v1.edges.map((e) => ({ ...e, instanceId: e.teamId })),
    tasks: v1.tasks.map((t) => ({ ...t, instanceId: t.teamId })),
    routes: v1.routes,
    messageLog: v1.messageLog.map((m) => ({ ...m, instanceId: m.teamId }))
  }
}

/**
 * v2 → v3: backfill the `instanceId` field on Agent, ReportingEdge,
 * and MessageLog. While the template/instance split is in flight,
 * `instanceId === teamId` so the operation is a pure copy. Idempotent.
 */
export function migrateV2ToV3(v2: LegacyOrchestraSliceV2): OrchestraStoreSlice {
  return {
    schemaVersion: 3,
    settings: v2.settings,
    teams: v2.teams,
    templates: v2.templates,
    instances: v2.instances,
    agents: v2.agents.map((a) => ({ ...a, instanceId: a.teamId })),
    edges: v2.edges.map((e) => ({ ...e, instanceId: e.teamId })),
    tasks: v2.tasks,
    routes: v2.routes,
    messageLog: v2.messageLog.map((m) => ({ ...m, instanceId: m.teamId }))
  }
}

/**
 * Best-effort detection: anything without a recognised v2/v3
 * `schemaVersion` and a `teams` array is treated as v1. Snapshots
 * from before schemaVersion existed at all also match.
 */
export function isV1Snapshot(value: unknown): value is LegacyOrchestraSliceV1 {
  if (value == null || typeof value !== 'object') return false
  const v = value as { schemaVersion?: unknown; teams?: unknown }
  return v.schemaVersion !== 2 && v.schemaVersion !== 3 && Array.isArray(v.teams)
}

/** Detect a v2 snapshot — has the v2 shape but is missing the v3
 *  `instanceId` backfill on agents/edges/messageLog. */
export function isV2Snapshot(value: unknown): value is LegacyOrchestraSliceV2 {
  if (value == null || typeof value !== 'object') return false
  const v = value as { schemaVersion?: unknown }
  return v.schemaVersion === 2
}
