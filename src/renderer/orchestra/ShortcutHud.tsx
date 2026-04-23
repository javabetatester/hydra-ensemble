/**
 * ShortcutHud — thin strip at the bottom of the Orchestra view that surfaces
 * the most-useful keyboard shortcuts for the current focus context.
 *
 * Instead of forcing the user to open the help overlay (`?`), we render a
 * pinned pill with up to 6 chips. The chip set swaps between canvas /
 * inspector / task drawer based on what the user is currently interacting
 * with. If a modal is open we hide the HUD entirely so it never competes
 * with the primary dialog.
 *
 * Focus/open detection is a mix of Zustand (`inspectorOpen`,
 * `taskDrawerTaskId`) and a DOM poll — focus changes don't emit events
 * reliably, so we cache the computed context with a 500ms interval.
 *
 * Dismissible: clicking X writes `hydra.orchestra.hud.dismissed = true`
 * to localStorage and the component renders nothing for the rest of the
 * session (and on subsequent mounts).
 */
import { useEffect, useState } from 'react'
import { Keyboard, X } from 'lucide-react'
import { useOrchestra } from './state/orchestra'

interface Props {}

type HudContext = 'canvas' | 'inspector' | 'task-drawer' | 'modal' | 'none'

interface Chip {
  keys: string
  description: string
}

const DISMISS_KEY = 'hydra.orchestra.hud.dismissed'
const POLL_MS = 500

const CHIPS_CANVAS: ReadonlyArray<Chip> = [
  { keys: 'A', description: 'New agent' },
  { keys: 'Del', description: 'Remove' },
  { keys: 'Esc', description: 'Deselect' },
  { keys: 'Ctrl+0', description: 'Fit' },
  { keys: '/', description: 'Focus task' },
  { keys: '?', description: 'Help' },
]

const CHIPS_INSPECTOR: ReadonlyArray<Chip> = [
  { keys: 'Esc', description: 'Close' },
  { keys: 'Arrow keys', description: 'Switch tabs' },
  { keys: 'Ctrl+S', description: 'Save soul' },
]

const CHIPS_TASK_DRAWER: ReadonlyArray<Chip> = [
  { keys: 'Esc', description: 'Close' },
  { keys: 'C', description: 'Cancel task' },
]

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === 'true'
  } catch {
    return false
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, 'true')
  } catch {
    // localStorage unavailable — dismissal is best-effort only.
  }
}

function computeContext(inspectorOpen: boolean, taskDrawerOpen: boolean): HudContext {
  if (typeof document === 'undefined') return 'none'

  // Modal wins over everything — we don't want to compete with a dialog.
  if (document.querySelector('[role="dialog"]') !== null) return 'modal'

  // Zustand-driven panels take precedence over raw canvas focus; the canvas
  // is visible behind them but the user's attention is elsewhere.
  if (inspectorOpen) return 'inspector'
  if (taskDrawerOpen) return 'task-drawer'

  const canvas = document.querySelector<HTMLElement>('[data-coach="canvas"]:focus-within')
  if (canvas !== null) return 'canvas'

  return 'none'
}

function chipsFor(ctx: HudContext): ReadonlyArray<Chip> {
  switch (ctx) {
    case 'canvas':
      return CHIPS_CANVAS
    case 'inspector':
      return CHIPS_INSPECTOR
    case 'task-drawer':
      return CHIPS_TASK_DRAWER
    default:
      return []
  }
}

export default function ShortcutHud() {
  const inspectorOpen = useOrchestra((s) => s.inspectorOpen)
  const taskDrawerTaskId = useOrchestra((s) => s.taskDrawerTaskId)
  const taskDrawerOpen = taskDrawerTaskId !== null

  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed())
  const [context, setContext] = useState<HudContext>(() =>
    computeContext(inspectorOpen, taskDrawerOpen),
  )

  // Poll the DOM for focus changes. Focus events are unreliable here because
  // the canvas owns a complex tree (SVG + overlays) that doesn't always
  // surface focus-in/-out consistently across browsers.
  useEffect(() => {
    if (dismissed) return

    let cancelled = false
    const tick = () => {
      if (cancelled) return
      const next = computeContext(inspectorOpen, taskDrawerOpen)
      setContext((prev) => (prev === next ? prev : next))
    }

    tick()
    const id = window.setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [dismissed, inspectorOpen, taskDrawerOpen])

  if (dismissed) return null
  if (context === 'modal' || context === 'none') return null

  const chips = chipsFor(context).slice(0, 6)
  if (chips.length === 0) return null

  const handleDismiss = () => {
    writeDismissed()
    setDismissed(true)
  }

  return (
    <div
      className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2"
      role="status"
      aria-label="Keyboard shortcuts"
    >
      <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/70 px-4 py-2 font-mono text-xs text-white/80 shadow-lg backdrop-blur">
        <Keyboard className="h-3.5 w-3.5 shrink-0 text-white/60" aria-hidden="true" />

        <ul className="flex items-center gap-3">
          {chips.map((chip) => (
            <li key={chip.keys} className="flex items-center gap-1.5 whitespace-nowrap">
              <kbd className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                {chip.keys}
              </kbd>
              <span className="text-white/50">{chip.description}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={handleDismiss}
          className="ml-1 rounded-full p-1 text-white/40 transition hover:bg-white/10 hover:text-white/80"
          aria-label="Dismiss shortcut HUD"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
