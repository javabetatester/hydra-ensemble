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

/** Slide panel width in px. Stored as pixels rather than a fraction so
 *  that resizing the right column (sessions+toolkit) doesn't implicitly
 *  grow/shrink the slide pane — a fraction of a shifting parent means
 *  one resize drags the other along. Chat column (flex-1) absorbs deltas. */
export const PANEL_WIDTH_MIN = 360
export const PANEL_WIDTH_MAX = 2000
export const PANEL_WIDTH_DEFAULT = 720

interface PanelSizeState {
  /** Slide panel width in px when open. */
  width: number
  setWidth: (value: number) => void
}

export const usePanelSize = create<PanelSizeState>()(
  persist(
    (set) => ({
      width: PANEL_WIDTH_DEFAULT,
      setWidth: (value) => {
        const clamped = Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, value))
        set({ width: clamped })
      }
    }),
    { name: 'hydra.panel-size-px' }
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

/** Terminals panel has two layouts the user picks from the in-panel view
 *  menu: a bottom strip inside the main column ('bottom' — default, stacked
 *  below the slide pane) or the classic right-side slide pane slot ('side',
 *  mutually exclusive with editor/dashboard/etc as before the redesign). */
export const TERMINALS_HEIGHT_MIN = 140
export const TERMINALS_HEIGHT_MAX = 900
export const TERMINALS_HEIGHT_DEFAULT = 260

export type TerminalsPosition = 'bottom' | 'side'

interface TerminalsPanelState {
  /** Bottom-dock visibility. In 'side' mode visibility is derived from
   *  useSlidePanel.current === 'terminals', so this field is ignored. */
  open: boolean
  position: TerminalsPosition
  height: number
  openPanel: () => void
  closePanel: () => void
  toggle: () => void
  setHeight: (value: number) => void
  setPosition: (value: TerminalsPosition) => void
}

export const useTerminalsPanel = create<TerminalsPanelState>()(
  persist(
    (set, get) => ({
      open: false,
      position: 'bottom',
      height: TERMINALS_HEIGHT_DEFAULT,
      openPanel: () => {
        if (get().position === 'side') {
          useSlidePanel.getState().open('terminals')
          return
        }
        set({ open: true })
      },
      closePanel: () => {
        if (get().position === 'side') {
          if (useSlidePanel.getState().current === 'terminals') {
            useSlidePanel.getState().close()
          }
          return
        }
        set({ open: false })
      },
      toggle: () => {
        if (get().position === 'side') {
          useSlidePanel.getState().toggle('terminals')
          return
        }
        set((s) => ({ open: !s.open }))
      },
      setHeight: (value) => {
        const clamped = Math.min(
          TERMINALS_HEIGHT_MAX,
          Math.max(TERMINALS_HEIGHT_MIN, value)
        )
        set({ height: clamped })
      },
      setPosition: (value) => {
        const cur = get().position
        if (cur === value) return
        // Migrate visibility so switching position keeps terminals visible
        // if they were already showing (and hidden if they weren't).
        const slide = useSlidePanel.getState()
        const showingInSide = slide.current === 'terminals'
        const showingInBottom = get().open
        if (value === 'side') {
          if (showingInBottom) slide.open('terminals')
          set({ position: value, open: false })
          return
        }
        // -> 'bottom'
        if (showingInSide) slide.close()
        set({ position: value, open: showingInSide })
      }
    }),
    {
      name: 'hydra.terminals-panel',
      // Don't persist `open` — default closed on startup. Position persists.
      partialize: (s) => ({ height: s.height, position: s.position })
    }
  )
)
