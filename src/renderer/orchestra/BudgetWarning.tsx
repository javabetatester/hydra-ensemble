/**
 * BudgetWarning — full-width banner pinned below TeamOverview that shows
 * a caution (yellow) once projected spending crosses 80% of a user
 * configurable threshold, and an alert (red) with a "Pause all running
 * agents" action once it crosses 100%.
 *
 * Threshold is stored in localStorage so it survives reloads; dismissal
 * lives in sessionStorage so the warning reappears in a fresh session.
 * No IPC, no new deps — purely derives from the live MessageLog via
 * sumMessages, same approximation the BudgetMeter uses.
 */

import { AlertTriangle, Pause, Settings, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { useOrchestra } from './state/orchestra'
import { formatCents, sumMessages } from './lib/budget'

interface Props {}

const THRESHOLD_STORAGE_KEY = 'hydra.orchestra.budgetThresholdCents'
const DISMISS_SESSION_KEY = 'hydra.orchestra.budgetWarningDismissed'
const DEFAULT_THRESHOLD_CENTS = 100
const BANNER_HEIGHT_PX = 28

type Level = 'ok' | 'warn' | 'danger'

function readThreshold(): number {
  if (typeof window === 'undefined') return DEFAULT_THRESHOLD_CENTS
  try {
    const raw = window.localStorage.getItem(THRESHOLD_STORAGE_KEY)
    if (!raw) return DEFAULT_THRESHOLD_CENTS
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_THRESHOLD_CENTS
    }
    return Math.round(parsed)
  } catch {
    return DEFAULT_THRESHOLD_CENTS
  }
}

function writeThreshold(cents: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(THRESHOLD_STORAGE_KEY, String(cents))
  } catch {
    // storage is best-effort; swallow quota / disabled-storage errors
  }
}

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(DISMISS_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(dismissed: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (dismissed) {
      window.sessionStorage.setItem(DISMISS_SESSION_KEY, '1')
    } else {
      window.sessionStorage.removeItem(DISMISS_SESSION_KEY)
    }
  } catch {
    // swallow — dismissal is a UX nicety, not a correctness requirement
  }
}

function classifyLevel(cents: number, thresholdCents: number): Level {
  if (thresholdCents <= 0) return 'ok'
  const ratio = cents / thresholdCents
  if (ratio >= 1) return 'danger'
  if (ratio >= 0.8) return 'warn'
  return 'ok'
}

