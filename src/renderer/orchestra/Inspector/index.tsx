import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useOrchestra } from '../state/orchestra'
import { defaultAgentColor } from '../../lib/agent'
import IdentityTab from './IdentityTab'
import RuntimeTab from './RuntimeTab'
import SoulTab from './SoulTab'
import SkillsTab from './SkillsTab'
import TriggersTab from './TriggersTab'

/**
 * Right-hand Inspector drawer for a single selected agent.
 *
 * Slides in when `inspectorOpen && selectedAgentIds.length === 1` — any other
 * selection cardinality hides it, since the drawer is strictly single-agent
 * (multi-select gets a different affordance on the canvas, not here).
 */

type TabKey = 'identity' | 'soul' | 'skills' | 'triggers' | 'runtime'

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'identity', label: 'identity' },
  { key: 'soul', label: 'soul' },
  { key: 'skills', label: 'skills' },
  { key: 'triggers', label: 'triggers' },
  { key: 'runtime', label: 'runtime' }
]

export default function Inspector() {
  const inspectorOpen = useOrchestra((s) => s.inspectorOpen)
  const selectedAgentIds = useOrchestra((s) => s.selectedAgentIds)
  const agents = useOrchestra((s) => s.agents)
  const setInspectorOpen = useOrchestra((s) => s.setInspectorOpen)

  // Active tab is session-local; resets to identity when the selected agent
  // changes so you don't land on a tab that's meaningless for the new one.
  const [activeTab, setActiveTab] = useState<TabKey>('identity')

  const agent = useMemo(() => {
    if (selectedAgentIds.length !== 1) return null
    const id = selectedAgentIds[0]
    return agents.find((a) => a.id === id) ?? null
  }, [selectedAgentIds, agents])

  // Reset the tab whenever the selected agent changes — prevents sticky state
  // where opening agent B still shows agent A's runtime tab scroll position.
  useEffect(() => {
    setActiveTab('identity')
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
      className={`fixed right-0 top-0 z-40 flex h-full w-[360px] flex-col border-l border-border-soft bg-bg-2 shadow-pop transition-transform duration-200 ease-out ${
        visible ? 'translate-x-0' : 'translate-x-full pointer-events-none'
      }`}
      aria-hidden={!visible}
      role="complementary"
      aria-label="agent inspector"
    >
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

          <nav
            className="flex shrink-0 items-center gap-0.5 border-b border-border-soft bg-bg-2 px-2 py-1.5"
            role="tablist"
            aria-label="inspector sections"
          >
            {TABS.map((t) => {
              const selected = activeTab === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(t.key)}
                  className={`rounded-sm px-2 py-1 text-[11px] font-medium lowercase transition ${
                    selected
                      ? 'bg-accent-500/15 text-accent-400'
                      : 'text-text-3 hover:bg-bg-3 hover:text-text-1'
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </nav>

          <div className="df-scroll min-h-0 flex-1 overflow-y-auto">
            {activeTab === 'identity' && (
              <IdentityTab agent={agent} onSwitchTab={(k) => setActiveTab(k)} />
            )}
            {activeTab === 'soul' && <SoulTab agentId={agent.id} />}
            {activeTab === 'skills' && <SkillsTab agentId={agent.id} />}
            {activeTab === 'triggers' && <TriggersTab agentId={agent.id} />}
            {activeTab === 'runtime' && <RuntimeTab agent={agent} />}
          </div>
        </>
      ) : null}
    </aside>
  )
}

/** Exported so the IdentityTab can request a tab switch in a type-safe way. */
export type InspectorTabKey = TabKey
