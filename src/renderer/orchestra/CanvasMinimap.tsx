/**
 * CanvasMinimap — compact mini-map overlay for the Orchestra canvas.
 *
 * Wraps `@xyflow/react`'s `MiniMap` so we can theme it with project Tailwind
 * tokens and toggle it via local state (persisted in localStorage). Must be
 * rendered as a CHILD of `<ReactFlow>` so the MiniMap can consume the
 * ReactFlow context.
 *
 * The overlay sits in the bottom-right corner and carries a small "EyeOff"
 * button to hide it. To resurrect the minimap later (e.g. from a settings
 * menu), call the exported `showMinimap()` helper which clears the persisted
 * flag and dispatches `orchestra:minimap-show`.
 */
import { useEffect, useState } from 'react'
import { EyeOff } from 'lucide-react'
import { MiniMap, type Node } from '@xyflow/react'

const STORAGE_KEY = 'hydra.orchestra.minimap.visible'
const SHOW_EVENT = 'orchestra:minimap-show'

/** Reset the persisted flag and notify mounted minimap instances to show
 *  themselves again. Safe to call from anywhere. */
export function showMinimap(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true')
  } catch {
    /* localStorage unavailable — still dispatch the event so in-memory
     *  instances update. */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SHOW_EVENT))
  }
}

function readInitialVisible(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return true
    return raw !== 'false'
  } catch {
    return true
  }
}

// React-Flow gives us the raw node in `nodeColor`; in Orchestra every node
// carries the underlying agent in `data.agent`, with an optional `color`.
interface AgentNodeData {
  agent?: { color?: string | null }
}

function nodeColor(node: Node): string {
  const data = node.data as AgentNodeData | undefined
  return data?.agent?.color ?? 'var(--color-accent-500)'
}

interface Props {}

export default function CanvasMinimap(_props: Props) {
  const [visible, setVisible] = useState<boolean>(readInitialVisible)

  // Listen for resurrection requests from elsewhere (e.g. a settings menu
  // that calls `showMinimap()`).
  useEffect(() => {
    const onShow = (): void => setVisible(true)
    window.addEventListener(SHOW_EVENT, onShow)
    return () => window.removeEventListener(SHOW_EVENT, onShow)
  }, [])

  const hide = (): void => {
    setVisible(false)
    try {
      localStorage.setItem(STORAGE_KEY, 'false')
    } catch {
      /* ignore persistence failures; in-memory hide still works */
    }
  }

  if (!visible) return null

  return (
    <div className="relative">
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        nodeColor={nodeColor}
        nodeStrokeWidth={2}
        maskColor="rgba(14, 14, 16, 0.5)"
        style={{
          width: 180,
          height: 120,
          background: 'var(--color-bg-2)',
          border: '1px solid var(--color-border-mid)',
          borderRadius: 'var(--radius-sm, 6px)'
        }}
      />

      {/* Hide button — overlaid on the minimap's top-right corner.
       *  The MiniMap itself is absolutely positioned by react-flow; we match
       *  its placement with a sibling anchored to the same corner. */}
      <button
        type="button"
        onClick={hide}
        aria-label="hide minimap"
        title="Hide minimap"
        className="absolute bottom-[108px] right-1 z-10 flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm,4px)] border border-[var(--color-border-mid)] bg-[var(--color-bg-2)] text-[var(--color-text-3)] opacity-80 transition hover:bg-[var(--color-bg-3)] hover:text-[var(--color-text-1)] hover:opacity-100"
        style={{ marginRight: 16, marginBottom: 16 }}
      >
        <EyeOff size={12} strokeWidth={2} />
      </button>
    </div>
  )
}