export default function BudgetWarning(_props: Props) {
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const teams = useOrchestra((s) => s.teams)
  const messageLog = useOrchestra((s) => s.messageLog)

  const [thresholdCents, setThresholdCents] = useState<number>(() =>
    readThreshold()
  )
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed())
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [thresholdDraft, setThresholdDraft] = useState<string>(() =>
    (readThreshold() / 100).toFixed(2)
  )

  const popoverRef = useRef<HTMLDivElement | null>(null)
  const gearBtnRef = useRef<HTMLButtonElement | null>(null)

  const team = useMemo(
    () =>
      activeTeamId ? teams.find((t) => t.id === activeTeamId) : undefined,
    [teams, activeTeamId]
  )
  const model = team?.defaultModel || 'sonnet'

  const cents = useMemo(() => {
    if (!activeTeamId) return 0
    const filtered = messageLog.filter((m) => m.teamId === activeTeamId)
    return sumMessages(filtered, model).cents
  }, [messageLog, activeTeamId, model])

  const level = classifyLevel(cents, thresholdCents)
  const visible = !dismissed && level !== 'ok' && Boolean(activeTeamId)

  // Keep the draft input in sync whenever the threshold actually changes
  // (e.g., another tab writes through the same localStorage key).
  useEffect(() => {
    setThresholdDraft((thresholdCents / 100).toFixed(2))
  }, [thresholdCents])

  // Close popover on outside click / Esc — standard modal-lite behavior.
  useEffect(() => {
    if (!popoverOpen) return
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (popoverRef.current?.contains(target)) return
      if (gearBtnRef.current?.contains(target)) return
      setPopoverOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [popoverOpen])

  const applyThreshold = useCallback(() => {
    const parsed = Number(thresholdDraft)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      // Reject invalid input silently and snap the draft back to the
      // currently-saved value so the user sees what's active.
      setThresholdDraft((thresholdCents / 100).toFixed(2))
      return
    }
    const nextCents = Math.max(1, Math.round(parsed * 100))
    setThresholdCents(nextCents)
    writeThreshold(nextCents)
  }, [thresholdDraft, thresholdCents])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
    writeDismissed(true)
  }, [])

  const handlePauseAll = useCallback(() => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('orchestra:pause-all'))
  }, [])

  const palette =
    level === 'danger'
      ? {
          bg: 'bg-red-500/15',
          border: 'border-red-500/60',
          text: 'text-red-200',
          icon: 'text-red-300',
          btn: 'bg-red-500/80 hover:bg-red-500 text-white',
          gear: 'hover:bg-red-500/25 text-red-200',
          close: 'hover:bg-red-500/25 text-red-200'
        }
      : {
          bg: 'bg-amber-500/15',
          border: 'border-amber-500/60',
          text: 'text-amber-200',
          icon: 'text-amber-300',
          btn: 'bg-amber-500/80 hover:bg-amber-500 text-white',
          gear: 'hover:bg-amber-500/25 text-amber-200',
          close: 'hover:bg-amber-500/25 text-amber-200'
        }

  const ratioPct = thresholdCents > 0 ? (cents / thresholdCents) * 100 : 0

  const wrapperStyle: CSSProperties = {
    height: `${BANNER_HEIGHT_PX}px`,
    transform: visible
      ? 'translateY(0)'
      : `translateY(-${BANNER_HEIGHT_PX}px)`,
    opacity: visible ? 1 : 0,
    transition:
      'transform 180ms ease-out, opacity 180ms ease-out'
  }

  // The wrapper is always rendered (even when hidden) so the slide-up
  // animation has something to animate out of. aria-hidden + inert-ish
  // pointer handling keeps it out of the tab order when off-screen.
  return (
    <div
      role="status"
      aria-hidden={!visible}
      aria-live="polite"
      style={wrapperStyle}
      className={`pointer-events-none absolute left-0 right-0 top-0 z-30 flex w-full items-center overflow-visible border-b ${palette.border} ${palette.bg} ${palette.text} px-3 text-[11px] shadow-sm backdrop-blur-md`}
    >
      <div
        className={`pointer-events-auto flex h-full w-full items-center gap-2`}
      >
        <AlertTriangle
          size={14}
          className={`${palette.icon} shrink-0`}
          aria-hidden
        />

        <span className="truncate font-medium">
          {level === 'danger'
            ? `Budget exceeded — ${formatCents(cents)} of ${formatCents(thresholdCents)} (${Math.round(ratioPct)}%)`
            : `Approaching budget — ${formatCents(cents)} of ${formatCents(thresholdCents)} (${Math.round(ratioPct)}%)`}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {level === 'danger' && (
            <button
              type="button"
              onClick={handlePauseAll}
              className={`inline-flex h-[20px] items-center gap-1 rounded-sm px-2 text-[10px] font-semibold uppercase tracking-wide ${palette.btn}`}
              title="Pause all running agents"
            >
              <Pause size={12} aria-hidden />
              Pause all running agents
            </button>
          )}

          <div className="relative">
            <button
              ref={gearBtnRef}
              type="button"
              onClick={() => setPopoverOpen((v) => !v)}
              className={`inline-flex h-[20px] w-[20px] items-center justify-center rounded-sm ${palette.gear}`}
              title="Adjust budget threshold"
              aria-haspopup="dialog"
              aria-expanded={popoverOpen}
            >
              <Settings size={13} aria-hidden />
            </button>

            {popoverOpen && (
              <div
                ref={popoverRef}
                role="dialog"
                aria-label="Budget threshold"
                className="absolute right-0 top-full z-40 mt-1 w-[220px] rounded-sm border border-border-soft bg-bg-2/95 p-2 text-[11px] text-text-2 shadow-pop backdrop-blur-md"
              >
                <label
                  htmlFor="budget-threshold-input"
                  className="df-label mb-1 block text-[10px] uppercase tracking-wide text-text-4"
                >
                  Threshold (USD)
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-text-4">$</span>
                  <input
                    id="budget-threshold-input"
                    type="number"
                    min={0.01}
                    step={0.25}
                    value={thresholdDraft}
                    onChange={(e) => setThresholdDraft(e.target.value)}
                    onBlur={applyThreshold}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        applyThreshold()
                        setPopoverOpen(false)
                      }
                    }}
                    className="w-full rounded-sm border border-border-soft bg-bg-1 px-1.5 py-0.5 font-mono text-[11px] text-text-1 outline-none focus:border-accent"
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-text-4">
                  Warning at 80% · alert at 100%. Current:{' '}
                  <span className="font-mono text-text-2">
                    {formatCents(cents)}
                  </span>
                </p>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      applyThreshold()
                      setPopoverOpen(false)
                    }}
                    className="rounded-sm border border-border-soft bg-bg-1 px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-2 hover:bg-bg-3"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            className={`inline-flex h-[20px] w-[20px] items-center justify-center rounded-sm ${palette.close}`}
            title="Dismiss for this session"
            aria-label="Dismiss budget warning"
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}
