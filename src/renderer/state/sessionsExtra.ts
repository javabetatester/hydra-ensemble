import { create } from 'zustand'

interface SessionsUiState {
  dashboardOpen: boolean
  openDashboard: () => void
  closeDashboard: () => void
  toggleDashboard: () => void
  chatMinimized: boolean
  toggleChatMinimized: () => void
  setChatMinimized: (v: boolean) => void
}

export const useSessionsUi = create<SessionsUiState>((set) => ({
  dashboardOpen: false,
  openDashboard: () => set({ dashboardOpen: true }),
  closeDashboard: () => set({ dashboardOpen: false }),
  toggleDashboard: () => set((prev) => ({ dashboardOpen: !prev.dashboardOpen })),
  chatMinimized: false,
  toggleChatMinimized: () => set((prev) => ({ chatMinimized: !prev.chatMinimized })),
  setChatMinimized: (v) => set({ chatMinimized: v })
}))
