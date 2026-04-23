import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Info,
  Loader2,
  MessageSquare,
  RefreshCw,
  ThumbsDown,
  X,
  XCircle
} from 'lucide-react'
import { useGh } from '../state/gh'
import type { PRCheck, PRDetail, PRInfo } from '../../shared/types'

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

// =============================================================================
// Unified diff parsing
// =============================================================================

interface DiffFile {
  /** Best-effort path (uses `b/` side; falls back to `a/` on deletes). */
  path: string
  /** Raw lines that belong to this file (including its `diff --git` header). */
  lines: string[]
  additions: number
  deletions: number
  isBinary: boolean
}

/** Split a `gh pr diff` blob into per-file chunks. */
function parseUnifiedDiff(diff: string): DiffFile[] {
  if (!diff) return []
  const files: DiffFile[] = []
  let current: DiffFile | null = null

  const flush = (): void => {
    if (current) files.push(current)
  }

  const lines = diff.split('\n')
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush()
      // `diff --git a/foo b/foo` — fall back to a/ when b/ absent (pure delete).
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
      const path = match?.[2] ?? line.replace(/^diff --git /, '')
      current = {
        path,
        lines: [line],
        additions: 0,
        deletions: 0,
        isBinary: false
      }
      continue
    }
    if (!current) continue
    current.lines.push(line)
    if (line.startsWith('Binary files ')) current.isBinary = true
    if (line.startsWith('+++ b/')) {
      const p = line.slice(6)
      if (p && p !== '/dev/null') current.path = p
    } else if (line.startsWith('--- a/') && current.path === '') {
      current.path = line.slice(6)
    }
    // Only count inside hunks; `+++`/`---` headers don't count.
    if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1
    else if (line.startsWith('-') && !line.startsWith('---')) current.deletions += 1
  }
  flush()
  return files
}

function UnifiedDiffFile({ file, defaultOpen }: { file: DiffFile; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)

  // Skip the `diff --git` header row and the `index/---/+++` prelude when rendering —
  // they're noise once we have the path + badges at the top.
  const renderable = useMemo(() => {
    const out: string[] = []
    let seenHunk = false
    for (const raw of file.lines) {
      if (!seenHunk) {
        if (raw.startsWith('@@')) {
          seenHunk = true
          out.push(raw)
        }
        continue
      }
      out.push(raw)
    }
    // Fallback: if no hunk appeared (e.g. binary or rename with no content),
    // show the metadata lines so the user still sees *something* useful.
    if (out.length === 0) return file.lines.slice(1)
    return out
  }, [file.lines])

  return (
    <div className="overflow-hidden rounded-md border border-border-soft bg-bg-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-bg-3"
      >
        {open ? (
          <ChevronDown size={12} strokeWidth={1.75} className="shrink-0 text-text-3" />
        ) : (
          <ChevronRight size={12} strokeWidth={1.75} className="shrink-0 text-text-3" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-text-2">{file.path}</span>
        {file.isBinary ? (
          <span className="shrink-0 font-mono text-[10px] uppercase text-text-4">binary</span>
        ) : (
          <>
            <span className="shrink-0 font-mono text-[11px] font-semibold text-status-generating">
              +{file.additions}
            </span>
            <span className="shrink-0 font-mono text-[11px] font-semibold text-status-attention">
              −{file.deletions}
            </span>
          </>
        )}
      </button>
      {open && (
        <pre className="df-scroll max-h-96 overflow-auto border-t border-border-soft bg-bg-1 font-mono text-[11px] leading-snug">
          {renderable.map((line, i) => {
            let rowCls = 'text-text-2'
            let marker = ' '
            if (line.startsWith('+') && !line.startsWith('+++')) {
              rowCls = 'bg-status-generating/10 text-text-1'
              marker = '+'
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              rowCls = 'bg-status-attention/10 text-text-1'
              marker = '-'
            } else if (line.startsWith('@@')) {
              rowCls = 'bg-bg-3 text-status-input'
              marker = '@'
            }
            const body = marker === ' ' ? line : line.slice(1)
            return (
              <div key={i} className={`flex ${rowCls}`}>
                <span
                  className={`w-6 shrink-0 select-none border-r border-border-soft px-2 text-right ${
                    marker === '+'
                      ? 'text-status-generating'
                      : marker === '-'
                        ? 'text-status-attention'
                        : 'text-text-4'
                  }`}
                >
                  {marker === ' ' ? '' : marker}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre px-2">{body || ' '}</span>
              </div>
            )
          })}
        </pre>
      )}
    </div>
  )
}

function DiffView({ diff }: { diff: string }) {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff])
  if (files.length === 0) {
    return (
      <pre className="df-scroll max-h-80 overflow-auto rounded-md border border-border-soft bg-bg-1 p-3 font-mono text-xs leading-snug text-text-3">
        {diff || 'No diff reported.'}
      </pre>
    )
  }
  const totalAdd = files.reduce((s, f) => s + f.additions, 0)
  const totalDel = files.reduce((s, f) => s + f.deletions, 0)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] text-text-4">
        <span>
          {files.length} file{files.length === 1 ? '' : 's'} changed
        </span>
        <span className="font-mono font-semibold text-status-generating">+{totalAdd}</span>
        <span className="font-mono font-semibold text-status-attention">−{totalDel}</span>
      </div>
      {files.map((f, i) => (
        <UnifiedDiffFile key={`${f.path}-${i}`} file={f} defaultOpen={files.length <= 3} />
      ))}
    </div>
  )
}

