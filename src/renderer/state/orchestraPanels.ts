/**
 * Persisted toggles for the Orchestrator's collapsible panels.
 *
 * Mirrors the panel paradigm of the classic layout (`Ctrl+T` /
 * `Ctrl+E` / etc) — each panel is independently open/closeable so
 * the user can compose a layout that fits the task at hand instead
 * of paying for sub-tabs.
 *
 * Three toggles for now: Templates Library, Projects & Teams, Right
 * Dock. Inspector mode lives inside the Right Dock and is governed
 * by selection (see `SidePanels`); it doesn't need its own panel
 * flag.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface OrchestraPanelsState {
  /** Templates Library — left side, default closed. */
  templates: boolean
  /** Projects & Teams (the new home of TeamRail) — left side,
   *  default open since it's the primary navigation surface. */
  projects: boolean
  /** Right dock (Tasks / History / Changes / Activity / Inspector) —
   *  default open. */
  dock: boolean

  toggleTemplates: () => void
  toggleProjects: () => void
  toggleDock: () => void
  setTemplates: (open: boolean) => void
  setProjects: (open: boolean) => void
  setDock: (open: boolean) => void
}

export const useOrchestraPanels = create<OrchestraPanelsState>()(
  persist(
    (set) => ({
      templates: false,
      projects: true,
      dock: true,
      toggleTemplates: () => set((s) => ({ templates: !s.templates })),
      toggleProjects: () => set((s) => ({ projects: !s.projects })),
      toggleDock: () => set((s) => ({ dock: !s.dock })),
      setTemplates: (open) => set({ templates: open }),
      setProjects: (open) => set({ projects: open }),
      setDock: (open) => set({ dock: open })
    }),
    {
      name: 'hydra.orchestra.panels',
      storage: createJSONStorage(() => localStorage)
    }
  )
)
