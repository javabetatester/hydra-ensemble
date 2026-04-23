/**
 * EmptyStates — reusable empty-state surfaces for Orchestra.
 *
 * Every screen in Orchestra can hit an empty condition (no teams, a fresh team
 * with no agents, no tasks yet, no history, an agent with no inbox). Instead of
 * ad-hoc "nothing here" blurbs scattered around, this module centralises five
 * named components with consistent typography, spacing and CTA styling.
 *
 * Illustrations are built from Tailwind-token shapes (div circles + lines) and
 * lucide icons — no image assets, no new deps. Buttons share two variants
 * (primary / secondary) expressed inline to keep this file self-contained.
 */
import type { ReactElement } from 'react'
import { Users, UserPlus, Wand2, ListTodo, Inbox, History } from 'lucide-react'

// ---------------------------------------------------------------------------
// Shared button styling
// ---------------------------------------------------------------------------

const BTN_BASE = 'px-5 py-2 text-sm font-medium rounded-sm transition-colors'
const BTN_PRIMARY = `${BTN_BASE} bg-accent-500 text-white hover:bg-accent-600 shadow-pop`
const BTN_SECONDARY = `${BTN_BASE} border border-border-mid bg-bg-2 text-text-1 hover:bg-bg-3`

// ---------------------------------------------------------------------------
// Shared prop shapes
// ---------------------------------------------------------------------------

export interface TemplateActionProps {
  onOpenTemplates: () => void
}

// ---------------------------------------------------------------------------
// Illustration primitives (Tailwind-only)
// ---------------------------------------------------------------------------

/**
 * Large stacked-circles + horizontal-lines illustration used in the headline
 * empty state ("no teams yet"). Purely decorative.
 */
function OrchestraIllustration(): ReactElement {
  return (
    <div
      aria-hidden
      className="relative mx-auto h-40 w-56 select-none"
    >
      {/* Back glow */}
      <div className="absolute inset-0 rounded-full bg-accent-500/5 blur-2xl" />

      {/* Three stacked circles (team nodes) */}
      <div className="absolute left-6 top-8 h-16 w-16 rounded-full border border-border-mid bg-bg-2" />
      <div className="absolute left-20 top-2 h-20 w-20 rounded-full border border-accent-500/60 bg-accent-500/10" />
      <div className="absolute right-4 top-10 h-14 w-14 rounded-full border border-border-mid bg-bg-2" />

      {/* Connecting lines (edges) */}
      <div className="absolute left-14 top-20 h-px w-10 rotate-[-12deg] bg-border-mid" />
      <div className="absolute right-14 top-22 h-px w-10 rotate-[12deg] bg-border-mid" />

      {/* Tiny dots suggesting agents */}
      <div className="absolute bottom-6 left-1/4 h-2 w-2 rounded-full bg-accent-500/70" />
      <div className="absolute bottom-4 left-1/2 h-2 w-2 rounded-full bg-text-3/60" />
      <div className="absolute bottom-7 right-1/4 h-2 w-2 rounded-full bg-text-3/60" />
    </div>
  )
}

/**
 * Smaller illustration for an empty team view — a single prominent circle with
 * placeholder agent slots around it, to echo the main illustration.
 */
