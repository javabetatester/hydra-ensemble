import { BrowserWindow, ipcMain } from 'electron'
import type { EditorFs } from '../editor/fs-bridge'
import { findInFiles, type FindOptions } from '../editor/find-in-files'
import { replaceInFiles, type ReplaceOptions } from '../editor/replace-in-files'
import {
  FileWatcher,
  type FileChangedPayload,
  type FileDeletedPayload
} from '../editor/file-watcher'

/**
 * Singleton FileWatcher shared by every renderer window. Created lazily
 * on first IPC call so unit tests that import this module without
 * spinning up a window don't allocate a chokidar instance.
 */
let watcher: FileWatcher | null = null
let bridgeWired = false

function getWatcher(): FileWatcher {
  if (!watcher) {
    watcher = new FileWatcher()
  }
  return watcher
}

/**
 * Forward FS events into every BrowserWindow's webContents. Wired ONCE
 * — chained subscribes share the same forwarder. Without this guard a
 * second subscribe leaks a duplicate listener and the renderer would
 * receive each event twice.
 */
function ensureBridgeWired(): void {
  if (bridgeWired) return
  const w = getWatcher()
  w.on('fileChanged', (payload: FileChangedPayload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send('editor:fileChanged', payload)
    }
  })
  w.on('fileDeleted', (payload: FileDeletedPayload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send('editor:fileDeleted', payload)
    }
  })
  bridgeWired = true
}

/**
 * Register IPC handlers for the editor file-system bridge. Channel names
 * match the `api.editor` surface declared in `src/shared/types.ts`.
 *
 * `getExtraRoots` lets the editor escape the $HOME-only sandbox for folders
 * the user opened explicitly via the OS dialog (their registered projects).
 * It's resolved per-call so newly-added projects work without re-wiring.
 */
export function registerEditorIpc(
  fs: EditorFs,
  getExtraRoots: () => readonly string[] = () => []
): void {
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
      findInFiles(payload.cwd, payload.query, {
        ...(payload.opts ?? {}),
        extraRoots: getExtraRoots()
      })
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
        { ...(payload.opts ?? {}), extraRoots: getExtraRoots() }
      )
  )
  ipcMain.handle('editor:claudeDirs', (_evt, cwd: string | null) => fs.claudeDirs(cwd))
  ipcMain.handle(
    'editor:copyPath',
    (_evt, payload: { src: string; destDir: string }) =>
      fs.copyPath(payload.src, payload.destDir)
  )
  ipcMain.handle('editor:deletePath', (_evt, path: string) => fs.deletePath(path))

  // File watching — invoked by the renderer the moment it opens a file
  // so it can react to external mutations. Subscriptions are
  // ref-counted; multiple windows watching the same path share one
  // chokidar instance.
  ipcMain.handle('editor:watchFile', (_evt, path: string) => {
    ensureBridgeWired()
    getWatcher().subscribe(path)
  })
  ipcMain.handle('editor:unwatchFile', (_evt, path: string) => {
    if (!watcher) return
    watcher.unsubscribe(path)
  })
}
