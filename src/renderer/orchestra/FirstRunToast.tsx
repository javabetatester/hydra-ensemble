/**
 * FirstRunToast — non-blocking suggestion shown in CLASSIC Hydra once the
 * user has booted >=5 times without ever enabling Orchestra.
 *
 * PRD.md §9: "First-run nudge: if the user has opened Hydra >=5 times and
 * never opened Orchestra, show a one-time *non-blocking* toast with an
 * 'Open Orchestra' action. Never via an in-app modal that interrupts
 * classic users." (see also §20 — no modal interruptions).
 *
 * This is deliberately NOT wired through `useToasts`: the generic toast
 * store has no notion of inline action buttons, and we need both an
 * "Open Orchestra" CTA and a secondary "Don't show again" affordance.
 * Styling still mirrors `components/Toasts.tsx` so the visual language
 * stays consistent.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { Network, X } from 'lucide-react'
import { useOrchestra } from './state/orchestra'
import { useDiscovery } from './state/discovery'

/** Delay before the toast slides in on a qualifying boot. Gives the rest
 *  of the app a beat to settle so the nudge doesn't race with boot
 *  splashes / session restoration. */
const APPEAR_DELAY_MS = 2_000

/** Auto-hide timeout. Hiding only ejects the component locally — it does
 *  NOT set `firstRunToastDismissedAt`, so the nudge remains eligible on
 *  subsequent boots (and the user can still reach Orchestra via the
 *  command palette). */
const AUTO_HIDE_MS = 25_000

export default function FirstRunToast(): ReactElement | null {
  const orchestraEnabled = useOrchestra((s) => s.settings.enabled)
  const setSettings = useOrchestra((s) => s.setSettings)
  const setOverlayOpen = useOrchestra((s) => s.setOverlayOpen)

  const bootCount = useDiscovery((s) => s.bootCount)
  const dismissedAt = useDiscovery((s) => s.firstRunToastDismissedAt)
  const dismissFirstRunToast = useDiscovery((s) => s.dismissFirstRunToast)

  // Local visibility separate from the "don't show again" flag. Lets the
  // user close the toast for this boot ("Not now") without poisoning the
  // persistent flag.
  const [visible, setVisible] = useState(false)
  const [hiddenThisBoot, setHiddenThisBoot] = useState(false)

  const eligible =
    !orchestraEnabled && bootCount >= 5 && dismissedAt === null && !hiddenThisBoot

  useEffect(() => {
    if (!eligible) {
      setVisible(false)
      return
    }
    const appearTimer = window.setTimeout(() => setVisible(true), APPEAR_DELAY_MS)
    return () => window.clearTimeout(appearTimer)
  }, [eligible])

  useEffect(() => {
    if (!visible) return
    const hideTimer = window.setTimeout(() => {
      // Auto-hide for this boot only; do NOT persist dismissal.
      setHiddenThisBoot(true)
    }, AUTO_HIDE_MS)
    return () => window.clearTimeout(hideTimer)
  }, [visible])

  if (!eligible || !visible) return null

  const handleOpen = (): void => {
    // Fire-and-forget: setSettings persists through IPC but we don't need
    // to await it before opening the overlay — the optimistic local state
    // update inside `setSettings` is synchronous.
    void setSettings({ enabled: true })
    setOverlayOpen(true)
    dismissFirstRunToast()
  }

  const handleNotNow = (): void => {
    // Hide for this boot only. The nudge is still eligible next launch.
    setHiddenThisBoot(true)
  }

  const handleDontShowAgain = (): void => {
    dismissFirstRunToast()
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="df-slide-in pointer-events-auto fixed bottom-12 right-4 z-[60] flex w-80 flex-col border bg-bg-2 shadow-pop border-border-mid"
      style={{ borderRadius: 'var(--radius-md)' }}
    >
      {/* Close (top-right) — equivalent to "Not now" but discoverable. */}
      <button
        type="button"
        onClick={handleNotNow}
        className="absolute right-1.5 top-1.5 rounded p-1 text-text-4 hover:bg-bg-3 hover:text-text-1"
        title="close"
        aria-label="close"
      >
        <X size={12} strokeWidth={1.75} />
      </button>

      <div className="flex items-start gap-2.5 px-3 pt-3">
        <span className="mt-0.5 shrink-0">
          <Network size={14} strokeWidth={1.75} className="text-text-2" />
        </span>
        <div className="min-w-0 flex-1 pr-4">
          <div className="truncate text-sm font-semibold text-text-1">
            New: Orchestra mode
          </div>
          <div className="mt-1 text-[12px] leading-snug text-text-3">
            Run teams of headless claude agents on tasks. Alpha — opt in to try.
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 px-3">
        <button
          type="button"
          onClick={handleOpen}
          className="rounded border border-border-mid bg-bg-3 px-2.5 py-1 text-[12px] font-medium text-text-1 hover:bg-bg-1"
        >
          Open Orchestra
        </button>
        <button
          type="button"
          onClick={handleNotNow}
          className="rounded px-2 py-1 text-[12px] text-text-2 hover:text-text-1"
        >
          Not now
        </button>
      </div>

      <div className="mt-2 px-3 pb-2.5">
        <button
          type="button"
          onClick={handleDontShowAgain}
          className="text-[11px] text-text-4 underline-offset-2 hover:text-text-2 hover:underline"
        >
          Don&apos;t show again
        </button>
      </div>
    </div>
  )
}
