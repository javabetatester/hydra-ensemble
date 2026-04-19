import { ipcMain } from 'electron'
import type { PtyManager } from '../pty/manager'
import type { PtySpawnOptions } from '../../shared/types'

export function registerPtyIpc(manager: PtyManager): void {
  ipcMain.handle('pty:spawn', (_evt, opts: PtySpawnOptions) => manager.spawn(opts))
  ipcMain.handle('pty:write', (_evt, payload: { sessionId: string; data: string }) =>
    manager.write(payload.sessionId, payload.data)
  )
  ipcMain.handle(
    'pty:resize',
    (_evt, payload: { sessionId: string; cols: number; rows: number }) =>
      manager.resize(payload.sessionId, payload.cols, payload.rows)
  )
  ipcMain.handle('pty:kill', (_evt, payload: { sessionId: string }) =>
    manager.kill(payload.sessionId)
  )
}
