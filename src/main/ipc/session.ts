import { ipcMain } from 'electron'
import type { SessionManager } from '../session/manager'
import type { AnalyzerManager } from '../pty/analyzer-manager'
import { readTranscript } from '../claude/transcript-parser'
import type {
  SessionCreateOptions,
  SessionState,
  SessionUpdate,
  TranscriptPayload
} from '../../shared/types'

export function registerSessionIpc(
  manager: SessionManager,
  analyzer: AnalyzerManager
): void {
  ipcMain.handle('session:create', (_evt, opts: SessionCreateOptions) => manager.create(opts))
  ipcMain.handle('session:destroy', (_evt, payload: { id: string }) => manager.destroy(payload.id))
  ipcMain.handle('session:list', () => manager.list())
  ipcMain.handle('session:rename', (_evt, payload: { id: string; name: string }) =>
    manager.rename(payload.id, payload.name)
  )
  ipcMain.handle('session:update', (_evt, payload: { id: string; patch: SessionUpdate }) =>
    manager.update(payload.id, payload.patch)
  )
  ipcMain.handle('session:restart', (_evt, payload: { id: string }) =>
    manager.restart(payload.id)
  )
  // Sync the analyzer's cached state with a renderer-side optimistic
  // flip so the next frame analysis diffs against the new baseline.
  ipcMain.handle(
    'session:syncState',
    (_evt, payload: { id: string; state: SessionState }) => {
      analyzer.syncState(payload.id, payload.state)
    }
  )
  ipcMain.handle(
    'session:readTranscript',
    async (_evt, payload: { id: string }): Promise<TranscriptPayload> => {
      const meta = manager.findById(payload.id)
      if (!meta) {
        return { sessionId: payload.id, path: null, messages: [] }
      }
      return readTranscript({
        sessionId: meta.id,
        claudeConfigDir: meta.claudeConfigDir,
        cwd: meta.cwd
      })
    }
  )
}
