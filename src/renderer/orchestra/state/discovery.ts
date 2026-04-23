/**
 * Discovery / onboarding telemetry for Orchestra.
 *
 * Tracks three signals used by the classic-UI first-run toast and the
 * in-Orchestra coach-mark tour:
 *   - how many times classic Hydra has booted (floor for the nudge)
 *   - whether the user dismissed the nudge explicitly ("don't show again")
 *   - whether the coach-mark tour has been completed
 *
 * Intentionally a *separate* slice from `useOrchestra` so classic users who
 * never opt in still write to it (the nudge lives on the classic surface).
 * Persisted under its own storage key so we can evolve the Orchestra view
 * slice without migrating discovery flags.
 *
 * See PRD.md §9 (first-run nudge) and §13 (empty states & onboarding).
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface DiscoveryState {
  /** Monotonic count of classic-UI boots; used for the >=5 threshold. */
  bootCount: number
  /** ISO timestamp of the user's explicit "don't show again" click.
   *  `null` means the toast is still eligible. */
  firstRunToastDismissedAt: string | null
  /** True once the user finishes or skips the in-Orchestra coach tour. */
  coachMarksCompleted: boolean
  /** Active step index of the coach-mark tour (0..3). Only meaningful
   *  while `coachMarksCompleted` is false. */
  currentCoachStep: number

  incrementBoot: () => void
  dismissFirstRunToast: () => void
  startCoachMarks: () => void
  advanceCoachStep: () => void
  completeCoachMarks: () => void
  reset: () => void
}

/** Module-level latch: guarantees `incrementBoot` only counts once per
 *  renderer session no matter how many components call it (StrictMode
 *  double-mount, hot reloads, etc.). Lives outside the store so it
 *  survives state rehydration but resets on full page reload. */
let __bootedThisSession = false

/** Exposed for tests that need to simulate a fresh session without
 *  reloading the window. Not part of the public discovery API. */
export const __resetBootLatchForTests = (): void => {
  __bootedThisSession = false
}

export const useDiscovery = create<DiscoveryState>()(
  persist(
    (set) => ({
      bootCount: 0,
      firstRunToastDismissedAt: null,
      coachMarksCompleted: false,
      currentCoachStep: 0,

      incrementBoot: () => {
        if (__bootedThisSession) return
        __bootedThisSession = true
        set((s) => ({ bootCount: s.bootCount + 1 }))
      },

      dismissFirstRunToast: () => {
        set({ firstRunToastDismissedAt: new Date().toISOString() })
      },

      startCoachMarks: () => {
        // Only reset the step pointer if the tour hasn't been completed.
        // Calling this mid-tour (e.g. remount) should be a no-op.
        set((s) => (s.coachMarksCompleted ? s : { currentCoachStep: 0 }))
      },

      advanceCoachStep: () => {
        set((s) => ({ currentCoachStep: s.currentCoachStep + 1 }))
      },

      completeCoachMarks: () => {
        set({ coachMarksCompleted: true })
      },

      reset: () => {
        __bootedThisSession = false
        set({
          bootCount: 0,
          firstRunToastDismissedAt: null,
          coachMarksCompleted: false,
          currentCoachStep: 0
        })
      }
    }),
    {
      name: 'hydra.orchestra.discovery',
      storage: createJSONStorage(() => localStorage)
    }
  )
)
