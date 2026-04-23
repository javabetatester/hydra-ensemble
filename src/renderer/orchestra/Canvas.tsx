import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent
} from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  useNodesState,
  useEdgesState,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type EdgeTypes,
  type NodeChange,
  type EdgeChange,
  type NodeTypes,
  type Node as RFNode,
  type Edge as RFEdge
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type {
  Agent,
  ReportingEdge as ReportingEdgeT,
  UUID
} from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'
import { useToasts } from '../state/toasts'
import { AgentCard, type AgentNode } from './AgentCard'
import { ReportingEdge, type ReportingEdgeType } from './ReportingEdge'
import { NewAgentPopover } from './modals/NewAgentPopover'

/**
 * Orchestra canvas.
 *
 * Owns the react-flow surface for the active team: node ↔ agent mapping,
 * edge ↔ reporting-edge mapping, shortcuts (A/⌘0/Delete/Backspace//), the
 * new-agent popover placement, and the debounced write-through for node
 * position changes. See PRD §11–§13 and PLAN §9 for the contract.
 */

const GRID = 16
const POSITION_DEBOUNCE_MS = 200

/** Build the react-flow node for an agent. Kept in module scope so equality
 *  checks in `useMemo` below are predictable. */
function toRFNode(agent: Agent, isMain: boolean, selected: boolean): AgentNode {
  return {
    id: agent.id,
    type: 'agent',
    position: agent.position,
    data: { agent, isMain },
    selected,
    // react-flow's own drag handle is the whole card; inner buttons stop
    // propagation where needed.
    draggable: true
  }
}

function toRFEdge(edge: ReportingEdgeT): ReportingEdgeType {
  return {
    id: edge.id,
    type: 'reporting',
    source: edge.parentAgentId,
    target: edge.childAgentId,
    // Pin handles so the edge always descends from the parent's bottom to
    // the child's top (see onConnect for the full rationale).
    sourceHandle: 's-s',
    targetHandle: 'n-t',
    data: { delegationMode: edge.delegationMode },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: 'var(--color-border-hard)'
    }
  }
}

