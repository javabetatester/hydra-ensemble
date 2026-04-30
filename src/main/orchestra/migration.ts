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

/**
 * Shape of the persisted slice in schema v1 — frozen here so the
 * migration keeps compiling even after the shared types finish moving
 * to v2-only.
 */
export interface LegacyOrchestraSliceV1 {
  schemaVersion: 1
  settings: OrchestraSettings
  teams: Team[]
  agents: Agent[]
  edges: ReportingEdge[]
  tasks: Task[]
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

  return {
    schemaVersion: 2,
    settings: v1.settings,
    teams: v1.teams.map((t) => ({ ...t })),
    templates,
    instances,
    agents: v1.agents,
    edges: v1.edges,
    tasks: v1.tasks,
    routes: v1.routes,
    messageLog: v1.messageLog
  }
}

/**
 * Best-effort detection: anything without `schemaVersion === 2` is
 * treated as v1. Snapshots from before schemaVersion existed at all are
 * also valid input — the v1 type only requires the historic shape.
 */
export function isV1Snapshot(value: unknown): value is LegacyOrchestraSliceV1 {
  if (value == null || typeof value !== 'object') return false
  const v = value as { schemaVersion?: unknown; teams?: unknown }
  return v.schemaVersion !== 2 && Array.isArray(v.teams)
}
