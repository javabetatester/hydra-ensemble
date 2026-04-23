import { ipcMain } from 'electron'
import type { GhService } from '../gh/manager'

/**
 * Register IPC handlers for the GitHub PR inspector. Channel names match
 * the `api.gh` surface declared in `src/shared/types.ts`.
 */
export function registerGhIpc(svc: GhService): void {
  ipcMain.handle('gh:listPRs', (_evt, cwd: string) => svc.listPRs(cwd))
  ipcMain.handle(
    'gh:getPR',
    (_evt, payload: { cwd: string; number: number }) =>
      svc.getPR(payload.cwd, payload.number)
  )
  ipcMain.handle(
    'gh:review',
    (
      _evt,
      payload: {
        cwd: string
        number: number
        decision: 'approve' | 'request-changes' | 'comment'
        body?: string
      }
    ) => svc.review(payload.cwd, payload.number, payload.decision, payload.body)
  )
  ipcMain.handle(
    'gh:comment',
    (_evt, payload: { cwd: string; number: number; body: string }) =>
      svc.comment(payload.cwd, payload.number, payload.body)
  )
  ipcMain.handle(
    'gh:merge',
    (_evt, payload: { cwd: string; number: number }) =>
      svc.merge(payload.cwd, payload.number)
  )
  ipcMain.handle(
    'gh:close',
    (_evt, payload: { cwd: string; number: number }) =>
      svc.close(payload.cwd, payload.number)
  )
}