function CanvasInner() {
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const allAgents = useOrchestra((s) => s.agents)
  const allEdges = useOrchestra((s) => s.edges)
  const teams = useOrchestra((s) => s.teams)
  const selectedAgentIds = useOrchestra((s) => s.selectedAgentIds)
  const updateAgent = useOrchestra((s) => s.updateAgent)
  const deleteEdge = useOrchestra((s) => s.deleteEdge)
  const createEdge = useOrchestra((s) => s.createEdge)
  const deleteAgent = useOrchestra((s) => s.deleteAgent)
  const selectAgent = useOrchestra((s) => s.selectAgent)
  const clearSelection = useOrchestra((s) => s.clearSelection)
  const setInspectorOpen = useOrchestra((s) => s.setInspectorOpen)
  const pushToast = useToasts((s) => s.push)

  const { fitView, screenToFlowPosition } = useReactFlow()

  // The active team's main agent id drives the crown. Lookup is cheap and
  // rebuilding the node array on every main change is the correct trigger.
  const mainAgentId = useMemo<UUID | null>(() => {
    const t = teams.find((x) => x.id === activeTeamId)
    return t?.mainAgentId ?? null
  }, [teams, activeTeamId])

  // Filter domain state to the active team and derive react-flow arrays.
  const teamAgents = useMemo(
    () => allAgents.filter((a) => a.teamId === activeTeamId),
    [allAgents, activeTeamId]
  )
  const teamEdges = useMemo(
    () => allEdges.filter((e) => e.teamId === activeTeamId),
    [allEdges, activeTeamId]
  )

  const derivedNodes = useMemo<AgentNode[]>(
    () =>
      teamAgents.map((a) =>
        toRFNode(a, a.id === mainAgentId, selectedAgentIds.includes(a.id))
      ),
    [teamAgents, mainAgentId, selectedAgentIds]
  )
  const derivedEdges = useMemo<ReportingEdgeType[]>(
    () => teamEdges.map(toRFEdge),
    [teamEdges]
  )

  const [nodes, setNodes] = useNodesState<AgentNode>(derivedNodes)
  const [edges, setEdges] = useEdgesState<ReportingEdgeType>(derivedEdges)

  // Sync local react-flow nodes/edges when the domain changes. We avoid
  // replacing the array during an active drag: `position` changes we don't
  // own flow through and would snap the dragged card mid-gesture.
  useEffect(() => {
    setNodes(derivedNodes)
  }, [derivedNodes, setNodes])
  useEffect(() => {
    setEdges(derivedEdges)
  }, [derivedEdges, setEdges])

  // ------------------------------------------------------------------------
  // Debounced position write-through
  // ------------------------------------------------------------------------

  const pendingPositions = useRef<
    Map<UUID, { x: number; y: number; timer: ReturnType<typeof setTimeout> }>
  >(new Map())

  const flushPosition = useCallback(
    (id: UUID): void => {
      const entry = pendingPositions.current.get(id)
      if (!entry) return
      pendingPositions.current.delete(id)
      void updateAgent({
        id,
        patch: { position: { x: entry.x, y: entry.y } }
      })
    },
    [updateAgent]
  )

  const schedulePositionWrite = useCallback(
    (id: UUID, x: number, y: number): void => {
      const existing = pendingPositions.current.get(id)
      if (existing) clearTimeout(existing.timer)
      const timer = setTimeout(() => flushPosition(id), POSITION_DEBOUNCE_MS)
      pendingPositions.current.set(id, { x, y, timer })
    },
    [flushPosition]
  )

  // On unmount, flush anything still pending so a fast navigation doesn't
  // silently drop the last drag.
  useEffect(() => {
    const pending = pendingPositions.current
    return () => {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer)
        void updateAgent({
          id,
          patch: { position: { x: entry.x, y: entry.y } }
        })
      }
      pending.clear()
    }
  }, [updateAgent])

  // ------------------------------------------------------------------------
  // Change handlers
  // ------------------------------------------------------------------------

  const onNodesChange = useCallback(
    (changes: NodeChange<AgentNode>[]): void => {
      setNodes((curr) => applyNodeChanges(changes, curr))
      for (const change of changes) {
        // react-flow emits `dragging: true` continuously during a drag and
        // then a final event with `dragging: false` on mouse-up. We only
        // persist on drag-end so we don't storm IPC with per-pixel writes,
        // but we still debounce in case a second drag starts quickly.
        if (
          change.type === 'position' &&
          change.position &&
          change.dragging === false
        ) {
          schedulePositionWrite(
            change.id,
            change.position.x,
            change.position.y
          )
        }
      }
    },
    [setNodes, schedulePositionWrite]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<ReportingEdgeType>[]): void => {
      setEdges((curr) => applyEdgeChanges(changes, curr))
      for (const change of changes) {
        if (change.type === 'remove') {
          void deleteEdge(change.id)
        }
      }
    },
    [setEdges, deleteEdge]
  )

  const onConnect = useCallback(
    async (params: Connection): Promise<void> => {
      if (!activeTeamId || !params.source || !params.target) return

      // Auto-orient: the reporting line points parent -> child, so whichever
      // agent is visually higher on the canvas becomes the parent no matter
      // which direction the user dragged from. 8px tie-breaker keeps same-row
      // drags honoring the user's intent.
      const sourceNode = teamAgents.find((a) => a.id === params.source)
      const targetNode = teamAgents.find((a) => a.id === params.target)
      const shouldSwap =
        !!sourceNode &&
        !!targetNode &&
        sourceNode.position.y > targetNode.position.y + 8

      const parentId = shouldSwap ? params.target : params.source
      const childId = shouldSwap ? params.source : params.target

      if (parentId === childId) {
        pushToast({
          kind: 'error',
          title: 'Cannot connect agent to itself'
        })
        return
      }

      // Force the edge's anchors to the parent's bottom-source and the child's
      // top-target. This keeps the arrow visually descending (parent on top,
      // arrow pointing down to child) regardless of which handle the user
      // happened to grab — otherwise swapping source/target ids without
      // swapping the handles leaves the edge drawn from the wrong side,
      // which is exactly the "ele liga EM CIMA do CEO" bug the user reported.
      setEdges(
        (curr) =>
          addEdge(
            {
              source: parentId,
              target: childId,
              sourceHandle: 's-s',
              targetHandle: 'n-t',
              type: 'reporting',
              data: { delegationMode: 'auto' as const },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 14,
                height: 14,
                color: 'var(--color-border-hard)'
              }
            },
            curr
          ) as ReportingEdgeType[]
      )
      const created = await createEdge({
        teamId: activeTeamId,
        parentAgentId: parentId,
        childAgentId: childId
      })
      if (!created) {
        setEdges((curr) =>
          curr.filter(
            (e) =>
              !(
                e.source === parentId &&
                e.target === childId &&
                !teamEdges.some((te) => te.id === e.id)
              )
          )
        )
      }
    },
    [activeTeamId, createEdge, setEdges, pushToast, teamEdges, teamAgents]
  )

  const onNodeClick = useCallback(
    (event: ReactMouseEvent, node: RFNode): void => {
      selectAgent(node.id, event.shiftKey)
      setInspectorOpen(true)
    },
    [selectAgent, setInspectorOpen]
  )

  const onPaneClick = useCallback(() => {
    clearSelection()
  }, [clearSelection])

  // ------------------------------------------------------------------------
  // New-agent popover
  // ------------------------------------------------------------------------

  interface PopoverState {
    screen: { x: number; y: number }
    flow: { x: number; y: number }
  }
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const openPopoverAt = useCallback(
    (clientX: number, clientY: number): void => {
      if (!activeTeamId) return
      const flow = screenToFlowPosition({ x: clientX, y: clientY })
      setPopover({
        screen: { x: clientX, y: clientY },
        flow: {
          x: Math.round(flow.x / GRID) * GRID,
          y: Math.round(flow.y / GRID) * GRID
        }
      })
    },
    [activeTeamId, screenToFlowPosition]
  )

  /** React-flow has no native `onPaneDoubleClick`. We listen on the wrapper
   *  and accept only events whose target lives on the pane layer — nodes,
   *  edges and controls are filtered out. */
  const onWrapperDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>): void => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const onPane = target.classList.contains('react-flow__pane')
      if (!onPane) return
      openPopoverAt(e.clientX, e.clientY)
    },
    [openPopoverAt]
  )

  const openPopoverCenter = useCallback((): void => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (!rect) return
    openPopoverAt(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }, [openPopoverAt])

  const closePopover = useCallback(() => setPopover(null), [])

  // ------------------------------------------------------------------------
  // Keyboard shortcuts
  // ------------------------------------------------------------------------

  // Bind at window level so the shortcuts work even when the canvas
  // wrapper hasn't been clicked/focused yet. The target-tagname guard
  // below keeps typing inside inputs / textareas / contenteditables
  // (Inspector tabs, AgentCard rename, TaskBar) free of hijacks.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const inInput =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAgentIds.length > 0) {
        if (inInput) return
        e.preventDefault()
        if (selectedAgentIds.length > 1) {
          const ok = window.confirm(
            `Delete ${selectedAgentIds.length} agents? This cannot be undone.`
          )
          if (!ok) return
        }
        for (const id of selectedAgentIds) void deleteAgent(id)
        clearSelection()
        return
      }

      if (e.key === 'a' || e.key === 'A') {
        if (inInput) return
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
        e.preventDefault()
        openPopoverCenter()
        return
      }

      if (e.key === '0' && (e.metaKey || e.ctrlKey)) {
        if (inInput) return
        e.preventDefault()
        fitView({ duration: 200 })
        return
      }

      if (e.key === '/') {
        if (inInput) return
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('orchestra:focus-task-bar'))
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedAgentIds, deleteAgent, clearSelection, openPopoverCenter, fitView])

  // ------------------------------------------------------------------------
  // Type registration — memoised so react-flow does not remount nodes/edges
  // on every parent render. This is called out in the react-flow docs and
  // is the most common source of "why do my nodes flicker" bugs.
  // ------------------------------------------------------------------------

  const nodeTypes = useMemo<NodeTypes>(() => ({ agent: AgentCard }), [])
  const edgeTypes = useMemo<EdgeTypes>(() => ({ reporting: ReportingEdge }), [])

  const defaultEdgeOptions = useMemo<Partial<RFEdge>>(
    () => ({
      type: 'reporting',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: 'var(--color-border-hard)'
      }
    }),
    []
  )

  return (
    <div
      ref={wrapperRef}
      data-coach="canvas"
      className="relative h-full w-full outline-none"
      onDoubleClick={onWrapperDoubleClick}
      style={
        {
          // react-flow reads these CSS vars via its own stylesheet; we map
          // them onto Hydra's tokens so the canvas inherits dark theme
          // without shipping a separate theme file.
          ['--xy-background-color' as string]: 'var(--color-bg-0)',
          ['--xy-background-pattern-color' as string]:
            'var(--color-border-soft)',
          ['--xy-edge-stroke' as string]: 'var(--color-border-hard)',
          ['--xy-edge-stroke-selected' as string]: 'var(--color-accent-500)',
          ['--xy-controls-button-background-color' as string]:
            'var(--color-bg-2)',
          ['--xy-controls-button-color' as string]: 'var(--color-text-2)',
          ['--xy-controls-button-border-color' as string]:
            'var(--color-border-mid)'
        } as CSSProperties
      }
    >
      <ReactFlow<AgentNode, ReportingEdgeType>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        zoomOnDoubleClick={false}
        snapToGrid
        snapGrid={[GRID, GRID]}
        minZoom={0.25}
        maxZoom={2}
        fitView
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        // We own Delete/Backspace via onKeyDownCanvas — letting react-flow
        // also bind them causes double-handling (agent deleted + edge
        // deleted in the same press).
        panOnDrag={[1, 2]}
        selectionOnDrag
      >
        <Background gap={GRID} size={1} />
        <Controls
          showInteractive={false}
          className="!bg-[var(--color-bg-2)] !border !border-[var(--color-border-mid)]"
        />
      </ReactFlow>

      {popover && activeTeamId ? (
        <NewAgentPopover
          open
          onClose={closePopover}
          position={popover.screen}
          flowPosition={popover.flow}
          teamId={activeTeamId}
        />
      ) : null}
    </div>
  )
}

/** Public entry: wraps `CanvasInner` in a `ReactFlowProvider` so hooks like
 *  `useReactFlow` work. OrchestraView mounts one Canvas per team swap, so
 *  keeping the provider here (instead of at app root) is safe. */
export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}

export default Canvas
