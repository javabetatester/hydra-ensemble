import { create } from 'zustand'
import type { TranscriptMessage } from '../../shared/types'

interface Entry {
  messages: TranscriptMessage[]
  /** Optimistic user messages: rendered instantly on submit, dropped once the
   *  same text shows up in the real JSONL payload. */
  pending: TranscriptMessage[]
  path: string | null
  loading: boolean
  loadedAt: number
}

interface TranscriptState {
  byId: Record<string, Entry>
  /** Fetch + cache the full transcript for a session. Safe to call often. */
  refresh: (sessionId: string) => Promise<void>
  /** Append an optimistic user message so the UI reflects input immediately. */
  appendPending: (sessionId: string, text: string) => void
  /** Start listening for transcriptChanged events. Wired once from the app root. */
  init: () => void
}

const pendingRefetch = new Map<string, ReturnType<typeof setTimeout>>()

/** Flatten a message's text blocks for optimistic-vs-real reconciliation. */
const textOf = (msg: TranscriptMessage): string =>
  msg.blocks
    .filter((b) => b.kind === 'text')
    .map((b) => ('text' in b ? b.text : ''))
    .join('\n')
    .trim()

export const useTranscripts = create<TranscriptState>((set, get) => ({
  byId: {},

  refresh: async (sessionId) => {
    const prev = get().byId[sessionId]
    set({
      byId: {
        ...get().byId,
        [sessionId]: {
          messages: prev?.messages ?? [],
          pending: prev?.pending ?? [],
          path: prev?.path ?? null,
          loading: true,
          loadedAt: prev?.loadedAt ?? 0
        }
      }
    })
    try {
      const payload = await window.api.session.readTranscript(sessionId)
      // Reconcile optimistic user messages with the authoritative JSONL: drop
      // pendings whose text already appears in the fresh payload. Anything
      // still pending stays appended at the end (claude hasn't ingested it yet).
      const prevPending = get().byId[sessionId]?.pending ?? []
      const realUserTexts = new Set(
        payload.messages.filter((m) => m.role === 'user').map(textOf)
      )
      const remainingPending = prevPending.filter((p) => !realUserTexts.has(textOf(p)))
      set({
        byId: {
          ...get().byId,
          [sessionId]: {
            messages: payload.messages,
            pending: remainingPending,
            path: payload.path,
            loading: false,
            loadedAt: Date.now()
          }
        }
      })
    } catch {
      const cur = get().byId[sessionId]
      if (cur) {
        set({
          byId: {
            ...get().byId,
            [sessionId]: { ...cur, loading: false }
          }
        })
      }
    }
  },

  appendPending: (sessionId, text) => {
    const cur = get().byId[sessionId]
    const baseMessages = cur?.messages ?? []
    const basePending = cur?.pending ?? []
    // Use a negative index so the React key never collides with a real message.
    const nextIndex = -(basePending.length + 1)
    const optimistic: TranscriptMessage = {
      index: nextIndex,
      role: 'user',
      blocks: [{ kind: 'text', text }],
      timestamp: new Date().toISOString(),
      uuid: `pending-${sessionId}-${Date.now()}-${basePending.length}`
    }
    set({
      byId: {
        ...get().byId,
        [sessionId]: {
          messages: baseMessages,
          pending: [...basePending, optimistic],
          path: cur?.path ?? null,
          loading: cur?.loading ?? false,
          loadedAt: cur?.loadedAt ?? 0
        }
      }
    })
  },

  init: () => {
    window.api.session.onTranscriptChanged((evt) => {
      const existing = pendingRefetch.get(evt.sessionId)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        pendingRefetch.delete(evt.sessionId)
        void get().refresh(evt.sessionId)
      }, 60)
      pendingRefetch.set(evt.sessionId, timer)
    })
  }
}))
