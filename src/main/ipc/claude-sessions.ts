import { ipcMain } from 'electron'
import type { ClaudeSessionsReader } from '../claude-sessions'
import { CLAUDE_SESSION_ID_RE } from '../claude-sessions'
import type { SessionManager } from '../session/manager'
import type { SessionCreateResult } from '../../shared/types'

/**
 * Wire up `api.claudeSessions.*` IPC channels:
 *   claudeSessions:list   → list previous sessions for a project
 *   claudeSessions:resume → spawn a Hydra session that runs `claude --resume`
 *
 * Resume is wired to the existing SessionManager so the resumed Claude
 * conversation appears in the sidebar exactly like any other agent —
 * just one with prior history attached.
 */
export function registerClaudeSessionsIpc(
  reader: ClaudeSessionsReader,
  sessions: SessionManager
): void {
  ipcMain.handle('claudeSessions:list', (_evt, payload: { projectPath: string }) => {
    return reader.listForProject(payload.projectPath)
  })

  ipcMain.handle(
    'claudeSessions:resume',
    async (
      _evt,
      payload: { projectPath: string; sessionId: string }
    ): Promise<SessionCreateResult> => {
      const { projectPath, sessionId } = payload
      if (!CLAUDE_SESSION_ID_RE.test(sessionId)) {
        return { ok: false, error: `invalid session id: ${sessionId}` }
      }
      return sessions.create({
        cwd: projectPath,
        cols: 120,
        rows: 30,
        provider: 'claude',
        resumeId: sessionId
      })
    }
  )
}
