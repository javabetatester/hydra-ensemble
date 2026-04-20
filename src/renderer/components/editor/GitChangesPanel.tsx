import { memo, useEffect } from 'react'
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
import { useGitChanges } from '../../state/gitChanges'
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
 * Root of the git changes pane. Deliberately does NOTHING besides wiring
 * the cwd and composing three independent subtrees. Each subtree picks
 * its OWN slice of the zustand store so unrelated updates (e.g. typing
 * in the commit message) don't repaint the diff viewer — the original
 * implementation pulled the whole store object and was cascading renders
 * across every keystroke, which on large diffs froze the UI.
 */
export default function GitChangesPanel({ cwd }: Props) {
  const setCwd = useGitChanges((s) => s.setCwd)
  useEffect(() => {
    setCwd(cwd)
  }, [cwd, setCwd])

  if (!cwd) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <HeaderBar hasCwd={false} />
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
      <HeaderBar hasCwd />
      <SelectionBar />
      <FileList />
      <DiffArea />
      <CommitForm />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

const HeaderBar = memo(function HeaderBar({ hasCwd }: { hasCwd: boolean }) {
  const count = useGitChanges((s) => s.files.length)
  const loading = useGitChanges((s) => s.loading)
  const refresh = useGitChanges((s) => s.refresh)
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border-soft bg-bg-2 px-3 py-2">
      <GitCommit size={12} strokeWidth={1.75} className="text-accent-400" />
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-2">
        changes
      </span>
      <span className="font-mono text-[10px] text-text-4">
        {count ? `${count} file${count > 1 ? 's' : ''}` : 'clean'}
      </span>
      <button
        type="button"
        onClick={() => void refresh()}
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
})

/* ------------------------------------------------------------------ */
/*  Select-all toolbar                                                 */
/* ------------------------------------------------------------------ */

const SelectionBar = memo(function SelectionBar() {
  const filesLength = useGitChanges((s) => s.files.length)
  const pickedSize = useGitChanges((s) => s.selectedForCommit.size)
  const allChecked = useGitChanges((s) => {
    if (s.files.length === 0) return false
    for (const f of s.files) if (!s.selectedForCommit.has(f.path)) return false
    return true
  })
  const selectAll = useGitChanges((s) => s.selectAllForCommit)
  const clearAll = useGitChanges((s) => s.clearSelection)
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 px-2 py-1">
      <button
        type="button"
        onClick={() => (allChecked ? clearAll() : selectAll())}
        disabled={filesLength === 0}
        className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[10px] text-text-3 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {allChecked ? (
          <CheckSquare size={11} strokeWidth={1.75} />
        ) : (
          <Square size={11} strokeWidth={1.75} />
        )}
        {allChecked ? 'unselect all' : 'select all'}
      </button>
      <span className="font-mono text-[10px] text-text-4">{pickedSize} picked</span>
    </div>
  )
})

/* ------------------------------------------------------------------ */
/*  File list                                                          */
/* ------------------------------------------------------------------ */

const FileList = memo(function FileList() {
  const files = useGitChanges((s) => s.files)
  if (files.length === 0) {
    return (
      <ul className="df-scroll max-h-48 shrink-0 overflow-y-auto border-b border-border-soft">
        <li className="px-3 py-6 text-center text-[11px] text-text-4">
          working tree clean
        </li>
      </ul>
    )
  }
  return (
    <ul className="df-scroll max-h-48 shrink-0 overflow-y-auto border-b border-border-soft">
      {files.map((f) => (
        <FileRow key={f.path} path={f.path} status={f.status} staged={!!f.staged} />
      ))}
    </ul>
  )
})

interface FileRowProps {
  path: string
  status: ChangedFile['status']
  staged: boolean
}

/**
 * One row per changed file. Reads ONLY the two slices it needs (its own
 * pick-state + the active selection) so repainting a single row doesn't
 * cost us a render of the whole list. Wrapped in memo with its scalar
 * props so parent re-renders skip the row entirely when its own state
 * didn't change.
 */
const FileRow = memo(function FileRow({ path, status, staged }: FileRowProps) {
  const picked = useGitChanges((s) => s.selectedForCommit.has(path))
  const active = useGitChanges((s) => s.selectedPath === path)
  const toggle = useGitChanges((s) => s.toggleForCommit)
  const select = useGitChanges((s) => s.selectFile)
  const meta = STATUS_META[status]
  return (
    <li
      className={`flex items-center gap-1.5 px-2 py-1 text-[11px] ${
        active ? 'bg-bg-3' : 'hover:bg-bg-3/60'
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggle(path)
        }}
        className="shrink-0 rounded-sm p-0.5 text-text-3 hover:text-text-1"
        aria-label={picked ? 'Unpick from commit' : 'Pick for commit'}
      >
        {picked ? (
          <CheckSquare size={12} strokeWidth={1.75} className="text-accent-400" />
        ) : (
          <Square size={12} strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        onClick={() => void select(path)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <span className={`w-3 shrink-0 font-mono text-[10px] font-semibold ${meta.cls}`}>
          {meta.label}
        </span>
        <span
          className={`truncate font-mono ${active ? 'text-text-1' : 'text-text-2'}`}
          title={path}
        >
          {path}
        </span>
        {staged ? (
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

/* ------------------------------------------------------------------ */
/*  Diff area                                                          */
/* ------------------------------------------------------------------ */

const DiffArea = memo(function DiffArea() {
  const diff = useGitChanges((s) => s.diff)
  const diffLoading = useGitChanges((s) => s.diffLoading)
  const selectedPath = useGitChanges((s) => s.selectedPath)
  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-bg-1 p-2">
      {diffLoading ? (
        <div className="flex h-full items-center justify-center gap-2 text-[11px] text-text-3">
          <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
          loading diff…
        </div>
      ) : (
        <DiffView diff={diff} fill emptyLabel={selectedPath ? 'no textual diff' : 'select a file'} />
      )}
    </div>
  )
})

/* ------------------------------------------------------------------ */
/*  Commit form                                                        */
/* ------------------------------------------------------------------ */

const CommitForm = memo(function CommitForm() {
  const message = useGitChanges((s) => s.message)
  const setMessage = useGitChanges((s) => s.setMessage)
  const generating = useGitChanges((s) => s.generating)
  const committing = useGitChanges((s) => s.committing)
  const error = useGitChanges((s) => s.error)
  const generate = useGitChanges((s) => s.generateMessage)
  const commit = useGitChanges((s) => s.commit)
  const canCommit = useGitChanges((s) => {
    if (s.committing) return false
    if (s.message.trim().length === 0) return false
    if (s.selectedForCommit.size > 0) return true
    return s.files.some((f) => f.staged)
  })
  return (
    <div className="shrink-0 border-t border-border-soft bg-bg-2 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-4">
          commit message
        </span>
        <button
          type="button"
          onClick={() => void generate()}
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
        onClick={() => void commit()}
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
  )
})
