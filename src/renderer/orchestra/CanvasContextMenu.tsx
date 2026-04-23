/**
 * CanvasContextMenu — right-click context menu for the Orchestra canvas.
 *
 * The menu shape depends on what was right-clicked:
 *   - pane  -> create-oriented actions (new agent/task, fit view, layout)
 *   - agent -> inspect/promote/lifecycle/assign/delete for one agent
 *   - edge  -> delete edge + delegation-mode stub
 *
 * Integration (wiring the `onContextMenu` handlers on Canvas / AgentCard /
 * ReportingEdge and mounting this component) is intentionally left to a
 * follow-up so this file stays self-contained and reviewable in isolation.
 *
 * The menu is absolutely-positioned at `{screenX, screenY}` and clamped to
 * the viewport so the bottom-right corner of the canvas never spawns a menu
 * that drops off-screen. Dismissal happens on Escape, outside click, scroll,
 * window blur, or after any menu item is chosen.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  Crown,
  Eye,
  ListTodo,
  Maximize2,
  Network,
  Pause,
  Play,
  Square,
  Trash2,
  Unlink,
  UserPlus
} from 'lucide-react'
import { useOrchestra } from './state/orchestra'

export type ContextMenuTarget =
  | { kind: 'pane'; flowX: number; flowY: number }
  | { kind: 'agent'; agentId: string }
  | { kind: 'edge'; edgeId: string }

interface Props {
  open: boolean
  screenX: number
  screenY: number
  target: ContextMenuTarget
  onClose: () => void
}

/** One actionable row in the menu. `divider: true` rows render a horizontal
 *  rule instead of a button and are skipped by keyboard navigation. */
type MenuItem =
  | {
      divider?: false
      key: string
      label: string
      icon: ReactNode
      onSelect: () => void
      danger?: boolean
      disabled?: boolean
    }
  | { divider: true; key: string }

const MENU_WIDTH = 200
const ROW_HEIGHT = 28 // matches py-1.5 + text-[12px] line-height
const DIVIDER_HEIGHT = 9 // border-t + my-1
const VERTICAL_PADDING = 8 // py-1 top + bottom

