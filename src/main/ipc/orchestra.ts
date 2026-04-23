/**
 * IPC bridge for Orchestra mode. Wires renderer calls on `window.api.orchestra`
 * through to `OrchestraCore`, and exposes {@link broadcastOrchestraEvent} so
 * the core can push live updates into the renderer via `webContents.send`.
 *
 * Every handler returns an {@link OrchestraResult} envelope so the renderer
 * has one consistent error-handling branch. Contract lives in PLAN.md §10.
 */

import { ipcMain, type BrowserWindow } from 'electron'
import type { OrchestraCore } from '../orchestra'
import { getStore, patchStore } from '../store'
import { safeSend } from '../lib/safeSend'
import type {
  NewAgentInput,
  NewEdgeInput,
  NewTeamInput,
  OrchestraEvent,
  OrchestraResult,
  OrchestraSettings,
  SafeMode,
  SecretStorage,
  SubmitTaskInput,
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
    const err = check(
      needObj(input, 'input'),
      needStr(input?.teamId, 'teamId'),
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
}
