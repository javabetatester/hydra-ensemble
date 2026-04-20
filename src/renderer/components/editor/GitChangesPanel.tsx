import { useEffect, useMemo } from 'react'
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

export default function GitChangesPanel({ cwd }: Props) {
  const {
    files,
    selectedPath,
    diff,
    selectedForCommit,
    message,
    loading,
    diffLoading,
    generating,
    committing,
    error,
    setCwd,
    refresh,
    selectFile,
    toggleForCommit,
    selectAllForCommit,
    clearSelection,
    setMessage,
    generateMessage,
    commit,
  } = useGitChanges()

  // Bind the panel to whichever session's worktree is active. Changes to
  // cwd wipe the store automatically (see setCwd in the store).
  useEffect(() => {
    setCwd(cwd)
  }, [cwd, setCwd])

  const allChecked = useMemo(
    () => files.length > 0 && files.every((f) => selectedForCommit.has(f.path)),
    [files, selectedForCommit]
  )
  const canCommit =
    !committing &&
    message.trim().length > 0 &&
    (selectedForCommit.size > 0 || files.some((f) => f.staged))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-soft bg-bg-2 px-3 py-2">
        <GitCommit size={12} strokeWidth={1.75} className="text-accent-400" />
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-2">
          changes
        </span>
        <span className="font-mono text-[10px] text-text-4">
          {files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : 'clean'}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || !cwd}
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

      {!cwd ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <GitCommit size={24} strokeWidth={1.25} className="text-text-4" />
          <div className="text-xs text-text-2">no active session</div>
          <div className="text-[11px] text-text-4">
            pick a session to view its git changes.
          </div>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 px-2 py-1">
            <button
              type="button"
              onClick={() => (allChecked ? clearSelection() : selectAllForCommit())}
              disabled={files.length === 0}
              className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[10px] text-text-3 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {allChecked ? (
                <CheckSquare size={11} strokeWidth={1.75} />
              ) : (
                <Square size={11} strokeWidth={1.75} />
              )}
              {allChecked ? 'unselect all' : 'select all'}
            </button>
            <span className="font-mono text-[10px] text-text-4">
              {selectedForCommit.size} picked
            </span>
          </div>

          <ul className="df-scroll max-h-48 shrink-0 overflow-y-auto border-b border-border-soft">
            {files.length === 0 ? (
              <li className="px-3 py-6 text-center text-[11px] text-text-4">
                working tree clean
              </li>
            ) : (
              files.map((f) => {
                const meta = STATUS_META[f.status]
                const picked = selectedForCommit.has(f.path)
                const active = f.path === selectedPath
                return (
                  <li
                    key={f.path}
                    className={`flex items-center gap-1.5 px-2 py-1 text-[11px] ${
                      active ? 'bg-bg-3' : 'hover:bg-bg-3/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleForCommit(f.path)
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
                      onClick={() => void selectFile(f.path)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <span
                        className={`w-3 shrink-0 font-mono text-[10px] font-semibold ${meta.cls}`}
                      >
                        {meta.label}
                      </span>
                      <span
                        className={`truncate font-mono ${
                          active ? 'text-text-1' : 'text-text-2'
                        }`}
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
              <DiffView diff={diff} fill emptyLabel={selectedPath ? 'no textual diff' : 'select a file'} />
            )}
          </div>

          <div className="shrink-0 border-t border-border-soft bg-bg-2 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-4">
                commit message
              </span>
              <button
                type="button"
                onClick={() => void generateMessage()}
                disabled={generating || !cwd}
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
        </>
      )}
    </div>
  )
}
