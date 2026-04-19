import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ExternalLink,
  GitPullRequest,
  Info,
  Loader2,
  RefreshCw,
  X
} from 'lucide-react'
import { useGh } from '../state/gh'
import type { PRCheck, PRInfo } from '../../shared/types'

const REFRESH_MS = 5 * 60 * 1000

function StateBadge({ state, isDraft }: { state: PRInfo['state']; isDraft: boolean }) {
  let cls = 'bg-status-generating/15 text-status-generating'
  let label: string = state.toLowerCase()
  if (isDraft) {
    cls = 'bg-bg-4 text-text-3'
    label = 'draft'
  } else if (state === 'MERGED') {
    cls = 'bg-accent-500/20 text-accent-200'
  } else if (state === 'CLOSED') {
    cls = 'bg-status-attention/15 text-status-attention'
  }
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  )
}

function CheckRow({ c }: { c: PRCheck }) {
  let dot = 'bg-text-4'
  if (c.conclusion === 'success') dot = 'bg-status-generating'
  else if (c.conclusion === 'failure' || c.conclusion === 'cancelled')
    dot = 'bg-status-attention'
  else if (c.status === 'in_progress' || c.status === 'queued')
    dot = 'bg-status-thinking'
  else if (c.conclusion === 'skipped') dot = 'bg-text-4'
  return (
    <div className="flex items-center gap-2 truncate text-xs text-text-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="truncate">{c.name}</span>
      <span className="ml-auto shrink-0 text-text-4">{c.conclusion ?? c.status}</span>
    </div>
  )
}

