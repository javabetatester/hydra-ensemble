import { ipcMain } from 'electron'
import type { EditorFs } from '../editor/fs-bridge'
import { findInFiles, type FindOptions } from '../editor/find-in-files'
import { replaceInFiles, type ReplaceOptions } from '../editor/replace-in-files'

/**
 * Register IPC handlers for the editor file-system bridge. Channel names
 * match the `api.editor` surface declared in `src/shared/types.ts`.
 */
export function registerEditorIpc(fs: EditorFs): void {
  ipcMain.handle('editor:readFile', (_evt, path: string) => fs.readFile(path))
  ipcMain.handle('editor:listDir', (_evt, path: string) => fs.listDir(path))
  ipcMain.handle(
    'editor:writeFile',
    (_evt, payload: { path: string; content: string }) =>
      fs.writeFile(payload.path, payload.content)
  )
  ipcMain.handle(
    'editor:findInFiles',
    (_evt, payload: { cwd: string; query: string; opts?: FindOptions }) =>
      findInFiles(payload.cwd, payload.query, payload.opts ?? {})
  )
  ipcMain.handle(
    'editor:replaceInFiles',
    (
      _evt,
      payload: { cwd: string; query: string; replacement: string; opts?: ReplaceOptions }
    ) =>
      replaceInFiles(
        payload.cwd,
        payload.query,
        payload.replacement,
        payload.opts ?? {}
      )
  )
  ipcMain.handle('editor:claudeDirs', (_evt, cwd: string | null) => fs.claudeDirs(cwd))
}
