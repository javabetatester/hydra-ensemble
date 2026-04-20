import { create } from 'zustand'
import type { ChangedFile } from '../../shared/types'

export interface SelectedFile {
  path: string
  status: ChangedFile['status']
  staged: boolean
}

interface GitChangesState {
  cwd: string | null
  files: ChangedFile[]
  /** Path currently shown in the diff viewer (null = none selected). */
  selectedPath: string | null
  /** Diff text for the current selection (may be empty if unchanged). */
  diff: string
  /** Which files the user has ticked for commit (additive to whatever is
   *  already staged). Cleared after a successful commit. */
  selectedForCommit: Set<string>
  /** Freeform commit message buffer. Cleared after a successful commit. */
  message: string
  /** Async flags — drive spinners and disabled states in the UI. */
  loading: boolean
  diffLoading: boolean
  generating: boolean
  committing: boolean
  error: string | null

  setCwd: (cwd: string | null) => void
  refresh: () => Promise<void>
  selectFile: (path: string | null) => Promise<void>
  toggleForCommit: (path: string) => void
  selectAllForCommit: () => void
  clearSelection: () => void
  setMessage: (message: string) => void
  generateMessage: () => Promise<void>
  commit: () => Promise<boolean>
}

/** Empty-state defaults, also used to reset after a commit. */
const EMPTY = {
  files: [],
  selectedPath: null,
  diff: '',
  selectedForCommit: new Set<string>(),
  message: '',
  loading: false,
  diffLoading: false,
  generating: false,
  committing: false,
  error: null as string | null,
}

export const useGitChanges = create<GitChangesState>((set, get) => ({
  cwd: null,
  ...EMPTY,

  setCwd: (cwd) => {
    if (cwd === get().cwd) return
    console.log('[gitChanges] setCwd', { cwd })
    set({ cwd, ...EMPTY })
    if (cwd) void get().refresh()
  },

  refresh: async () => {
    const cwd = get().cwd
    if (!cwd) return
    // Re-entrancy guard: if a refresh is already in flight, drop the
    // second call. Without this, clicking Refresh while an earlier
    // listChangedFiles is still pending can strand `loading: true`
    // when the second response arrives out of order.
    if (get().loading) return
    console.log('[gitChanges] refresh start', { cwd })
    const t0 = performance.now()
    set({ loading: true, error: null })
    try {
      const res = await window.api.git.listChangedFiles(cwd)
      const t1 = performance.now()
      console.log('[gitChanges] listChangedFiles', {
        ms: Math.round(t1 - t0),
        ok: res.ok,
        count: res.ok ? res.value.length : -1,
      })
      if (!res.ok) {
        set({ loading: false, error: res.error })
        return
      }
      const files = res.value
      const paths = new Set(files.map((f) => f.path))
      const pruned = new Set<string>()
      for (const p of get().selectedForCommit) if (paths.has(p)) pruned.add(p)
      const selectedPath = get().selectedPath
      const nextSelected =
        selectedPath && paths.has(selectedPath) ? selectedPath : files[0]?.path ?? null
      set({ files, selectedForCommit: pruned, selectedPath: nextSelected, loading: false })
      if (nextSelected && nextSelected !== selectedPath) {
        void get().selectFile(nextSelected)
      } else if (!nextSelected) {
        set({ diff: '' })
      } else if (selectedPath) {
        void get().selectFile(selectedPath)
      }
    } catch (err) {
      console.error('[gitChanges] refresh threw', err)
      set({ loading: false, error: (err as Error).message })
    }
  },

  selectFile: async (path) => {
    const cwd = get().cwd
    set({ selectedPath: path, diff: '' })
    if (!cwd || !path) return
    console.log('[gitChanges] selectFile', { path })
    const t0 = performance.now()
    set({ diffLoading: true })
    try {
      const file = get().files.find((f) => f.path === path)
      const useStaged = file?.staged === true
      const res = await window.api.git.getDiff(cwd, path, useStaged)
      const t1 = performance.now()
      console.log('[gitChanges] getDiff', {
        ms: Math.round(t1 - t0),
        ok: res.ok,
        bytes: res.ok ? res.value.length : -1,
      })
      if (!res.ok) {
        set({ diff: '', diffLoading: false, error: res.error })
        return
      }
      set({ diff: res.value, diffLoading: false })
    } catch (err) {
      console.error('[gitChanges] selectFile threw', err)
      set({ diffLoading: false, error: (err as Error).message })
    }
  },

  toggleForCommit: (path) => {
    const next = new Set(get().selectedForCommit)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    set({ selectedForCommit: next })
  },

  selectAllForCommit: () => {
    set({ selectedForCommit: new Set(get().files.map((f) => f.path)) })
  },

  clearSelection: () => {
    set({ selectedForCommit: new Set<string>() })
  },

  setMessage: (message) => set({ message }),

  generateMessage: async () => {
    const cwd = get().cwd
    if (!cwd) return
    set({ generating: true, error: null })
    try {
      const res = await window.api.git.generateCommitMessage(cwd)
      if (!res.ok) {
        set({ generating: false, error: res.error })
        return
      }
      set({ message: res.value, generating: false })
    } catch (err) {
      set({ generating: false, error: (err as Error).message })
    }
  },

  commit: async () => {
    const cwd = get().cwd
    const message = get().message.trim()
    if (!cwd || message.length === 0) {
      set({ error: 'commit message cannot be empty' })
      return false
    }
    set({ committing: true, error: null })
    try {
      // Stage the ticked paths first (additive over whatever was already
      // in the index). Empty selection means "commit what's already
      // staged" — matches git's default UX.
      const paths = [...get().selectedForCommit]
      if (paths.length > 0) {
        const stage = await window.api.git.stageFiles(cwd, paths)
        if (!stage.ok) {
          set({ committing: false, error: stage.error })
          return false
        }
      }
      const res = await window.api.git.commit(cwd, message)
      if (!res.ok) {
        set({ committing: false, error: res.error })
        return false
      }
      set({ committing: false, message: '', selectedForCommit: new Set<string>() })
      await get().refresh()
      return true
    } catch (err) {
      set({ committing: false, error: (err as Error).message })
      return false
    }
  },
}))
