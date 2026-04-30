import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * UI preferences that don't belong to any one feature store.
 *
 * `zenMode` controls how the "hover-reveal" affordances render across
 * the app. Off (default): subdued buttons stay visible at a reduced
 * opacity so the UI is discoverable on machines where hover/compositing
 * is unreliable (broken GPU, no-pointer touch, screen readers). On:
 * buttons hide entirely until the parent row is hovered — the original
 * dense aesthetic.
 *
 * The actual visibility is implemented by `.df-hover-reveal` in
 * globals.css, which reads `--hover-reveal-base` from `<html>`. The
 * effect in App.tsx mirrors `zenMode` into `data-zen-mode` on the root.
 * Components only need the class — no per-component state plumbing.
 */
interface UIPreferencesState {
  zenMode: boolean
  setZenMode: (value: boolean) => void
  toggleZenMode: () => void
}

export const useUIPreferences = create<UIPreferencesState>()(
  persist(
    (set) => ({
      zenMode: false,
      setZenMode: (value) => set({ zenMode: value }),
      toggleZenMode: () => set((s) => ({ zenMode: !s.zenMode }))
    }),
    { name: 'hydra.ui.preferences' }
  )
)
