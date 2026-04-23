import { create } from 'zustand'
import type { FileContent } from '../../shared/types'

/** A diff the user is previewing from the git changes panel. Rendered
 *  full-width in the main editor slot, takes priority over the normal
 *  CodeMirror buffer. Cleared when the user picks a regular file or
 *  closes the diff. */
export interface DiffPreview {
  path: string
  patch: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
}

interface EditorState {
  openFiles: FileContent[]
  activeFilePath: string | null
  editorOpen: boolean
  /** When set, the editor's file tree is rooted HERE instead of the active
   *  session's worktree. Used to pin the editor to `.claude/` after the
   *  user clicks a file under the .claude toolkit tab. Cleared on close. */
  overrideRoot: string | null
  /** Open diff tabs. Each click in the git changes panel appends (or
   *  upserts) into this list so the user can flip between several diffs
   *  the same way they flip between file tabs. Persists across sidebar
   *  tab changes (Files ↔ Changes). */
  openDiffs: DiffPreview[]
  /** Path of the currently-active diff tab, or null if no diff is open /
   *  the user is focused on a file tab. */
  activeDiffPath: string | null
  /** Which tab family the editor's main slot is rendering: the file
   *  buffer (activeFilePath) or the diff preview (activeDiffPath). Kept
   *  explicit so we can keep both lists mounted and let the user switch
   *  between them without losing state. */
  activeKind: 'file' | 'diff'
  /** Map of file path → unified diff patch. Populated from
   *  GitChangesPanel when the user clicks a changed file. CodeMirrorView
   *  reads the current file's patch and paints gutter + line marks. */
  fileDiffs: Record<string, string>
  /** Snapshot of the on-disk bytes for each open file. Populated when we
   *  read and when we save. The dirty state is a pure derivation: a file
   *  is dirty iff `openFile.bytes !== savedBytes[openFile.path]`. Kept
   *  separate from `openFiles` so per-keystroke updates don't have to
   *  clone a potentially large original string. */
  savedBytes: Record<string, string>
  /** Whether the active buffer has unsaved edits. Derived — consumers
   *  call `get().isDirty(path)` rather than subscribing to a flag, so
   *  the computation stays cheap and consistent with the live buffer. */
  isDirty: (path?: string | null) => boolean
  openEditor: () => void
  closeEditor: () => void
  toggleEditor: () => void
  /** Open `path` in the editor. Returns the RESOLVED absolute path (after
   *  the fs bridge's realpath canonicalisation) so callers can key other
   *  state — e.g. fileDiffs — against whatever CodeMirror will actually
   *  see as `activeFilePath`. Returns null when the read fails. */
  openFile: (path: string) => Promise<string | null>
  closeFile: (path: string) => void
  closeAllFiles: () => void
  setActive: (path: string) => void
  setOverrideRoot: (root: string | null) => void
  /** Upsert a diff into the tab list and focus it. Re-clicking the same
   *  path refreshes its patch instead of stacking duplicates. */
  openDiff: (preview: DiffPreview) => void
  /** Remove a diff tab. If it was active, fall back to the last remaining
   *  diff tab, or — if none — switch activeKind back to 'file'. */
  closeDiff: (path: string) => void
  /** Focus an already-open diff tab. */
  setActiveDiff: (path: string) => void
  /** Drop every diff tab at once. Used when the cwd changes, since diffs
   *  from a different working tree no longer apply. */
  closeAllDiffs: () => void
  setFileDiff: (path: string, patch: string | null) => void
  clearFileDiffs: () => void
  /** Replace the buffer in memory (e.g. after the user types in CodeMirror). */
  updateActiveBuffer: (text: string) => void
  /** Persist the active buffer to disk via the IPC bridge. */
  saveActive: () => Promise<void>
}

