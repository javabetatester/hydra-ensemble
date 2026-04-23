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

export type SessionViewMode = 'cli' | 'visual'

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
  /** 'cli' (xterm) or 'visual' (rendered chat transcript). Defaults to 'cli'. */
  viewMode?: SessionViewMode
  /** True when this session runs under its own isolated CLAUDE_CONFIG_DIR
   *  (separate login, separate MCP state). Default false = shares host. */
  isFreshConfig?: boolean
}

export interface SessionUpdate {
  name?: string
  avatar?: string
  accentColor?: string
  description?: string
  viewMode?: SessionViewMode
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
  /** Persisted avatar chosen by the renderer (URL to a local SVG). */
  avatar?: string
  /** Persisted accent colour chosen by the renderer. */
  accentColor?: string
  /** UI mode the session opens in. Default 'cli'. */
  viewMode?: SessionViewMode
  /** When true, spin up a dedicated CLAUDE_CONFIG_DIR for this session
   *  (empty, isolated) so Claude prompts for a brand-new login instead of
   *  inheriting the host account. Default false. */
  freshConfig?: boolean
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
  /** Coarse activity verb derived from the latest tool call (e.g. "editing"). */
  subStatus?: string
  /** Concrete target — file path, command snippet, search pattern. */
  subTarget?: string
}

// =============================================================================
// Transcript (visual chat view — parsed from Claude Code's JSONL session log)
// =============================================================================

export type TranscriptRole = 'user' | 'assistant' | 'system'

/** A single rendered block inside a transcript message. */
export type TranscriptBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | {
      kind: 'tool_use'
      id: string
      name: string
      /** Free-form JSON input — parser leaves it untouched for the UI to render. */
      input: Record<string, unknown>
    }
  | {
      kind: 'tool_result'
      toolUseId: string
      /** Plain-text rendering of the result. */
      text: string
      isError?: boolean
    }

export interface TranscriptMessage {
  /** Stable index into the transcript (turn order, 0-based). */
  index: number
  role: TranscriptRole
  blocks: TranscriptBlock[]
  timestamp?: string
  /** Model that produced this message (assistant only). */
  model?: string
  /** Session uuid from the JSONL line — useful for /rewind targeting. */
  uuid?: string
  /** Parent uuid in the JSONL graph (for branch/fork detection). */
  parentUuid?: string
  /** Per-message usage (assistant only). */
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
  }
}

export interface TranscriptPayload {
  sessionId: string
  path: string | null
  messages: TranscriptMessage[]
}

// =============================================================================
// Claude slash commands (built from `.claude/commands/*.md` files)
// =============================================================================

export type ClaudeCommandSource = 'project' | 'global'

export interface ClaudeCommand {
  /** Slash name without the leading `/` — e.g. `review`, `pre-pr`. */
  name: string
  filePath: string
  source: ClaudeCommandSource
  /** First markdown heading (if any). */
  title?: string
  /** Short description — first non-heading line of the file. */
  description?: string
}

export interface ClaudeCommandsPayload {
  cwd: string | null
  commands: ClaudeCommand[]
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
  /** True when the change is in the index (column 1 of porcelain). */
  staged?: boolean
}

export interface FindInFilesOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export interface FindInFilesMatch {
  /** Absolute file path. */
  file: string
  /** 1-based line number. */
  line: number
  /** The matching line (truncated to a few hundred chars). */
  text: string
}

export type FindInFilesResult =
  | {
      ok: true
      value: {
        matches: FindInFilesMatch[]
        truncated: boolean
        tool: 'git grep' | 'grep'
      }
    }
  | { ok: false; error: string }

export interface ReplaceInFilesOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export type ReplaceInFilesResult =
  | {
      ok: true
      value: {
        filesChanged: number
        replacements: number
      }
    }
  | { ok: false; error: string }

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
  /** Default command. Used on Linux + macOS, and as the fallback on Windows. */
  command: string
  /** Optional override when running on Windows (cmd.exe semantics). */
  commandWin?: string
  /** Optional override when running on macOS. */
  commandMac?: string
  /** Optional override when running on Linux. */
  commandLinux?: string
  /** Name from the curated lucide icon set (see renderer/lib/toolkit-icons). */
  icon?: string
  /** Optional accent colour (hex) used for hover ring and run state. */
  accent?: string
  /** Optional one-word group tag for visual grouping. */
  group?: string
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

import type {
  Agent,
  MessageLog,
  NewAgentInput,
  NewEdgeInput,
  NewTeamInput,
  OrchestraEvent,
  OrchestraResult,
  OrchestraSettings,
  ReportingEdge,
  SafeMode,
  SecretStorage,
  SubmitTaskInput,
  Task,
  Team,
  UpdateAgentInput,
  UUID
} from './orchestra'

