import { contextBridge, ipcRenderer } from 'electron'
import type {
  ChangedFile,
  DirEntry,
  HydraEnsembleApi,
  FileContent,
  GitOpResult,
  JsonlUpdate,
  NotifyOptions,
  PRDetail,
  PRInfo,
  Platform,
  ProjectMeta,
  PtyDataEvent,
  PtyExitEvent,
  SessionCreateOptions,
  SessionMeta,
  SessionState,
  SessionUpdate,
  ToolkitItem,
  ToolkitRunResult,
  WatchdogFireEvent,
  WatchdogRule,
  Worktree
} from '../shared/types'

function on<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_evt: unknown, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: HydraEnsembleApi = {
  pty: {
    spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
    kill: (sessionId) => ipcRenderer.invoke('pty:kill', { sessionId }),
    write: (sessionId, data) => ipcRenderer.invoke('pty:write', { sessionId, data }),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.invoke('pty:resize', { sessionId, cols, rows }),
    onData: (handler) => on<PtyDataEvent>('pty:data', handler),
    onExit: (handler) => on<PtyExitEvent>('pty:exit', handler)
  },
  session: {
    create: (opts: SessionCreateOptions) => ipcRenderer.invoke('session:create', opts),
    destroy: (id: string) => ipcRenderer.invoke('session:destroy', { id }),
    list: () => ipcRenderer.invoke('session:list'),
    rename: (id: string, name: string) =>
      ipcRenderer.invoke('session:rename', { id, name }),
    update: (id: string, patch: SessionUpdate) =>
      ipcRenderer.invoke('session:update', { id, patch }),
    restart: (id: string) => ipcRenderer.invoke('session:restart', { id }),
    onChange: (handler) => on<SessionMeta[]>('session:changed', handler),
    onState: (handler) =>
      on<{ sessionId: string; state: SessionState }>('session:state', handler),
    onJsonl: (handler) => on<JsonlUpdate>('session:jsonl', handler)
  },
  claude: {
    resolvePath: () => ipcRenderer.invoke('claude:resolvePath')
  },
  git: {
    repoRoot: (cwd: string) => ipcRenderer.invoke('git:repoRoot', cwd),
    listWorktrees: (cwd: string): Promise<GitOpResult<Worktree[]>> =>
      ipcRenderer.invoke('git:listWorktrees', cwd),
    createWorktree: (repoRoot: string, name: string, baseBranch?: string) =>
      ipcRenderer.invoke('git:createWorktree', { repoRoot, name, baseBranch }),
    removeWorktree: (repoRoot: string, path: string) =>
      ipcRenderer.invoke('git:removeWorktree', { repoRoot, path }),
    listChangedFiles: (cwd: string): Promise<GitOpResult<ChangedFile[]>> =>
      ipcRenderer.invoke('git:listChangedFiles', cwd),
    currentBranch: (cwd: string) => ipcRenderer.invoke('git:currentBranch', cwd)
  },
  project: {
    list: (): Promise<ProjectMeta[]> => ipcRenderer.invoke('project:list'),
    add: (path: string) => ipcRenderer.invoke('project:add', path),
    remove: (path: string) => ipcRenderer.invoke('project:remove', path),
    pickDirectory: () => ipcRenderer.invoke('project:pickDirectory'),
    setCurrent: (path: string) => ipcRenderer.invoke('project:setCurrent', path),
    current: () => ipcRenderer.invoke('project:current'),
    onChange: (handler) => on<ProjectMeta[]>('project:changed', handler)
  },
  toolkit: {
    list: (): Promise<ToolkitItem[]> => ipcRenderer.invoke('toolkit:list'),
    save: (items: ToolkitItem[]) => ipcRenderer.invoke('toolkit:save', items),
    run: (id: string, cwd: string): Promise<ToolkitRunResult> =>
      ipcRenderer.invoke('toolkit:run', { id, cwd })
  },
  watchdog: {
    list: (): Promise<WatchdogRule[]> => ipcRenderer.invoke('watchdog:list'),
    save: (rules: WatchdogRule[]) => ipcRenderer.invoke('watchdog:save', rules),
    onFire: (handler) => on<WatchdogFireEvent>('watchdog:fired', handler)
  },
  notify: {
    show: (opts: NotifyOptions) => ipcRenderer.invoke('notify:show', opts)
  },
  editor: {
    readFile: (path: string): Promise<FileContent> =>
      ipcRenderer.invoke('editor:readFile', path),
    listDir: (path: string): Promise<DirEntry[]> => ipcRenderer.invoke('editor:listDir', path),
    writeFile: (path: string, content: string) =>
      ipcRenderer.invoke('editor:writeFile', { path, content })
  },
  gh: {
    listPRs: (cwd: string): Promise<GitOpResult<PRInfo[]>> =>
      ipcRenderer.invoke('gh:listPRs', cwd),
    getPR: (cwd: string, number: number): Promise<GitOpResult<PRDetail>> =>
      ipcRenderer.invoke('gh:getPR', { cwd, number })
  },
  quickTerm: {
    toggle: () => ipcRenderer.invoke('quickTerm:toggle')
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },
  platform: {
    os: process.platform as Platform
  }
}

contextBridge.exposeInMainWorld('api', api)
