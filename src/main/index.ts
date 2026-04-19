import { app, BrowserWindow, shell } from 'electron'
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

const ptyManager = new PtyManager()
const analyzerManager = new AnalyzerManager()
const jsonlManager = new JsonlManager()
const worktreeService = new WorktreeService()
const projectService = new ProjectService()
const toolkitService = new ToolkitService()
const notificationService = new NotificationService()
const editorFs = new EditorFs()
const ghService = new GhService()

const watchdogService = new WatchdogService({
  onAction: (a) => {
    if (a.kind === 'sendInput') {
      ptyManager.write(a.sessionId, a.data ?? '')
    } else if (a.kind === 'kill') {
      void sessionManager?.destroy(a.sessionId)
    }
  }
})

const sessionManager: SessionManager = new SessionManager({
  pty: ptyManager,
  analyzer: analyzerManager,
  jsonl: jsonlManager,
  onSessionData: (sessionId, data) => watchdogService.feed(sessionId, data),
  onSessionDestroyed: (sessionId) => watchdogService.forgetSession(sessionId)
})

const quickTermService = new QuickTermService(ptyManager)

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0d0d0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

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

  // Mirror analyzer state changes onto the persisted session metadata.
  // The renderer also receives `session:state` directly; this keeps the
  // sessions list in sync for next paint.
  win.webContents.on('ipc-message', () => {
    /* no-op placeholder */
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Bridge analyzer state events to update the SessionMeta cache.
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

app.whenReady().then(() => {
  initStore()
  registerPtyIpc(ptyManager)
  registerClaudeIpc()
  registerSessionIpc(sessionManager)
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
  sessionManager.shutdown()
  jsonlManager.stopAll()
  analyzerManager.disposeAll()
  ptyManager.killAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  sessionManager.shutdown()
  jsonlManager.stopAll()
  analyzerManager.disposeAll()
  ptyManager.killAll()
})
