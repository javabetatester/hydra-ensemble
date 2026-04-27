import { create } from 'zustand'
import type { ClaudeSessionSummary } from '../../shared/types'

interface ProjectSessions {
  sessions: ClaudeSessionSummary[]
  loading: boolean
  error: string | null
}

interface ClaudeSessionsState {
  /** Per-project session data, keyed by project path. */
  byProject: Record<string, ProjectSessions>
  /** Get sessions for a specific project (returns stable defaults if not loaded). */
  forProject: (projectPath: string) => ProjectSessions
  /** Load/reload the session list for a specific project. */
  refresh: (projectPath: string) => Promise<void>
  /** Resume a session from a specific project. */
  resume: (projectPath: string, sessionId: string) => Promise<boolean>
}

const EMPTY: ProjectSessions = { sessions: [], loading: false, error: null }

export const useClaudeSessions = create<ClaudeSessionsState>((set, get) => ({
  byProject: {},

  forProject: (projectPath) => {
    return get().byProject[projectPath] ?? EMPTY
  },

  refresh: async (projectPath) => {
    if (!projectPath) return
    if (!window.api?.claudeSessions) return

    set((prev) => ({
      byProject: {
        ...prev.byProject,
        [projectPath]: {
          ...(prev.byProject[projectPath] ?? EMPTY),
          loading: true,
          error: null
        }
      }
    }))

    try {
      const sessions = await window.api.claudeSessions.list(projectPath)
      set((prev) => ({
        byProject: {
          ...prev.byProject,
          [projectPath]: { sessions, loading: false, error: null }
        }
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((prev) => ({
        byProject: {
          ...prev.byProject,
          [projectPath]: { sessions: [], loading: false, error: message }
        }
      }))
    }
  },

  resume: async (projectPath, sessionId) => {
    if (!window.api?.claudeSessions) return false
    try {
      const result = await window.api.claudeSessions.resume(projectPath, sessionId)
      if (!result.ok) return false
      // Drop the resumed session optimistically
      set((prev) => {
        const current = prev.byProject[projectPath]
        if (!current) return prev
        return {
          byProject: {
            ...prev.byProject,
            [projectPath]: {
              ...current,
              sessions: current.sessions.filter((s) => s.sessionId !== sessionId)
            }
          }
        }
      })
      return true
    } catch {
      return false
    }
  }
}))
