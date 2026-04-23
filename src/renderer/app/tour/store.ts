import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Tour } from './types'

/**
 * Tour controller store.
 *
 * Runtime state (activeId, stepIndex) is in-memory — a tour is a
 * foreground interaction, not something to rehydrate on reload.
 * Persisted state (completedIds) lives in localStorage so we can hide
 * tours the user has already seen from the launcher menu without
 * nagging.
 */

interface TourState {
  activeId: string | null
  stepIndex: number
  tours: Record<string, Tour>
  completedIds: Record<string, number>

  register(tour: Tour): void
  start(id: string): void
  next(): void
  back(): void
  stop(complete?: boolean): void
  reset(id: string): void
  resetAll(): void
}

export const useTour = create<TourState>()(
  persist(
    (set, get) => ({
      activeId: null,
      stepIndex: 0,
      tours: {},
      completedIds: {},

      register(tour) {
        set((s) => ({ tours: { ...s.tours, [tour.id]: tour } }))
      },

      start(id) {
        if (!get().tours[id]) return
        set({ activeId: id, stepIndex: 0 })
      },

      next() {
        const { activeId, stepIndex, tours } = get()
        if (!activeId) return
        const tour = tours[activeId]
        if (!tour) return
        if (stepIndex + 1 >= tour.steps.length) {
          // Finished — mark complete and tear down.
          set((s) => ({
            activeId: null,
            stepIndex: 0,
            completedIds: { ...s.completedIds, [activeId]: Date.now() }
          }))
          return
        }
        set({ stepIndex: stepIndex + 1 })
      },

      back() {
        const { stepIndex } = get()
        if (stepIndex <= 0) return
        set({ stepIndex: stepIndex - 1 })
      },

      stop(complete = false) {
        const { activeId } = get()
        if (complete && activeId) {
          set((s) => ({
            activeId: null,
            stepIndex: 0,
            completedIds: { ...s.completedIds, [activeId]: Date.now() }
          }))
          return
        }
        set({ activeId: null, stepIndex: 0 })
      },

      reset(id) {
        set((s) => {
          const next = { ...s.completedIds }
          delete next[id]
          return { completedIds: next }
        })
      },

      resetAll() {
        set({ completedIds: {} })
      }
    }),
    {
      name: 'hydra.tour.v2',
      // Register map is NOT persisted — tours are declared at module
      // load time by each feature that owns them. Persisting would
      // lock us into a stale schema after a release bump.
      partialize: (s) => ({ completedIds: s.completedIds })
    }
  )
)
