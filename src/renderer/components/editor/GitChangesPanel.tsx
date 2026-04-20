import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckSquare,
  GitCommit,
  Loader2,
  RefreshCw,
  Sparkles,
  Square,
} from 'lucide-react'
import type { ChangedFile } from '../../../shared/types'
import DiffView from './DiffView'

interface Props {
  cwd: string | null
}

const STATUS_META: Record<ChangedFile['status'], { label: string; cls: string }> = {
  modified: { label: 'M', cls: 'text-status-input' },
  added: { label: 'A', cls: 'text-status-generating' },
  deleted: { label: 'D', cls: 'text-status-attention' },
  renamed: { label: 'R', cls: 'text-accent-400' },
  untracked: { label: 'U', cls: 'text-text-3' },
}

/**
 * Self-contained git changes panel. Deliberately holds ALL its state in
 * React (no zustand store, no cross-module subscriptions) so the failure
 * modes are local and obvious. Every async op is guarded by a generation
 * counter so late responses from a superseded fetch don't stomp newer
 * UI state — that was the class of bug that used to leave the header
 * spinner stuck forever after the user clicked Refresh a few times.
 */
export default function GitChangesPanel({ cwd }: Props) {
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [message, setMessage] = useState<string>('')

  const [loading, setLoading] = useState<boolean>(false)
  const [diffLoading, setDiffLoading] = useState<boolean>(false)
  const [generating, setGenerating] = useState<boolean>(false)
  const [committing, setCommitting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Request generations — every async call captures the current value and
  // bails when it's superseded. Survives the component's lifetime.
  const statusGen = useRef(0)
  const diffGen = useRef(0)

  // ---------- loaders ----------

  const loadStatus = useCallback(async (): Promise<void> => {
    if (!cwd) {
      console.log('[Changes] loadStatus skipped — no cwd')
      return
    }
    const gen = ++statusGen.current
    console.log('[Changes] loadStatus START', { cwd, gen })
    setLoading(true)
    setError(null)

    // Safety watchdog — if the await hasn't returned in 8s, force-clear
    // loading so the UI stops spinning no matter what. Also logs so we
    // know the IPC never came back.
    const watchdog = setTimeout(() => {
      if (gen !== statusGen.current) return
      console.warn('[Changes] loadStatus WATCHDOG fired — forcing loading=false', { gen })
      setError('git status did not return within 8s')
      setLoading(false)
    }, 8000)

    try {
      const t0 = performance.now()
      const res = await window.api.git.listChangedFiles(cwd)
      const ms = Math.round(performance.now() - t0)
      console.log('[Changes] loadStatus IPC returned', {
        gen,
        ms,
        ok: res.ok,
        count: res.ok ? res.value.length : -1,
      })
      if (gen !== statusGen.current) {
        console.log('[Changes] loadStatus superseded, dropping', { gen, current: statusGen.current })
        return
      }
      if (!res.ok) {
        setError(res.error)
        setFiles([])
        return
      }
      setFiles(res.value)
      setPicked((prev) => {
        const live = new Set(res.value.map((f) => f.path))
        let changed = false
        const next = new Set<string>()
        for (const p of prev) {
          if (live.has(p)) next.add(p)
          else changed = true
        }
        return changed ? next : prev
      })
      setSelectedPath((prev) => (prev && res.value.some((f) => f.path === prev) ? prev : null))
      console.log('[Changes] loadStatus state updated', { gen })
    } catch (err) {
      console.error('[Changes] loadStatus threw', err)
      if (gen !== statusGen.current) return
      setError((err as Error).message)
    } finally {
      clearTimeout(watchdog)
      if (gen === statusGen.current) {
        setLoading(false)
        console.log('[Changes] loadStatus DONE', { gen })
      }
    }
  }, [cwd])

  const loadDiff = useCallback(
    async (path: string): Promise<void> => {
      if (!cwd) return
      const gen = ++diffGen.current
      setDiffLoading(true)
      try {
        const file = files.find((f) => f.path === path)
        const useStaged = file?.staged === true
        const res = await window.api.git.getDiff(cwd, path, useStaged)
        if (gen !== diffGen.current) return
        if (!res.ok) {
          setDiff('')
          setError(res.error)
          return
        }
        setDiff(res.value)
      } catch (err) {
        if (gen !== diffGen.current) return
        setError((err as Error).message)
      } finally {
        if (gen === diffGen.current) setDiffLoading(false)
      }
    },
    [cwd, files]
  )

  // ---------- effects ----------

  // Reset local state when cwd changes. Does NOT auto-fetch anymore —
  // the user has to click Refresh to populate. This was load-bearing for
  // a freeze investigation: doing any async work on mount was exercising
  // a code path we still haven't fully isolated, so the panel now opens
  // completely inert.
  useEffect(() => {
    statusGen.current += 1
    diffGen.current += 1
    setFiles([])
    setSelectedPath(null)
    setDiff('')
    setPicked(new Set())
    setMessage('')
    setError(null)
  }, [cwd])

  // Load the diff whenever the selected path changes. No-op when nothing
  // is selected — the diff pane just shows the empty-state label.
  useEffect(() => {
    if (!selectedPath) {
      setDiff('')
      setDiffLoading(false)
      return
    }
    void loadDiff(selectedPath)
  }, [selectedPath, loadDiff])

  // ---------- derived ----------

  const allPicked = useMemo(
    () => files.length > 0 && files.every((f) => picked.has(f.path)),
    [files, picked]
  )
  const hasStaged = useMemo(() => files.some((f) => f.staged), [files])
  const canCommit = !committing && message.trim().length > 0 && (picked.size > 0 || hasStaged)

  // ---------- actions ----------

  const togglePick = useCallback((path: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setPicked(new Set(files.map((f) => f.path)))
  }, [files])

  const clearAll = useCallback(() => {
    setPicked(new Set())
  }, [])

  const onGenerate = useCallback(async (): Promise<void> => {
    if (!cwd || generating) return
    setGenerating(true)
    setError(null)
    try {
      const res = await window.api.git.generateCommitMessage(cwd)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setMessage(res.value)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGenerating(false)
    }
  }, [cwd, generating])

  const onCommit = useCallback(async (): Promise<void> => {
    if (!cwd) return
    const msg = message.trim()
    if (msg.length === 0) {
      setError('commit message cannot be empty')
      return
    }
    setCommitting(true)
    setError(null)
    try {
      if (picked.size > 0) {
        const stageRes = await window.api.git.stageFiles(cwd, [...picked])
        if (!stageRes.ok) {
          setError(stageRes.error)
          return
        }
      }
      const res = await window.api.git.commit(cwd, msg)
      if (!res.ok) {
        setError(res.error)
        return
      }
      // Commit succeeded — reset inputs, reload status to reflect the new HEAD.
      setMessage('')
      setPicked(new Set())
      await loadStatus()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCommitting(false)
    }
  }, [cwd, message, picked, loadStatus])

  // ---------- render ----------

  if (!cwd) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <Header hasCwd={false} loading={false} onRefresh={() => undefined} />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <GitCommit size={24} strokeWidth={1.25} className="text-text-4" />
          <div className="text-xs text-text-2">no active session</div>
          <div className="text-[11px] text-text-4">
            pick a session to view its git changes.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header hasCwd loading={loading} count={files.length} onRefresh={() => void loadStatus()} />

      <div className="flex shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 px-2 py-1">
        <button
          type="button"
          onClick={() => (allPicked ? clearAll() : selectAll())}
          disabled={files.length === 0}
          className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[10px] text-text-3 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {allPicked ? (
            <CheckSquare size={11} strokeWidth={1.75} />
          ) : (
            <Square size={11} strokeWidth={1.75} />
          )}
          {allPicked ? 'unselect all' : 'select all'}
        </button>
        <span className="font-mono text-[10px] text-text-4">{picked.size} picked</span>
      </div>

      <ul className="df-scroll max-h-48 shrink-0 overflow-y-auto border-b border-border-soft">
        {files.length === 0 ? (
          <li className="px-3 py-6 text-center text-[11px] text-text-4">
            working tree clean
          </li>
        ) : (
          files.map((f) => {
            const meta = STATUS_META[f.status]
            const isPicked = picked.has(f.path)
            const isActive = f.path === selectedPath
            return (
              <li
                key={f.path}
                className={`flex items-center gap-1.5 px-2 py-1 text-[11px] ${
                  isActive ? 'bg-bg-3' : 'hover:bg-bg-3/60'
                }`}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePick(f.path)
                  }}
                  className="shrink-0 rounded-sm p-0.5 text-text-3 hover:text-text-1"
                  aria-label={isPicked ? 'Unpick from commit' : 'Pick for commit'}
                >
                  {isPicked ? (
                    <CheckSquare size={12} strokeWidth={1.75} className="text-accent-400" />
                  ) : (
                    <Square size={12} strokeWidth={1.75} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPath(f.path)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <span className={`w-3 shrink-0 font-mono text-[10px] font-semibold ${meta.cls}`}>
                    {meta.label}
                  </span>
                  <span
                    className={`truncate font-mono ${isActive ? 'text-text-1' : 'text-text-2'}`}
                    title={f.path}
                  >
                    {f.path}
                  </span>
                  {f.staged ? (
                    <span
                      className="ml-auto shrink-0 rounded-sm bg-status-generating/15 px-1 font-mono text-[9px] uppercase tracking-[0.12em] text-status-generating"
                      title="already staged"
                    >
                      staged
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })
        )}
      </ul>

      <div className="min-h-0 flex-1 overflow-hidden bg-bg-1 p-2">
        {diffLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-[11px] text-text-3">
            <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
            loading diff…
          </div>
        ) : (
          <DiffView
            diff={diff}
            fill
            emptyLabel={selectedPath ? 'no textual diff' : 'select a file to view the diff'}
          />
        )}
      </div>

      <div className="shrink-0 border-t border-border-soft bg-bg-2 p-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-4">
            commit message
          </span>
          <button
            type="button"
            onClick={() => void onGenerate()}
            disabled={generating}
            className="flex items-center gap-1 rounded-sm border border-accent-500/40 bg-accent-500/10 px-2 py-0.5 font-mono text-[10px] text-accent-200 transition hover:bg-accent-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            title="Generate with Claude"
          >
            {generating ? (
              <Loader2 size={10} strokeWidth={1.75} className="animate-spin" />
            ) : (
              <Sparkles size={10} strokeWidth={1.75} />
            )}
            {generating ? 'drafting…' : 'generate with AI'}
          </button>
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="type a message or click Generate with AI"
          className="df-scroll w-full resize-none rounded-sm border border-border-soft bg-bg-1 px-2 py-1.5 font-mono text-[11.5px] text-text-1 placeholder:text-text-4 focus:border-accent-500/60 focus:outline-none"
        />
        {error ? (
          <div className="mt-1.5 flex items-start gap-1.5 rounded-sm border border-status-attention/40 bg-status-attention/10 px-2 py-1 font-mono text-[10px] text-status-attention">
            <AlertCircle size={11} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => void onCommit()}
          disabled={!canCommit}
          className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-sm bg-accent-500 px-2 py-1.5 font-mono text-[11px] font-semibold text-white transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {committing ? (
            <Loader2 size={11} strokeWidth={2} className="animate-spin" />
          ) : (
            <Check size={11} strokeWidth={2} />
          )}
          {committing ? 'committing…' : 'commit'}
        </button>
      </div>
    </div>
  )
}

function Header({
  hasCwd,
  loading,
  count,
  onRefresh,
}: {
  hasCwd: boolean
  loading: boolean
  count?: number
  onRefresh: () => void
}) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border-soft bg-bg-2 px-3 py-2">
      <GitCommit size={12} strokeWidth={1.75} className="text-accent-400" />
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-2">
        changes
      </span>
      {hasCwd ? (
        <span className="font-mono text-[10px] text-text-4">
          {count && count > 0 ? `${count} file${count > 1 ? 's' : ''}` : 'clean'}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading || !hasCwd}
        className="ml-auto rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1 disabled:opacity-40"
        title="Refresh"
        aria-label="Refresh changes"
      >
        {loading ? (
          <Loader2 size={11} strokeWidth={1.75} className="animate-spin" />
        ) : (
          <RefreshCw size={11} strokeWidth={1.75} />
        )}
      </button>
    </header>
  )
}
