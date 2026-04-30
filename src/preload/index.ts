import { contextBridge, ipcRenderer } from 'electron'
import type {
  ChangedFile,
  ClaudeCommandsPayload,
  ClaudeSessionSummary,
  DirEntry,
  HydraEnsembleApi,
  FileChangedEvent,
  FileContent,
  FileDeletedEvent,
  GitOpResult,
  JsonlUpdate,
  NotifyOptions,
  Platform,
  ProjectMeta,
  Provider,
  PtyDataEvent,
  PtyExitEvent,
  SessionCreateOptions,
  SessionMeta,
  SessionState,
  SessionUpdate,
  ToolkitItem,
  ToolkitRunResult,
  TranscriptPayload,
  VaultEntry,
  WriteFileResult,
  Worktree
} from '../shared/types'
import type {
  GenerateTeamInput,
  NewAgentInput,
  NewEdgeInput,
  NewTeamInput,
  OrchestraEvent,
  OrchestraResult,
  OrchestraSettings,
  SafeMode,
  SecretStorage,
  SubmitTaskInput,
  TeamExportV1,
  UpdateAgentInput,
  UUID
} from '../shared/orchestra'

/**
 * Orchestra read handlers wrap their result in `OrchestraResult<T>` on the
 * main side to keep a single error branch. Renderer-facing reads prefer the
 * raw value with a safe fallback, so `teams.map(...)` never sees an envelope.
 */
async function unwrapList<T>(
  channel: string,
  ...args: unknown[]
): Promise<T[]> {
  const raw = (await ipcRenderer.invoke(channel, ...args)) as
    | { ok: true; value: T[] }
    | { ok: false; error: string }
    | T[]
    | undefined
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && 'ok' in raw && raw.ok && Array.isArray(raw.value)) {
    return raw.value
  }
  return []
}

