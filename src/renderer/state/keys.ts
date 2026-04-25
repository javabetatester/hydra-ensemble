import { create } from 'zustand'
import type { Provider, VaultEntry } from '../../shared/types'

/**
 * Per-provider cached view of the user's saved API keys. The store
 * intentionally does NOT auto-load on creation — `refresh()` must be
 * called from the consumer (NewSessionDialog opens it). Otherwise we'd
 * hit IPC before main is ready during HMR boot.
 *
 * Plaintext values are NEVER held here — only metadata. The spawn path
 * resolves the plaintext inside the main process via `vault.reveal()`.
 */

const EMPTY_BY_PROVIDER: Record<Provider, VaultEntry[]> = {
  claude: [],
  codex: [],
  copilot: []
}

interface KeysState {
  byProvider: Record<Provider, VaultEntry[]>
  loading: boolean
  refresh(): Promise<void>
  save(input: {
    name: string
    provider: Provider
    apiKeyEnv: string
    value: string
  }): Promise<string>
  remove(id: string): Promise<void>
  rename(id: string, name: string): Promise<void>
}

function group(entries: VaultEntry[]): Record<Provider, VaultEntry[]> {
  const out: Record<Provider, VaultEntry[]> = {
    claude: [],
    codex: [],
    copilot: []
  }
  for (const e of entries) {
    out[e.provider].push(e)
  }
  return out
}

export const useKeys = create<KeysState>((set, get) => ({
  byProvider: EMPTY_BY_PROVIDER,
  loading: false,

  refresh: async () => {
    set({ loading: true })
    try {
      const entries = await window.api.keys.list()
      set({ byProvider: group(entries) })
    } finally {
      set({ loading: false })
    }
  },

  save: async (input) => {
    const { id } = await window.api.keys.save(input)
    await get().refresh()
    return id
  },

  remove: async (id) => {
    await window.api.keys.remove(id)
    await get().refresh()
  },

  rename: async (id, name) => {
    await window.api.keys.rename(id, name)
    await get().refresh()
  }
}))
