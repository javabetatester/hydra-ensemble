import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useOrchestra } from '../state/orchestra'
import { defaultAgentColor } from '../../lib/agent'
import {
  useInspectorSize,
  INSPECTOR_WIDTH_MIN,
  INSPECTOR_WIDTH_MAX
} from '../../state/panels'
import IdentityTab from './IdentityTab'
import RuntimeTab from './RuntimeTab'
import SoulTab from './SoulTab'
import SkillsTab from './SkillsTab'
import TriggersTab from './TriggersTab'
import InboxTab from './InboxTab'
import OverviewTab from './OverviewTab'
import { Tabs, type TabDef } from '../../ui'

/**
 * Right-hand Inspector drawer for a single selected agent.
 *
 * Slides in when `inspectorOpen && selectedAgentIds.length === 1` — any other
 * selection cardinality hides it, since the drawer is strictly single-agent
 * (multi-select gets a different affordance on the canvas, not here).
 */

type TabKey =
  | 'overview'
  | 'identity'
  | 'soul'
  | 'skills'
  | 'triggers'
  | 'inbox'
  | 'runtime'

// `prompt` and `console` used to be separate tabs but were pure debug
// surfaces (system-prompt preview, raw runner logs) that crowded the
// nav without earning their space for day-to-day users. Runtime keeps
// the live message log and the pause/stop controls; inbox keeps task
// messaging. Prompt/console files stay on disk so we can re-surface
// them behind a dev affordance later without a rewrite.
const TABS: ReadonlyArray<TabDef<TabKey>> = [
  { key: 'overview', label: 'overview' },
  { key: 'identity', label: 'identity' },
  { key: 'soul', label: 'soul' },
  { key: 'skills', label: 'skills' },
  { key: 'triggers', label: 'triggers' },
  { key: 'inbox', label: 'inbox' },
  { key: 'runtime', label: 'runtime' }
]

export default function Inspector() {
  const inspectorOpen = useOrchestra((s) => s.inspectorOpen)
  const selectedAgentIds = useOrchestra((s) => s.selectedAgentIds)
  const agents = useOrchestra((s) => s.agents)
  const setInspectorOpen = useOrchestra((s) => s.setInspectorOpen)
  const width = useInspectorSize((s) => s.width)
  const setWidth = useInspectorSize((s) => s.setWidth)

  // Drag-to-resize handle on the LEFT edge. Mouse-only; a touch variant
  // would need pointermove which adds capture-phase complexity and no
  // real Orchestra user runs this on tablet anyway.
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const onResizeStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startW: width }
      const onMove = (ev: MouseEvent): void => {
        if (!dragRef.current) return
        // Dragging LEFT widens the panel because the panel is anchored
        // to the right edge of the viewport.
        const delta = dragRef.current.startX - ev.clientX
        setWidth(dragRef.current.startW + delta)
      }
      const onUp = (): void => {
        dragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [width, setWidth]
  )

  // Active tab is session-local; resets to identity when the selected agent
  // changes so you don't land on a tab that's meaningless for the new one.
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  const agent = useMemo(() => {
    if (selectedAgentIds.length !== 1) return null
    const id = selectedAgentIds[0]
    return agents.find((a) => a.id === id) ?? null
  }, [selectedAgentIds, agents])

  // Reset the tab whenever the selected agent changes — prevents sticky state
  // where opening agent B still shows agent A's runtime tab scroll position.
  useEffect(() => {
    setActiveTab('overview')
  }, [agent?.id])

  // Esc closes the drawer. Scoped to when it's actually open so the listener
  // doesn't eat Esc on other parts of the app.
  useEffect(() => {
    if (!inspectorOpen || !agent) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setInspectorOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspectorOpen, agent, setInspectorOpen])

  const visible = inspectorOpen && agent !== null

  return (
    <aside
      data-coach="inspector"
      data-tour-id="orchestra-inspector"
      style={{ width }}
      className={`fixed right-0 top-0 z-40 flex h-full flex-col border-l border-border-soft bg-bg-2 shadow-pop transition-transform duration-200 ease-out ${
        visible ? 'translate-x-0' : 'translate-x-full pointer-events-none'
      }`}
      aria-hidden={!visible}
      role="complementary"
      aria-label="agent inspector"
    >
      {/* Left-edge drag handle for resize. 6px hit area, 1px visible on
          hover; cursor flips to ew-resize so the affordance is obvious. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="resize inspector"
        aria-valuemin={INSPECTOR_WIDTH_MIN}
        aria-valuemax={INSPECTOR_WIDTH_MAX}
        aria-valuenow={width}
        onMouseDown={onResizeStart}
        className="group absolute left-0 top-0 z-50 h-full w-1.5 -translate-x-1/2 cursor-ew-resize"
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent-500/60" />
      </div>
      {agent ? (
        <>
          <header className="flex shrink-0 items-center justify-between border-b border-border-soft bg-bg-1 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="block h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: agent.color || defaultAgentColor(agent.id) }}
                aria-hidden
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-text-1">{agent.name}</div>
                <div className="truncate font-mono text-[10px] text-text-4">
                  {agent.role || 'no role'} · /{agent.id.slice(0, 8)}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setInspectorOpen(false)}
              className="rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1"
              aria-label="close inspector"
              title="Esc"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </header>

          <Tabs
            tabs={TABS}
            value={activeTab}
            onChange={setActiveTab}
            ariaLabel="inspector sections"
            scroll
          />

          <div className="df-scroll min-h-0 flex-1 overflow-y-auto">
            {activeTab === 'overview' && (
              <OverviewTab agent={agent} onSwitchTab={(k) => setActiveTab(k)} />
            )}
            {activeTab === 'identity' && (
              <IdentityTab agent={agent} onSwitchTab={(k) => setActiveTab(k)} />
            )}
            {activeTab === 'soul' && <SoulTab agentId={agent.id} />}
            {activeTab === 'skills' && <SkillsTab agentId={agent.id} />}
            {activeTab === 'triggers' && <TriggersTab agentId={agent.id} />}
            {activeTab === 'inbox' && <InboxTab agent={agent} />}
            {activeTab === 'runtime' && <RuntimeTab agent={agent} />}
          </div>
        </>
      ) : null}
    </aside>
  )
}

/** Exported so the IdentityTab can request a tab switch in a type-safe way. */
export type InspectorTabKey = TabKey
