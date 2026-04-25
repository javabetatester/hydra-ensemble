import { useEffect, useMemo, useState } from 'react'
import {
  X,
  FolderOpen,
  GitBranch,
  Plus,
  Sparkles,
  Info,
  Folder,
  MessageSquare,
  TerminalSquare,
  UserPlus,
  UserCheck,
  Bot,
  Eye,
  EyeOff,
  KeyRound
} from 'lucide-react'
import { useProjects } from '../state/projects'
import { useSessions } from '../state/sessions'
import {
  PROVIDER_SPECS,
  type Provider,
  type SessionViewMode,
  type Worktree
} from '../../shared/types'

const LAST_PROVIDER_KEY = 'hydra.lastProvider'

const PROVIDER_ORDER: Provider[] = ['claude', 'codex', 'copilot']

function readLastProvider(): Provider {
  try {
    const v = localStorage.getItem(LAST_PROVIDER_KEY)
    if (v === 'claude' || v === 'codex' || v === 'copilot') return v
  } catch {
    // localStorage may be unavailable in some embed contexts; fall through
  }
  return 'claude'
}

function persistLastProvider(p: Provider): void {
  try {
    localStorage.setItem(LAST_PROVIDER_KEY, p)
  } catch {
    /* noop */
  }
}

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * Centred dialog the user sees every time they spawn a new agent.
 * Asks: which project? main repo or a dedicated worktree branch?
 * Worktrees explainer is right there for newcomers.
 */
