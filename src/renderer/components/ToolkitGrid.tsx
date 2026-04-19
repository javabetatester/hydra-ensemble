import { Wrench, Settings2, Loader2, AlertCircle, Check, ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useToolkit } from '../state/toolkit'
import type { ToolkitItem } from '../../shared/types'
import { ToolkitIcon, guessIconForLabel } from '../lib/toolkit-icons'
import { hexAlpha } from '../lib/agent'

interface Props {
  cwd: string | null
  projectName?: string
  branch?: string
}

export default function ToolkitGrid({ cwd, projectName, branch }: Props) {
  const items = useToolkit((s) => s.items)
  const runs = useToolkit((s) => s.runs)
  const run = useToolkit((s) => s.run)
  const openEditor = useToolkit((s) => s.openEditor)

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

  return (
    <section className="flex h-full flex-col border-l border-t border-border-soft bg-bg-2">
      <header className="flex shrink-0 items-center justify-between border-b border-border-soft px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Wrench size={14} strokeWidth={1.75} className="text-accent-400" />
          <span className="font-semibold text-text-1">Toolkit</span>
          {projectName ? (
            <span className="flex min-w-0 items-center gap-1 truncate text-xs text-text-3">
              <span className="text-text-4">·</span>
              <span className="truncate font-mono">{projectName}</span>
              {branch ? (
                <>
                  <span className="text-text-4">·</span>
                  <span className="truncate font-mono text-text-3">{branch}</span>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={openEditor}
          className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-3 px-2 py-1 text-[11px] text-text-2 transition hover:border-accent-500/50 hover:bg-bg-4 hover:text-text-1"
          title="edit toolkit commands"
        >
          <Settings2 size={11} strokeWidth={1.75} />
          edit
        </button>
      </header>

      <div className="df-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Wrench size={26} strokeWidth={1.25} className="text-text-4" />
            <div className="text-sm text-text-2">no toolkit items</div>
            <button
              type="button"
              onClick={openEditor}
              className="mt-1 rounded-sm bg-accent-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-600"
            >
              add your first command
            </button>
          </div>
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
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-border-soft px-3 py-1.5 font-mono text-[10px] text-text-4">
        <span>{items.length} commands</span>
        <span>{cwd ? '✓ project ready' : 'pick a project to enable'}</span>
      </footer>
    </section>
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
