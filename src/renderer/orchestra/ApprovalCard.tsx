/**
 * ApprovalCard — inline timeline card for `approval_request` MessageLog entries.
 *
 * Parses the entry's JSON payload `{ tool, args, timeoutAt }`, renders the
 * tool invocation shell-style, shows a live countdown, and exposes Allow /
 * Deny buttons. On timeout the card flips to an "EXPIRED" state and Allow
 * is disabled.
 *
 * See PRD.md §16 (safeMode) and §10.F6 — the parent TaskDrawer injects the
 * actual approve/deny handlers; wiring them to main-side IPC is a later task.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle, X } from 'lucide-react'
import type { MessageLog } from '../../shared/orchestra'

interface Props {
  entry: MessageLog
  onApprove: () => Promise<void>
  onDeny: () => Promise<void>
}

interface ParsedPayload {
  tool: string
  args: unknown
  timeoutAt: number
}

/** Best-effort parse of the approval_request content. Tolerant of missing
 *  fields: callers may emit partial payloads during development, and the
 *  fallback pre-block below renders anything we can't decode. */
function tryParse(content: string): ParsedPayload | null {
  try {
    const obj = JSON.parse(content) as Record<string, unknown>
    if (typeof obj.tool !== 'string') return null
    if (typeof obj.timeoutAt !== 'number') return null
    return {
      tool: obj.tool,
      args: obj.args,
      timeoutAt: obj.timeoutAt
    }
  } catch {
    return null
  }
}

/** Formats remaining ms as M:SS. Clamps at zero. */
function formatRemaining(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms / 1000))
  const min = Math.floor(clamped / 60)
  const sec = clamped % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

/** Renders args as `arg1 arg2` for strings / string[], else falls back to
 *  a JSON dump. The goal is to read the card like a shell invocation. */
function renderArgs(args: unknown): string {
  if (typeof args === 'string') return args
  if (Array.isArray(args) && args.every((a) => typeof a === 'string')) {
    return (args as string[]).join(' ')
  }
  try {
    return JSON.stringify(args)
  } catch {
    return String(args)
  }
}

export default function ApprovalCard({ entry, onApprove, onDeny }: Props) {
  const parsed = useMemo(() => tryParse(entry.content), [entry.content])

  // Keep a ticking `now` so the countdown updates every second. We store the
  // timestamp (not the remaining ms) so rerenders stay in lockstep with the
  // wall clock — avoids drift if the tab was backgrounded.
  const [now, setNow] = useState<number>(() => Date.now())
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [finished, setFinished] = useState<'approved' | 'denied' | null>(null)

  useEffect(() => {
    if (!parsed) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [parsed])

  // Fallback: raw content block when the payload doesn't parse.
  if (!parsed) {
    return (
      <div className="rounded-md border border-border-mid bg-bg-2 p-3">
        <div className="df-label mb-1.5 text-amber-400">approval required</div>
        <pre className="df-scroll whitespace-pre-wrap break-words font-mono text-[11px] leading-snug text-text-2">
          {entry.content}
        </pre>
      </div>
    )
  }

  const remaining = parsed.timeoutAt - now
  const expired = remaining <= 0
  const disabled = busy !== null || finished !== null || expired

  const onClickApprove = async (): Promise<void> => {
    if (disabled) return
    setBusy('approve')
    try {
      await onApprove()
      setFinished('approved')
    } finally {
      setBusy(null)
    }
  }
  const onClickDeny = async (): Promise<void> => {
    if (busy !== null || finished !== null) return
    setBusy('deny')
    try {
      await onDeny()
      setFinished('denied')
    } finally {
      setBusy(null)
    }
  }

  // Header reflects the terminal state: expired > resolved > pending.
  let headerLabel = 'approval required'
  let headerCls = 'text-amber-400'
  if (expired && !finished) {
    headerLabel = 'expired — auto-denied'
    headerCls = 'text-amber-400'
  } else if (finished === 'approved') {
    headerLabel = 'approved'
    headerCls = 'text-status-generating'
  } else if (finished === 'denied') {
    headerLabel = 'denied'
    headerCls = 'text-status-attention'
  }

  return (
    <div className="rounded-md border border-border-mid bg-bg-2 p-3">
      <div className={`df-label mb-2 flex items-center gap-1.5 ${headerCls}`}>
        {expired && !finished ? (
          <AlertTriangle size={11} strokeWidth={1.75} />
        ) : finished === 'approved' ? (
          <CheckCircle size={11} strokeWidth={1.75} />
        ) : finished === 'denied' ? (
          <X size={11} strokeWidth={2} />
        ) : (
          <AlertTriangle size={11} strokeWidth={1.75} />
        )}
        <span>{headerLabel}</span>
      </div>

      <div className="mb-2 text-[11px] text-text-3">agent wants to run:</div>

      {/* Shell-style tool invocation */}
      <pre className="mb-3 overflow-x-auto rounded-sm border border-border-soft bg-bg-1 px-2 py-1.5 font-mono text-[11px] leading-snug text-text-1">
        <span className="text-accent-500">$ </span>
        <span className="text-text-1">{parsed.tool}</span>
        <span className="text-text-2"> {renderArgs(parsed.args)}</span>
      </pre>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void onClickDeny()}
          disabled={busy !== null || finished !== null}
          className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-status-attention/40 bg-status-attention/10 px-2 text-[11px] font-semibold text-status-attention hover:bg-status-attention/20 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Deny"
        >
          <X size={11} strokeWidth={2} />
          {busy === 'deny' ? 'denying…' : 'Deny'}
        </button>
        <button
          type="button"
          onClick={() => void onClickApprove()}
          disabled={disabled}
          className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-accent-600 bg-accent-500/90 px-2 text-[11px] font-semibold text-bg-0 hover:bg-accent-500 disabled:cursor-not-allowed disabled:border-border-soft disabled:bg-bg-3 disabled:text-text-4"
          title={expired ? 'Timed out — Allow disabled' : 'Allow tool call'}
          aria-label="Allow"
        >
          <CheckCircle size={11} strokeWidth={1.75} />
          {busy === 'approve' ? 'allowing…' : 'Allow'}
        </button>
      </div>

      {/* Countdown / terminal message */}
      <div className="mt-2 font-mono text-[10px] text-text-4">
        {finished === 'approved'
          ? 'approved just now'
          : finished === 'denied'
            ? 'denied just now'
            : expired
              ? 'timed out'
              : `auto-deny in ${formatRemaining(remaining)}`}
      </div>
    </div>
  )
}
