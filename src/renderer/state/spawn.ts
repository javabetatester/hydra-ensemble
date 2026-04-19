import { create } from 'zustand'

/**
 * Single source of truth for whether the New Session dialog is open.
 *
 * Every entry point that lets the user spawn an agent — the SessionsPanel
 * "+" button, the empty-state hero CTA, the empty session-list tile, the
 * Cmd/Ctrl+T shortcut — opens this dialog so a first-time user is always
 * walked through project + worktree selection. The instant-spawn paths
 * (Cmd/Ctrl+Shift+T, the command palette) bypass it on purpose for power
 * users who already know what they want.
 */
interface SpawnDialogState {
  open: boolean
  show: () => void
  hide: () => void
  toggle: () => void
}

export const useSpawnDialog = create<SpawnDialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open }))
}))