const fire = (name: string, detail?: unknown): void => {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export default function CanvasContextMenu({
  open,
  screenX,
  screenY,
  target,
  onClose
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Pull actions/data from the store. Using per-field selectors keeps the
  // component from re-rendering on unrelated slice changes (tasks, routes,
  // messageLog append churn).
  const setInspectorOpen = useOrchestra((s) => s.setInspectorOpen)
  const selectAgent = useOrchestra((s) => s.selectAgent)
  const promoteMain = useOrchestra((s) => s.promoteMain)
  const pauseAgent = useOrchestra((s) => s.pauseAgent)
  const stopAgent = useOrchestra((s) => s.stopAgent)
  const updateAgent = useOrchestra((s) => s.updateAgent)
  const deleteAgent = useOrchestra((s) => s.deleteAgent)
  const deleteEdge = useOrchestra((s) => s.deleteEdge)
  const agents = useOrchestra((s) => s.agents)
  const teams = useOrchestra((s) => s.teams)
  const activeTeamId = useOrchestra((s) => s.activeTeamId)

  // Resolve agent-specific context once per render. For pane/edge targets this
  // is cheap (the branches are never taken) and lets the item list above stay
  // declarative.
  const targetAgent =
    target.kind === 'agent'
      ? (agents.find((a) => a.id === target.agentId) ?? null)
      : null
  const activeTeam =
    activeTeamId !== null
      ? (teams.find((t) => t.id === activeTeamId) ?? null)
      : null
  const isTargetMain =
    targetAgent !== null && activeTeam?.mainAgentId === targetAgent.id

  const items = useMemo<MenuItem[]>(() => {
    if (target.kind === 'pane') {
      return [
        {
          key: 'new-agent-here',
          label: 'New agent here',
          icon: <UserPlus size={12} aria-hidden />,
          onSelect: () => {
            fire('orchestra:new-agent-at', {
              flowX: target.flowX,
              flowY: target.flowY
            })
          }
        },
        {
          key: 'new-task',
          label: 'New task',
          icon: <ListTodo size={12} aria-hidden />,
          onSelect: () => {
            fire('orchestra:new-task')
          }
        },
        {
          key: 'fit-view',
          label: 'Fit view',
          icon: <Maximize2 size={12} aria-hidden />,
          onSelect: () => {
            fire('orchestra:fit-view')
          }
        },
        {
          key: 'auto-layout',
          label: 'Auto-layout',
          icon: <Network size={12} aria-hidden />,
          onSelect: () => {
            // Stub: the layout algorithm lives in a future PR; dispatching now
            // means consumers can wire up listeners incrementally.
            fire('orchestra:auto-layout')
          }
        }
      ]
    }

    if (target.kind === 'agent') {
      const state = targetAgent?.state ?? 'idle'
      const out: MenuItem[] = [
        {
          key: 'inspect',
          label: 'Open inspector',
          icon: <Eye size={12} aria-hidden />,
          onSelect: () => {
            selectAgent(target.agentId, false)
            setInspectorOpen(true)
          }
        },
        {
          key: 'promote',
          label: 'Promote to main',
          icon: <Crown size={12} aria-hidden />,
          disabled: isTargetMain,
          onSelect: () => {
            if (isTargetMain) return
            void promoteMain(target.agentId)
          }
        }
      ]

      // Lifecycle row — shape follows agent state so the user sees the
      // transition that's actually legal right now (pause when running,
      // resume when paused). Stop is always present as a hard kill.
      if (state === 'running') {
        out.push({
          key: 'pause',
          label: 'Pause',
          icon: <Pause size={12} aria-hidden />,
          onSelect: () => {
            void pauseAgent(target.agentId)
          }
        })
      } else if (state === 'paused') {
        out.push({
          key: 'resume',
          label: 'Resume',
          icon: <Play size={12} aria-hidden />,
          onSelect: () => {
            // The store doesn't expose a dedicated resumeAgent yet; AgentCard
            // uses the same updateAgent-with-state fallback. Swap this when
            // `resumeAgent` lands.
            void updateAgent({
              id: target.agentId,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              patch: { state: 'running' } as any
            })
          }
        })
      }

      out.push(
        {
          key: 'stop',
          label: 'Stop',
          icon: <Square size={12} aria-hidden />,
          onSelect: () => {
            void stopAgent(target.agentId)
          }
        },
        {
          key: 'assign-task',
          label: 'Assign task',
          icon: <ListTodo size={12} aria-hidden />,
          onSelect: () => {
            fire('orchestra:new-task', { assignedAgentId: target.agentId })
          }
        },
        { divider: true, key: 'div-1' },
        {
          key: 'delete-agent',
          label: 'Delete agent',
          icon: <Trash2 size={12} aria-hidden />,
          danger: true,
          onSelect: () => {
            if (!window.confirm('Delete this agent?')) return
            void deleteAgent(target.agentId)
          }
        }
      )

      return out
    }

    // edge
    return [
      {
        key: 'delete-edge',
        label: 'Delete edge',
        icon: <Trash2 size={12} aria-hidden />,
        danger: true,
        onSelect: () => {
          if (!window.confirm('Delete this edge?')) return
          void deleteEdge(target.edgeId)
        }
      },
      {
        key: 'toggle-delegation',
        label: 'Toggle delegation mode',
        icon: <Unlink size={12} aria-hidden />,
        onSelect: () => {
          // Stub: the store does not yet expose `updateEdge`, so the best we
          // can do is log intent. Wire to the real action once it exists.
          // eslint-disable-next-line no-console
          console.info(
            '[CanvasContextMenu] toggle delegation requested',
            target.edgeId
          )
        }
      }
    ]
  }, [
    target,
    targetAgent?.state,
    isTargetMain,
    selectAgent,
    setInspectorOpen,
    promoteMain,
    pauseAgent,
    stopAgent,
    updateAgent,
    deleteAgent,
    deleteEdge
  ])

  // Indexes of items that are keyboard-navigable (everything except dividers
  // and disabled rows). Computed once per item list so arrow keys can hop
  // straight between real rows.
  const focusableIndexes = useMemo(
    () =>
      items
        .map((it, i) =>
          it.divider !== true && !(it as { disabled?: boolean }).disabled
            ? i
            : -1
        )
        .filter((i) => i >= 0),
    [items]
  )

  // Dismiss on outside click / Escape / scroll / window blur. Also wire
  // arrow-key navigation and Enter while the menu owns focus.
  useEffect(() => {
    if (!open) return

    const onMouseDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onScroll = (): void => onClose()
    const onBlur = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') {
        return
      }
      if (!ref.current) return
      const buttons = Array.from(
        ref.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      ).filter((b) => !b.disabled)
      if (buttons.length === 0) return
      const active = document.activeElement as HTMLElement | null
      const currentIdx = buttons.findIndex((b) => b === active)

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = currentIdx < 0 ? 0 : (currentIdx + 1) % buttons.length
        buttons[next]?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev =
          currentIdx <= 0 ? buttons.length - 1 : currentIdx - 1
        buttons[prev]?.focus()
      } else if (e.key === 'Enter') {
        if (currentIdx >= 0) {
          e.preventDefault()
          buttons[currentIdx]?.click()
        }
      }
    }

    // `true` on mousedown so we beat react-flow's own capture-phase handler
    // that would otherwise swallow the event and keep the menu open.
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey)

    // Autofocus first focusable row on open.
    const t = window.setTimeout(() => {
      const first = ref.current?.querySelector<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])'
      )
      first?.focus()
    }, 0)

    return () => {
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [open, onClose])

  if (!open) return null

  // Clamp to viewport. `focusableIndexes` is unrelated here — we measure the
  // true rendered height (real rows + dividers + padding) so the clamp works
  // for both pane (4 rows) and agent (7 rows + divider) shapes.
  const totalHeight =
    items.reduce(
      (acc, it) => acc + (it.divider === true ? DIVIDER_HEIGHT : ROW_HEIGHT),
      0
    ) + VERTICAL_PADDING

  const vw = typeof window !== 'undefined' ? window.innerWidth : MENU_WIDTH
  const vh = typeof window !== 'undefined' ? window.innerHeight : totalHeight
  const left = Math.max(4, Math.min(screenX, vw - MENU_WIDTH - 4))
  const top = Math.max(4, Math.min(screenY, vh - totalHeight - 4))

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="canvas context menu"
      tabIndex={-1}
      style={{ left, top, width: MENU_WIDTH }}
      className="fixed z-50 rounded-sm border border-border-mid bg-bg-2 py-1 shadow-pop"
      // Keep right-click on the menu itself from re-opening a nested menu.
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => {
        if (item.divider === true) {
          return (
            <div
              key={item.key}
              role="separator"
              className="my-1 border-t border-border-soft"
            />
          )
        }
        const tone = item.disabled
          ? 'cursor-not-allowed text-text-4'
          : item.danger
            ? 'text-status-attention hover:bg-bg-3'
            : 'text-text-2 hover:bg-bg-3 hover:text-text-1'
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              item.onSelect()
              onClose()
            }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] outline-none transition-colors focus:bg-bg-3 focus:text-text-1 ${tone}`}
          >
            <span
              className={`flex h-3 w-3 shrink-0 items-center justify-center ${
                item.disabled ? 'text-text-4' : 'text-text-3'
              }`}
              aria-hidden
            >
              {item.icon}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
