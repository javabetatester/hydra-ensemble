import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  /** Save a clipboard image (base64) to a temp file and return its path.
   *  Used by the renderer paste handler to bridge clipboard images into
   *  the PTY — Claude Code can then read the file. */
  ipcMain.handle(
    'pty:saveClipboardImage',
    async (_evt, payload: { base64: string; mimeType: string }): Promise<string> => {
      const ext = payload.mimeType === 'image/jpeg' ? '.jpg' : '.png'
      const dir = join(tmpdir(), 'hydra-clipboard')
      await mkdir(dir, { recursive: true })
      const filePath = join(dir, `paste-${randomUUID()}${ext}`)
      const buf = Buffer.from(payload.base64, 'base64')
      await writeFile(filePath, buf)
      return filePath
    }
  )
}