async function unwrapValue<T>(
  channel: string,
  fallback: T,
  ...args: unknown[]
): Promise<T> {
  const raw = (await ipcRenderer.invoke(channel, ...args)) as
    | { ok: true; value: T }
    | { ok: false; error: string }
    | T
    | undefined
  if (raw && typeof raw === 'object' && 'ok' in raw) {
    return raw.ok ? raw.value : fallback
  }
  return (raw as T | undefined) ?? fallback
}

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
    saveClipboardImage: (base64: string, mimeType: string): Promise<string> =>
      ipcRenderer.invoke('pty:saveClipboardImage', { base64, mimeType }),
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
    syncState: (id: string, state: SessionState) =>
      ipcRenderer.invoke('session:syncState', { id, state }),
    readTranscript: (id: string): Promise<TranscriptPayload> =>
      ipcRenderer.invoke('session:readTranscript', { id }),
    onChange: (handler) => on<SessionMeta[]>('session:changed', handler),
    onState: (handler) =>
      on<{
        sessionId: string
        state: SessionState
        generation: number
        emittedAt: number
      }>('session:state', handler),
    onJsonl: (handler) => on<JsonlUpdate>('session:jsonl', handler),
    onTranscriptChanged: (handler) =>
      on<{ sessionId: string }>('session:transcriptChanged', handler)
  },
  claude: {
    resolvePath: () => ipcRenderer.invoke('claude:resolvePath'),
    listCommands: (cwd: string | null): Promise<ClaudeCommandsPayload> =>
      ipcRenderer.invoke('claude:listCommands', cwd)
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
    currentBranch: (cwd: string) => ipcRenderer.invoke('git:currentBranch', cwd),
    getDiff: (cwd: string, filePath?: string, staged?: boolean) =>
      ipcRenderer.invoke('git:getDiff', { cwd, filePath, staged }),
    stageFiles: (cwd: string, paths: string[]) =>
      ipcRenderer.invoke('git:stageFiles', { cwd, paths }),
    unstageFiles: (cwd: string, paths: string[]) =>
      ipcRenderer.invoke('git:unstageFiles', { cwd, paths }),
    commit: (cwd: string, message: string) =>
      ipcRenderer.invoke('git:commit', { cwd, message }),
    generateCommitMessage: (cwd: string, rules?: string) =>
      ipcRenderer.invoke('git:generateCommitMessage', { cwd, rules })
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
  claudeSessions: {
    list: (projectPath: string): Promise<ClaudeSessionSummary[]> =>
      ipcRenderer.invoke('claudeSessions:list', { projectPath }),
    resume: (projectPath: string, sessionId: string) =>
      ipcRenderer.invoke('claudeSessions:resume', { projectPath, sessionId })
  },
  toolkit: {
    list: (): Promise<ToolkitItem[]> => ipcRenderer.invoke('toolkit:list'),
    save: (items: ToolkitItem[]) => ipcRenderer.invoke('toolkit:save', items),
    run: (id: string, cwd: string): Promise<ToolkitRunResult> =>
      ipcRenderer.invoke('toolkit:run', { id, cwd })
  },
  notify: {
    show: (opts: NotifyOptions) => ipcRenderer.invoke('notify:show', opts)
  },
  editor: {
    readFile: (path: string): Promise<FileContent> =>
      ipcRenderer.invoke('editor:readFile', path),
    listDir: (path: string): Promise<DirEntry[]> => ipcRenderer.invoke('editor:listDir', path),
    writeFile: (path: string, content: string): Promise<WriteFileResult> =>
      ipcRenderer.invoke('editor:writeFile', { path, content }),
    findInFiles: (
      cwd: string,
      query: string,
      opts?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }
    ) => ipcRenderer.invoke('editor:findInFiles', { cwd, query, opts }),
    replaceInFiles: (
      cwd: string,
      query: string,
      replacement: string,
      opts?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }
    ) =>
      ipcRenderer.invoke('editor:replaceInFiles', { cwd, query, replacement, opts }),
    claudeDirs: (cwd: string | null) => ipcRenderer.invoke('editor:claudeDirs', cwd),
    copyPath: (src: string, destDir: string): Promise<string> =>
      ipcRenderer.invoke('editor:copyPath', { src, destDir }),
    deletePath: (path: string): Promise<void> =>
      ipcRenderer.invoke('editor:deletePath', path),
    watchFile: (path: string): Promise<void> =>
      ipcRenderer.invoke('editor:watchFile', path),
    unwatchFile: (path: string): Promise<void> =>
      ipcRenderer.invoke('editor:unwatchFile', path),
    onFileChanged: (handler) => on<FileChangedEvent>('editor:fileChanged', handler),
    onFileDeleted: (handler) => on<FileDeletedEvent>('editor:fileDeleted', handler)
  },
  quickTerm: {
    toggle: () => ipcRenderer.invoke('quickTerm:toggle')
  },
  keys: {
    list: (provider?: Provider): Promise<VaultEntry[]> =>
      ipcRenderer.invoke('keys:list', provider !== undefined ? { provider } : {}),
    save: (input: { name: string; provider: Provider; apiKeyEnv: string; value: string }) =>
      ipcRenderer.invoke('keys:save', input),
    remove: (id: string) => ipcRenderer.invoke('keys:remove', { id }),
    rename: (id: string, name: string) => ipcRenderer.invoke('keys:rename', { id, name })
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  },
  platform: {
    os: process.platform as Platform
  },
  orchestra: {
    settings: {
      get: () =>
        unwrapValue<OrchestraSettings>('orchestra:settings.get', {
          enabled: false,
          apiKeyProvider: 'keychain',
          onboardingDismissed: false
        }),
      set: (patch: Partial<OrchestraSettings>) =>
        ipcRenderer.invoke('orchestra:settings.set', patch)
    },
    team: {
      list: () => unwrapList('orchestra:team.list'),
      create: (input: NewTeamInput) => ipcRenderer.invoke('orchestra:team.create', input),
      rename: (id: UUID, name: string) =>
        ipcRenderer.invoke('orchestra:team.rename', { id, name }),
      setSafeMode: (id: UUID, safeMode: SafeMode) =>
        ipcRenderer.invoke('orchestra:team.setSafeMode', { id, safeMode }),
      delete: (id: UUID) => ipcRenderer.invoke('orchestra:team.delete', { id }),
      readClaudeMd: (id: UUID) => ipcRenderer.invoke('orchestra:team.readClaudeMd', { id }),
      writeClaudeMd: (id: UUID, text: string) =>
        ipcRenderer.invoke('orchestra:team.writeClaudeMd', { id, text }),
      export: (id: UUID): Promise<OrchestraResult<string | null>> =>
        ipcRenderer.invoke('orchestra:team.export', { id }),
      importPick: (): Promise<OrchestraResult<TeamExportV1 | null>> =>
        ipcRenderer.invoke('orchestra:team.importPick'),
      importProvision: (
        data: TeamExportV1,
        worktreePath: string
      ): Promise<OrchestraResult<unknown>> =>
        ipcRenderer.invoke('orchestra:team.importProvision', { data, worktreePath }),
      generateFromPrompt: (
        input: GenerateTeamInput
      ): Promise<OrchestraResult<TeamExportV1>> =>
        ipcRenderer.invoke('orchestra:team.generateFromPrompt', input)
    },
    agent: {
      list: (teamId: UUID) => unwrapList('orchestra:agent.list', { teamId }),
      create: (input: NewAgentInput) => ipcRenderer.invoke('orchestra:agent.create', input),
      update: (input: UpdateAgentInput) => ipcRenderer.invoke('orchestra:agent.update', input),
      delete: (id: UUID) => ipcRenderer.invoke('orchestra:agent.delete', { id }),
      promoteMain: (id: UUID) => ipcRenderer.invoke('orchestra:agent.promoteMain', { id }),
      pause: (id: UUID) => ipcRenderer.invoke('orchestra:agent.pause', { id }),
      stop: (id: UUID) => ipcRenderer.invoke('orchestra:agent.stop', { id }),
      readSoul: (id: UUID) => ipcRenderer.invoke('orchestra:agent.readSoul', { id }),
      writeSoul: (id: UUID, text: string) =>
        ipcRenderer.invoke('orchestra:agent.writeSoul', { id, text }),
      readSkills: (id: UUID) => ipcRenderer.invoke('orchestra:agent.readSkills', { id }),
      writeSkills: (id: UUID, skills: unknown[]) =>
        ipcRenderer.invoke('orchestra:agent.writeSkills', { id, skills }),
      readTriggers: (id: UUID) => ipcRenderer.invoke('orchestra:agent.readTriggers', { id }),
      writeTriggers: (id: UUID, triggers: unknown[]) =>
        ipcRenderer.invoke('orchestra:agent.writeTriggers', { id, triggers })
    },
    edge: {
      list: (teamId: UUID) => unwrapList('orchestra:edge.list', { teamId }),
      create: (input: NewEdgeInput) => ipcRenderer.invoke('orchestra:edge.create', input),
      delete: (id: UUID) => ipcRenderer.invoke('orchestra:edge.delete', { id })
    },
    task: {
      submit: (input: SubmitTaskInput) => ipcRenderer.invoke('orchestra:task.submit', input),
      cancel: (id: UUID) => ipcRenderer.invoke('orchestra:task.cancel', { id }),
      delete: (id: UUID) => ipcRenderer.invoke('orchestra:task.delete', { id }),
      list: (teamId: UUID) => unwrapList('orchestra:task.list', { teamId })
    },
    template: {
      list: () => unwrapList('orchestra:template.list')
    },
    instance: {
      list: (filter: { projectPath?: string } = {}) =>
        unwrapList('orchestra:instance.list', filter),
      apply: (input: {
        templateId: UUID
        worktreePath: string
        name?: string
        projectPath?: string
      }) => ipcRenderer.invoke('orchestra:instance.apply', input)
    },
    messageLog: {
      forTask: (taskId: UUID) =>
        unwrapList('orchestra:messageLog.forTask', { taskId })
    },
    apiKey: {
      // IPC handler expects `{ value, storage }`; adapt here so the
      // renderer-facing name stays `prefer` (matches PLAN.md vocab).
      set: (value: string, prefer: SecretStorage) =>
        ipcRenderer.invoke('orchestra:apiKey.set', { value, storage: prefer }),
      test: () => ipcRenderer.invoke('orchestra:apiKey.test'),
      clear: () => ipcRenderer.invoke('orchestra:apiKey.clear')
    },
    onEvent: (handler) => on<OrchestraEvent>('orchestra:event', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