export default function NewSessionDialog({ open, onClose }: Props) {
  const projects = useProjects((s) => s.projects)
  const currentPath = useProjects((s) => s.currentPath)
  const worktrees = useProjects((s) => s.worktrees)
  const loadingWorktrees = useProjects((s) => s.loadingWorktrees)
  const setCurrent = useProjects((s) => s.setCurrent)
  const refreshWorktrees = useProjects((s) => s.refreshWorktrees)
  const addProject = useProjects((s) => s.addProject)
  const createWorktree = useProjects((s) => s.createWorktree)
  const createSession = useSessions((s) => s.createSession)

  const [pickedProject, setPickedProject] = useState<string | null>(currentPath)
  const [pickedWorktree, setPickedWorktree] = useState<Worktree | null>(null)
  const [name, setName] = useState('')
  const [showNewWt, setShowNewWt] = useState(false)
  const [newWtName, setNewWtName] = useState('')
  const [newWtBranch, setNewWtBranch] = useState('')
  const [creating, setCreating] = useState(false)
  const [showExplainer, setShowExplainer] = useState(false)
  const [viewMode, setViewMode] = useState<SessionViewMode>('cli')
  const [freshConfig, setFreshConfig] = useState(false)
  const [provider, setProvider] = useState<Provider>(() => readLastProvider())
  const providerSpec = PROVIDER_SPECS[provider]
  const [model, setModel] = useState<string>(
    () => PROVIDER_SPECS[readLastProvider()].defaultModel ?? ''
  )
  const [useApiKey, setUseApiKey] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)

  // Sync picked project with current when dialog opens
  useEffect(() => {
    if (!open) return
    setPickedProject(currentPath)
    setPickedWorktree(null)
    setName('')
    setShowNewWt(false)
    setNewWtName('')
    setNewWtBranch('')
    setViewMode('cli')
    setFreshConfig(false)
    const last = readLastProvider()
    setProvider(last)
    setModel(PROVIDER_SPECS[last].defaultModel ?? '')
    setUseApiKey(false)
    setApiKey('')
    setShowApiKey(false)
  }, [open, currentPath])

  // When the provider changes, snap the model to its default and persist
  // the choice so the next open of the dialog reflects the user's pick.
  useEffect(() => {
    persistLastProvider(provider)
    setModel(PROVIDER_SPECS[provider].defaultModel ?? '')
    // The api-key toggle only applies to providers that support keys —
    // dropping back to a keyless provider (copilot) clears it implicitly.
    if (!PROVIDER_SPECS[provider].apiKeyEnv) {
      setUseApiKey(false)
      setApiKey('')
    }
  }, [provider])

  // Refresh worktrees when project changes
  useEffect(() => {
    if (!open || !pickedProject) return
    if (pickedProject !== currentPath) {
      void setCurrent(pickedProject)
    } else {
      void refreshWorktrees()
    }
  }, [open, pickedProject, currentPath, setCurrent, refreshWorktrees])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const main = useMemo(() => worktrees.find((w) => w.isMain), [worktrees])
  const branches = useMemo(() => worktrees.filter((w) => !w.isBare), [worktrees])

  if (!open) return null

  const submit = async (): Promise<void> => {
    if (!pickedProject) return
    setCreating(true)
    try {
      // Resolve the cwd: worktree path overrides project path.
      const cwd = pickedWorktree?.path ?? pickedProject
      const branch = pickedWorktree?.branch
      const trimmedKey = apiKey.trim()
      const keyToSend =
        useApiKey && providerSpec.apiKeyEnv && trimmedKey ? trimmedKey : undefined
      await createSession({
        cwd,
        worktreePath: pickedWorktree && !pickedWorktree.isMain ? pickedWorktree.path : undefined,
        branch,
        name: name.trim() || undefined,
        viewMode,
        freshConfig,
        provider,
        model: providerSpec.hasModelPicker ? model : undefined,
        apiKey: keyToSend
      })
      onClose()
    } finally {
      setCreating(false)
    }
  }

  const submitNewWorktree = async (): Promise<void> => {
    const wtName = newWtName.trim()
    if (!wtName) return
    setCreating(true)
    try {
      await createWorktree(wtName, newWtBranch.trim() || undefined)
      // refreshWorktrees runs inside createWorktree. Pick the new one
      // automatically once it's in the list.
      setShowNewWt(false)
      setNewWtName('')
      setNewWtBranch('')
      // Wait one tick for store to sync, then auto-select.
      setTimeout(() => {
        const wt = useProjects.getState().worktrees.find((w) => w.path.endsWith('/' + wtName))
        if (wt) setPickedWorktree(wt)
      }, 50)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[68] flex items-center justify-center bg-bg-0/85 px-4 backdrop-blur-md df-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}
      >
        <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Sparkles size={14} strokeWidth={1.75} className="text-accent-400" />
            <span className="df-label">spawn agent</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="close"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </header>

        <div className="space-y-4 p-4">
          {/* Project */}
          <div>
            <label className="df-label mb-1.5 flex items-center justify-between">
              <span>project</span>
              <button
                type="button"
                onClick={() => void addProject()}
                className="flex items-center gap-1 text-[10px] normal-case tracking-normal text-accent-400 hover:text-accent-200"
              >
                <FolderOpen size={11} strokeWidth={1.75} />
                open another…
              </button>
            </label>
            {projects.length === 0 ? (
              <button
                type="button"
                onClick={() => void addProject()}
                className="flex w-full items-center justify-center gap-2 rounded-sm border border-dashed border-border-mid bg-bg-1 px-3 py-3 text-sm text-text-3 hover:bg-bg-3 hover:text-text-1"
              >
                <Folder size={14} strokeWidth={1.75} />
                pick a project directory
              </button>
            ) : (
              <div className="df-scroll grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-sm border border-border-soft bg-bg-1 p-1">
                {projects.map((p) => {
                  const sel = p.path === pickedProject
                  return (
                    <button
                      key={p.path}
                      type="button"
                      onClick={() => setPickedProject(p.path)}
                      className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition ${
                        sel ? 'bg-accent-500/15 text-text-1' : 'text-text-2 hover:bg-bg-3'
                      }`}
                    >
                      <Folder size={12} strokeWidth={1.75} className={sel ? 'text-accent-400' : 'text-text-4'} />
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="ml-auto truncate font-mono text-[10px] text-text-4">
                        {p.path}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Worktree */}
          <div>
            <label className="df-label mb-1.5 flex items-center justify-between">
              <span>worktree / branch</span>
              <button
                type="button"
                onClick={() => setShowExplainer((v) => !v)}
                className="flex items-center gap-1 text-[10px] normal-case tracking-normal text-text-4 hover:text-text-2"
              >
                <Info size={11} strokeWidth={1.75} />
                what is a worktree?
              </button>
            </label>

            {showExplainer ? (
              <div className="mb-2 rounded-sm border border-border-soft bg-bg-1 p-3 text-[11px] leading-relaxed text-text-3">
                <p className="mb-1.5">
                  <strong className="text-text-2">git worktree</strong> — a second working copy
                  of the same repo on its own branch. Same git history, separate files on disk.
                </p>
                <p className="mb-1.5">
                  Each agent running in a worktree operates as if it were an independent clone:
                  it can edit, commit, run tests, and install deps <em>without interfering</em>{' '}
                  with the other worktrees.
                </p>
                <p>
                  When the branch is done, merge it into main with a normal{' '}
                  <code className="rounded-sm bg-bg-3 px-1 font-mono">git merge</code> and remove
                  the worktree from the sidebar. The branch stays in the repo as commits.
                </p>
              </div>
            ) : null}

            {loadingWorktrees ? (
              <div className="rounded-sm border border-border-soft bg-bg-1 px-3 py-2 text-[11px] text-text-4">
                listing worktrees…
              </div>
            ) : (
              <div className="df-scroll grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-sm border border-border-soft bg-bg-1 p-1">
                {/* "Main" is always an option. Selecting it means: spawn in the main checkout, no isolated worktree. */}
                {main ? (
                  <WorktreeRow
                    worktree={main}
                    selected={pickedWorktree?.path === main.path}
                    onPick={() => setPickedWorktree(main)}
                    isMainOption
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setPickedWorktree(null)}
                    className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs ${
                      pickedWorktree === null
                        ? 'bg-accent-500/15 text-text-1'
                        : 'text-text-2 hover:bg-bg-3'
                    }`}
                  >
                    <GitBranch size={12} strokeWidth={1.75} className="text-text-4" />
                    <span>main directory (no worktree)</span>
                  </button>
                )}
                {branches
                  .filter((w) => !w.isMain)
                  .map((w) => (
                    <WorktreeRow
                      key={w.path}
                      worktree={w}
                      selected={pickedWorktree?.path === w.path}
                      onPick={() => setPickedWorktree(w)}
                    />
                  ))}
                {showNewWt ? (
                  <div className="mt-1 flex flex-col gap-1.5 rounded-sm border border-accent-500/30 bg-bg-2 p-2">
                    <input
                      autoFocus
                      type="text"
                      value={newWtName}
                      onChange={(e) => setNewWtName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void submitNewWorktree()
                        if (e.key === 'Escape') setShowNewWt(false)
                      }}
                      placeholder="worktree name (e.g. fix-auth)"
                      className="rounded-sm border border-border-mid bg-bg-1 px-2 py-1 font-mono text-xs text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newWtBranch}
                      onChange={(e) => setNewWtBranch(e.target.value)}
                      placeholder="base branch (default: main)"
                      className="rounded-sm border border-border-soft bg-bg-1 px-2 py-1 font-mono text-xs text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowNewWt(false)}
                        className="rounded-sm px-2 py-1 text-[10px] text-text-3 hover:bg-bg-3 hover:text-text-1"
                      >
                        cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitNewWorktree()}
                        disabled={!newWtName.trim() || creating}
                        className="rounded-sm bg-accent-500 px-2 py-1 text-[10px] font-semibold text-white hover:bg-accent-600 disabled:opacity-40"
                      >
                        create
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowNewWt(true)}
                    className="flex items-center gap-2 rounded-sm border border-dashed border-border-soft px-2 py-1.5 text-xs text-text-3 hover:border-accent-500/50 hover:bg-bg-3 hover:text-text-1"
                  >
                    <Plus size={12} strokeWidth={1.75} />
                    new worktree…
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Optional name */}
          <div>
            <label className="df-label mb-1.5 block">name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pickedProject) void submit()
              }}
              placeholder="auto: session-N"
              className="w-full rounded-sm border border-border-mid bg-bg-1 px-2.5 py-1.5 font-mono text-sm text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
            />
          </div>

          {/* View mode selector — CLI (raw xterm) vs visual chat. */}
          <div>
            <label className="df-label mb-1.5 block">view</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setViewMode('cli')}
                className={`flex items-start gap-2 rounded-sm border px-2.5 py-2 text-left transition ${
                  viewMode === 'cli'
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-border-soft bg-bg-1 hover:border-border-mid hover:bg-bg-3'
                }`}
              >
                <TerminalSquare
                  size={14}
                  strokeWidth={1.75}
                  className={viewMode === 'cli' ? 'mt-0.5 text-accent-400' : 'mt-0.5 text-text-3'}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-text-1">cli</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-text-3">
                    raw xterm — every key goes straight to claude, slash commands, shortcuts, all of it.
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('visual')}
                className={`flex items-start gap-2 rounded-sm border px-2.5 py-2 text-left transition ${
                  viewMode === 'visual'
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-border-soft bg-bg-1 hover:border-border-mid hover:bg-bg-3'
                }`}
              >
                <MessageSquare
                  size={14}
                  strokeWidth={1.75}
                  className={viewMode === 'visual' ? 'mt-0.5 text-accent-400' : 'mt-0.5 text-text-3'}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-text-1">visual</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-text-3">
                    rendered chat — markdown, tool calls, clickable file refs, usage inline.
                  </div>
                </div>
              </button>
            </div>
            <div className="mt-1.5 font-mono text-[10px] text-text-4">
              you can toggle this per session at any time from the pane header.
            </div>
          </div>

          {/* Provider — pick the agent CLI this session runs. The
              dropdown immediately below switches available models. */}
          <div>
            <label className="df-label mb-1.5 block">agent</label>
            <div className="grid grid-cols-3 gap-2">
              {PROVIDER_ORDER.map((p) => {
                const spec = PROVIDER_SPECS[p]
                const sel = provider === p
                const Icon =
                  p === 'copilot' ? Bot : p === 'codex' ? Sparkles : Sparkles
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProvider(p)}
                    className={`flex flex-col items-start gap-1 rounded-sm border px-2.5 py-2 text-left transition ${
                      sel
                        ? 'border-accent-500 bg-accent-500/10'
                        : 'border-border-soft bg-bg-1 hover:border-border-mid hover:bg-bg-3'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Icon
                        size={12}
                        strokeWidth={1.75}
                        className={sel ? 'text-accent-400' : 'text-text-3'}
                      />
                      <span className="text-xs font-semibold text-text-1">
                        {spec.label}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] text-text-4">
                      {spec.binary}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="mt-1.5 text-[11px] leading-snug text-text-3">
              {providerSpec.authHint}
            </div>
          </div>

          {/* Model — only providers with a curated list show this. */}
          {providerSpec.hasModelPicker && providerSpec.models ? (
            <div>
              <label className="df-label mb-1.5 block">model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-sm border border-border-mid bg-bg-1 px-2.5 py-1.5 font-mono text-sm text-text-1 focus:border-accent-500 focus:outline-none"
              >
                {providerSpec.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* API key (chavinha) — only providers with an apiKeyEnv. The
              key is exported into the spawn's PTY env and never written
              to disk. Toggling off blanks the field on close. */}
          {providerSpec.apiKeyEnv ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="df-label">api key</span>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-2">
                  <span className="text-text-4">use api key for this session</span>
                  <input
                    type="checkbox"
                    checked={useApiKey}
                    onChange={(e) => setUseApiKey(e.target.checked)}
                    className="h-3 w-3 accent-accent-500"
                  />
                </label>
              </div>
              {useApiKey ? (
                <div className="relative">
                  <KeyRound
                    size={12}
                    strokeWidth={1.75}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-4"
                  />
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={`exported as ${providerSpec.apiKeyEnv}`}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-sm border border-border-mid bg-bg-1 pl-7 pr-9 py-1.5 font-mono text-sm text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-text-4 hover:bg-bg-3 hover:text-text-1"
                    title={showApiKey ? 'hide key' : 'show key'}
                    aria-label={showApiKey ? 'hide key' : 'show key'}
                  >
                    {showApiKey ? (
                      <EyeOff size={12} strokeWidth={1.75} />
                    ) : (
                      <Eye size={12} strokeWidth={1.75} />
                    )}
                  </button>
                </div>
              ) : (
                <div className="rounded-sm border border-dashed border-border-soft bg-bg-1 px-2.5 py-1.5 font-mono text-[11px] text-text-4">
                  agent will inherit ambient auth (no per-session key)
                </div>
              )}
            </div>
          ) : null}

          {/* Account — share the host login (default) or run this
              session under an isolated config dir so the agent CLI
              prompts for a brand-new login. */}
          <div>
            <label className="df-label mb-1.5 block">account</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFreshConfig(false)}
                className={`flex items-start gap-2 rounded-sm border px-2.5 py-2 text-left transition ${
                  !freshConfig
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-border-soft bg-bg-1 hover:border-border-mid hover:bg-bg-3'
                }`}
              >
                <UserCheck
                  size={14}
                  strokeWidth={1.75}
                  className={!freshConfig ? 'mt-0.5 text-accent-400' : 'mt-0.5 text-text-3'}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-text-1">global login</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-text-3">
                    inherits the host&apos;s ambient auth — same account, history and state as your other sessions.
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setFreshConfig(true)}
                className={`flex items-start gap-2 rounded-sm border px-2.5 py-2 text-left transition ${
                  freshConfig
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-border-soft bg-bg-1 hover:border-border-mid hover:bg-bg-3'
                }`}
              >
                <UserPlus
                  size={14}
                  strokeWidth={1.75}
                  className={freshConfig ? 'mt-0.5 text-accent-400' : 'mt-0.5 text-text-3'}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-text-1">fresh account</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-text-3">
                    dedicated{' '}
                    <code className="font-mono text-[10px]">{providerSpec.configDirEnv}</code>{' '}
                    — agent asks for a new login on first launch.
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border-soft bg-bg-1 px-4 py-2.5">
          <div className="font-mono text-[10px] text-text-4">
            {pickedWorktree ? `cwd: ${pickedWorktree.path}` : pickedProject ? `cwd: ${pickedProject}` : ''}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-border-soft px-3 py-1.5 text-xs text-text-2 hover:border-border-mid hover:bg-bg-3"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!pickedProject || creating}
              className="rounded-sm bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600 disabled:opacity-40"
            >
              {creating ? 'spawning…' : 'spawn agent'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function WorktreeRow({
  worktree,
  selected,
  onPick,
  isMainOption
}: {
  worktree: Worktree
  selected: boolean
  onPick: () => void
  isMainOption?: boolean
}) {
  const branchLabel = worktree.branch || worktree.head.slice(0, 7)
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition ${
        selected ? 'bg-accent-500/15 text-text-1' : 'text-text-2 hover:bg-bg-3'
      }`}
    >
      <GitBranch
        size={12}
        strokeWidth={1.75}
        className={selected ? 'text-accent-400' : 'text-text-4'}
      />
      <span className="truncate font-mono">{branchLabel}</span>
      {isMainOption ? (
        <span className="rounded-sm bg-bg-3 px-1 py-0 text-[9px] uppercase tracking-wider text-text-4">
          main
        </span>
      ) : worktree.isManaged ? (
        <span className="rounded-sm bg-accent-500/15 px-1 py-0 text-[9px] uppercase tracking-wider text-accent-400">
          worktree
        </span>
      ) : null}
      <span className="ml-auto truncate font-mono text-[10px] text-text-4">
        {worktree.path}
      </span>
    </button>
  )
}
