import { ipcMain } from 'electron'
import type { SessionManager } from '../session/manager'
import type { SessionCreateOptions, SessionUpdate } from '../../shared/types'

export function registerSessionIpc(manager: SessionManager): void {
  ipcMain.handle('session:create', (_evt, opts: SessionCreateOptions) => manager.create(opts))
  ipcMain.handle('session:destroy', (_evt, payload: { id: string }) => manager.destroy(payload.id))
  ipcMain.handle('session:list', () => manager.list())
  ipcMain.handle('session:rename', (_evt, payload: { id: string; name: string }) =>
    manager.rename(payload.id, payload.name)
  )
  ipcMain.handle('session:update', (_evt, payload: { id: string; patch: SessionUpdate }) =>
    manager.update(payload.id, payload.patch)
  )
}