function TeamIllustration(): ReactElement {
  return (
    <div
      aria-hidden
      className="relative mx-auto h-28 w-40 select-none"
    >
      <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-500/60 bg-accent-500/10" />
      <div className="absolute left-2 top-4 h-8 w-8 rounded-full border border-dashed border-border-mid bg-bg-2" />
      <div className="absolute right-2 top-4 h-8 w-8 rounded-full border border-dashed border-border-mid bg-bg-2" />
      <div className="absolute bottom-2 left-1/2 h-8 w-8 -translate-x-1/2 rounded-full border border-dashed border-border-mid bg-bg-2" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmptyOrchestra — "no teams yet" hero empty state
// ---------------------------------------------------------------------------

export interface EmptyOrchestraProps {
  onCreateTeam: () => void
  onOpenTemplates: () => void
}

export function EmptyOrchestra({
  onCreateTeam,
  onOpenTemplates,
}: EmptyOrchestraProps): ReactElement {
  return (
    <div className="flex h-full w-full items-center justify-center bg-bg-1 p-10">
      <div className="flex max-w-lg flex-col items-center text-center">
        <OrchestraIllustration />

        <div className="mt-8 flex items-center gap-2 text-text-3">
          <Users className="h-4 w-4" />
          <span className="text-xs uppercase tracking-wider">Orchestra</span>
        </div>

        <h2 className="mt-2 text-2xl font-semibold text-text-1">
          Build your first AI team
        </h2>
        <p className="mt-2 text-sm text-text-3">
          Group agents around a shared goal and let them collaborate on tasks.
        </p>

        <div className="mt-8 flex w-full items-center justify-center gap-3">
          <button type="button" onClick={onCreateTeam} className={BTN_SECONDARY}>
            Blank team
          </button>
          <button type="button" onClick={onOpenTemplates} className={BTN_PRIMARY}>
            Start from template
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmptyTeam — "team has no agents" state
// ---------------------------------------------------------------------------

export interface EmptyTeamProps {
  onAddAgent: () => void
  onOpenTemplates: () => void
  teamName: string
}

export function EmptyTeam({
  onAddAgent,
  onOpenTemplates,
  teamName,
}: EmptyTeamProps): ReactElement {
  return (
    <div className="flex h-full w-full items-center justify-center bg-bg-1 p-8">
      <div className="flex max-w-md flex-col items-center text-center">
        <TeamIllustration />

        <h3 className="mt-6 text-xl font-semibold text-text-1">
          <span className="text-accent-500">{teamName}</span> has no agents yet
        </h3>
        <p className="mt-2 text-sm text-text-3">
          Add an agent to start delegating work inside this team.
        </p>

        <div className="mt-6 flex w-full items-center justify-center gap-3">
          <button
            type="button"
            onClick={onAddAgent}
            className={`${BTN_PRIMARY} inline-flex items-center gap-2`}
          >
            <UserPlus className="h-4 w-4" />
            New agent (wizard)
          </button>
          <button
            type="button"
            onClick={onOpenTemplates}
            className={`${BTN_SECONDARY} inline-flex items-center gap-2`}
          >
            <Wand2 className="h-4 w-4" />
            Use template
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmptyTasks — compact "no tasks yet" state for the right panel
// ---------------------------------------------------------------------------

export interface EmptyTasksProps {
  onCreateTask: () => void
}

export function EmptyTasks({ onCreateTask }: EmptyTasksProps): ReactElement {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 bg-bg-1 px-4 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border-mid bg-bg-2 text-text-3">
        <ListTodo className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-medium text-text-1">No tasks yet</p>
        <p className="mt-1 text-xs text-text-3">
          Kick things off by assigning work to an agent.
        </p>
      </div>
      <button
        type="button"
        onClick={onCreateTask}
        className={`${BTN_PRIMARY} inline-flex items-center gap-2`}
      >
        <ListTodo className="h-4 w-4" />
        Submit a task
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmptyHistory — single muted line
// ---------------------------------------------------------------------------

export function EmptyHistory(): ReactElement {
  return (
    <div className="flex w-full items-center justify-center gap-2 bg-bg-1 px-4 py-6 text-xs text-text-3">
      <History className="h-3.5 w-3.5" />
      <span>Nothing finished yet.</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmptyInbox — agent has no assigned tasks
// ---------------------------------------------------------------------------

export interface EmptyInboxProps {
  agentName: string
}

export function EmptyInbox({ agentName }: EmptyInboxProps): ReactElement {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 bg-bg-1 px-4 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border-mid bg-bg-2 text-text-3">
        <Inbox className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-medium text-text-1">
          No tasks assigned to <span className="text-accent-500">{agentName}</span>
        </p>
        <p className="mt-1 text-xs text-text-3">
          Use the Tasks panel and pick this agent as the assignee.
        </p>
      </div>
    </div>
  )
}
