import { create } from 'zustand'
import type {
  JsonlUpdate,
  SessionCreateOptions,
  SessionMeta,
  SessionState
} from '../../shared/types'
import { useToasts } from './toasts'
import { AGENT_COLORS, NFT_AVATAR_URLS } from '../lib/agent'

const pickRandom = <T,>(arr: readonly T[]): T | undefined =>
  arr[Math.floor(Math.random() * arr.length)]

interface SessionsState {
  sessions: SessionMeta[]
  activeId: string | null
  isCreating: boolean
  /** Per-session unread flag — true when an inactive session has received
   *  PTY output since the user last saw it. Cleared on setActive. */
  unread: Record<string, boolean>
  setSessions: (s: SessionMeta[]) => void
  setActive: (id: string | null) => void
  patchSession: (id: string, patch: Partial<SessionMeta>) => void
  createSession: (opts: Partial<SessionCreateOptions>) => Promise<SessionMeta | null>
  cloneSession: (id: string) => Promise<SessionMeta | null>
  destroySession: (id: string) => Promise<void>
  renameSession: (id: string, name: string) => Promise<void>
  init: () => Promise<void>
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,
  isCreating: false,
  unread: {},

  setSessions: (sessions) => {
    set((prev) => ({
      sessions,
      activeId:
        prev.activeId && sessions.some((s) => s.id === prev.activeId)
          ? prev.activeId
          : (sessions[0]?.id ?? null)
    }))
  },

  setActive: (id) => {
    set((prev) => {
      if (!id) return { activeId: null }
      const nextUnread = { ...prev.unread }
      delete nextUnread[id]
      return { activeId: id, unread: nextUnread }
    })
  },

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
        // Fresh sessions get a random NFT avatar + random accent colour so
        // each agent is visually distinctive from birth. User can still
        // override via the edit dialog.
        avatar: pickRandom(NFT_AVATAR_URLS),
        accentColor: pickRandom(AGENT_COLORS),
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
      const nextUnread = { ...prev.unread }
      delete nextUnread[id]
      return { sessions, activeId, unread: nextUnread }
    })
  },

  cloneSession: async (id) => {
    const source = get().sessions.find((s) => s.id === id)
    if (!source) return null
    const res = await window.api.session.create({
      cols: 120,
      rows: 30,
      name: `${source.name}-clone`,
      cwd: source.cwd,
      worktreePath: source.worktreePath,
      branch: source.branch,
      avatar: pickRandom(NFT_AVATAR_URLS),
      accentColor: pickRandom(AGENT_COLORS)
    })
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error('[session] clone failed:', res.error)
      return null
    }
    set((prev) => ({ sessions: [...prev.sessions, res.session], activeId: res.session.id }))
    return res.session
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
    // OS notification click → focus the session it referred to.
    const onFocus = (_evt: unknown, payload: { sessionId: string }): void => {
      const s = get().sessions.find((s) => s.id === payload.sessionId)
      if (s) get().setActive(s.id)
    }
    // Use the raw electron ipcRenderer via window for this one — it's not
    // worth adding to the typed contextBridge for a single channel.
    type FocusEvt = { sessionId: string }
    type IpcLite = {
      on: (channel: string, listener: (...args: unknown[]) => void) => void
    }
    const ipc = (window as unknown as { electron?: { ipcRenderer?: IpcLite } }).electron
      ?.ipcRenderer
    if (ipc) {
      ipc.on('notify:focusSession', (...args) => {
        const payload = args[args.length - 1] as FocusEvt
        if (payload?.sessionId) {
          const s = get().sessions.find((x) => x.id === payload.sessionId)
          if (s) get().setActive(s.id)
        }
      })
    }
    void onFocus
    // Mark a session as unread the first time it emits data while the
    // user is looking at another tab. Only flip false -> true so the
    // high-frequency pty:data stream doesn't thrash setState.
    window.api.pty.onData((evt) => {
      const state = get()
      if (state.activeId === evt.sessionId) return
      if (state.unread[evt.sessionId]) return
      set((prev) => ({ unread: { ...prev.unread, [evt.sessionId]: true } }))
    })
    window.api.session.onState((evt: { sessionId: string; state: SessionState }) => {
      const prev = get().sessions.find((s) => s.id === evt.sessionId)
      get().patchSession(evt.sessionId, { state: evt.state })

      if (!prev || get().activeId === evt.sessionId) return

      const sendBoth = (
        kind: 'attention' | 'success',
        title: string,
        body: string
      ): void => {
        useToasts.getState().push({
          kind,
          title,
          body,
          sessionId: evt.sessionId
        })
        // OS-level notification too so the user sees it when the window
        // is unfocused or buried under other apps. Critical when running
        // 10+ parallel agents — toast in-app isn't enough.
        if (!document.hasFocus()) {
          void window.api.notify.show({
            title,
            body,
            // NotificationKind uses 'completed' for the success variant.
            kind: kind === 'success' ? 'completed' : 'attention',
            sessionId: evt.sessionId
          })
        }
      }

      // Surface attention transitions so a backgrounded agent doesn't
      // get stuck waiting unnoticed.
      if (evt.state === 'needsAttention' && prev.state !== 'needsAttention') {
        sendBoth(
          'attention',
          `${prev.name} needs attention`,
          prev.subStatus
            ? `${prev.subStatus}${prev.subTarget ? ' · ' + prev.subTarget : ''}`
            : 'agent is waiting for permission'
        )
        return
      }

      // "Your turn again" transition: agent was working (thinking /
      // generating), and now it's settled into an input prompt. Toast
      // so the user knows that backgrounded session is ready to chat.
      const wasWorking = prev.state === 'thinking' || prev.state === 'generating'
      const nowReady = evt.state === 'userInput' || evt.state === 'idle'
      if (wasWorking && nowReady) {
        sendBoth(
          'success',
          `${prev.name} is ready`,
          prev.latestAssistantText
            ? prev.latestAssistantText.slice(0, 120)
            : 'agent finished — your turn'
        )
      }
    })
    window.api.session.onJsonl((update: JsonlUpdate) => {
      // JSONL only updates derived metrics — cost, tokens, model, the
      // latest tool_use sub-status. Coarse state (thinking / generating
      // / userInput / idle) is owned exclusively by the PTY analyzer
      // because that's what reflects what the terminal actually shows.
      // Two writers fighting led to a stuck 'thinking' pill after
      // claude was clearly done.
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
