import {
  Wrench,
  Settings2,
  Loader2,
  AlertCircle,
  Check,
  ChevronDown,
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
import type { ClaudeCommand, ToolkitItem } from '../../shared/types'
import { ToolkitIcon, guessIconForLabel } from '../lib/toolkit-icons'
import { hexAlpha } from '../lib/agent'

type Tab = 'bashes' | 'commands'

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
          active={tab === 'bashes'}
          icon={TerminalSquare}
          label="bashes"
          onClick={() => setTab('bashes')}
        />
        <TabButton
          active={tab === 'commands'}
          icon={SlashSquare}
          label="commands"
          onClick={() => setTab('commands')}
        />
        <div className="ml-auto flex items-center gap-1">
          {tab === 'bashes' ? (
            <button
              type="button"
              onClick={openEditor}
              className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-3 px-2 py-1 text-[11px] text-text-2 transition hover:border-accent-500/50 hover:bg-bg-4 hover:text-text-1"
              title="edit toolkit commands"
            >
              <Settings2 size={11} strokeWidth={1.75} />
              edit
            </button>
          ) : (
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
          )}
        </div>
      </header>

      <div className="df-scroll min-h-0 flex-1 overflow-y-auto p-2">
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
        ) : (
          <CommandsTab
            entry={commandsEntry}
            canSend={!!activeSessionPtyId && !!canSendToSession}
            onSend={sendSlash}
            query={commandsQuery}
            onQueryChange={setCommandsQuery}
          />
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-border-soft px-3 py-1.5 font-mono text-[10px] text-text-4">
        {tab === 'bashes' ? (
          <>
            <span>{items.length} bashes</span>
            <span>{cwd ? '✓ project ready' : 'pick a project to enable'}</span>
          </>
        ) : (
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
        )}
      </footer>
    </section>
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
  query,
  onQueryChange
}: {
  entry?: { commands: ClaudeCommand[]; loading: boolean }
  canSend: boolean
  onSend: (name: string) => void
  query: string
  onQueryChange: (q: string) => void
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
      {/* Sticky search — stays visible at the top of the scroll area. */}
      <div className="sticky top-0 z-10 -mx-2 -mt-2 border-b border-border-soft bg-bg-2/95 px-2 py-1.5 backdrop-blur">
        <div
          className="flex items-center gap-1.5 border border-border-soft bg-bg-1 px-2 py-1 focus-within:border-accent-500/60"
          style={{ borderRadius: 'var(--radius-sm)' }}
        >
          <Search size={11} strokeWidth={1.75} className="shrink-0 text-text-4" />
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="filter commands…"
            className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-text-1 placeholder:text-text-4 focus:outline-none"
          />
          {query.length > 0 ? (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="shrink-0 text-text-4 hover:text-text-1"
              title="clear filter"
              aria-label="clear filter"
            >
              <X size={11} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </div>

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

function statusAccent(status?: 'running' | 'success' | 'error'): string {
  switch (status) {
    case 'running':
      return '#fbbf24'
    case 'success':
      return '#2ecc71'
    case 'error':
      return '#ff4d5d'
    default:
      return '#ff6b4d'
  }
}
