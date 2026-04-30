/**
 * SidePanels — tabbed container for the right-column panels in OrchestraView.
 *
 * Hosts four tabs (Tasks, History, Changes, Activity) and persists the
 * selected tab to localStorage so a reload restores the user's last view
 * without losing the active-team context owned by `useOrchestra`.
 *
 * A compact `<BudgetMeter />` strip is mounted BELOW the active tab
 * content (not inside the tab body) so the budget is always visible
 * regardless of which panel is currently on-screen. It only renders when
 * a team is active — there is no meaningful budget to show otherwise.
 *
 * The parent (OrchestraView aside, 340px) owns width/height; this
 * component fills with w-full / h-full and lets each panel scroll
 * internally.
 */
import { useCallback, useEffect, useState } from 'react'
import { Activity, GitBranch, History, ListTodo } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useOrchestra } from './state/orchestra'
import TasksPanel from './TasksPanel'
import TasksHistoryPanel from './TasksHistoryPanel'
import TeamChangesPanel from './TeamChangesPanel'
import ActivityFeed from './ActivityFeed'
import BudgetMeter from './BudgetMeter'
import Inspector from './Inspector'

type TabId = 'tasks' | 'history' | 'changes' | 'activity'

interface TabDef {
  readonly id: TabId
  readonly label: string
  readonly icon: LucideIcon
}

/** Tab definitions — order here drives left-to-right order in the strip. */
const TABS: ReadonlyArray<TabDef> = [
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'history', label: 'History', icon: History },
  { id: 'changes', label: 'Changes', icon: GitBranch },
  { id: 'activity', label: 'Activity', icon: Activity }
]

const STORAGE_KEY = 'hydra.orchestra.sidePanelTab'

/** Narrow an unknown localStorage value back to a TabId. Guards against
 *  stale keys from older versions or hand-edited storage. */
function isTabId(value: unknown): value is TabId {
  return (
    value === 'tasks' ||
    value === 'history' ||
    value === 'changes' ||
    value === 'activity'
  )
}

/** Read the persisted tab once at mount. Wrapped in try/catch because
 *  localStorage can throw in privacy modes / sandboxed renderers. */
function readInitialTab(): TabId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (isTabId(raw)) return raw
  } catch {
    // Ignore — fall through to default.
  }
  return 'tasks'
}

export default function SidePanels() {
  const [activeTab, setActiveTab] = useState<TabId>(readInitialTab)
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const inspectorOpen = useOrchestra((s) => s.inspectorOpen)
  const selectedAgentIds = useOrchestra((s) => s.selectedAgentIds)
  // Phase-3: when an agent is selected and the user wants the
  // Inspector open, replace the team-scoped tab strip with it. Single
  // dock surface, single close button — see issue #12 follow-up plan.
  const showInspector = inspectorOpen && selectedAgentIds.length === 1

  // Persist tab selection. Swallow errors so a broken localStorage never
  // crashes the renderer.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, activeTab)
    } catch {
      // no-op
    }
  }, [activeTab])

  const handleSelect = useCallback((id: TabId) => {
    setActiveTab(id)
  }, [])

  if (showInspector) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden border-l border-border-soft bg-bg-2 text-text-1">
        <Inspector />
        {activeTeamId !== null && (
          <div className="border-t border-border-soft bg-bg-1">
            <BudgetMeter compact teamId={activeTeamId} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-border-soft bg-bg-2 text-text-1">
      {/* Tab strip */}
      <div
        role="tablist"
        aria-label="Side panels"
        className="flex items-stretch border-b border-border-soft bg-bg-1"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`side-panels-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`side-panels-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleSelect(tab.id)}
              className={
                'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 font-mono text-[11px] transition-colors ' +
                (isActive
                  ? 'border-accent-500 text-accent-400'
                  : 'border-transparent text-text-3 hover:text-text-1')
              }
            >
              <Icon size={13} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Active tab content — each panel manages its own scrolling. */}
      <div
        role="tabpanel"
        id={`side-panels-panel-${activeTab}`}
        aria-labelledby={`side-panels-tab-${activeTab}`}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {activeTab === 'tasks' && <TasksPanel />}
        {activeTab === 'history' && <TasksHistoryPanel />}
        {activeTab === 'changes' && <TeamChangesPanel />}
        {activeTab === 'activity' && <ActivityFeed />}
      </div>

      {/* Budget meter strip — always below the active tab, never inside it.
          Only meaningful when a team is active. */}
      {activeTeamId !== null && (
        <div className="border-t border-border-soft bg-bg-1">
          <BudgetMeter compact teamId={activeTeamId} />
        </div>
      )}
    </div>
  )
}
