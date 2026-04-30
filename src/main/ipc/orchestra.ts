/**
 * IPC bridge for Orchestra mode. Wires renderer calls on `window.api.orchestra`
 * through to `OrchestraCore`, and exposes {@link broadcastOrchestraEvent} so
 * the core can push live updates into the renderer via `webContents.send`.
 *
 * Every handler returns an {@link OrchestraResult} envelope so the renderer
 * has one consistent error-handling branch. Contract lives in PLAN.md §10.
 */

import { readFile, stat, writeFile } from 'node:fs/promises'
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { OrchestraCore } from '../orchestra'
import { getStore, patchStore } from '../store'
import { safeSend } from '../lib/safeSend'
import type {
  GenerateTeamInput,
  NewAgentInput,
  NewEdgeInput,
  NewTeamInput,
  OrchestraEvent,
  OrchestraResult,
  OrchestraSettings,
  SafeMode,
  SecretStorage,
  SubmitTaskInput,
  TeamExportV1,
  UpdateAgentInput,
  UUID
} from '../../shared/orchestra'

// ---------------------------------------------------------------------------
// Result + validation helpers
// ---------------------------------------------------------------------------

const ok = <T>(value: T): OrchestraResult<T> => ({ ok: true, value })
const fail = (error: string): OrchestraResult<never> => ({ ok: false, error })
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

async function wrap<T>(fn: () => Promise<T> | T): Promise<OrchestraResult<T>> {
  try { return ok(await fn()) } catch (e) { return fail(errMsg(e)) }
}

function needStr(v: unknown, field: string): string | null {
  return typeof v !== 'string' || v.trim().length === 0
    ? `invalid input: ${field}`
    : null
}

function needObj(v: unknown, field: string): string | null {
  return v === null || typeof v !== 'object' ? `invalid input: ${field}` : null
}

/** Run a series of validators; return the first error, or null. */
function check(...errs: Array<string | null>): string | null {
  for (const e of errs) if (e) return e
  return null
}

const SAFE_MODES: ReadonlySet<SafeMode> = new Set(['strict', 'prompt', 'yolo'])
const STORAGE_KINDS: ReadonlySet<SecretStorage> = new Set([
  'keychain',
  'safeStorage'
])

// ---------------------------------------------------------------------------
// Event broadcast
// ---------------------------------------------------------------------------

/**
 * Forward an {@link OrchestraEvent} to the renderer. Called from the
 * `emit` callback `OrchestraCore` was constructed with in `main/index.ts`.
 */
