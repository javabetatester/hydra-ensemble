import { create } from 'zustand'
import type { ClaudeSessionSummary } from '../../shared/types'

interface ClaudeSessionsState {
  /** Sessions for the project at `projectPath`. Empty when no project is
   *  active or when the project has no prior Claude sessions on disk. */
  sessions: ClaudeSessionSummary[]
  /** The path the current `sessions` list was loaded for. Used by the UI
   *  to detect a stale list while a refresh is in flight after a project
   *  switch. */
  loadedFor: string | null
  loading: boolean
  error: string | null
  /** Reload the list for `projectPath`. Pass null to clear. */
  refresh: (projectPath: string | null) => Promise<void>
  /** Spawn a new Hydra session that runs `claude --resume <sessionId>`.
   *  Returns true on success so the UI can dismiss the row optimistically. */
  resume: (projectPath: string, sessionId: string) => Promise<boolean>
}

export const useClaudeSessions = create<ClaudeSessionsState>((set) => ({
  sessions: [],
  loadedFor: null,
  loading: false,
  error: null,

  refresh: async (projectPath) => {
    if (!projectPath) {
      set({ sessions: [], loadedFor: null, loading: false, error: null })
      return
    }
    if (!window.api?.claudeSessions) {
      set({ sessions: [], loadedFor: projectPath, loading: false, error: null })
      return
    }
    set({ loading: true, error: null })
    try {
      const sessions = await window.api.claudeSessions.list(projectPath)
      set({ sessions, loadedFor: projectPath, loading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ sessions: [], loadedFor: projectPath, loading: false, error: message })
    }
  },

  resume: async (projectPath, sessionId) => {
    if (!window.api?.claudeSessions) {
      set({ error: 'claudeSessions API not available' })
      return false
    }
    try {
      const result = await window.api.claudeSessions.resume(projectPath, sessionId)
      if (!result.ok) {
        set({ error: result.error })
        return false
      }
      // Drop the resumed session from the list optimistically — it's
      // now active, and the next refresh will confirm via the active-
      // sessions filter.
      set((prev) => ({
        sessions: prev.sessions.filter((s) => s.sessionId !== sessionId)
      }))
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      return false
    }
  }
}))
