/**
 * CanvasFabs — stacked floating action buttons anchored to the bottom-right
 * corner of the Orchestra canvas.
 *
 * The outer wrapper is `pointer-events-none` so double-click on the react-flow
 * pane still registers underneath; the buttons themselves opt back in with
 * `pointer-events-auto`. Self-contained: owns the open state for both the
 * NewAgentPopover (centred on the viewport since there's no cursor position)
 * and the NewTaskDialog.
 */
import { useState } from 'react'
import { Plus, UserPlus, Users } from 'lucide-react'
import { useOrchestra } from './state/orchestra'
import NewAgentPopover from './modals/NewAgentPopover'
import { useNewTaskDialog } from '../state/newTaskDialog'
import { fmtShortcut } from '../lib/platform'

interface Props {}

export default function CanvasFabs(_props: Props) {
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const showNewTask = useNewTaskDialog((s) => s.show)

  const [agentOpen, setAgentOpen] = useState(false)

  const primaryDisabled = activeTeamId === null

  const openAgent = (): void => {
    if (primaryDisabled) return
    setAgentOpen(true)
  }

  const openTask = (): void => {
    // Inside OrchestraView: open the task dialog without a project
    // context so it falls back to the orchestrator's `activeTeamId`
    // (the legacy FAB behaviour).
    showNewTask()
  }

  // Centre of the viewport — used only when there's no cursor anchor to
  // position the popover against (FAB click, unlike double-click on pane).
  const centerX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0
  const centerY = typeof window !== 'undefined' ? window.innerHeight / 2 : 0

  return (
    <>
      <div className="pointer-events-none absolute bottom-4 right-4 z-30 flex flex-col items-end gap-2">
        {/* Primary FAB — New agent */}
        <FabButton
          label="New agent"
          shortcutHint={fmtShortcut('A')}
          disabled={primaryDisabled}
          disabledTooltip="Create a team first"
          onClick={openAgent}
          size={44}
          variant="primary"
          aria-label="new agent"
        >
          <UserPlus size={18} strokeWidth={2} />
        </FabButton>

        {/* Secondary FAB — New task */}
        <div data-tour-id="orchestra-new-task">
          <FabButton
            label="New task"
            onClick={openTask}
            size={36}
            variant="secondary"
            aria-label="new task"
          >
            <span className="relative inline-flex items-center justify-center">
              <Users size={14} strokeWidth={2} />
              <Plus
                size={10}
                strokeWidth={2.5}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-bg-2 p-[1px] text-text-1"
              />
            </span>
          </FabButton>
        </div>
      </div>

      {activeTeamId !== null && (
        <NewAgentPopover
          open={agentOpen}
          onClose={() => setAgentOpen(false)}
          teamId={activeTeamId}
          position={{ x: centerX, y: centerY }}
        />
      )}
    </>
  )
}

interface FabButtonProps {
  label: string
  shortcutHint?: string
  disabled?: boolean
  disabledTooltip?: string
  onClick: () => void
  size: number
  variant: 'primary' | 'secondary'
  'aria-label': string
  children: React.ReactNode
}

function FabButton({
  label,
  shortcutHint,
  disabled = false,
  disabledTooltip,
  onClick,
  size,
  variant,
  'aria-label': ariaLabel,
  children
}: FabButtonProps) {
  const tooltipText = disabled && disabledTooltip ? disabledTooltip : label

  const base =
    variant === 'primary'
      ? 'bg-accent-500 text-white hover:bg-accent-400'
      : 'border border-border-mid bg-bg-2 text-text-1 hover:bg-bg-3'

  return (
    <div className="group pointer-events-auto relative flex items-center">
      {/* Left-side slide-out tooltip */}
      <div
        className="pointer-events-none absolute right-full mr-2 flex -translate-x-1 items-center gap-1.5 whitespace-nowrap rounded-full border border-border-soft bg-bg-2 px-2.5 py-1 text-[11px] text-text-1 opacity-0 shadow-pop transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100"
        role="tooltip"
      >
        <span>{tooltipText}</span>
        {!disabled && shortcutHint && (
          <span className="rounded-sm border border-border-soft bg-bg-1 px-1 py-[1px] font-mono text-[10px] text-text-3">
            {shortcutHint}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        className={`flex items-center justify-center rounded-full shadow-pop transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-bg-2 ${base}`}
        style={{ width: size, height: size }}
      >
        {children}
      </button>
    </div>
  )
}
