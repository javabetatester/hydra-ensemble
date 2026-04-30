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
import { useNewTaskDialog } from '../state/newTaskDialog'
import { AgentCard, type AgentNode } from './AgentCard'
import { ReportingEdge, type ReportingEdgeType } from './ReportingEdge'
import { NewAgentPopover } from './modals/NewAgentPopover'
import CanvasMinimap from './CanvasMinimap'

/** Orchestra canvas: react-flow surface for the active team, shortcuts,
 *  new-agent popover, and debounced position write-through. */

const GRID = 16
const POSITION_DEBOUNCE_MS = 200

/** Build a react-flow node for an agent (module-scope for stable refs). */
function toRFNode(agent: Agent, isMain: boolean, selected: boolean): AgentNode {
  return {
    id: agent.id,
    type: 'agent',
    position: agent.position,
    data: { agent, isMain },
    selected,
    draggable: true
  }
}

function toRFEdge(edge: ReportingEdgeT): ReportingEdgeType {
  return {
    id: edge.id,
    type: 'reporting',
    source: edge.parentAgentId,
    target: edge.childAgentId,
    // Pin handles so the edge descends parent-bottom → child-top.
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

  const { fitView, screenToFlowPosition, setViewport, getViewport } =
    useReactFlow()

  // Active team's main agent id drives the crown.
  const mainAgentId = useMemo<UUID | null>(() => {
    const t = teams.find((x) => x.id === activeTeamId)
    return t?.mainAgentId ?? null
  }, [teams, activeTeamId])

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

  // Sync local react-flow state when domain changes.
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

  // Flush pending position writes on unmount.
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

  // Change handlers: persist on drag-end only (debounced).
  const onNodesChange = useCallback(
    (changes: NodeChange<AgentNode>[]): void => {
      setNodes((curr) => applyNodeChanges(changes, curr))
      for (const change of changes) {
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

      // Auto-orient parent→child by y-position; 8px tie-breaker honors intent.
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

      // Pin handles so arrow descends parent-bottom → child-top regardless
      // of which side the user dragged from.
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

  // New-agent popover.
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

  /** Pane-only double-click (filter out nodes/edges/controls). */
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

  /** Right-click on empty pane opens the New Agent popover at the cursor. */
  const onPaneContextMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent): void => {
      e.preventDefault()
      openPopoverAt(e.clientX, e.clientY)
    },
    [openPopoverAt]
  )

  // Middle-click pan: react-flow's built-in only fires when mousedown lands
  // on the pane layer; AgentCards swallow it. Capture-phase listener on
  // the wrapper translates the viewport directly so the gesture works
  // regardless of what's under the cursor.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    let panning = false
    let lastX = 0
    let lastY = 0

    const onDown = (e: MouseEvent): void => {
      if (e.button !== 1) return
      e.preventDefault(); e.stopPropagation()
      panning = true; lastX = e.clientX; lastY = e.clientY
      document.body.style.cursor = 'grabbing'
    }
    const onMove = (e: MouseEvent): void => {
      if (!panning) return
      const dx = e.clientX - lastX; const dy = e.clientY - lastY
      lastX = e.clientX; lastY = e.clientY
      const vp = getViewport()
      setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom })
    }
    const onUp = (e: MouseEvent): void => {
      if (e.button !== 1 || !panning) return
      panning = false
      document.body.style.cursor = ''
    }
    // Suppress browser auto-scroll cursor on middle-click.
    const onAux = (e: MouseEvent): void => { if (e.button === 1) e.preventDefault() }

    wrapper.addEventListener('mousedown', onDown, true)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    wrapper.addEventListener('auxclick', onAux, true)
    return () => {
      wrapper.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      wrapper.removeEventListener('auxclick', onAux, true)
      document.body.style.cursor = ''
    }
  }, [getViewport, setViewport])

  // Shift+scroll = horizontal pan. Non-passive capture so we pre-empt RF.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.shiftKey) return
      if (e.ctrlKey || e.metaKey) return
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY
      const vp = getViewport()
      setViewport({ x: vp.x - delta, y: vp.y, zoom: vp.zoom })
    }
    wrapper.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      wrapper.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
    }
  }, [getViewport, setViewport])

  // Keyboard shortcuts (window-level; inInput guard frees form typing).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const inInput =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      if (e.key === 'Escape') {
        if (inInput) return
        let handled = false
        if (popover) { closePopover(); handled = true }
        if (selectedAgentIds.length > 0) { clearSelection(); handled = true }
        if (handled) e.preventDefault()
        return
      }

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

      if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey)) {
        if (inInput) return
        if (e.altKey || e.shiftKey) return
        e.preventDefault()
        // Select every agent in the active team (append after a clear).
        clearSelection()
        for (const a of teamAgents) selectAgent(a.id, true)
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
        // The legacy TaskBar component used to capture this — it has
        // since been retired. Open the canonical NewTaskDialog
        // instead so '/' on the canvas keeps its "start typing a
        // task" intent.
        useNewTaskDialog.getState().show()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    selectedAgentIds,
    deleteAgent,
    clearSelection,
    openPopoverCenter,
    fitView,
    popover,
    closePopover,
    teamAgents,
    selectAgent
  ])

  // Bridge orchestra:fit-view events from CanvasToolbar (outside provider).
  useEffect(() => {
    const onFitRequest = (): void => {
      fitView({ duration: 200 })
    }
    window.addEventListener('orchestra:fit-view', onFitRequest)
    return () => window.removeEventListener('orchestra:fit-view', onFitRequest)
  }, [fitView])

  // Memoised type maps — prevents react-flow node/edge remounts on rerender.
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

  // TODO(hover-hint): 500ms hover on AgentCard bottom handle should show
  // "drag down to manage a new agent". Needs data-hint="drop-target" on
  // the Handle in AgentCard.tsx + a CSS rule — both outside this file.

  return (
    <div
      ref={wrapperRef}
      data-coach="canvas"
      data-tour-id="orchestra-canvas"
      className="relative h-full w-full outline-none"
      onDoubleClick={onWrapperDoubleClick}
      style={
        {
          // Map RF css vars onto Hydra tokens so the canvas inherits theme.
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
        onPaneContextMenu={onPaneContextMenu}
        zoomOnDoubleClick={false}
        snapToGrid
        snapGrid={[GRID, GRID]}
        minZoom={0.25}
        maxZoom={2}
        fitView
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        panOnDrag={[1, 2]}
        selectionOnDrag
      >
        <Background gap={GRID} size={1} />
        <Controls
          position="top-right"
          showInteractive={false}
          className="!bg-[var(--color-bg-2)] !border !border-[var(--color-border-mid)]"
        />
        <CanvasMinimap />
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

/** Wraps CanvasInner in ReactFlowProvider so useReactFlow hooks work. */
export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}

export default Canvas
