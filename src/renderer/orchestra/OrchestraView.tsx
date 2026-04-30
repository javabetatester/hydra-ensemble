/**
 * OrchestraView — top-level layout for Orchestra mode.
 *
 * Three-column layout (Rail 220px / Canvas flex-1 / Inspector 360px) plus a
 * 52px bottom bar. This file is a composition root only: the heavy-lift
 * children (TeamRail, Canvas, Inspector, TaskBar) and the ApiKeyModal live
 * in sibling files and are assumed to exist.
 *
 * See PRD.md §11 (UI layout), §13 (empty states) and PLAN.md §5.1.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  HelpCircle,
  Key as KeyIcon,
  Network,
  Plus,
  Settings
} from 'lucide-react'
import { useOrchestra } from './state/orchestra'
import TeamRail from './TeamRail'
import Canvas from './Canvas'
import SidePanels from './SidePanels'
import TeamOverview from './TeamOverview'
import CanvasFabs from './CanvasFabs'
import CanvasToolbar from './CanvasToolbar'
import ApiKeyModal from './modals/ApiKeyModal'
import SettingsPanel from './SettingsPanel'
import CoachMarks from './CoachMarks'
import TaskDrawer from './TaskDrawer'
import OrchestraHelp from './OrchestraHelp'
import OrchestraSearch from './OrchestraSearch'
import NotificationsBell from './NotificationsBell'
import TeamHealthPanel from './TeamHealthPanel'
import AgentWizard from './modals/AgentWizard'
import { useNewTaskDialog } from '../state/newTaskDialog'
import NewTeamDialog from './modals/NewTeamDialog'
import TeamTemplatesDialog from './TeamTemplatesDialog'
import ImportTeamDialog from './ImportTeamDialog'
import GenerateTeamDialog from './GenerateTeamDialog'
import TeamSwitcher from './TeamSwitcher'
import ProjectChip from './ProjectChip'
import TemplatesPanel from './TemplatesPanel'
import { useOrchestraPanels } from '../state/orchestraPanels'
import BulkActionsBar from './BulkActionsBar'
import OrchestraToasts from './OrchestraToasts'
import ProvidersDialog from './ProvidersDialog'
import ShortcutHud from './ShortcutHud'
import AgentPresence from './AgentPresence'
import BudgetWarning from './BudgetWarning'
import OrchestraBreadcrumb from './OrchestraBreadcrumb'
import {
  useOrchestraKeybinds,
  ORCHESTRA_EVENTS,
  onOrchestraEvent
} from './useOrchestraKeybinds'
import { Kbd } from '../ui'

interface Props {
  onBackToClassic: () => void
}

/** Starter templates shown on the first-run empty state. See PRD.md §10 F1. */
interface StarterTemplate {
  id: 'pr-review' | 'feature-factory' | 'bug-triage'
  name: string
  tagline: string
  agents: number
}

const STARTER_TEMPLATES: ReadonlyArray<StarterTemplate> = [
  {
    id: 'pr-review',
    name: 'PR Reviewers',
    tagline: 'Go lint + security audit + test gap finder, collated by a lead.',
    agents: 4
  },
  {
    id: 'feature-factory',
    name: 'Feature Factory',
    tagline: 'PM → Architect → Backend + Frontend → QA. End-to-end feature shop.',
    agents: 5
  },
  {
    id: 'bug-triage',
    name: 'Bug Triager',
    tagline: 'Triage agent routes stack traces to backend or frontend debuggers.',
    agents: 3
  }
]

/** Resolve Orchestra IPC defensively — the preload may not have the namespace
 *  yet in early phases of rollout. Falls back to a shape that reports "no key". */
interface OrchestraApiKeyApi {
  test: () => Promise<{ ok: boolean; error?: string }>
}

function getApiKeyApi(): OrchestraApiKeyApi | null {
  const bridge = (window as unknown as {
    api?: { orchestra?: { apiKey?: OrchestraApiKeyApi } }
  }).api
  return bridge?.orchestra?.apiKey ?? null
}

