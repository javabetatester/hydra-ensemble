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
import { ArrowLeft, Crown, Network, Plus, Settings } from 'lucide-react'
import { useOrchestra } from './state/orchestra'
import TeamRail from './TeamRail'
import Canvas from './Canvas'
import Inspector from './Inspector'
import TaskBar from './TaskBar'
import ApiKeyModal from './modals/ApiKeyModal'
import SettingsPanel from './SettingsPanel'
import CoachMarks from './CoachMarks'
import TaskDrawer from './TaskDrawer'

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

  const activeTeam = useMemo(
    () => teams.find((t) => t.id === activeTeamId) ?? null,
    [teams, activeTeamId]
  )
  const activeAgents = useMemo(
    () => (activeTeam ? agents.filter((a) => a.teamId === activeTeam.id) : []),
    [agents, activeTeam]
  )

  if (!enabled) return null

  const apiKeyResolved = hasApiKey !== null
  const apiKeyMissing = hasApiKey === false

  const handleCreateBlank = (): void => {
    // Team creation needs a worktree path, which the user has to pick —
    // delegate the full flow to the TeamRail inline-creation affordance
    // rather than trying to auto-create from the empty state.
    setCreatingInline('blank')
  }

  const handleUseTemplate = (tpl: StarterTemplate): void => {
    setCreatingInline(tpl.id)
  }

  return (
    <div className="relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-bg-1 text-text-1">
      {/* Top header strip */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBackToClassic}
            className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-text-3 hover:bg-bg-3 hover:text-text-1"
            title="back to classic dashboard"
          >
            <ArrowLeft size={12} strokeWidth={1.75} />
            Classic
          </button>
          <span className="h-3 w-px bg-border-soft" aria-hidden />
          <Network size={13} strokeWidth={1.75} className="text-accent-400" />
          <span className="df-label text-sm font-semibold text-text-1">Orchestra</span>
          {activeTeam ? (
            <>
              <span className="font-mono text-[10px] text-text-4">·</span>
              <span className="truncate text-xs text-text-2">{activeTeam.name}</span>
              {activeTeam.mainAgentId ? (
                <Crown
                  size={11}
                  strokeWidth={1.75}
                  className="text-accent-400"
                  aria-label="main agent set"
                />
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-text-4">
          {activeAgents.length > 0 ? (
            <span>
              {activeAgents.length} {activeAgents.length === 1 ? 'agent' : 'agents'}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-text-3 hover:bg-bg-3 hover:text-text-1"
            title="Orchestra settings"
            aria-label="Orchestra settings"
          >
            <Settings size={14} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* Main 3-column body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-border-soft bg-bg-2">
          <TeamRail />
        </aside>

        <main className="relative flex min-w-0 flex-1 flex-col bg-bg-1">
          {teams.length === 0 ? (
            <EmptyTeamsState
              onBlank={handleCreateBlank}
              onPickTemplate={handleUseTemplate}
              pending={creatingInline}
            />
          ) : activeTeam && activeAgents.length === 0 ? (
            <CanvasGhostState />
          ) : (
            <Canvas />
          )}
        </main>

        {inspectorOpen ? (
          <aside className="flex w-[360px] shrink-0 flex-col border-l border-border-soft bg-bg-2">
            <Inspector />
          </aside>
        ) : null}
      </div>

      {/* Bottom task bar (52px). Disabled visually is owned by TaskBar itself. */}
      <footer className="flex h-[52px] shrink-0 items-center border-t border-border-soft bg-bg-2 px-3">
        <TaskBar />
      </footer>

      {/* Coach marks overlay — always mounted while Orchestra is visible;
          the component decides its own visibility via the store. */}
      <CoachMarks open={true} />

      {/* Task drawer — internal logic reads `taskDrawerTaskId` to decide
          visibility, so passing a constant `open` is fine. */}
      <TaskDrawer
        open={true}
        onClose={() => useOrchestra.getState().setTaskDrawer(null)}
      />

      {/* Orchestra settings panel (gear icon in header). */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Blocking API-key modal. Rendered last so it layers above everything. */}
      {apiKeyResolved && apiKeyMissing ? (
        <ApiKeyModal
          open
          blocking
          onClose={() => setHasApiKey(true)}
        />
      ) : null}
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

function CanvasGhostState() {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-dashed border-border-soft" />
      <div className="flex flex-col items-center gap-2 text-center">
        <Plus size={28} strokeWidth={1.25} className="text-text-4" />
        <div className="text-sm text-text-2">No agents yet</div>
        <div className="font-mono text-[11px] text-text-4">
          Double-click to add an agent, or press <kbd className="rounded-sm border border-border-soft bg-bg-3 px-1 py-0.5 text-[10px] text-text-2">A</kbd>
        </div>
      </div>
    </div>
  )
}
