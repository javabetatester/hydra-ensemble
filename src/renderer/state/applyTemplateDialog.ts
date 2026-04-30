/**
 * Global controller for the "Apply Team Template" dialog. Mirrors
 * `useNewTaskDialog` so any surface (sidebar, command palette,
 * empty-state CTA inside NewTaskDialog) can ask for the picker with a
 * specific project pre-filled.
 *
 * Phase 4 of issue #12.
 */

import { create } from 'zustand'

export interface ApplyTemplateContext {
  /** Pre-filled project root. The dialog still lets the user change it. */
  projectPath?: string
  /** Pre-selected template (e.g. when the user clicks "Apply" on a
   *  Templates Library card). The dialog still lets the user change it. */
  templateId?: string
}

interface ApplyTemplateDialogState {
  open: boolean
  context: ApplyTemplateContext
  show: (context?: ApplyTemplateContext) => void
  hide: () => void
}

export const useApplyTemplateDialog = create<ApplyTemplateDialogState>((set) => ({
  open: false,
  context: {},
  show: (context = {}) => set({ open: true, context }),
  hide: () => set({ open: false, context: {} })
}))
