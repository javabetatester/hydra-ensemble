import {
  Wrench,
  Settings2,
  Loader2,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  Sparkles,
  TerminalSquare,
  SlashSquare,
  Globe,
  FolderGit2,
  RotateCw,
  Search,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useToolkit } from '../state/toolkit'
import { useClaudeCommands } from '../state/claudeCommands'
import { useEditor } from '../state/editor'
import { useSlidePanel, useToolkitSize } from '../state/panels'
import type { ClaudeCommand, DirEntry, ToolkitItem } from '../../shared/types'
import { ToolkitIcon, guessIconForLabel } from '../lib/toolkit-icons'
import { hexAlpha } from '../lib/agent'

type Tab = 'bashes' | 'commands' | 'claude'

interface Props {
  cwd: string | null
  /** Active session ptyId — required for commands to know which agent to send to. */
  activeSessionPtyId?: string | null
  /** Active session id — for optimistic state flips on send. */
  activeSessionId?: string | null
  /** Whether the active session is ready to accept input. */
  canSendToSession?: boolean
}

export default function ToolkitGrid({
  cwd,
  activeSessionPtyId,
  activeSessionId,
  canSendToSession
}: Props) {
  const items = useToolkit((s) => s.items)
  const runs = useToolkit((s) => s.runs)
  const run = useToolkit((s) => s.run)
  const openEditor = useToolkit((s) => s.openEditor)

  const cwdKey = cwd ?? ''
  const commandsEntry = useClaudeCommands((s) => s.byCwd[cwdKey])
  const refreshCommands = useClaudeCommands((s) => s.refresh)

  const [tab, setTab] = useState<Tab>('bashes')
  const [commandsQuery, setCommandsQuery] = useState('')
  const expanded = useToolkitSize((s) => s.expanded)
  const setExpanded = useToolkitSize((s) => s.setExpanded)
  const toggleExpanded = useToolkitSize((s) => s.toggleExpanded)

  /** Tab click logic: clicking the ACTIVE tab toggles the panel
   *  expanded/collapsed; clicking an INACTIVE tab switches to it AND
   *  ensures the panel is expanded. So the panel acts as a slide-up
   *  drawer rooted in its tab strip. */
  const handleTabClick = (next: Tab): void => {
    if (next === tab) {
      toggleExpanded()
      return
    }
    setTab(next)
    if (!expanded) setExpanded(true)
  }

  // Re-fetch claude commands whenever cwd or tab changes to commands.
  useEffect(() => {
    if (tab !== 'commands') return
    void refreshCommands(cwd)
  }, [tab, cwd, refreshCommands])

  // Group items for visual sectioning. Items without `group` are grouped under "—".
  const groups = useMemo(() => {
    const map = new Map<string, ToolkitItem[]>()
    for (const it of items) {
      const key = it.group?.trim() || '—'
      const arr = map.get(key) ?? []
      arr.push(it)
      map.set(key, arr)
    }
    return [...map.entries()]
  }, [items])

  const sendSlash = (name: string): void => {
    if (!activeSessionPtyId) return
    // No optimistic 'thinking' flip — slash commands are usually
    // instant and don't produce a "esc to interrupt" footer for the
    // analyzer to confirm. Flipping would strand the pill in thinking.
    void window.api.pty.write(activeSessionPtyId, `/${name}\r`)
  }

  return (
    <section className="flex h-full flex-col border-l border-t border-border-soft bg-bg-2">
      <header className="flex shrink-0 items-center gap-1.5 border-b border-border-soft px-2 py-1.5">
        <TabButton
          active={tab === 'bashes' && expanded}
          icon={TerminalSquare}
          label="bashes"
          onClick={() => handleTabClick('bashes')}
        />
        <TabButton
          active={tab === 'commands' && expanded}
          icon={SlashSquare}
          label="commands"
          onClick={() => handleTabClick('commands')}
        />
        <TabButton
          active={tab === 'claude' && expanded}
          icon={Sparkles}
          label=".claude"
          onClick={() => handleTabClick('claude')}
        />
        <div className="ml-auto flex items-center gap-1">
          {tab === 'bashes' ? (
            <button
              type="button"
              onClick={openEditor}
              data-tour-id="toolkit-add"
              className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-3 px-2 py-1 text-[11px] text-text-2 transition hover:border-accent-500/50 hover:bg-bg-4 hover:text-text-1"
              title="edit toolkit commands"
            >
              <Settings2 size={11} strokeWidth={1.75} />
              edit
            </button>
          ) : tab === 'commands' ? (
            <button
              type="button"
              onClick={() => void refreshCommands(cwd)}
              className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-3 px-2 py-1 text-[11px] text-text-2 transition hover:border-accent-500/50 hover:bg-bg-4 hover:text-text-1"
              title="re-scan .claude/commands"
            >
              <RotateCw
                size={11}
                strokeWidth={1.75}
                className={commandsEntry?.loading ? 'animate-spin' : ''}
              />
              refresh
            </button>
          ) : null}
        </div>
      </header>

      {/* Filter bar — pulled OUT of the scroll area so it stays pinned at
          the top of the tab and doesn't bleed content behind it (the old
          `sticky top-0 bg-bg-2/95` leaked the list rows through the
          backdrop blur, which the user saw as "vazado"). */}
      {tab === 'commands' ? (
        <div className="shrink-0 border-b border-border-soft bg-bg-2 px-2 py-1.5">
          <div
            className="flex items-center gap-1.5 border border-border-soft bg-bg-1 px-2 py-1 focus-within:border-accent-500/60"
            style={{ borderRadius: 'var(--radius-sm)' }}
          >
            <Search size={11} strokeWidth={1.75} className="shrink-0 text-text-4" />
            <input
              type="text"
              value={commandsQuery}
              onChange={(e) => setCommandsQuery(e.target.value)}
              placeholder="filter commands…"
              className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-text-1 placeholder:text-text-4 focus:outline-none"
            />
            {commandsQuery.length > 0 ? (
              <button
                type="button"
                onClick={() => setCommandsQuery('')}
                className="shrink-0 text-text-4 hover:text-text-1"
                title="clear filter"
                aria-label="clear filter"
              >
                <X size={11} strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        data-tour-id="toolkit-grid"
        className="df-scroll min-h-0 flex-1 overflow-y-auto p-2"
      >
        {tab === 'bashes' ? (
          items.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="no bashes yet"
              actionLabel="add your first command"
              onAction={openEditor}
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {groups.map(([groupName, groupItems]) => (
                <div key={groupName} className="flex flex-col gap-1">
                  {groups.length > 1 ? (
                    <div className="df-label px-1 pt-0.5">{groupName}</div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-1.5">
                    {groupItems.map((it) => (
                      <ToolkitButton
                        key={it.id}
                        item={it}
                        runState={runs[it.id]}
                        disabled={!cwd}
                        onRun={() => cwd && void run(it, cwd)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : tab === 'commands' ? (
          <CommandsTab
            entry={commandsEntry}
            canSend={!!activeSessionPtyId && !!canSendToSession}
            onSend={sendSlash}
            query={commandsQuery}
          />
        ) : (
          <ClaudeFolderTab cwd={cwd} />
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-border-soft px-3 py-1.5 font-mono text-[10px] text-text-4">
        {tab === 'bashes' ? (
          <>
            <span>{items.length} bashes</span>
            <span>{cwd ? '✓ project ready' : 'pick a project to enable'}</span>
          </>
        ) : tab === 'commands' ? (
          <>
            <span>
              {(() => {
                const all = commandsEntry?.commands ?? []
                const q = commandsQuery.trim().toLowerCase()
                if (!q) return `${all.length} commands`
                const matched = all.filter(
                  (c) =>
                    c.name.toLowerCase().includes(q) ||
                    (c.title?.toLowerCase().includes(q) ?? false) ||
                    (c.description?.toLowerCase().includes(q) ?? false)
                ).length
                return `${matched} / ${all.length} commands`
              })()}
            </span>
            <span>
              {activeSessionPtyId
                ? canSendToSession
                  ? '✓ ready to send'
                  : 'agent busy — wait for prompt'
                : 'no active session'}
            </span>
          </>
        ) : (
          <>
            <span>.claude</span>
            <span>click a file to open in the editor</span>
          </>
        )}
      </footer>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  .claude folder tab                                                 */
/* ------------------------------------------------------------------ */

function ClaudeFolderTab({ cwd }: { cwd: string | null }) {
  const [dirs, setDirs] = useState<{ project: string | null; global: string | null } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openFile = useEditor((s) => s.openFile)
  const setOverrideRoot = useEditor((s) => s.setOverrideRoot)
  const openPanel = useSlidePanel((s) => s.open)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setDirs(null)
    window.api.editor
      .claudeDirs(cwd)
      .then((res) => {
        if (cancelled) return
        setDirs(res)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cwd])

  // Opens a file from .claude in the editor AND pins the editor's file
  // tree to that .claude dir (project or global) so the user can keep
  // browsing siblings. Override is cleared when the editor closes, so a
  // fresh Ctrl+E afterwards returns to the session worktree.
  const onOpen = (path: string, sectionRoot: string): void => {
    setOverrideRoot(sectionRoot)
    void openFile(path)
    openPanel('editor')
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-text-3">
        <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
        scanning .claude/…
      </div>
    )
  }
  if (error) {
    return (
      <div className="m-2 flex items-start gap-2 rounded-md border border-status-attention/30 bg-status-attention/10 px-3 py-2 text-sm text-status-attention">
        <AlertCircle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
        <div className="break-words">{error}</div>
      </div>
    )
  }
  if (!dirs || (!dirs.project && !dirs.global)) {
    return (
      <EmptyState
        icon={Sparkles}
        title={cwd ? 'no .claude folder found' : 'pick a project to see its .claude folder'}
      />
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {dirs.project ? (
        <ClaudeFolderSection label="project" root={dirs.project} onOpen={onOpen} />
      ) : null}
      {dirs.global ? (
        <ClaudeFolderSection label="global" root={dirs.global} onOpen={onOpen} />
      ) : null}
    </div>
  )
}

function ClaudeFolderSection({
  label,
  root,
  onOpen,
}: {
  label: string
  root: string
  onOpen: (path: string, sectionRoot: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const short = root.split('/').slice(-3).join('/')
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-1 pt-0.5 text-left font-mono text-[10px] uppercase tracking-wider text-text-4 hover:text-text-1"
      >
        {expanded ? (
          <ChevronDown size={10} strokeWidth={1.75} />
        ) : (
          <ChevronRight size={10} strokeWidth={1.75} />
        )}
        <Globe size={9} strokeWidth={1.75} />
        <span>{label}</span>
        <span className="truncate text-text-4/80 normal-case">· {short}</span>
      </button>
      {expanded ? (
        <ClaudeDirNode path={root} depth={0} sectionRoot={root} onOpen={onOpen} alwaysExpanded />
      ) : null}
    </div>
  )
}

function ClaudeDirNode({
  path,
  depth,
  sectionRoot,
  onOpen,
  alwaysExpanded = false,
}: {
  path: string
  depth: number
  sectionRoot: string
  onOpen: (path: string, sectionRoot: string) => void
  alwaysExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState<boolean>(alwaysExpanded)
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const ensureLoaded = async (): Promise<void> => {
    if (entries !== null || loading) return
    setLoading(true)
    try {
      const next = await window.api.editor.listDir(path)
      setEntries(next)
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (alwaysExpanded) void ensureLoaded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alwaysExpanded, path])

  const toggle = (): void => {
    if (!expanded) {
      setExpanded(true)
      void ensureLoaded()
    } else {
      setExpanded(false)
    }
  }

  const pad = `${8 + depth * 12}px`

  return (
    <div>
      {alwaysExpanded ? null : (
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center gap-1.5 truncate py-1 pr-2 text-left text-[11px] text-text-2 hover:bg-bg-3 hover:text-text-1"
          style={{ paddingLeft: pad }}
          title={path}
        >
          <ChevronRight
            size={11}
            strokeWidth={2}
            className={`shrink-0 text-text-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          <Folder size={12} strokeWidth={1.75} className="shrink-0 text-accent-400" />
          <span className="truncate">{path.split('/').pop()}</span>
        </button>
      )}
      {expanded ? (
        loading ? (
          <div
            className="flex items-center gap-1.5 py-1 text-[10.5px] text-text-4"
            style={{ paddingLeft: `${8 + (depth + 1) * 12}px` }}
          >
            <Loader2 size={10} className="animate-spin" /> loading…
          </div>
        ) : (
          entries?.map((e) =>
            e.isDir ? (
              <ClaudeDirNode
                key={e.path}
                path={e.path}
                depth={depth + 1}
                sectionRoot={sectionRoot}
                onOpen={onOpen}
              />
            ) : (
              <button
                key={e.path}
                type="button"
                onClick={() => onOpen(e.path, sectionRoot)}
                className="flex w-full items-center gap-1.5 truncate py-1 pr-2 text-left text-[11px] text-text-3 hover:bg-bg-3 hover:text-text-1"
                style={{ paddingLeft: `${8 + (depth + 1) * 12 + 14}px` }}
                title={e.path}
              >
                <FileIcon size={12} strokeWidth={1.5} className="shrink-0 text-text-4" />
                <span className="truncate">{e.name}</span>
              </button>
            )
          )
        )
      ) : null}
    </div>
  )
}

function TabButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean
  icon: typeof TerminalSquare
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition ${
        active
          ? 'border-accent-500 bg-accent-500/10 text-text-1'
          : 'border-border-soft bg-bg-1 text-text-3 hover:border-border-mid hover:bg-bg-3 hover:text-text-1'
      }`}
    >
      <Icon size={12} strokeWidth={1.75} className={active ? 'text-accent-400' : ''} />
      <span className="font-semibold">{label}</span>
    </button>
  )
}

function EmptyState({
  icon: Icon,
  title,
  actionLabel,
  onAction
}: {
  icon: typeof Wrench
  title: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <Icon size={26} strokeWidth={1.25} className="text-text-4" />
      <div className="text-sm text-text-2">{title}</div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 rounded-sm bg-accent-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-600"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

function CommandsTab({
  entry,
  canSend,
  onSend,
  query
}: {
  entry?: { commands: ClaudeCommand[]; loading: boolean }
  canSend: boolean
  onSend: (name: string) => void
  query: string
}) {
  if (!entry || (entry.loading && entry.commands.length === 0)) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-text-3">
        <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
        scanning .claude/commands…
      </div>
    )
  }
  if (entry.commands.length === 0) {
    return (
      <EmptyState
        icon={SlashSquare}
        title="no .claude/commands found"
      />
    )
  }

  // Case-insensitive substring match on name, title and description.
  const q = query.trim().toLowerCase()
  const filtered = q
    ? entry.commands.filter((c) => {
        if (c.name.toLowerCase().includes(q)) return true
        if (c.title?.toLowerCase().includes(q)) return true
        if (c.description?.toLowerCase().includes(q)) return true
        return false
      })
    : entry.commands

  // Group by source so project-local appears above globals.
  const project = filtered.filter((c) => c.source === 'project')
  const global = filtered.filter((c) => c.source === 'global')

  return (
    <div className="flex flex-col gap-2">
      {filtered.length === 0 ? (
        <div className="px-2 py-6 text-center text-xs text-text-3">
          no commands match "{query}"
        </div>
      ) : (
        <>
          {project.length > 0 ? (
            <Section icon={FolderGit2} label="project">
              {project.map((c) => (
                <CommandButton key={c.filePath} cmd={c} canSend={canSend} onSend={onSend} />
              ))}
            </Section>
          ) : null}
          {global.length > 0 ? (
            <Section icon={Globe} label="global">
              {global.map((c) => (
                <CommandButton key={c.filePath} cmd={c} canSend={canSend} onSend={onSend} />
              ))}
            </Section>
          ) : null}
        </>
      )}
    </div>
  )
}

function Section({
  icon: Icon,
  label,
  children
}: {
  icon: typeof FolderGit2
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 px-1 pt-0.5 font-mono text-[10px] uppercase tracking-wider text-text-4">
        <Icon size={9} strokeWidth={1.75} />
        {label}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}

function CommandButton({
  cmd,
  canSend,
  onSend
}: {
  cmd: ClaudeCommand
  canSend: boolean
  onSend: (name: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSend(cmd.name)}
      disabled={!canSend}
      title={
        canSend
          ? `send /${cmd.name} to the active agent`
          : 'no active session — pick an agent first'
      }
      className={`flex items-start gap-2 overflow-hidden rounded-sm border px-2 py-1.5 text-left transition ${
        canSend
          ? 'border-border-soft bg-bg-3 hover:border-accent-500/50 hover:bg-bg-4'
          : 'cursor-not-allowed border-border-soft bg-bg-3/50 opacity-60'
      }`}
    >
      <SlashSquare size={11} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent-400" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-text-1">/{cmd.name}</span>
          {cmd.title && cmd.title.toLowerCase() !== cmd.name.toLowerCase() ? (
            <span className="truncate text-[10px] text-text-3">— {cmd.title}</span>
          ) : null}
        </div>
        {cmd.description ? (
          <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-text-3">
            {cmd.description}
          </div>
        ) : null}
      </div>
    </button>
  )
}

function ToolkitButton({
  item,
  runState,
  disabled,
  onRun
}: {
  item: ToolkitItem
  runState?: { status: 'running' | 'success' | 'error'; result?: { exitCode: number; durationMs: number; stdout: string; stderr: string } }
  disabled: boolean
  onRun: () => void
}) {
  const [showOutput, setShowOutput] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const accent = item.accent ?? statusAccent(runState?.status)
  const iconName = item.icon ?? guessIconForLabel(item.label)

  useEffect(() => {
    if (!showOutput) return
    const onClick = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setShowOutput(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [showOutput])

  const accentRing = runState?.status
    ? `inset 0 0 0 1px ${hexAlpha(accent, 0.6)}`
    : `inset 0 0 0 1px ${hexAlpha('#ffffff', 0.08)}`

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={onRun}
        disabled={disabled}
        title={disabled ? 'no project selected' : item.command}
        className={`group flex w-full items-stretch gap-0 overflow-hidden text-left text-xs transition-all df-lift ${
          disabled
            ? 'cursor-not-allowed bg-bg-3/50 text-text-4'
            : 'bg-bg-3 text-text-1 hover:bg-bg-4'
        }`}
        style={{
          borderRadius: 'var(--radius-md)',
          boxShadow: accentRing
        }}
      >
        {/* icon column */}
        <div
          className="flex w-8 shrink-0 items-center justify-center"
          style={{
            backgroundColor: hexAlpha(accent, runState?.status ? 0.15 : 0.08),
            color: runState?.status ? accent : 'var(--color-text-3)'
          }}
        >
          <ToolkitIcon name={iconName} size={13} />
        </div>
        {/* label column */}
        <div className="flex flex-1 items-center justify-between gap-1.5 px-2 py-1.5">
          <span className="truncate font-medium">{item.label || item.id}</span>
          <ToolkitStatusIcon status={runState?.status} accent={accent} />
        </div>
      </button>

      {runState?.result ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setShowOutput((v) => !v)
          }}
          className="absolute -bottom-1 right-1 rounded-sm bg-bg-1/90 p-0.5 text-text-4 opacity-0 transition group-hover:opacity-100 hover:text-text-1"
          title="show output"
          aria-label="show output"
        >
          <ChevronDown size={10} strokeWidth={1.75} />
        </button>
      ) : null}

      {showOutput && runState?.result ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-sm border border-border-mid bg-bg-3 p-2 shadow-pop df-fade-in df-scroll">
          <div className="mb-1 flex items-center justify-between text-[10px] text-text-4">
            <span className="font-mono">exit {runState.result.exitCode}</span>
            <span className="font-mono">{(runState.result.durationMs / 1000).toFixed(2)}s</span>
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-text-2">
            {runState.result.stdout || runState.result.stderr || '(no output)'}
          </pre>
        </div>
      ) : null}
    </div>
  )
}

function ToolkitStatusIcon({
  status,
  accent
}: {
  status?: 'running' | 'success' | 'error'
  accent: string
}) {
  if (status === 'running') {
    return (
      <Loader2
        size={12}
        strokeWidth={2}
        className="shrink-0 animate-spin"
        style={{ color: accent }}
        aria-label="running"
      />
    )
  }
  if (status === 'success') {
    return (
      <Check size={12} strokeWidth={2.25} className="shrink-0 text-status-generating" aria-label="success" />
    )
  }
  if (status === 'error') {
    return (
      <AlertCircle
        size={12}
        strokeWidth={2}
        className="shrink-0 text-status-attention"
        aria-label="error"
      />
    )
  }
  return null
}

/** Resolves to a CSS custom-property expression so the palette stays in
 *  sync with @theme tokens — previously this helper returned raw hex
 *  strings that copied the status palette by value. */
function statusAccent(status?: 'running' | 'success' | 'error'): string {
  switch (status) {
    case 'running':
      return 'var(--color-status-running)'
    case 'success':
      return 'var(--color-status-success)'
    case 'error':
      return 'var(--color-status-danger)'
    default:
      return 'var(--color-accent-500)'
  }
}