export const useEditor = create<EditorState>((set, get) => ({
  openFiles: [],
  activeFilePath: null,
  editorOpen: false,
  overrideRoot: null,
  openDiffs: [],
  activeDiffPath: null,
  activeKind: 'file',
  fileDiffs: {},
  savedBytes: {},

  isDirty: (path) => {
    const s = get()
    const p = path ?? s.activeFilePath
    if (!p) return false
    const file = s.openFiles.find((f) => f.path === p)
    if (!file) return false
    if (file.encoding !== 'utf-8') return false
    const baseline = s.savedBytes[p]
    return baseline !== undefined && baseline !== file.bytes
  },

  openEditor: () => set({ editorOpen: true }),
  closeEditor: () =>
    set({
      editorOpen: false,
      openDiffs: [],
      activeDiffPath: null,
      activeKind: 'file',
      fileDiffs: {},
      savedBytes: {}
    }),
  toggleEditor: () => set((s) => ({ editorOpen: !s.editorOpen })),
  setOverrideRoot: (root) => set({ overrideRoot: root }),
  openDiff: (preview) =>
    set((s) => {
      const existingIdx = s.openDiffs.findIndex((d) => d.path === preview.path)
      const openDiffs =
        existingIdx >= 0
          ? s.openDiffs.map((d, i) => (i === existingIdx ? preview : d))
          : [...s.openDiffs, preview]
      return { openDiffs, activeDiffPath: preview.path, activeKind: 'diff' }
    }),
  closeDiff: (path) =>
    set((s) => {
      const openDiffs = s.openDiffs.filter((d) => d.path !== path)
      if (s.activeDiffPath !== path) return { openDiffs }
      const fallback = openDiffs[openDiffs.length - 1]?.path ?? null
      return {
        openDiffs,
        activeDiffPath: fallback,
        activeKind: fallback ? 'diff' : 'file'
      }
    }),
  setActiveDiff: (path) =>
    set((s) =>
      s.openDiffs.some((d) => d.path === path)
        ? { activeDiffPath: path, activeKind: 'diff' }
        : s
    ),
  closeAllDiffs: () =>
    set({ openDiffs: [], activeDiffPath: null, activeKind: 'file' }),
  setFileDiff: (path, patch) =>
    set((s) => {
      const next = { ...s.fileDiffs }
      if (patch === null || patch.length === 0) delete next[path]
      else next[path] = patch
      return { fileDiffs: next }
    }),
  clearFileDiffs: () => set({ fileDiffs: {} }),

  openFile: async (path) => {
    // Fast path: already open by literal (resolved) path. Most callers
    // hit this — the file tree + tabs both hand us the canonical path.
    const existing = get().openFiles.find((f) => f.path === path)
    if (existing) {
      set({ activeFilePath: path, activeKind: 'file' })
      return existing.path
    }
    try {
      const file = await window.api.editor.readFile(path)
      // Dedupe on the RESOLVED path too — the git changes panel hands us
      // `cwd/relative`, which may differ from the symlink-resolved realpath
      // we store. Without this second check, clicking the same changed
      // file twice would stack duplicate tabs.
      set((s) => {
        const baseline =
          file.encoding === 'utf-8'
            ? { ...s.savedBytes, [file.path]: file.bytes }
            : s.savedBytes
        if (s.openFiles.some((f) => f.path === file.path)) {
          return {
            activeFilePath: file.path,
            activeKind: 'file',
            savedBytes: baseline
          }
        }
        return {
          openFiles: [...s.openFiles, file],
          activeFilePath: file.path,
          activeKind: 'file',
          savedBytes: baseline
        }
      })
      return file.path
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[editor] readFile failed:', (err as Error).message)
      return null
    }
  },

  closeFile: (path) => {
    set((s) => {
      const openFiles = s.openFiles.filter((f) => f.path !== path)
      let activeFilePath = s.activeFilePath
      if (activeFilePath === path) {
        activeFilePath = openFiles[openFiles.length - 1]?.path ?? null
      }
      const savedBytes = { ...s.savedBytes }
      delete savedBytes[path]
      return { openFiles, activeFilePath, savedBytes }
    })
  },

  closeAllFiles: () => set({ openFiles: [], activeFilePath: null, savedBytes: {} }),

  setActive: (path) => set({ activeFilePath: path, activeKind: 'file' }),

  updateActiveBuffer: (text) => {
    set((s) => {
      if (!s.activeFilePath) return s
      return {
        openFiles: s.openFiles.map((f) =>
          f.path === s.activeFilePath
            ? { ...f, bytes: text, encoding: 'utf-8', size: text.length }
            : f
        )
      }
    })
  },

  saveActive: async () => {
    const { openFiles, activeFilePath } = get()
    if (!activeFilePath) return
    const file = openFiles.find((f) => f.path === activeFilePath)
    if (!file || file.encoding !== 'utf-8') return
    const contentAtSave = file.bytes
    try {
      await window.api.editor.writeFile(file.path, contentAtSave)
      // Baseline advances to whatever we just wrote. If the user typed
      // more characters between the dispatch and the IPC round-trip,
      // `contentAtSave` reflects what's ON DISK — NOT the current buffer
      // — so the dirty flag stays accurate (they still have unsaved
      // edits relative to disk).
      set((s) => ({
        savedBytes: { ...s.savedBytes, [file.path]: contentAtSave }
      }))
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[editor] writeFile failed:', (err as Error).message)
    }
  }
}))
