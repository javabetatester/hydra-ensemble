import { create } from 'zustand'
import type {
  JsonlUpdate,
  SessionCreateOptions,
  SessionMeta,
  SessionState
} from '../../shared/types'

interface SessionsState {
  sessions: SessionMeta[]
  activeId: string | null
  isCreating: boolean
  setSessions: (s: SessionMeta[]) => void
  setActive: (id: string | null) => void
  patchSession: (id: string, patch: Partial<SessionMeta>) => void
  createSession: (opts: Partial<SessionCreateOptions>) => Promise<SessionMeta | null>
  destroySession: (id: string) => Promise<void>
  renameSession: (id: string, name: string) => Promise<void>
  init: () => Promise<void>
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,
  isCreating: false,

  setSessions: (sessions) => {
    set((prev) => ({
      sessions,
      activeId:
        prev.activeId && sessions.some((s) => s.id === prev.activeId)
          ? prev.activeId
          : (sessions[0]?.id ?? null)
    }))
  },

  setActive: (id) => set({ activeId: id }),

  patchSession: (id, patch) => {
    set((prev) => ({
      sessions: prev.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s))
    }))
  },

  createSession: async (opts) => {
    if (get().isCreating) return null
    set({ isCreating: true })
    try {
      const res = await window.api.session.create({
        cols: 120,
        rows: 30,
        ...opts
      })
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error('[session] create failed:', res.error)
        return null
      }
      set((prev) => ({
        sessions: [...prev.sessions, res.session],
        activeId: res.session.id
      }))
      return res.session
    } finally {
      set({ isCreating: false })
    }
  },

  destroySession: async (id) => {
    await window.api.session.destroy(id)
    set((prev) => {
      const sessions = prev.sessions.filter((s) => s.id !== id)
      const activeId =
        prev.activeId === id ? (sessions[sessions.length - 1]?.id ?? null) : prev.activeId
      return { sessions, activeId }
    })
  },

  renameSession: async (id, name) => {
    await window.api.session.rename(id, name)
    get().patchSession(id, { name })
  },

  init: async () => {
    const sessions = await window.api.session.list()
    set({ sessions, activeId: sessions[0]?.id ?? null })
    window.api.session.onChange((next) => {
      get().setSessions(next)
    })
    window.api.session.onState((evt: { sessionId: string; state: SessionState }) => {
      // sessionId here is the ptyId — sessions use the same string in Phase 1
      get().patchSession(evt.sessionId, { state: evt.state })
    })
    window.api.session.onJsonl((update: JsonlUpdate) => {
      get().patchSession(update.sessionId, {
        cost: update.cost,
        tokensIn: update.tokensIn,
        tokensOut: update.tokensOut,
        model: update.model,
        latestAssistantText: update.latestAssistantText,
        subStatus: update.subStatus,
        subTarget: update.subTarget
      })
    })
  }
}))