export interface HydraEnsembleApi {
  pty: {
    /** Spawn a raw PTY (no claude exec). Used by the Terminals panel for
     *  plain shells that should NOT appear as agent sessions. */
    spawn: (opts: PtySpawnOptions) => Promise<PtySpawnResult>
    /** Kill a raw PTY by id. Used to close a Terminals tab. */
    kill: (sessionId: string) => Promise<void>
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
    restart: (id: string) => Promise<SessionCreateResult>
    /** Align the PTY analyzer's cached state with a renderer-side
     *  optimistic flip so its next frame analysis emits correctly. */
    syncState: (id: string, state: SessionState) => Promise<void>
    /** Read the full parsed transcript for the session. Returns an empty
     *  array if the JSONL file hasn't appeared yet. */
    readTranscript: (id: string) => Promise<TranscriptPayload>
    onChange: (handler: (sessions: SessionMeta[]) => void) => () => void
    onState: (
      handler: (event: {
        sessionId: string
        state: SessionState
        /** Monotonic counter per sessionId — bumped on every analyzer spawn.
         *  Renderer rejects events with a generation smaller than the last
         *  one seen for that session, so a dying analyzer can't overwrite
         *  a fresh one's state. */
        generation: number
        /** Main-process Date.now() at emit time. Tie-breaker inside the same
         *  generation: an older emittedAt is stale and ignored. */
        emittedAt: number
      }) => void
    ) => () => void
    onJsonl: (handler: (update: JsonlUpdate) => void) => () => void
    /** Fires (debounced) when a session's JSONL file has new lines. */
    onTranscriptChanged: (handler: (event: { sessionId: string }) => void) => () => void
  }
  claude: {
    resolvePath: () => Promise<string | null>
    /** Enumerate slash commands available in `<cwd>/.claude/commands/`
     *  (project-local) plus `~/.claude/commands/` (global). */
    listCommands: (cwd: string | null) => Promise<ClaudeCommandsPayload>
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
    getDiff: (
      cwd: string,
      filePath?: string,
      staged?: boolean
    ) => Promise<GitOpResult<string>>
    stageFiles: (cwd: string, paths: string[]) => Promise<GitOpResult>
    unstageFiles: (cwd: string, paths: string[]) => Promise<GitOpResult>
    commit: (cwd: string, message: string) => Promise<GitOpResult<{ sha: string }>>
    /** Spawn `claude -p` in the background to draft a commit message from
     *  the current staged diff. Returns the trimmed message. `rules` is an
     *  optional free-form user instruction block (style guide, scopes, etc.)
     *  that is injected into the prompt. */
    generateCommitMessage: (cwd: string, rules?: string) => Promise<GitOpResult<string>>
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
    findInFiles: (
      cwd: string,
      query: string,
      opts?: FindInFilesOptions
    ) => Promise<FindInFilesResult>
    replaceInFiles: (
      cwd: string,
      query: string,
      replacement: string,
      opts?: ReplaceInFilesOptions
    ) => Promise<ReplaceInFilesResult>
    claudeDirs: (cwd: string | null) => Promise<{ project: string | null; global: string | null }>
    copyPath: (src: string, destDir: string) => Promise<string>
    deletePath: (path: string) => Promise<void>
  }
  gh: {
    listPRs: (cwd: string) => Promise<GitOpResult<PRInfo[]>>
    getPR: (cwd: string, number: number) => Promise<GitOpResult<PRDetail>>
  }
  quickTerm: {
    toggle: () => Promise<void>
  }
  window: {
    minimize: () => Promise<void>
    maximizeToggle: () => Promise<boolean>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
  }
  platform: {
    os: Platform
  }
  orchestra?: {
    settings: {
      get: () => Promise<OrchestraSettings>
      set: (patch: Partial<OrchestraSettings>) => Promise<void>
    }
    team: {
      list: () => Promise<Team[]>
      create: (input: NewTeamInput) => Promise<OrchestraResult<Team>>
      rename: (id: UUID, name: string) => Promise<OrchestraResult<Team>>
      setSafeMode: (id: UUID, safeMode: SafeMode) => Promise<OrchestraResult<Team>>
      delete: (id: UUID) => Promise<OrchestraResult<void>>
    }
    agent: {
      list: (teamId: UUID) => Promise<Agent[]>
      create: (input: NewAgentInput) => Promise<OrchestraResult<Agent>>
      update: (input: UpdateAgentInput) => Promise<OrchestraResult<Agent>>
      delete: (id: UUID) => Promise<OrchestraResult<void>>
      promoteMain: (id: UUID) => Promise<OrchestraResult<Team>>
      pause: (id: UUID) => Promise<OrchestraResult<Agent>>
      stop: (id: UUID) => Promise<OrchestraResult<Agent>>
    }
    edge: {
      list: (teamId: UUID) => Promise<ReportingEdge[]>
      create: (input: NewEdgeInput) => Promise<OrchestraResult<ReportingEdge>>
      delete: (id: UUID) => Promise<OrchestraResult<void>>
    }
    task: {
      submit: (input: SubmitTaskInput) => Promise<OrchestraResult<Task>>
      cancel: (id: UUID) => Promise<OrchestraResult<void>>
      list: (teamId: UUID) => Promise<Task[]>
    }
    messageLog: {
      forTask: (taskId: UUID) => Promise<MessageLog[]>
    }
    apiKey: {
      set: (value: string, prefer: SecretStorage) => Promise<OrchestraResult<SecretStorage>>
      test: () => Promise<{ ok: true } | { ok: false; error: string }>
      clear: () => Promise<void>
    }
    onEvent: (handler: (event: OrchestraEvent) => void) => () => void
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
