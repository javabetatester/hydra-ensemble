/**
 * CanvasToolbar — vertical stack of floating canvas actions anchored to the
 * bottom-LEFT of the Orchestra canvas. Matches the visual language of
 * CanvasFabs (round buttons, hover-slide tooltip) so the two corners look
 * like siblings. Actions:
 *
 *  - Fit view
 *  - Auto-layout
 *  - Templates (opens TeamTemplatesDialog)
 *
 * Lives OUTSIDE the ReactFlowProvider, so `fit-view` is dispatched via a
 * custom window event the Canvas bridges to fitView() internally.
 */
import { useCallback, useMemo, useState } from 'react'
import { Maximize2, Network, Wand2 } from 'lucide-react'
import type { Agent, ReportingEdge, UUID } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'
import TeamTemplatesDialog from './TeamTemplatesDialog'

interface Props {}

/** Horizontal and vertical spacing for the hierarchical auto-layout.
 *  Wide enough to keep AgentCard edges clear of each other at 1x zoom. */
const LAYOUT_X_STEP = 260
const LAYOUT_Y_STEP = 200

export default function CanvasToolbar(_props: Props) {
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const agents = useOrchestra((s) => s.agents)
  const edges = useOrchestra((s) => s.edges)
  const updateAgent = useOrchestra((s) => s.updateAgent)

  const [templatesOpen, setTemplatesOpen] = useState(false)

  const teamAgents = useMemo(
    () => (activeTeamId ? agents.filter((a) => a.teamId === activeTeamId) : []),
    [agents, activeTeamId]
  )
  const teamEdges = useMemo(
    () => (activeTeamId ? edges.filter((e) => e.teamId === activeTeamId) : []),
    [edges, activeTeamId]
  )

  const hasGraph = teamAgents.length > 0

  const onFit = useCallback((): void => {
    window.dispatchEvent(new CustomEvent('orchestra:fit-view'))
  }, [])

  const onAutoLayout = useCallback(async (): Promise<void> => {
    if (!hasGraph) return
    const next = computeHierarchicalLayout(teamAgents, teamEdges)
    const writes: Array<Promise<void>> = []
    for (const agent of teamAgents) {
      const target = next.get(agent.id)
      if (!target) continue
      if (
        Math.round(target.x) === Math.round(agent.position.x) &&
        Math.round(target.y) === Math.round(agent.position.y)
      )
        continue
      writes.push(
        updateAgent({
          id: agent.id,
          patch: { position: { x: target.x, y: target.y } }
        })
      )
    }
    await Promise.all(writes)
  }, [hasGraph, teamAgents, teamEdges, updateAgent])

  return (
    <>
      <div className="pointer-events-none absolute bottom-4 left-4 z-30 flex flex-col items-start gap-2">
        <ToolbarButton
          label="Fit to screen"
          shortcutHint="⌘0"
          onClick={onFit}
          aria-label="Fit to screen"
        >
          <Maximize2 size={16} strokeWidth={1.75} />
        </ToolbarButton>

        <ToolbarButton
          label="Auto-layout"
          disabled={!hasGraph}
          disabledTooltip="Add agents first"
          onClick={() => void onAutoLayout()}
          aria-label="Auto-layout the canvas"
        >
          <Network size={16} strokeWidth={1.75} />
        </ToolbarButton>

        <ToolbarButton
          label="Templates"
          onClick={() => setTemplatesOpen(true)}
          aria-label="Open team templates"
        >
          <Wand2 size={16} strokeWidth={1.75} />
        </ToolbarButton>
      </div>

      <TeamTemplatesDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
      />
    </>
  )
}

interface ToolbarButtonProps {
  label: string
  shortcutHint?: string
  disabled?: boolean
  disabledTooltip?: string
  onClick: () => void
  'aria-label': string
  children: React.ReactNode
}

function ToolbarButton({
  label,
  shortcutHint,
  disabled = false,
  disabledTooltip,
  onClick,
  'aria-label': ariaLabel,
  children
}: ToolbarButtonProps) {
  const tooltipText = disabled && disabledTooltip ? disabledTooltip : label

  return (
    <div className="group pointer-events-auto relative flex items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border-mid bg-bg-2 text-text-1 shadow-pop transition hover:bg-bg-3 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-bg-2"
      >
        {children}
      </button>

      {/* Right-side slide-out tooltip (mirrors CanvasFabs which slides left). */}
      <div
        className="pointer-events-none absolute left-full ml-2 flex translate-x-1 items-center gap-1.5 whitespace-nowrap rounded-full border border-border-soft bg-bg-2 px-2.5 py-1 text-[11px] text-text-1 opacity-0 shadow-pop transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100"
        role="tooltip"
      >
        <span>{tooltipText}</span>
        {!disabled && shortcutHint ? (
          <span className="rounded-sm border border-border-soft bg-bg-1 px-1 py-[1px] font-mono text-[10px] text-text-3">
            {shortcutHint}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** Longest-path leveling with left-to-right placement per level. */
function computeHierarchicalLayout(
  agents: Agent[],
  edges: ReportingEdge[]
): Map<UUID, { x: number; y: number }> {
  const level = new Map<UUID, number>()
  for (const a of agents) level.set(a.id, 0)

  // Iterate BFS-ish: propagate children to max(parent+1, current).
  let changed = true
  let guard = 0
  while (changed && guard < agents.length + 2) {
    changed = false
    for (const e of edges) {
      const parentLvl = level.get(e.parentAgentId) ?? 0
      const childLvl = level.get(e.childAgentId) ?? 0
      const want = parentLvl + 1
      if (want > childLvl) {
        level.set(e.childAgentId, want)
        changed = true
      }
    }
    guard++
  }

  // Bucket by level, sort within by createdAt.
  const buckets = new Map<number, Agent[]>()
  for (const a of agents) {
    const lvl = level.get(a.id) ?? 0
    const bucket = buckets.get(lvl) ?? []
    bucket.push(a)
    buckets.set(lvl, bucket)
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  const positions = new Map<UUID, { x: number; y: number }>()
  for (const [lvl, list] of buckets) {
    list.forEach((a, idx) => {
      positions.set(a.id, {
        x: idx * LAYOUT_X_STEP,
        y: lvl * LAYOUT_Y_STEP
      })
    })
  }
  return positions
}
