import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { PtyManager } from './pty/manager'
import { AnalyzerManager } from './pty/analyzer-manager'
import { JsonlManager } from './claude/jsonl-manager'
import { SessionManager } from './session/manager'
import { WorktreeService } from './git/worktree'
import { ProjectService } from './project/manager'
import { ToolkitService } from './toolkit/manager'
import { WatchdogService } from './watchdog/manager'
import { NotificationService } from './notifications/manager'
import { EditorFs } from './editor/fs-bridge'
import { GhService } from './gh/manager'
import { QuickTermService } from './quickTerm/manager'
import { registerPtyIpc } from './ipc/pty'
import { registerClaudeIpc } from './ipc/claude'
import { registerSessionIpc } from './ipc/session'
import { registerGitIpc } from './ipc/git'
import { registerProjectIpc } from './ipc/project'
import { registerToolkitIpc } from './ipc/toolkit'
import { registerWatchdogIpc } from './ipc/watchdog'
import { registerNotifyIpc } from './ipc/notify'
import { registerEditorIpc } from './ipc/editor'
import { registerGhIpc } from './ipc/gh'
import { registerQuickTermIpc } from './ipc/quickTerm'
import { initStore } from './store'
import { initUpdater } from './updater'
import type { JsonlUpdate, SessionState } from '../shared/types'

// --- services ------------------------------------------------------------
// These are filled in inside app.whenReady *after* initStore() runs, because
// SessionManager's constructor reads getStore().sessions to rehydrate the
// persisted session list. If we instantiated at module load the store
// cache would still be the empty default and every persisted session
// would be silently dropped on boot.
let ptyManager!: PtyManager
let analyzerManager!: AnalyzerManager
let jsonlManager!: JsonlManager
let sessionManager!: SessionManager
let worktreeService!: WorktreeService
let projectService!: ProjectService
let toolkitService!: ToolkitService
let notificationService!: NotificationService
let editorFs!: EditorFs
let ghService!: GhService
let watchdogService!: WatchdogService
let quickTermService!: QuickTermService

function setupServices(): void {
  ptyManager = new PtyManager()
  analyzerManager = new AnalyzerManager()
  jsonlManager = new JsonlManager()
  worktreeService = new WorktreeService()
  projectService = new ProjectService()
  toolkitService = new ToolkitService()
  notificationService = new NotificationService()
  editorFs = new EditorFs()
  ghService = new GhService()

  watchdogService = new WatchdogService({
    onAction: (a) => {
      if (a.kind === 'sendInput') {
        ptyManager.write(a.sessionId, a.data ?? '')
      } else if (a.kind === 'kill') {
        void sessionManager.destroy(a.sessionId)
      }
    }
  })

  sessionManager = new SessionManager({
    pty: ptyManager,
    analyzer: analyzerManager,
    jsonl: jsonlManager,
    onSessionData: (sessionId, data) => watchdogService.feed(sessionId, data),
    onSessionDestroyed: (sessionId) => watchdogService.forgetSession(sessionId)
  })

  quickTermService = new QuickTermService(ptyManager)

  // Bridge analyzer state events to update the SessionMeta cache so the
  // renderer sees live state changes via the `session:changed` broadcast
  // in addition to the direct `session:state` event.
  analyzerManager.onAnyStateChange = (sessionId: string, state: SessionState) => {
    sessionManager.patchLive(sessionId, { state })
  }

  // Bridge jsonl updates likewise.
  jsonlManager.onAnyUpdate = (update: JsonlUpdate) => {
    sessionManager.patchLive(update.sessionId, {
      cost: update.cost,
      tokensIn: update.tokensIn,
      tokensOut: update.tokensOut,
      model: update.model,
      latestAssistantText: update.latestAssistantText,
      subStatus: update.subStatus,
      subTarget: update.subTarget
    })
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0d0d0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Hide the menu bar entirely on Linux/Windows. The app draws its own
    // header so File/Edit/View/Window/Help is just visual noise. macOS
    // keeps a real app menu because the OS expects one at the top.
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Belt-and-braces: also drop the menu so Alt won't bring it back.
  if (process.platform !== 'darwin') {
    win.setMenuBarVisibility(false)
    win.setMenu(null)
  }

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  ptyManager.attachWindow(win)
  sessionManager.attachWindow(win)
  analyzerManager.attachWindow(win)
  jsonlManager.attachWindow(win)
  projectService.attachWindow(win)
  watchdogService.attachWindow(win)
  notificationService.attachWindow(win)

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Window-control IPC so the renderer can wire the custom titlebar
// minimize / maximize / close buttons that replace the OS-native
// frame on tiling WMs (Hyprland, etc.) where decorations are absent.
function registerWindowIpc(): void {
  const winFor = (sender: Electron.WebContents): BrowserWindow | null =>
    BrowserWindow.fromWebContents(sender)

  ipcMain.handle('window:minimize', (e) => {
    winFor(e.sender)?.minimize()
  })
  ipcMain.handle('window:maximizeToggle', (e) => {
    const w = winFor(e.sender)
    if (!w) return false
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
    return w.isMaximized()
  })
  ipcMain.handle('window:close', (e) => {
    winFor(e.sender)?.close()
  })
  ipcMain.handle('window:isMaximized', (e) => winFor(e.sender)?.isMaximized() ?? false)
}

app.whenReady().then(async () => {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }

  // Order matters: initStore populates the JSON cache from userData/store.json
  // BEFORE SessionManager's constructor reads getStore().sessions for
  // rehydration. Used to be reversed, so every boot started with an
  // empty session list.
  initStore()

  // One-time migrate host ~/.claude/.credentials.json from any legacy
  // shadow dir so login persists across newly-spawned sessions.
  const { migrateLegacyCredentials } = await import('./claude/config-isolation')
  await migrateLegacyCredentials().catch(() => {})

  setupServices()

  registerWindowIpc()
  registerPtyIpc(ptyManager)
  registerClaudeIpc()
  registerSessionIpc(sessionManager, analyzerManager)
  registerGitIpc(worktreeService)
  registerProjectIpc(projectService)
  registerToolkitIpc(toolkitService)
  registerWatchdogIpc(watchdogService)
  registerNotifyIpc(notificationService)
  registerEditorIpc(editorFs)
  registerGhIpc(ghService)
  registerQuickTermIpc(quickTermService)

  const win = createWindow()
  initUpdater(win)

  // Rehydrate persisted sessions after the renderer has mounted and
  // subscribed to IPC events. did-finish-load + a short tick is enough
  // for contextBridge listeners to be wired up in practice.
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void sessionManager.rehydrate()
    }, 400)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// On close, kill PTYs but preserve the per-session CLAUDE_CONFIG_DIR so
// sessions can be rehydrated on the next launch (history + credentials).
app.on('window-all-closed', () => {
  sessionManager?.shutdown()
  jsonlManager?.stopAll()
  analyzerManager?.disposeAll()
  ptyManager?.killAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  sessionManager?.shutdown()
  jsonlManager?.stopAll()
  analyzerManager?.disposeAll()
  ptyManager?.killAll()
})
