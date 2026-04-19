// =============================================================================
// PTY
// =============================================================================

export interface PtySpawnOptions {
  sessionId: string
  cwd: string
  shell?: string
  args?: string[]
  env?: Record<string, string>
  cols: number
  rows: number
}

export type PtySpawnResult = { ok: true } | { ok: false; error: string }

export interface PtyDataEvent {
  sessionId: string
  data: string
}

export interface PtyExitEvent {
  sessionId: string
  exitCode: number
  signal?: number
}

// =============================================================================
// Sessions
// =============================================================================

export interface SessionMeta {
  id: string
  name: string
  cwd: string
  worktreePath?: string
  branch?: string
  claudeConfigDir: string
  createdAt: string
  ptyId: string
  /** Emoji or short string shown as the agent's avatar. */
  avatar?: string
  /** Hex colour used for the agent's accent ring. */
  accentColor?: string
  /** Optional one-line description / role hint. */
  description?: string
  state?: SessionState
  /** Finer-grained activity, e.g. "editing src/foo.ts" or "running npm test". */
  subStatus?: string
  /** Optional target the agent is currently acting on (file/command). */
  subTarget?: string
  cost?: number
  tokensIn?: number
  tokensOut?: number
  model?: string
  latestAssistantText?: string
}

export interface SessionUpdate {
  name?: string
  avatar?: string
  accentColor?: string
  description?: string
}

export type SessionState =
  | 'idle'
  | 'thinking'
  | 'generating'
  | 'userInput'
  | 'needsAttention'

export interface SessionCreateOptions {
  name?: string
  cwd?: string
  worktreePath?: string
  branch?: string
  cols: number
  rows: number
  shellOnly?: boolean
}

export type SessionCreateResult =
  | { ok: true; session: SessionMeta }
  | { ok: false; error: string }

// =============================================================================
// JSONL (cost / tokens / model)
// =============================================================================

export interface JsonlUpdate {
  sessionId: string
  cost: number
  tokensIn: number
  tokensOut: number
  model: string
  latestAssistantText?: string
  latestAssistantAt?: string
}

// =============================================================================
// Git / Worktrees
// =============================================================================

export interface Worktree {
  path: string
  branch: string
  head: string
  isBare: boolean
  isManaged: boolean
  isMain: boolean
}

export interface ChangedFile {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
}

export type GitOpResult<T = void> = { ok: true; value: T } | { ok: false; error: string }

// =============================================================================
// Projects
// =============================================================================

export interface ProjectMeta {
  path: string
  name: string
  lastOpenedAt: string
  repoRoot?: string
}

// =============================================================================
// Toolkit
// =============================================================================

export interface ToolkitItem {
  id: string
  label: string
  command: string
  icon?: string
}

export interface ToolkitRunResult {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

// =============================================================================
// Watchdogs
// =============================================================================

export interface WatchdogRule {
  id: string
  name: string
  enabled: boolean
  /** ECMAScript regex source matched against the recent PTY text window */
  triggerPattern: string
  action: 'sendInput' | 'notify' | 'kill'
  payload?: string
  cooldownMs: number
}

export interface WatchdogFireEvent {
  ruleId: string
  sessionId: string
  matched: string
  at: string
}

// =============================================================================
// Notifications
// =============================================================================

export type NotificationKind = 'info' | 'attention' | 'completed' | 'error'

export interface NotifyOptions {
  title: string
  body: string
  kind?: NotificationKind
  sessionId?: string
}

// =============================================================================
// Editor
// =============================================================================

export interface DirEntry {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
  size: number
  mtimeMs: number
}

export interface FileContent {
  path: string
  bytes: string // base64 if binary, utf-8 otherwise
  encoding: 'utf-8' | 'base64'
  size: number
}

// =============================================================================
// GitHub PRs (gh CLI)
// =============================================================================

export interface PRInfo {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  author: string
  url: string
  headRefName: string
  baseRefName: string
  isDraft: boolean
  updatedAt: string
}

export interface PRDetail extends PRInfo {
  body: string
  diff: string
  checks: PRCheck[]
}

export interface PRCheck {
  name: string
  status: 'queued' | 'in_progress' | 'completed' | 'unknown'
  conclusion?: 'success' | 'failure' | 'cancelled' | 'skipped' | 'neutral'
  url?: string
}

// =============================================================================
// Renderer-facing API (exposed via contextBridge as window.api)
// =============================================================================

export interface HydraEnsembleApi {
  pty: {
    write: (sessionId: string, data: string) => Promise<void>
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>
    onData: (handler: (event: PtyDataEvent) => void) => () => void
    onExit: (handler: (event: PtyExitEvent) => void) => () => void
  }
  session: {
    create: (opts: SessionCreateOptions) => Promise<SessionCreateResult>
    destroy: (id: string) => Promise<void>
    list: () => Promise<SessionMeta[]>
    rename: (id: string, name: string) => Promise<void>
    update: (id: string, patch: SessionUpdate) => Promise<void>
    onChange: (handler: (sessions: SessionMeta[]) => void) => () => void
    onState: (handler: (event: { sessionId: string; state: SessionState }) => void) => () => void
    onJsonl: (handler: (update: JsonlUpdate) => void) => () => void
  }
  claude: {
    resolvePath: () => Promise<string | null>
  }
  git: {
    repoRoot: (cwd: string) => Promise<string | null>
    listWorktrees: (cwd: string) => Promise<GitOpResult<Worktree[]>>
    createWorktree: (
      repoRoot: string,
      name: string,
      baseBranch?: string
    ) => Promise<GitOpResult<Worktree>>
    removeWorktree: (repoRoot: string, path: string) => Promise<GitOpResult>
    listChangedFiles: (cwd: string) => Promise<GitOpResult<ChangedFile[]>>
    currentBranch: (cwd: string) => Promise<string | null>
  }
  project: {
    list: () => Promise<ProjectMeta[]>
    add: (path: string) => Promise<ProjectMeta | null>
    remove: (path: string) => Promise<void>
    pickDirectory: () => Promise<string | null>
    setCurrent: (path: string) => Promise<void>
    current: () => Promise<ProjectMeta | null>
    onChange: (handler: (projects: ProjectMeta[]) => void) => () => void
  }
  toolkit: {
    list: () => Promise<ToolkitItem[]>
    save: (items: ToolkitItem[]) => Promise<void>
    run: (id: string, cwd: string) => Promise<ToolkitRunResult>
  }
  watchdog: {
    list: () => Promise<WatchdogRule[]>
    save: (rules: WatchdogRule[]) => Promise<void>
    onFire: (handler: (event: WatchdogFireEvent) => void) => () => void
  }
  notify: {
    show: (opts: NotifyOptions) => Promise<void>
  }
  editor: {
    readFile: (path: string) => Promise<FileContent>
    listDir: (path: string) => Promise<DirEntry[]>
    writeFile: (path: string, content: string) => Promise<void>
  }
  gh: {
    listPRs: (cwd: string) => Promise<GitOpResult<PRInfo[]>>
    getPR: (cwd: string, number: number) => Promise<GitOpResult<PRDetail>>
  }
  quickTerm: {
    toggle: () => Promise<void>
  }
  platform: {
    os: Platform
  }
}

export type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

declare global {
  interface Window {
    api: HydraEnsembleApi
  }
}

export {}