function DiffView({ diff }: { diff: string }) {
  const lines = useMemo(() => diff.split('\n'), [diff])
  return (
    <pre className="df-scroll max-h-80 overflow-auto rounded-md border border-border-soft bg-bg-1 p-3 font-mono text-xs leading-snug">
      {lines.map((line, i) => {
        let cls = 'text-text-2'
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-status-generating'
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-status-attention'
        else if (line.startsWith('@@')) cls = 'text-status-input'
        else if (line.startsWith('diff ')) cls = 'text-accent-400'
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

interface Props {
  cwd: string | null
  open: boolean
  onClose: () => void
  mode?: 'inline' | 'overlay'
}

export default function PRInspector({ cwd, open, onClose }: Props) {
  const [showExplainer, setShowExplainer] = useState(false)
  const stateCwd = useGh((s) => s.cwd)
  const prs = useGh((s) => s.prs)
  const loading = useGh((s) => s.loading)
  const error = useGh((s) => s.error)
  const selected = useGh((s) => s.selected)
  const selectedLoading = useGh((s) => s.selectedLoading)
  const expandedNumber = useGh((s) => s.expandedNumber)
  const openPanel = useGh((s) => s.openPanel)
  const closePanel = useGh((s) => s.closePanel)
  const refresh = useGh((s) => s.refresh)
  const selectPR = useGh((s) => s.selectPR)
  const collapsePR = useGh((s) => s.collapsePR)

  // Sync open prop → store; reset selection when cwd changes.
  useEffect(() => {
    if (open && cwd && cwd !== stateCwd) {
      openPanel(cwd)
    } else if (!open) {
      closePanel()
    }
  }, [open, cwd, stateCwd, openPanel, closePanel])

  useEffect(() => {
    if (!open) return
    const id = window.setInterval(() => {
      void refresh()
    }, REFRESH_MS)
    return () => window.clearInterval(id)
  }, [open, refresh])

  if (!open) return null

  const ghMissing = error?.includes('not installed')

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-bg-2">
      <header className="flex shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <GitPullRequest size={14} strokeWidth={1.75} className="text-accent-400" />
          <span className="font-semibold text-text-1">pull requests</span>
          {prs.length > 0 && (
            <span className="font-mono text-[10px] text-text-4">· {prs.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowExplainer((v) => !v)}
            className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-[10px] text-text-4 hover:bg-bg-3 hover:text-text-1"
            title="what is the PR inspector?"
          >
            <Info size={11} strokeWidth={1.75} />
            what?
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-sm p-1.5 text-text-3 hover:bg-bg-3 hover:text-text-1 disabled:opacity-40"
            title="refresh"
            aria-label="refresh"
          >
            {loading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} strokeWidth={1.75} />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1.5 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="close"
            title="Esc"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {showExplainer ? (
        <div className="border-b border-border-soft bg-bg-1 px-4 py-3 text-[11px] leading-relaxed text-text-3">
          <p className="mb-1.5">
            <strong className="text-text-2">PR Inspector</strong> — lists the current repo's pull
            requests via the GitHub CLI (
            <code className="rounded-sm bg-bg-3 px-1 font-mono">gh</code>) without leaving Hydra.
          </p>
          <p className="mb-1.5">
            Click a PR to expand it and see the <strong>description</strong>,{' '}
            <strong>diff</strong> (colour-coded +/− lines) and <strong>checks</strong> (CI, lint,
            tests) with a status dot per check.
          </p>
          <p>
            Handy when an agent just opened a PR and you want a quick look before approving or
            merging. Requires <code className="rounded-sm bg-bg-3 px-1 font-mono">gh auth login</code>{' '}
            done once on your machine.
          </p>
        </div>
      ) : null}
      <div className="df-scroll min-h-0 flex-1 overflow-y-auto">
        {ghMissing && (
          <div className="m-4 rounded-md border border-status-thinking/30 bg-status-thinking/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-status-thinking">
              <AlertCircle size={14} strokeWidth={1.75} />
              gh CLI not installed
            </div>
            <div className="mt-1.5 text-xs text-text-3">
              Install from{' '}
              <a
                className="text-accent-400 hover:underline"
                href="https://cli.github.com"
                target="_blank"
                rel="noreferrer"
              >
                cli.github.com
              </a>
              , then run <code className="font-mono text-text-2">gh auth login</code>.
            </div>
          </div>
        )}
        {!ghMissing && error && (
          <div className="m-4 flex items-start gap-2 rounded-md border border-status-attention/30 bg-status-attention/10 px-3 py-2 text-sm text-status-attention">
            <AlertCircle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <div className="break-words">{error}</div>
          </div>
        )}
        {prs.length === 0 && !loading && !error && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
            <GitPullRequest size={32} strokeWidth={1.25} className="text-text-4" />
            <div className="text-sm text-text-2">No pull requests</div>
            <div className="text-xs text-text-4">
              This repository has no open PRs to inspect.
            </div>
          </div>
        )}
        {loading && prs.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-3">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        )}
        <div className="flex flex-col gap-1.5 p-3">
          {prs.map((pr) => {
            const expanded = pr.number === expandedNumber
            return (
              <div
                key={pr.number}
                className={`overflow-hidden rounded-md border transition ${
                  expanded
                    ? 'border-border-mid bg-bg-3'
                    : 'border-border-soft bg-bg-3 hover:border-border-mid hover:bg-bg-4'
                }`}
              >
                <button
                  type="button"
                  onClick={() => (expanded ? collapsePR() : void selectPR(pr.number))}
                  className="flex w-full flex-col gap-1.5 px-3 py-2.5 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-text-4">#{pr.number}</span>
                    <StateBadge state={pr.state} isDraft={pr.isDraft} />
                    <span className="ml-auto truncate text-[11px] text-text-4">
                      {pr.author}
                    </span>
                  </div>
                  <div className="truncate text-sm text-text-1">{pr.title}</div>
                </button>
                {expanded && (
                  <div className="space-y-3 border-t border-border-soft bg-bg-2 p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-mono text-[11px] text-text-4">
                        {pr.headRefName} → {pr.baseRefName}
                      </div>
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-[11px] text-accent-400 hover:underline"
                      >
                        Open <ExternalLink size={11} strokeWidth={1.75} />
                      </a>
                    </div>
                    {selectedLoading && (
                      <div className="flex items-center gap-1.5 text-xs text-text-3">
                        <Loader2 size={12} className="animate-spin" /> Loading…
                      </div>
                    )}
                    {selected && (
                      <>
                        {selected.body && (
                          <div className="whitespace-pre-wrap text-xs leading-relaxed text-text-2">
                            {selected.body}
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <div className="text-[11px] uppercase tracking-wide text-text-4">
                            Checks
                          </div>
                          {selected.checks.length === 0 && (
                            <div className="text-xs text-text-4">No checks reported</div>
                          )}
                          {selected.checks.map((c, i) => (
                            <CheckRow key={`${c.name}-${i}`} c={c} />
                          ))}
                        </div>
                        {selected.diff && <DiffView diff={selected.diff} />}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
