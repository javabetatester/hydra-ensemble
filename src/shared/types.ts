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
// Providers — which CLI backs the session
// =============================================================================

/** Identifier of the agent CLI a session runs under. */
export type Provider = 'claude' | 'codex' | 'copilot'

export interface ProviderSpec {
  id: Provider
  label: string
  /** Binary name as installed on PATH. */
  binary: string
  /** Env var the CLI honors for its config root. */
  configDirEnv: string
  /** Env var for API key, when the CLI supports key-based auth.
   *  undefined when the provider only auths via its own flow (e.g. gh). */
  apiKeyEnv?: string
  /** Model id passed via `--model` at spawn. Undefined means "let the
   *  CLI pick its own default" — Codex and Copilot manage model
   *  selection from inside their own TUI (`/model` etc), Hydra doesn't
   *  expose a picker for them. Claude is pinned because Hydra is
   *  intentionally an Opus-4.7-first orchestrator. */
  defaultModel?: string
  /** Friendly hint shown under the agent block explaining auth/setup. */
  authHint: string
}

export const PROVIDER_SPECS: Record<Provider, ProviderSpec> = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    binary: 'claude',
    configDirEnv: 'CLAUDE_CONFIG_DIR',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-opus-4-7',
    authHint:
      'Auths via Claude CLI browser flow by default. Set an API key to override. Pinned to Opus 4.7.'
  },
  codex: {
    id: 'codex',
    label: 'OpenAI Codex',
    binary: 'codex',
    configDirEnv: 'CODEX_HOME',
    apiKeyEnv: 'OPENAI_API_KEY',
    authHint:
      'Requires OPENAI_API_KEY (set per session below) or `codex login` in the CLI. Switch models inside the agent with `/model`.'
  },
  copilot: {
    id: 'copilot',
    label: 'GitHub Copilot',
    binary: 'copilot',
    configDirEnv: 'GH_CONFIG_DIR',
    apiKeyEnv: undefined,
    authHint:
      'Uses GitHub CLI auth (`gh auth login`). Fresh mode requires re-auth in the new isolated config dir. Models picked inside the CLI.'
  }
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
  /** Absolute path of the isolated config directory for this session.
   *  Despite the historical name, this is shared by every provider — it's
   *  the dir exported via the provider's `configDirEnv` (CLAUDE_CONFIG_DIR
   *  for claude, CODEX_HOME for codex, GH_CONFIG_DIR for copilot) when the
   *  session runs in fresh-config mode. Host-shared sessions still resolve
   *  this to the host's claude dir for backward compat with persisted data. */
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
  /** Input footprint of the MOST-RECENT assistant turn — approximates
   *  "current context window used". Unlike tokensIn (cumulative across
   *  the whole session) this is what drives the context meter in the
   *  session card. */
  contextTokens?: number
  model?: string
  latestAssistantText?: string
  /** 'cli' (xterm) or 'visual' (rendered chat transcript). Defaults to 'cli'. */
  viewMode?: SessionViewMode
  /** True when this session runs under its own isolated config directory
   *  (separate login, separate state). Default false = shares host. */
  isFreshConfig?: boolean
  /** Which CLI this session is running. Defaults to 'claude' for
   *  backward compat with sessions created before the multi-provider
   *  refactor. */
  provider?: Provider
  /** Model id passed via --model. Undefined for providers without a
   *  model picker (Copilot). */
  providerModel?: string
  /** Reference to a key in the per-user vault. When present the spawn
   *  re-reveals the plaintext from the vault and exports it as the
   *  provider's apiKeyEnv. Plaintext is NEVER persisted in SessionMeta —
   *  only the id. */
  apiKeyId?: string
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
  /** When true, spin up a dedicated isolated config dir for this session
   *  (empty) so the provider CLI prompts for a brand-new login instead of
   *  inheriting the host account. Default false. */
  freshConfig?: boolean
  /** Which CLI to launch. Defaults to 'claude'. */
  provider?: Provider
  /** Model id passed to the CLI via `--model`. Ignored when the provider
   *  has no model picker (e.g. copilot). */
  model?: string
  /** Optional API key for this session. When set, exported into the
   *  PTY env as the provider's apiKeyEnv var (if it has one). Never
   *  persisted to disk; lives only in the spawned process env. */
  apiKey?: string
  /** When set, the spawn pulls the plaintext key from the vault (main
   *  process only) and exports it as the provider's apiKeyEnv var.
   *  Mutually exclusive with `apiKey` (which carries an ad-hoc key for
   *  this session that doesn't get saved). */
  apiKeyId?: string
  /** Resume an existing Claude Code session by uuid. Adds `--resume <id>`
   *  to the launch command. Only meaningful for `provider === 'claude'`;
   *  ignored otherwise. The id MUST be a plain UUID — the spawn validates
   *  it again before splicing into the shell command. */
  resumeId?: string
}

// =============================================================================
// Key vault — per-user encrypted storage for provider API keys
// =============================================================================

