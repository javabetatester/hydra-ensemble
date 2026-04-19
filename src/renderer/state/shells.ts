import { create } from 'zustand'

/**
 * Plain shell terminals — the kind you spawn to run `npm run dev`,
 * `tail -f log`, `htop`, or any side process you want to keep tabs on
 * while your Claude agents do their thing.
 *
 * Shells are NOT agent sessions. They go directly through window.api.pty
 * (no SessionManager, no JSONL watcher, no analyzer, no entry in the
 * Sessions panel) so the two concepts stay clean: session = a running
 * Claude agent; shell = an interactive bash you happen to need.
 */
export interface Shell {
  id: string // ptyId
  name: string
  cwd: string
  createdAt: number
}

interface ShellsState {
  shells: Shell[]
  activeId: string | null
  setActive: (id: string | null) => void
  spawn: (cwd: string, name?: string) => Promise<Shell | null>
  destroy: (id: string) => Promise<void>
  rename: (id: string, name: string) => void
}

let _seq = 0
const newId = (): string =>
  `shell-${Date.now().toString(36)}-${(++_seq).toString(36)}`

export const useShells = create<ShellsState>((set, get) => ({
  shells: [],
  activeId: null,

  setActive: (id) => set({ activeId: id }),

  spawn: async (cwd, name) => {
    const id = newId()
    const result = await window.api.pty.spawn({
      sessionId: id,
      cwd,
      cols: 120,
      rows: 30
    })
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error('[shells] spawn failed:', result.error)
      return null
    }
    const shell: Shell = {
      id,
      name: name ?? `shell-${get().shells.length + 1}`,
      cwd,
      createdAt: Date.now()
    }
    set((s) => ({ shells: [...s.shells, shell], activeId: shell.id }))
    return shell
  },

  destroy: async (id) => {
    await window.api.pty.kill(id)
    set((s) => {
      const shells = s.shells.filter((sh) => sh.id !== id)
      const activeId =
        s.activeId === id ? (shells[shells.length - 1]?.id ?? null) : s.activeId
      return { shells, activeId }
    })
  },

  rename: (id, name) => {
    set((s) => ({
      shells: s.shells.map((sh) => (sh.id === id ? { ...sh, name } : sh))
    }))
  }
}))