// =============================================================================
// Review actions
// =============================================================================

type ActionKind = 'approve' | 'request-changes' | 'comment' | 'merge' | 'close'

function ReviewActions({
  cwd,
  pr,
  onAfter
}: {
  cwd: string
  pr: PRDetail
  onAfter: () => void
}) {
  const [body, setBody] = useState('')
  const [working, setWorking] = useState<ActionKind | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionOk, setActionOk] = useState<string | null>(null)

  const locked = pr.state !== 'OPEN'
  const trimmed = body.trim()

  async function run(kind: ActionKind): Promise<void> {
    setActionError(null)
    setActionOk(null)
    setWorking(kind)
    try {
      let res: Awaited<ReturnType<typeof window.api.gh.review>>
      switch (kind) {
        case 'approve':
          res = await window.api.gh.review(cwd, pr.number, 'approve', trimmed || undefined)
          break
        case 'request-changes':
          res = await window.api.gh.review(cwd, pr.number, 'request-changes', trimmed)
          break
        case 'comment':
          res = await window.api.gh.comment(cwd, pr.number, trimmed)
          break
        case 'merge':
          res = await window.api.gh.merge(cwd, pr.number)
          break
        case 'close':
          res = await window.api.gh.close(cwd, pr.number)
          break
      }
      if (res.ok) {
        setActionOk(
          kind === 'approve'
            ? 'Approved.'
            : kind === 'request-changes'
              ? 'Changes requested.'
              : kind === 'comment'
                ? 'Comment posted.'
                : kind === 'merge'
                  ? 'Merge queued.'
                  : 'Closed.'
        )
        if (kind !== 'approve' && kind !== 'request-changes') {
          // Approve/request-changes keep the composer so you can see what you said;
          // for comment/merge/close we clear and refresh the detail.
          setBody('')
        } else {
          setBody('')
        }
        onAfter()
      } else {
        setActionError(res.error)
      }
    } finally {
      setWorking(null)
    }
  }

  if (locked) {
    return (
      <div className="rounded-md border border-border-soft bg-bg-2 px-3 py-2 text-[11px] text-text-4">
        Review actions disabled — PR is {pr.state.toLowerCase()}.
      </div>
    )
  }

  const busy = working !== null
  const needsBody = working === 'request-changes' || working === 'comment'
  const canRequestChanges = trimmed.length > 0 && !busy
  const canComment = trimmed.length > 0 && !busy

  return (
    <div className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a comment (required for 'Request changes' and 'Comment')…"
        rows={3}
        disabled={busy}
        className="df-scroll w-full resize-y rounded-md border border-border-soft bg-bg-1 px-2.5 py-2 text-xs text-text-1 placeholder:text-text-4 focus:border-accent-400 focus:outline-none disabled:opacity-50"
      />
      {actionError && (
        <div className="flex items-start gap-1.5 rounded-md border border-status-attention/30 bg-status-attention/10 px-2 py-1.5 text-[11px] text-status-attention">
          <AlertCircle size={12} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span className="break-words">{actionError}</span>
        </div>
      )}
      {actionOk && !actionError && (
        <div className="rounded-md border border-status-generating/30 bg-status-generating/10 px-2 py-1.5 text-[11px] text-status-generating">
          {actionOk}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => void run('approve')}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-status-generating/40 bg-status-generating/10 px-2.5 py-1.5 text-xs font-medium text-status-generating hover:bg-status-generating/20 disabled:opacity-50"
          title="gh pr review --approve"
        >
          {working === 'approve' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Check size={12} strokeWidth={2} />
          )}
          Approve
        </button>
        <button
          type="button"
          onClick={() => void run('request-changes')}
          disabled={!canRequestChanges}
          className="flex items-center gap-1.5 rounded-md border border-status-attention/40 bg-status-attention/10 px-2.5 py-1.5 text-xs font-medium text-status-attention hover:bg-status-attention/20 disabled:opacity-50"
          title={
            trimmed.length === 0
              ? 'A comment is required when requesting changes'
              : 'gh pr review --request-changes'
          }
        >
          {working === 'request-changes' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <ThumbsDown size={12} strokeWidth={2} />
          )}
          Request changes
        </button>
        <button
          type="button"
          onClick={() => void run('comment')}
          disabled={!canComment}
          className="flex items-center gap-1.5 rounded-md border border-border-soft bg-bg-3 px-2.5 py-1.5 text-xs font-medium text-text-1 hover:bg-bg-4 disabled:opacity-50"
          title={trimmed.length === 0 ? 'Write a comment first' : 'gh pr comment'}
        >
          {working === 'comment' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <MessageSquare size={12} strokeWidth={2} />
          )}
          Comment
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void run('merge')}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-accent-400/40 bg-accent-500/15 px-2.5 py-1.5 text-xs font-medium text-accent-200 hover:bg-accent-500/25 disabled:opacity-50"
            title="gh pr merge --auto --squash"
          >
            {working === 'merge' ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <GitMerge size={12} strokeWidth={2} />
            )}
            Merge
          </button>
          <button
            type="button"
            onClick={() => void run('close')}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-border-soft bg-bg-3 px-2.5 py-1.5 text-xs font-medium text-text-2 hover:bg-bg-4 disabled:opacity-50"
            title="gh pr close"
          >
            {working === 'close' ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <XCircle size={12} strokeWidth={2} />
            )}
            Close
          </button>
        </div>
      </div>
      {needsBody && trimmed.length === 0 && (
        <div className="text-[10px] text-text-4">This action needs a comment body.</div>
      )}
    </div>
  )
}

// =============================================================================
// Inspector
// =============================================================================

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
            <strong>diff</strong> (per-file, collapsible, colour-coded +/− lines) and{' '}
            <strong>checks</strong> (CI, lint, tests) with a status dot per check.
          </p>
          <p>
            Approve, request changes, comment, merge or close directly from here — shells out to{' '}
            <code className="rounded-sm bg-bg-3 px-1 font-mono">gh pr review/comment/merge/close</code>.
            Requires <code className="rounded-sm bg-bg-3 px-1 font-mono">gh auth login</code> done
            once on your machine.
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
                    {/* Top pane: metadata + checks */}
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

                        {/* Bottom pane: diff */}
                        <div className="space-y-1.5">
                          <div className="text-[11px] uppercase tracking-wide text-text-4">
                            Diff
                          </div>
                          <DiffView diff={selected.diff} />
                        </div>

                        {/* Review actions pinned at the bottom */}
                        {cwd && (
                          <div className="border-t border-border-soft pt-3">
                            <ReviewActions
                              cwd={cwd}
                              pr={selected}
                              onAfter={() => {
                                void selectPR(pr.number)
                                void refresh()
                              }}
                            />
                          </div>
                        )}
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
