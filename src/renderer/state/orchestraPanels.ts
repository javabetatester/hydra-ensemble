/**
 * Persisted toggles for every collapsible surface of the Orchestrator
 * view. Single source of truth for the breadcrumb's `View ▾`
 * dropdown, the sidebar/dock keybinds (Ctrl+Shift+L/P/J), and any
 * future panel toggles.
 *
 * Replaces the earlier scattering: the View dropdown used to read
 * `hydra.orchestra.view.{minimap,toolbar,tasksPanel}` directly from
 * localStorage with no consumer wired up; the canvas-side panels
 * I added had a parallel store. Both now live here under
 * `hydra.orchestra.panels`, and consumers (Canvas chrome, Right
 * Dock, Templates panel, Projects rail) all read this store.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface OrchestraPanelsState {
  /** Templates Library — left side, default closed. */
  templates: boolean
  /** Projects & Teams (the new home of TeamRail) — left side,
   *  default open since it's the primary navigation surface. */
  projects: boolean
  /** Right dock (Tasks / History / Changes / Activity / Inspector). */
  tasksPanel: boolean
  /** Canvas minimap, anchored bottom-right of the workspace. */
  minimap: boolean
  /** Canvas toolbar (fit-view / auto-layout / templates), bottom-left. */
  toolbar: boolean

  toggleTemplates: () => void
  toggleProjects: () => void
  toggleTasksPanel: () => void
  toggleMinimap: () => void
  toggleToolbar: () => void

  setTemplates: (open: boolean) => void
  setProjects: (open: boolean) => void
  setTasksPanel: (open: boolean) => void
  setMinimap: (open: boolean) => void
  setToolbar: (open: boolean) => void
}

export const useOrchestraPanels = create<OrchestraPanelsState>()(
  persist(
    (set) => ({
      templates: false,
      projects: true,
      tasksPanel: true,
      minimap: true,
      toolbar: true,

      toggleTemplates: () => set((s) => ({ templates: !s.templates })),
      toggleProjects: () => set((s) => ({ projects: !s.projects })),
      toggleTasksPanel: () => set((s) => ({ tasksPanel: !s.tasksPanel })),
      toggleMinimap: () => set((s) => ({ minimap: !s.minimap })),
      toggleToolbar: () => set((s) => ({ toolbar: !s.toolbar })),

      setTemplates: (open) => set({ templates: open }),
      setProjects: (open) => set({ projects: open }),
      setTasksPanel: (open) => set({ tasksPanel: open }),
      setMinimap: (open) => set({ minimap: open }),
      setToolbar: (open) => set({ toolbar: open })
    }),
    {
      name: 'hydra.orchestra.panels',
      storage: createJSONStorage(() => localStorage)
    }
  )
)
