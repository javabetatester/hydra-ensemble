import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps
} from '@xyflow/react'
import { X } from 'lucide-react'
import type { DelegationMode } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'

/**
 * Custom react-flow edge for a reporting line (parent -> child).
 *
 * Shows a centred chip with the edge's `delegationMode`. Clicking the chip
 * opens a tiny local popover to toggle between `auto` and `approve`. Wiring
 * the change into state is deferred — MVP logs the intent; the state action
 * lands in the next phase so the visual affordance is already in place.
 */

export interface ReportingEdgeData extends Record<string, unknown> {
  delegationMode: DelegationMode
}

export type ReportingEdgeType = Edge<ReportingEdgeData, 'reporting'>

function ReportingEdgeImpl(props: EdgeProps<ReportingEdgeType>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    data,
    selected
  } = props

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  })

  const mode: DelegationMode = data?.delegationMode ?? 'auto'
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const active = hovered || Boolean(selected)

  // Click-away closes the popover. Using mousedown (not click) so the
  // handler fires before a downstream onClick can reopen it.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!popoverRef.current) return
      if (!popoverRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const setMode = useCallback(
    (next: DelegationMode): void => {
      // TODO: wire to a store action. `useOrchestra` currently exposes
      // `createEdge` / `deleteEdge` but no `updateEdge` / `setEdgeDelegationMode`
      // for patching `delegationMode`. Follow-up lands the action; for now the
      // popover closes so the UX flow is exercised end-to-end.
      // eslint-disable-next-line no-console
      console.log('[orchestra] edge delegationMode change requested', {
        edgeId: id,
        from: mode,
        to: next
      })
      setOpen(false)
    },
    [id, mode]
  )

  const onDelete = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>): void => {
      e.stopPropagation()
      void useOrchestra.getState().deleteEdge(id)
    },
    [id]
  )

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: active
            ? 'var(--color-accent-500)'
            : 'var(--color-border-hard)',
          strokeWidth: active ? 2.5 : 1.5
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute z-10 flex items-center gap-1"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all'
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOpen((v) => !v)
            }}
            className={[
              'inline-flex items-center gap-1 rounded-[var(--radius-sm)]',
              'border border-[var(--color-border-mid)]',
              'bg-[var(--color-bg-3)] px-1.5 py-0.5',
              'font-mono text-[10px] uppercase tracking-wider',
              mode === 'auto'
                ? 'text-[var(--color-text-2)]'
                : 'text-[var(--color-accent-400)]'
            ].join(' ')}
            aria-label={`delegation mode ${mode}`}
          >
            {mode}
          </button>
          {active ? (
            <button
              type="button"
              onClick={onDelete}
              className={[
                'nodrag nopan inline-flex items-center justify-center',
                'rounded-[var(--radius-sm)] border border-[var(--color-border-mid)]',
                'bg-[var(--color-bg-3)] p-0.5',
                'text-[var(--color-text-2)] hover:text-red-400',
                'hover:border-red-400'
              ].join(' ')}
              aria-label="delete reporting edge"
            >
              <X size={10} strokeWidth={1.75} />
            </button>
          ) : null}
          {open ? (
            <div
              ref={popoverRef}
              className={[
                'absolute left-1/2 top-full mt-1 -translate-x-1/2',
                'min-w-[120px] rounded-[var(--radius-md)]',
                'border border-[var(--color-border-mid)]',
                'bg-[var(--color-bg-2)] p-1',
                'shadow-[var(--shadow-pop)]'
              ].join(' ')}
              role="menu"
            >
              {(['auto', 'approve'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  role="menuitemradio"
                  aria-checked={opt === mode}
                  onClick={(e) => {
                    e.stopPropagation()
                    setMode(opt)
                  }}
                  className={[
                    'block w-full rounded-[var(--radius-sm)] px-2 py-1 text-left',
                    'font-mono text-[11px]',
                    opt === mode
                      ? 'bg-[var(--color-bg-4)] text-[var(--color-text-1)]'
                      : 'text-[var(--color-text-2)] hover:bg-[var(--color-bg-3)]'
                  ].join(' ')}
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const ReportingEdge = memo(ReportingEdgeImpl)
ReportingEdge.displayName = 'ReportingEdge'

export default ReportingEdge
