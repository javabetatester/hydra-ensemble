import { create } from 'zustand'

export type ToastKind = 'info' | 'attention' | 'success' | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  title: string
  body?: string
  /** Optional session id to focus when the user clicks the toast. */
  sessionId?: string
  /** Milliseconds before auto-dismiss. Defaults to 6_000. */
  ttl?: number
  createdAt: number
}

interface State {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id' | 'createdAt'>) => string
  dismiss: (id: string) => void
  clear: () => void
}

let _seq = 0
const nextId = (): string => `t-${Date.now().toString(36)}-${++_seq}`

export const useToasts = create<State>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = nextId()
    const toast: Toast = { id, createdAt: Date.now(), ttl: 6000, ...t }
    set((s) => ({ toasts: [...s.toasts, toast] }))
    if (toast.ttl && toast.ttl > 0) {
      setTimeout(() => {
        get().dismiss(id)
      }, toast.ttl)
    }
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] })
}))
