import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type PanelKind = 'editor' | 'dashboard' | 'watchdogs' | 'pr' | 'terminals'

interface SlidePanelState {
  current: PanelKind | null
  open: (k: PanelKind) => void
  close: () => void
  toggle: (k: PanelKind) => void
}

/**
 * Single source of truth for the right-side slide panel.
 * Editor / Dashboard / Watchdogs / PR Inspector are mutually exclusive
 * and share the same animated slot in the main column. Opening one
 * implicitly closes the other.
 */
export const useSlidePanel = create<SlidePanelState>((set) => ({
  current: null,
  open: (k) => set({ current: k }),
  close: () => set({ current: null }),
  toggle: (k) => set((s) => ({ current: s.current === k ? null : k }))
}))

/** Clamped fraction [MIN..MAX] describing the slide panel's share of the
 *  window width. Persisted so a resize survives reloads. */
export const PANEL_WIDTH_MIN = 0.3
export const PANEL_WIDTH_MAX = 0.85
export const PANEL_WIDTH_DEFAULT = 0.52

interface PanelSizeState {
  /** Fraction of the viewport width the slide panel occupies when open. */
  widthFraction: number
  setWidthFraction: (value: number) => void
}

export const usePanelSize = create<PanelSizeState>()(
  persist(
    (set) => ({
      widthFraction: PANEL_WIDTH_DEFAULT,
      setWidthFraction: (value) => {
        const clamped = Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, value))
        set({ widthFraction: clamped })
      }
    }),
    { name: 'hydra.panel-size' }
  )
)

/** Editor sidebar (Files / Changes / Search) width in px. Stored as a
 *  pixel value rather than a fraction because it's sized relative to the
 *  editor's own width, not the viewport, and the editor pane itself is
 *  already user-resizable. */
export const EDITOR_SIDEBAR_MIN = 180
export const EDITOR_SIDEBAR_MAX = 600
export const EDITOR_SIDEBAR_DEFAULT = 256

interface EditorSidebarSizeState {
  width: number
  setWidth: (value: number) => void
}

export const useEditorSidebarSize = create<EditorSidebarSizeState>()(
  persist(
    (set) => ({
      width: EDITOR_SIDEBAR_DEFAULT,
      setWidth: (value) => {
        const clamped = Math.min(EDITOR_SIDEBAR_MAX, Math.max(EDITOR_SIDEBAR_MIN, value))
        set({ width: clamped })
      }
    }),
    { name: 'hydra.editor-sidebar-size' }
  )
)

/** Right column (Sessions + Toolkit) width in px. Pinned to the viewport's
 *  right edge; user drags its LEFT edge to resize. */
export const RIGHT_COLUMN_MIN = 240
export const RIGHT_COLUMN_MAX = 560
export const RIGHT_COLUMN_DEFAULT = 320

interface RightColumnSizeState {
  width: number
  setWidth: (value: number) => void
}

export const useRightColumnSize = create<RightColumnSizeState>()(
  persist(
    (set) => ({
      width: RIGHT_COLUMN_DEFAULT,
      setWidth: (value) => {
        const clamped = Math.min(RIGHT_COLUMN_MAX, Math.max(RIGHT_COLUMN_MIN, value))
        set({ width: clamped })
      }
    }),
    { name: 'hydra.right-column-size' }
  )
)
