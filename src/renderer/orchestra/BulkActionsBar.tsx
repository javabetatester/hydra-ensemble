/**
 * BulkActionsBar — floating pill toolbar that surfaces bulk operations when
 * the user has 2+ agent cards selected on the canvas. Rendered at the top
 * center below the TeamOverview bar. Self-contained: pulls selection and
 * mutation actions straight from `useOrchestra`.
 *
 * Keyboard: `Esc` while visible clears the selection (matches the usual
 * "dismiss selection" muscle memory). Listener is scoped so it only attaches
 * when there are 2+ selected ids.
 *
 * While any bulk action is in-flight, every button is disabled to avoid
 * interleaving mutations against the store.
 */
import { useEffect, useState } from 'react'
import { Pause, Square, Trash2, XSquare, X } from 'lucide-react'
import { useOrchestra } from './state/orchestra'

interface Props {}

export default function BulkActionsBar(_props: Props) {
  const selectedAgentIds = useOrchestra((s) => s.selectedAgentIds)
  const deleteAgent = useOrchestra((s) => s.deleteAgent)
  const pauseAgent = useOrchestra((s) => s.pauseAgent)
  const stopAgent = useOrchestra((s) => s.stopAgent)
  const clearSelection = useOrchestra((s) => s.clearSelection)

  const [busy, setBusy] = useState(false)

  const visible = selectedAgentIds.length >= 2
  const count = selectedAgentIds.length

  useEffect(() => {
    if (selectedAgentIds.length <= 1) return

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedAgentIds.length, clearSelection])

  if (!visible) return null

  const handlePauseAll = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      for (const id of selectedAgentIds) {
        await pauseAgent(id)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleStopAll = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      for (const id of selectedAgentIds) {
        await stopAgent(id)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteAll = async (): Promise<void> => {
    if (busy) return
    const ids = [...selectedAgentIds]
    const confirmed = window.confirm(`Delete ${ids.length} agents?`)
    if (!confirmed) return
    setBusy(true)
    try {
      for (const id of ids) {
        await deleteAgent(id)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleClear = (): void => {
    if (busy) return
    clearSelection()
  }

  const buttonCls =
    'flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-text-2 hover:bg-bg-3 hover:text-text-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-2'

  const dangerCls =
    'flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-danger-400 hover:bg-danger-500/10 hover:text-danger-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-danger-400'

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-[56px] z-30 flex -translate-x-1/2 items-center gap-2 rounded-sm border border-border-mid bg-bg-2/95 px-3 py-1.5 shadow-pop backdrop-blur-md"
      role="toolbar"
      aria-label="Bulk agent actions"
    >
      <span className="rounded-sm px-1.5 py-0.5 text-[11px] font-medium text-accent-400">
        {count} selected
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handlePauseAll}
          disabled={busy}
          className={buttonCls}
          aria-label="Pause all selected agents"
        >
          <Pause size={12} strokeWidth={2} />
          <span>Pause all</span>
        </button>

        <button
          type="button"
          onClick={handleStopAll}
          disabled={busy}
          className={buttonCls}
          aria-label="Stop all selected agents"
        >
          <Square size={12} strokeWidth={2} />
          <span>Stop all</span>
        </button>

        <button
          type="button"
          onClick={handleDeleteAll}
          disabled={busy}
          className={dangerCls}
          aria-label="Delete all selected agents"
        >
          <Trash2 size={12} strokeWidth={2} />
          <span>Delete all</span>
        </button>

        <button
          type="button"
          onClick={handleClear}
          disabled={busy}
          className={buttonCls}
          aria-label="Clear selection"
        >
          <XSquare size={12} strokeWidth={2} />
          <span>Clear</span>
        </button>

        <button
          type="button"
          onClick={handleClear}
          disabled={busy}
          className={buttonCls}
          aria-label="Close bulk actions bar"
          title="Clear selection"
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
