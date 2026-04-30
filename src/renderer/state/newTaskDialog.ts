/**
 * Global controller for the orchestrator's New-Task dialog.
 *
 * The dialog used to be a child of `CanvasFabs`, which limited it to
 * the OrchestraView. Phase 4 of issue #12 lifts it to App-level so
 * any surface (sidebar, command palette, global shortcut) can ask for
 * "new task in <project>" without caring whether the orchestrator
 * canvas is currently mounted.
 */

import { create } from 'zustand'
import type { UUID } from '../../shared/orchestra'

export interface NewTaskInitialContext {
  /** Pre-fill / pre-resolve the target team-instance directly. Wins
   *  over `projectPath`. */
  instanceId?: UUID
  /** Pre-fill from a project root. The dialog resolves the instance
   *  via `orchestra.instance.list({ projectPath })`. */
  projectPath?: string
}

interface NewTaskDialogState {
  open: boolean
  context: NewTaskInitialContext
  show: (context?: NewTaskInitialContext) => void
  hide: () => void
}

export const useNewTaskDialog = create<NewTaskDialogState>((set) => ({
  open: false,
  context: {},
  show: (context = {}) => set({ open: true, context }),
  hide: () => set({ open: false, context: {} })
}))