export function broadcastOrchestraEvent(
  window: BrowserWindow,
  event: OrchestraEvent
): void {
  safeSend(window, 'orchestra:event', event)
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerOrchestraIpc(
  core: OrchestraCore,
  _window: BrowserWindow
): void {
  // settings — read/write straight through the JSON store
  ipcMain.handle('orchestra:settings.get', () =>
    ok<OrchestraSettings>(getStore().orchestra.settings)
  )
  ipcMain.handle(
    'orchestra:settings.set',
    (_e, patch: Partial<OrchestraSettings>) => {
      const err = needObj(patch, 'patch')
      if (err) return fail(err)
      const current = getStore().orchestra
      patchStore({
        orchestra: {
          ...current,
          settings: { ...current.settings, ...patch }
        }
      })
      return ok(undefined)
    }
  )

  // teams
  ipcMain.handle('orchestra:team.list', () => ok(core.listTeams()))
  ipcMain.handle('orchestra:team.create', (_e, input: NewTeamInput) => {
    const err = check(
      needObj(input, 'input'),
      needStr(input?.name, 'name'),
      needStr(input?.worktreePath, 'worktreePath')
    )
    return err ? fail(err) : wrap(() => core.createTeam(input))
  })
  ipcMain.handle(
    'orchestra:team.rename',
    (_e, p: { id: UUID; name: string }) => {
      const err = check(needStr(p?.id, 'id'), needStr(p?.name, 'name'))
      return err ? fail(err) : wrap(() => core.renameTeam(p.id, p.name))
    }
  )
  ipcMain.handle(
    'orchestra:team.setSafeMode',
    (_e, p: { id: UUID; safeMode: SafeMode }) => {
      const err = check(
        needStr(p?.id, 'id'),
        SAFE_MODES.has(p?.safeMode) ? null : 'invalid input: safeMode'
      )
      return err ? fail(err) : wrap(() => core.setSafeMode(p.id, p.safeMode))
    }
  )
  ipcMain.handle('orchestra:team.delete', (_e, p: { id: UUID }) => {
    const err = needStr(p?.id, 'id')
    return err ? fail(err) : wrap(() => core.deleteTeam(p.id))
  })

  // agents
  ipcMain.handle('orchestra:agent.list', (_e, p?: { teamId?: UUID }) => {
    const teamId = p?.teamId
    if (!teamId) return fail('invalid input: teamId')
    return ok(core.listAgents(teamId))
  })
  ipcMain.handle('orchestra:agent.create', (_e, input: NewAgentInput) => {
    const posOk =
      input?.position &&
      typeof input.position.x === 'number' &&
      typeof input.position.y === 'number'
    const err = check(
      needObj(input, 'input'),
      needStr(input?.teamId, 'teamId'),
      needStr(input?.name, 'name'),
      needStr(input?.role, 'role'),
      posOk ? null : 'invalid input: position'
    )
    return err ? fail(err) : wrap(() => core.createAgent(input))
  })
  ipcMain.handle('orchestra:agent.update', (_e, input: UpdateAgentInput) => {
    const err = check(
      needObj(input, 'input'),
      needStr(input?.id, 'id'),
      needObj(input?.patch, 'patch')
    )
    return err ? fail(err) : wrap(() => core.updateAgent(input))
  })
  ipcMain.handle('orchestra:agent.delete', (_e, p: { id: UUID }) => {
    const err = needStr(p?.id, 'id')
    return err ? fail(err) : wrap(() => core.deleteAgent(p.id))
  })
  ipcMain.handle('orchestra:agent.promoteMain', (_e, p: { id: UUID }) => {
    const err = needStr(p?.id, 'id')
    return err ? fail(err) : wrap(() => core.promoteMain(p.id))
  })
  ipcMain.handle('orchestra:agent.pause', (_e, p: { id: UUID }) => {
    const err = needStr(p?.id, 'id')
    return err ? fail(err) : wrap(() => core.pauseAgent(p.id))
  })
  ipcMain.handle('orchestra:agent.stop', (_e, p: { id: UUID }) => {
    const err = needStr(p?.id, 'id')
    return err ? fail(err) : wrap(() => core.stopAgent(p.id))
  })

  // agent file I/O — soul.md / skills.yaml / triggers.yaml live on disk and
  // are the source of truth. Tabs read/write through these handlers.
  ipcMain.handle('orchestra:agent.readSoul', (_e, p: { id: UUID }) => {
    const err = needStr(p?.id, 'id')
    return err ? fail(err) : wrap(() => core.readAgentSoul(p.id))
  })
  ipcMain.handle(
    'orchestra:agent.writeSoul',
    (_e, p: { id: UUID; text: string }) => {
      const err = check(
        needStr(p?.id, 'id'),
        typeof p?.text === 'string' ? null : 'invalid input: text'
      )
      return err ? fail(err) : wrap(() => core.writeAgentSoul(p.id, p.text))
    }
  )
  ipcMain.handle('orchestra:agent.readSkills', (_e, p: { id: UUID }) => {
    const err = needStr(p?.id, 'id')
    return err ? fail(err) : wrap(() => core.readAgentSkills(p.id))
  })
  ipcMain.handle(
    'orchestra:agent.writeSkills',
    (_e, p: { id: UUID; skills: unknown[] }) => {
      const err = check(
        needStr(p?.id, 'id'),
        Array.isArray(p?.skills) ? null : 'invalid input: skills'
      )
      return err
        ? fail(err)
        : wrap(() => core.writeAgentSkills(p.id, p.skills as never))
    }
  )
  ipcMain.handle('orchestra:agent.readTriggers', (_e, p: { id: UUID }) => {
    const err = needStr(p?.id, 'id')
    return err ? fail(err) : wrap(() => core.readAgentTriggers(p.id))
  })
  ipcMain.handle(
    'orchestra:agent.writeTriggers',
    (_e, p: { id: UUID; triggers: unknown[] }) => {
      const err = check(
        needStr(p?.id, 'id'),
        Array.isArray(p?.triggers) ? null : 'invalid input: triggers'
      )
      return err
        ? fail(err)
        : wrap(() => core.writeAgentTriggers(p.id, p.triggers as never))
    }
  )
  ipcMain.handle('orchestra:team.readClaudeMd', (_e, p: { id: UUID }) => {
    const err = needStr(p?.id, 'id')
    return err ? fail(err) : wrap(() => core.readTeamClaudeMd(p.id))
  })
  ipcMain.handle(
    'orchestra:team.writeClaudeMd',
    (_e, p: { id: UUID; text: string }) => {
      const err = check(
        needStr(p?.id, 'id'),
        typeof p?.text === 'string' ? null : 'invalid input: text'
      )
      return err ? fail(err) : wrap(() => core.writeTeamClaudeMd(p.id, p.text))
    }
  )

  // edges
  ipcMain.handle('orchestra:edge.list', (_e, p?: { teamId?: UUID }) => {
    const teamId = p?.teamId
    if (!teamId) return fail('invalid input: teamId')
    return ok(core.listEdges(teamId))
  })
  ipcMain.handle('orchestra:edge.create', (_e, input: NewEdgeInput) => {
    const err = check(
      needObj(input, 'input'),
      needStr(input?.teamId, 'teamId'),
      needStr(input?.parentAgentId, 'parentAgentId'),
      needStr(input?.childAgentId, 'childAgentId')
    )
    return err ? fail(err) : wrap(() => core.createEdge(input))
  })
  ipcMain.handle('orchestra:edge.delete', (_e, p: { id: UUID }) => {
    const err = needStr(p?.id, 'id')
    return err ? fail(err) : wrap(() => core.deleteEdge(p.id))
  })

  // tasks
  ipcMain.handle('orchestra:task.submit', (_e, input: SubmitTaskInput) => {
    // Phase 2: instanceId OR teamId is acceptable. While the
    // template/instance split is in flight (issue #12) the two are
    // equal — phase 5 drops `teamId` from the wire.
    const hasTarget =
      typeof input?.instanceId === 'string' && input.instanceId.length > 0
        ? true
        : typeof input?.teamId === 'string' && input.teamId.length > 0
    const err = check(
      needObj(input, 'input'),
      hasTarget ? null : 'invalid input: instanceId or teamId',
      needStr(input?.title, 'title'),
      typeof input?.body === 'string' ? null : 'invalid input: body'
    )
    return err ? fail(err) : wrap(() => core.submitTask(input))
  })
  ipcMain.handle('orchestra:task.cancel', (_e, p: { id: UUID }) => {
    const err = needStr(p?.id, 'id')
    return err ? fail(err) : wrap(() => core.cancelTask(p.id))
  })
  ipcMain.handle('orchestra:task.list', (_e, p: { teamId: UUID }) => {
    const err = needStr(p?.teamId, 'teamId')
    return err ? fail(err) : ok(core.listTasks(p.teamId))
  })

  // message log
  ipcMain.handle('orchestra:messageLog.forTask', (_e, p: { taskId: UUID }) => {
    const err = needStr(p?.taskId, 'taskId')
    return err ? fail(err) : ok(core.messageLogForTask(p.taskId))
  })

  // api key
  ipcMain.handle(
    'orchestra:apiKey.set',
    (_e, p: { value: string; storage: SecretStorage }) => {
      const err = check(
        needStr(p?.value, 'value'),
        STORAGE_KINDS.has(p?.storage) ? null : 'invalid input: storage'
      )
      return err ? fail(err) : wrap(() => core.setApiKey(p.value, p.storage))
    }
  )
  ipcMain.handle('orchestra:apiKey.test', () => wrap(() => core.testApiKey()))
  ipcMain.handle('orchestra:apiKey.clear', () => wrap(() => core.clearApiKey()))

  // team export / import
  ipcMain.handle(
    'orchestra:team.export',
    async (_e, p: { id: UUID }): Promise<OrchestraResult<string | null>> => {
      const err = needStr(p?.id, 'id')
      if (err) return fail(err)
      try {
        const data = await core.exportTeam(p.id)
        const result = await dialog.showSaveDialog({
          title: 'Export team',
          defaultPath: `${data.team.name.replace(/\s+/g, '-').toLowerCase()}.json`,
          filters: [{ name: 'Team Export', extensions: ['json'] }]
        })
        if (result.canceled || !result.filePath) return ok(null)
        await writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf-8')
        return ok(result.filePath)
      } catch (e) {
        return fail(errMsg(e))
      }
    }
  )

  ipcMain.handle(
    'orchestra:team.importPick',
    async (): Promise<OrchestraResult<TeamExportV1 | null>> => {
      try {
        const result = await dialog.showOpenDialog({
          title: 'Import team',
          filters: [{ name: 'Team Export', extensions: ['json'] }],
          properties: ['openFile']
        })
        if (result.canceled || result.filePaths.length === 0) return ok(null)
        const filePath = result.filePaths[0]!
        const st = await stat(filePath)
        if (st.size > 10 * 1024 * 1024) {
          return fail('file too large (max 10 MB)')
        }
        const raw = await readFile(filePath, 'utf-8')
        const parsed = JSON.parse(raw) as TeamExportV1
        if (parsed.formatVersion !== 1) {
          return fail(
            `unsupported export version: ${parsed.formatVersion ?? 'missing'}`
          )
        }
        if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) {
          return fail('export contains no agents')
        }
        if (!parsed.team?.name) {
          return fail('export missing team name')
        }
        return ok(parsed)
      } catch (e) {
        return fail(errMsg(e))
      }
    }
  )

  ipcMain.handle(
    'orchestra:team.importProvision',
    (_e, p: { data: TeamExportV1; worktreePath: string }) => {
      const err = check(
        needObj(p?.data, 'data'),
        needStr(p?.worktreePath, 'worktreePath')
      )
      return err ? fail(err) : wrap(() => core.importTeam(p.data, p.worktreePath))
    }
  )

  ipcMain.handle(
    'orchestra:team.generateFromPrompt',
    (_e, input: GenerateTeamInput) => {
      const err = check(
        needObj(input, 'input'),
        needStr(input?.prompt, 'prompt')
      )
      return err ? fail(err) : wrap(() => core.generateTeamFromPrompt(input))
    }
  )

  // ----------------------------------------------------- templates / instances
  // Phase 3 of issue #12. Templates are read straight from the registry;
  // instances can be listed (optionally filtered by projectPath) and
  // created by applying an existing template to a new project.

  ipcMain.handle('orchestra:template.list', () =>
    ok(core.listTemplates())
  )

  ipcMain.handle('orchestra:instance.list', (_e, p?: { projectPath?: string }) => {
    if (p?.projectPath !== undefined && typeof p.projectPath !== 'string') {
      return fail('invalid input: projectPath')
    }
    return ok(core.listInstances(p ?? {}))
  })

  ipcMain.handle(
    'orchestra:instance.apply',
    (
      _e,
      input: {
        templateId: UUID
        worktreePath: string
        name?: string
        projectPath?: string
      }
    ) => {
      const err = check(
        needObj(input, 'input'),
        needStr(input?.templateId, 'templateId'),
        needStr(input?.worktreePath, 'worktreePath')
      )
      return err ? fail(err) : wrap(() => core.applyTemplate(input))
    }
  )
}