export default function OrchestraView({ onBackToClassic }: Props) {
  const settings = useOrchestra((s) => s.settings)
  const teams = useOrchestra((s) => s.teams)
  const agents = useOrchestra((s) => s.agents)
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const inspectorOpen = useOrchestra((s) => s.inspectorOpen)
  const selectedAgentIds = useOrchestra((s) => s.selectedAgentIds)
  const projectsPanelOpen = useOrchestraPanels((s) => s.projects)
  const dockPanelOpen = useOrchestraPanels((s) => s.dock)
  const init = useOrchestra((s) => s.init)
  const createTeam = useOrchestra((s) => s.createTeam)

  // Defence-in-depth: App.tsx already gates on settings.enabled, but if this
  // component is rendered directly we still refuse to mount.
  const enabled = settings?.enabled ?? false

  // API-key presence is cached once per session. `null` = not-yet-tested,
  // `true` = key present and validated, `false` = missing / rejected.
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null)
  const [creatingInline, setCreatingInline] = useState<StarterTemplate['id'] | 'blank' | null>(
    null
  )
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)
  const [helpOpen, setHelpOpen] = useState<boolean>(false)
  const [searchOpen, setSearchOpen] = useState<boolean>(false)
  const [healthOpen, setHealthOpen] = useState<boolean>(false)
  const [wizardOpen, setWizardOpen] = useState<boolean>(false)
  const showNewTaskDialog = useNewTaskDialog((s) => s.show)
  const [templatesOpen, setTemplatesOpen] = useState<boolean>(false)
  const [providersOpen, setProvidersOpen] = useState<boolean>(false)
  const [sidePanelsHidden, setSidePanelsHidden] = useState<boolean>(false)
  const [newTeamOpen, setNewTeamOpen] = useState<boolean>(false)
  const [newTeamMode, setNewTeamMode] = useState<'blank' | 'template'>('blank')
  const [newTeamTemplateId, setNewTeamTemplateId] = useState<string | undefined>(undefined)
  const [importOpen, setImportOpen] = useState<boolean>(false)
  const [generateOpen, setGenerateOpen] = useState<boolean>(false)

  // Register Orchestra-wide keyboard shortcuts. Each shortcut dispatches
  // a custom window event; subscribers below translate into setOpen() calls.
  useOrchestraKeybinds()
  useEffect(() => {
    const subscribe = (name: string, handler: () => void): (() => void) => {
      const listener = (): void => handler()
      window.addEventListener(name, listener)
      return () => window.removeEventListener(name, listener)
    }
    const offs = [
      onOrchestraEvent(ORCHESTRA_EVENTS.help, () => setHelpOpen((v) => !v)),
      onOrchestraEvent(ORCHESTRA_EVENTS.search, () => setSearchOpen((v) => !v)),
      onOrchestraEvent(ORCHESTRA_EVENTS.settings, () => setSettingsOpen((v) => !v)),
      onOrchestraEvent(ORCHESTRA_EVENTS.newTask, () => showNewTaskDialog()),
      onOrchestraEvent(ORCHESTRA_EVENTS.newAgentWizard, () => setWizardOpen(true)),
      onOrchestraEvent(ORCHESTRA_EVENTS.healthToggle, () => setHealthOpen((v) => !v)),
      // Rail footer / empty-state / template buttons dispatch these;
      // centralising the listener here means every entry point ends up
      // in the same modal code path.
      subscribe('orchestra:new-team', () => {
        setNewTeamMode('blank')
        setNewTeamTemplateId(undefined)
        setNewTeamOpen(true)
      }),
      subscribe('orchestra:open-templates', () => setTemplatesOpen(true)),
      subscribe('orchestra:import-team', () => setImportOpen(true)),
      subscribe('orchestra:generate-team', () => setGenerateOpen(true))
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [])

  // One-shot init + API-key probe. Guarded by `enabled` so disabled mounts
  // never kick off side effects.
  useEffect(() => {
    if (!enabled) return
    void init()
    const probe = getApiKeyApi()
    if (!probe) {
      setHasApiKey(false)
      return
    }
    let cancelled = false
    void probe
      .test()
      .then((res) => {
        if (!cancelled) setHasApiKey(res.ok)
      })
      .catch(() => {
        if (!cancelled) setHasApiKey(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, init])

  const tasks = useOrchestra((s) => s.tasks)

  const activeTeam = useMemo(
    () => teams.find((t) => t.id === activeTeamId) ?? null,
    [teams, activeTeamId]
  )
  const activeAgents = useMemo(
    () => (activeTeam ? agents.filter((a) => a.teamId === activeTeam.id) : []),
    [agents, activeTeam]
  )
  /** Tasks scoped to the active team — surfaced in the header counter
   *  next to the agent count so the breadcrumb's pill can be retired. */
  const activeTeamTaskCount = useMemo(() => {
    if (!activeTeam) return 0
    let n = 0
    for (const t of tasks) if (t.teamId === activeTeam.id) n++
    return n
  }, [tasks, activeTeam])
  /** Count of tasks in the active team that failed in the last 24h —
   *  surfaces as a red dot on the Health button. */
  const recentFailureCount = useMemo(() => {
    if (!activeTeam) return 0
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    return tasks.reduce((acc, t) => {
      if (t.teamId !== activeTeam.id) return acc
      if (t.status !== 'failed') return acc
      const ts = Date.parse(t.updatedAt)
      return Number.isFinite(ts) && ts >= cutoff ? acc + 1 : acc
    }, 0)
  }, [tasks, activeTeam])
  /** Any task currently executing across the active team. Drives the
   *  thin accent border along the top edge of the canvas column. */
  const hasInFlightTask = useMemo(() => {
    if (!activeTeam) return false
    return tasks.some(
      (t) =>
        t.teamId === activeTeam.id &&
        (t.status === 'in_progress' || t.status === 'routing')
    )
  }, [tasks, activeTeam])

  if (!enabled) return null

  const apiKeyResolved = hasApiKey !== null
  const apiKeyMissing = hasApiKey === false

  const handleCreateBlank = (): void => {
    // Open the real modal. Previously the click fired a window.prompt
    // chain that silently no-oped inside Electron windows.
    setNewTeamMode('blank')
    setNewTeamTemplateId(undefined)
    setNewTeamOpen(true)
  }

  const handleUseTemplate = (tpl: StarterTemplate): void => {
    // Map the starter template ids to the real TEAM_TEMPLATES ids that
    // ship agents + edges with the team.
    const templateId =
      tpl.id === 'pr-review'
        ? 'pr-review-swarm'
        : tpl.id === 'feature-factory'
          ? 'feature-factory'
          : 'bug-triage'
    setNewTeamMode('template')
    setNewTeamTemplateId(templateId)
    setNewTeamOpen(true)
  }

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-bg-1 text-text-1">
      {/* DEVELOPING banner — Orchestra is still in active development.
          CLI-path delegation rides on an XML envelope protocol, approval
          flow is a UI shell without runtime pause, and multi-provider
          routing past Claude is scaffolded but not wired. Loud banner so
          users don't treat this as a finished product. */}
      <div
        role="note"
        aria-label="Orchestrador is in active development"
        className="flex shrink-0 items-center justify-center gap-3 border-b border-status-thinking/60 bg-status-thinking/15 px-4 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-status-thinking"
      >
        <span className="h-1.5 w-1.5 animate-ping rounded-full bg-status-thinking" />
        <span className="text-[13px] tracking-[0.32em]">DEVELOPING</span>
        <span className="hidden text-[10px] font-medium tracking-[0.18em] text-status-thinking/80 sm:inline">
          · surface still shifting, expect rough edges
        </span>
      </div>
      {/* Top header strip — 40px (was 48), two logical groups separated
          by a visible divider on the right. Trimmed in phase-1 of the
          orchestrator UI proposal so the canvas gains vertical room. */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 px-4">
        {/* Left group: navigation + brand + project + team picker */}
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onBackToClassic}
            className="group relative flex h-7 w-7 items-center justify-center rounded-sm text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="Back to classic dashboard"
          >
            <ArrowLeft size={14} strokeWidth={1.75} />
            <HeaderTooltip label="Back to classic" />
          </button>
          <div className="flex items-center gap-2">
            <Network size={15} strokeWidth={1.75} className="text-accent-400" />
            <span className="df-label text-sm font-semibold text-text-1">Orchestrador</span>
          </div>
          {teams.length > 0 ? (
            <>
              <span
                className="h-5 w-px bg-border-soft"
                aria-hidden
              />
              {/* Project chip — first thing after the brand so the
                   "where am I" answer is unmissable. Followed by the
                   team picker. */}
              <ProjectChip />
              <div className="flex items-center gap-1.5">
                <TeamSwitcher />
                {activeTeam?.mainAgentId ? (
                  <span
                    className="group relative flex h-5 w-5 items-center justify-center rounded-full bg-accent-500/10 text-[9px] font-semibold text-accent-400"
                    aria-label="Main agent set"
                  >
                    M
                    <HeaderTooltip label="Main agent set" />
                  </span>
                ) : null}
                {activeAgents.length > 0 ? (
                  <span
                    className="font-mono text-[10px] text-text-4"
                    title="Agents · tasks in the active team"
                  >
                    {activeAgents.length} {activeAgents.length === 1 ? 'agent' : 'agents'}
                    {activeTeamTaskCount > 0
                      ? ` · ${activeTeamTaskCount} ${
                          activeTeamTaskCount === 1 ? 'task' : 'tasks'
                        }`
                      : ''}
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <span className="h-5 w-px bg-border-soft" aria-hidden />
              <button
                type="button"
                onClick={handleCreateBlank}
                className="flex items-center gap-1 rounded-sm border border-accent-500/40 bg-accent-500/10 px-2 py-1 text-[11px] font-medium text-accent-400 hover:bg-accent-500/20"
              >
                <Plus size={12} strokeWidth={2} />
                New team
              </button>
            </>
          )}
        </div>

        {/* Right group: status actions (health, bell, settings) + separator + help */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {activeTeam ? (
              <button
                type="button"
                onClick={() => setHealthOpen(true)}
                className="group relative flex h-7 w-7 items-center justify-center rounded-sm text-text-3 hover:bg-bg-3 hover:text-text-1"
                aria-label="Team health"
              >
                <Activity size={15} strokeWidth={1.75} />
                {recentFailureCount > 0 ? (
                  <span
                    className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 font-mono text-[9px] font-semibold text-white"
                    aria-label={`${recentFailureCount} failed tasks in the last 24h`}
                  >
                    {recentFailureCount > 9 ? '9+' : recentFailureCount}
                  </span>
                ) : null}
                <HeaderTooltip label="Team health · Ctrl+B" />
              </button>
            ) : null}
            {/* NotificationsBell carries its own button chrome + dropdown,
                so we just wrap it in a `group` span to hang the tooltip. */}
            <span className="group relative inline-flex">
              <NotificationsBell />
              <HeaderTooltip label="Notifications" />
            </span>
            <button
              type="button"
              onClick={() => setProvidersOpen(true)}
              className="group relative flex h-7 w-7 items-center justify-center rounded-sm text-text-3 hover:bg-bg-3 hover:text-text-1"
              aria-label="Configure providers"
            >
              <KeyIcon size={15} strokeWidth={1.75} />
              <HeaderTooltip label="Providers (API keys + OAuth)" />
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="group relative flex h-7 w-7 items-center justify-center rounded-sm text-text-3 hover:bg-bg-3 hover:text-text-1"
              aria-label="Orchestrador settings"
            >
              <Settings size={15} strokeWidth={1.75} />
              <HeaderTooltip label="Settings · Ctrl+," />
            </button>
          </div>
          <span className="h-5 w-px bg-border-soft" aria-hidden />
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="group relative flex h-7 w-7 items-center justify-center rounded-sm text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="Help"
          >
            <HelpCircle size={15} strokeWidth={1.75} />
            <HeaderTooltip label="Help · ?" />
          </button>
        </div>
      </header>

      {/* Secondary header strip: breadcrumb path renders below the main header. */}
      <OrchestraBreadcrumb />

      {/* TeamTabsStrip retired in phase-5: TeamSwitcher in the header
          plus the grouped TeamRail cover the same selector role
          without a third surface. */}

      {/* Main multi-panel body. Templates Library is the leftmost
          panel when toggled on (Ctrl+Shift+L), then the
          Projects/Teams rail (Ctrl+Shift+P), then the canvas, then
          the right dock (Ctrl+Shift+J). Each panel is independently
          collapsible — see useOrchestraPanels. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <TemplatesPanel />
        {projectsPanelOpen ? <TeamRail /> : null}

        <main className="relative flex min-w-0 flex-1 flex-col bg-bg-1">
          {/* Subtle accent stripe along the top edge when any task is
              actively running. Non-interactive, pointer-events-none so it
              never steals clicks from the canvas below. */}
          {hasInFlightTask ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[2px] bg-gradient-to-r from-transparent via-accent-400 to-transparent"
            />
          ) : null}
          {teams.length === 0 ? (
            <EmptyTeamsState
              onBlank={handleCreateBlank}
              onPickTemplate={handleUseTemplate}
              pending={creatingInline}
            />
          ) : (
            <>
              <Canvas />
              {/* Ghost hint rendered ON TOP of the canvas so the user can
                  still double-click / press A to open the New Agent popover
                  even while the canvas is empty. `pointer-events-none`
                  keeps every interaction going through to react-flow. */}
              {activeTeam && activeAgents.length === 0 ? (
                <CanvasGhostState />
              ) : null}
              {/* Budget warning banner — sits above the TeamOverview chips. */}
              <BudgetWarning />
              {/* Live counters + active-task chips pinned to the top. */}
              <TeamOverview />
              {/* Bottom-left toolbar (fit-view, auto-layout, templates). */}
              <CanvasToolbar />
              {/* Bottom-right FABs (new agent, new task). */}
              <CanvasFabs />
              {/* Live presence indicators for agents in the active team. */}
              <AgentPresence />
              {/* Multi-select floating actions (pause/stop/delete N). */}
              <BulkActionsBar />
            </>
          )}
        </main>

        {/* Right dock: hosts the team-scoped tab strip (Tasks · History
            · Changes · Activity) AND, when a single agent is selected,
            the Inspector — same surface, same close. Width adapts so
            the Inspector's denser content gets a bit more room. Phase
            3 of the orchestrator UI proposal. */}
        {activeTeam && !sidePanelsHidden && dockPanelOpen ? (
          <aside
            className={`flex shrink-0 flex-col border-l border-border-soft bg-bg-2 transition-[width] duration-150 ${
              inspectorOpen && selectedAgentIds.length === 1
                ? 'w-[440px]'
                : 'w-[360px]'
            }`}
          >
            <SidePanels />
          </aside>
        ) : null}
      </div>

      {/* Bottom bar removed — task submission lives in the right-side
          TasksPanel now (see §25 in PRD.md for the updated flow). The
          previous quick-submit strip was confusing because it looked like
          a chat for the whole canvas. */}

      {/* Coach marks overlay — always mounted while Orchestra is visible;
          the component decides its own visibility via the store. */}
      <CoachMarks open={true} />

      {/* Task drawer — gate on taskDrawerTaskId so it never even mounts
          without a target, killing the "task not found" flash. */}
      <OrchestraTaskDrawerMount />

      {/* Side-effect observer: emits toasts on done/failed/error/delegation. */}
      <OrchestraToasts />


      {/* Orchestra settings panel (gear icon + Ctrl+,). */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Help overlay (? key). */}
      <OrchestraHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Global search palette (Ctrl+P). */}
      <OrchestraSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Team health dashboard (Activity button in header + Ctrl+B). */}
      <TeamHealthPanel open={healthOpen} onClose={() => setHealthOpen(false)} />

      {/* Agent creation wizard (Ctrl+Shift+K). Falls back to canvas center
          as the spawn position since the wizard isn't cursor-anchored. */}
      {activeTeamId ? (
        <AgentWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          teamId={activeTeamId}
          position={{
            x: Math.round((typeof window !== 'undefined' ? window.innerWidth / 2 : 400) / 16) * 16,
            y: Math.round((typeof window !== 'undefined' ? window.innerHeight / 2 : 300) / 16) * 16
          }}
        />
      ) : null}

      {/* New task dialog (Ctrl+Shift+N). */}
      {/* NewTaskDialog is mounted globally in App.tsx; opening here goes
          through `useNewTaskDialog.show()` so context flows uniformly. */}

      {/* Team templates dialog (Templates button in the action bar). */}
      <TeamTemplatesDialog open={templatesOpen} onClose={() => setTemplatesOpen(false)} />

      {/* Import team from JSON file. */}
      <ImportTeamDialog open={importOpen} onClose={() => setImportOpen(false)} />

      {/* Generate team from prompt (Claude designs the team). */}
      <GenerateTeamDialog open={generateOpen} onClose={() => setGenerateOpen(false)} />

      {/* Providers dialog — one place to configure Claude OAuth,
          Anthropic API key, OpenAI, OpenRouter, Codex CLI. Opened from
          the header "Providers" button or a settings shortcut. */}
      <ProvidersDialog open={providersOpen} onClose={() => setProvidersOpen(false)} />

      {/* New team dialog — prompted from the empty state, the Team rail
          footer, or the team switcher. Handles both blank creation and
          full template provisioning. */}
      <NewTeamDialog
        open={newTeamOpen}
        mode={newTeamMode}
        templateId={newTeamTemplateId}
        onClose={() => setNewTeamOpen(false)}
      />

      {/* Blocking API-key modal. Rendered last so it layers above everything. */}
      {apiKeyResolved && apiKeyMissing ? (
        <ApiKeyModal
          open
          blocking
          onClose={() => setHasApiKey(true)}
        />
      ) : null}

      {/* Global keyboard shortcut HUD — mounted at the very bottom so it
          floats above every other surface in the Orchestra tree. */}
      <ShortcutHud />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty states — see PRD.md §13
// ---------------------------------------------------------------------------

interface EmptyTeamsStateProps {
  onBlank: () => void
  onPickTemplate: (tpl: StarterTemplate) => void
  pending: StarterTemplate['id'] | 'blank' | null
}

function EmptyTeamsState({ onBlank, onPickTemplate, pending }: EmptyTeamsStateProps) {
  return (
    <div className="df-scroll flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <Network size={40} strokeWidth={1.25} className="text-text-4" />
        <div className="text-base font-semibold text-text-1">Create your first team</div>
        <div className="max-w-md text-xs text-text-3">
          Teams are named groups of agents that share a worktree and an API key. Pick a
          starter template below or start from a blank canvas.
        </div>
      </div>

      <div className="grid w-full max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
        {STARTER_TEMPLATES.map((tpl) => {
          const busy = pending === tpl.id
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => onPickTemplate(tpl)}
              disabled={pending !== null}
              className="df-lift flex flex-col gap-2 rounded-md border border-border-soft bg-bg-3 p-4 text-left hover:border-border-mid hover:bg-bg-4 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-text-1">{tpl.name}</span>
                <span className="font-mono text-[10px] text-text-4">{tpl.agents} agents</span>
              </div>
              <p className="text-[11px] leading-relaxed text-text-3">{tpl.tagline}</p>
              {busy ? (
                <span className="font-mono text-[10px] text-accent-400">creating…</span>
              ) : null}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={onBlank}
        disabled={pending !== null}
        className="flex items-center gap-1.5 rounded-md border border-border-mid bg-bg-3 px-3 py-2 text-xs text-text-1 hover:bg-bg-4 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={12} strokeWidth={1.75} />
        Blank team
      </button>
    </div>
  )
}

/** Thin wrapper that only mounts the TaskDrawer when a task is selected,
 *  so a stale id never produces a "task not found" flash on boot. */
function OrchestraTaskDrawerMount() {
  const taskId = useOrchestra((s) => s.taskDrawerTaskId)
  const close = useOrchestra((s) => s.setTaskDrawer)
  if (!taskId) return null
  return <TaskDrawer open={true} onClose={() => close(null)} />
}

/** Small below-the-button tooltip. Revealed via the parent `.group:hover`
 *  rule so the parent only needs `className="group"`. We keep this
 *  pointer-events-none so it never steals the click from the button. */
interface HeaderTooltipProps {
  label: string
}

function HeaderTooltip({ label }: HeaderTooltipProps) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-sm border border-border-soft bg-bg-3 px-1.5 py-0.5 font-mono text-[10px] text-text-2 opacity-0 shadow-sm transition-opacity duration-100 group-hover:opacity-100"
    >
      {label}
    </span>
  )
}

function CanvasGhostState() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="absolute inset-6 rounded-lg border-2 border-dashed border-border-soft" />
      <div className="relative flex flex-col items-center gap-2 text-center">
        <Plus size={28} strokeWidth={1.25} className="text-text-4" />
        <div className="text-sm text-text-2">No agents yet</div>
        <div className="font-mono text-[11px] text-text-4">
          Double-click the canvas, press <Kbd>A</Kbd>, or click
          <span className="mx-1 inline-flex items-center gap-1 rounded-sm border border-accent-500/40 bg-accent-500/10 px-1.5 py-0.5 text-accent-400">
            <Plus size={10} strokeWidth={1.75} />New agent
          </span>
          in the action bar above.
        </div>
      </div>
    </div>
  )
}