/** Sanitised view of a vault record — never carries the encrypted blob. */
export interface VaultEntry {
  id: string
  name: string
  provider: Provider
  apiKeyEnv: string
  createdAt: string
  lastUsedAt?: string
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
  /** Input footprint of the most-recent assistant turn — see SessionMeta.contextTokens. */
  contextTokens?: number
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
// Claude session history (read from ~/.claude/projects/<encoded>/<uuid>.jsonl)
// =============================================================================

/** A previously-recorded Claude Code session for a project, suitable for
 *  resuming via `claude --resume <id>`. The fields here are derived purely
 *  from disk — Hydra doesn't persist its own copy. */
export interface ClaudeSessionSummary {
  /** UUID — both the filename of the JSONL and the value passed to --resume. */
  sessionId: string
  /** Truncated first user message, or empty string if none was found. */
  title: string
  /** mtime as ISO string; used to sort recency. */
  mtime: string
  /** Branch name read from the first user message's `gitBranch` field. */
  gitBranch?: string
  /** Number of user/assistant turns in the JSONL — useful for "1 message" vs.
   *  "long conversation" hints. */
  messageCount: number
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

/** Fired by the main-process FileWatcher whenever a watched file's
 *  content changes on disk. The hash lets the renderer short-circuit
 *  loops where its own save triggers the chokidar event. */
export interface FileChangedEvent {
  path: string
  mtime: number
  size: number
  hash: string
}

/** Fired when a watched file is unlinked from disk. */
export interface FileDeletedEvent {
  path: string
}

export interface WriteFileResult {
  ok: boolean
  /** sha1 of the bytes that were written. Present on success. */
  hash?: string
  error?: string
}

// =============================================================================
// Renderer-facing API (exposed via contextBridge as window.api)
// =============================================================================

import type {
  Agent,
  GenerateTeamInput,
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
  Skill,
  SubmitTaskInput,
  Task,
  Team,
  TeamExportV1,
  TeamInstance,
  TeamTemplate,
  Trigger,
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
    /** Save a clipboard image to a temp file and return its absolute path. */
    saveClipboardImage: (base64: string, mimeType: string) => Promise<string>
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
  claudeSessions: {
    /** List all Claude Code sessions for a project, sorted recency-first. */
    list: (projectPath: string) => Promise<ClaudeSessionSummary[]>
    /** Spawn a new Hydra session that runs `claude --resume <sessionId>`
     *  inside `projectPath`. Returns the new Hydra session's id. */
    resume: (projectPath: string, sessionId: string) => Promise<SessionCreateResult>
  }
  toolkit: {
    list: () => Promise<ToolkitItem[]>
    save: (items: ToolkitItem[]) => Promise<void>
    run: (id: string, cwd: string) => Promise<ToolkitRunResult>
  }
  notify: {
    show: (opts: NotifyOptions) => Promise<void>
  }
  editor: {
    readFile: (path: string) => Promise<FileContent>
    listDir: (path: string) => Promise<DirEntry[]>
    writeFile: (path: string, content: string) => Promise<WriteFileResult>
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
    /** Subscribe the main-process FileWatcher to `path`. Idempotent —
     *  ref-counted, so balance with `unwatchFile`. */
    watchFile: (path: string) => Promise<void>
    unwatchFile: (path: string) => Promise<void>
    /** Fires when a watched file mutates on disk. Returns an unsubscribe. */
    onFileChanged: (handler: (event: FileChangedEvent) => void) => () => void
    /** Fires when a watched file is unlinked. Returns an unsubscribe. */
    onFileDeleted: (handler: (event: FileDeletedEvent) => void) => () => void
  }
  quickTerm: {
    toggle: () => Promise<void>
  }
  keys: {
    /** Stripped list (no cipher blob) — optionally filtered by provider. */
    list: (provider?: Provider) => Promise<VaultEntry[]>
    /** Saves a new key. Returns the new vault record's id. */
    save: (input: {
      name: string
      provider: Provider
      apiKeyEnv: string
      value: string
    }) => Promise<{ id: string }>
    remove: (id: string) => Promise<void>
    rename: (id: string, name: string) => Promise<void>
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
      readClaudeMd: (id: UUID) => Promise<OrchestraResult<string>>
      writeClaudeMd: (id: UUID, text: string) => Promise<OrchestraResult<void>>
      export: (id: UUID) => Promise<OrchestraResult<string | null>>
      importPick: () => Promise<OrchestraResult<TeamExportV1 | null>>
      importProvision: (
        data: TeamExportV1,
        worktreePath: string
      ) => Promise<OrchestraResult<unknown>>
      generateFromPrompt: (
        input: GenerateTeamInput
      ) => Promise<OrchestraResult<TeamExportV1>>
    }
    agent: {
      list: (teamId: UUID) => Promise<Agent[]>
      create: (input: NewAgentInput) => Promise<OrchestraResult<Agent>>
      update: (input: UpdateAgentInput) => Promise<OrchestraResult<Agent>>
      delete: (id: UUID) => Promise<OrchestraResult<void>>
      promoteMain: (id: UUID) => Promise<OrchestraResult<Team>>
      pause: (id: UUID) => Promise<OrchestraResult<Agent>>
      stop: (id: UUID) => Promise<OrchestraResult<Agent>>
      readSoul: (id: UUID) => Promise<OrchestraResult<string>>
      writeSoul: (id: UUID, text: string) => Promise<OrchestraResult<void>>
      readSkills: (id: UUID) => Promise<OrchestraResult<Skill[]>>
      writeSkills: (id: UUID, skills: Skill[]) => Promise<OrchestraResult<void>>
      readTriggers: (id: UUID) => Promise<OrchestraResult<Trigger[]>>
      writeTriggers: (id: UUID, triggers: Trigger[]) => Promise<OrchestraResult<void>>
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
    template: {
      list: () => Promise<TeamTemplate[]>
    }
    instance: {
      list: (filter?: { projectPath?: string }) => Promise<TeamInstance[]>
      apply: (input: {
        templateId: UUID
        worktreePath: string
        name?: string
        projectPath?: string
      }) => Promise<OrchestraResult<TeamInstance>>
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
