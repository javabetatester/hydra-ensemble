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
  /** The diff preview currently shown in the main editor area, or null
   *  when a regular file is active. Set from GitChangesPanel for cases
   *  the file cannot be edited (deleted, binary, huge). Most of the time
   *  we open the file in CodeMirror and paint the diff inline instead
   *  (see fileDiffs). */
  diffPreview: DiffPreview | null
  /** Map of file path → unified diff patch. Populated from
   *  GitChangesPanel when the user clicks a changed file. CodeMirrorView
   *  reads the current file's patch and paints gutter + line marks. */
  fileDiffs: Record<string, string>
  openEditor: () => void
  closeEditor: () => void
  toggleEditor: () => void
  openFile: (path: string) => Promise<void>
  closeFile: (path: string) => void
  closeAllFiles: () => void
  setActive: (path: string) => void
  setOverrideRoot: (root: string | null) => void
  setDiffPreview: (preview: DiffPreview | null) => void
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
  diffPreview: null,
  fileDiffs: {},

  openEditor: () => set({ editorOpen: true }),
  closeEditor: () => set({ editorOpen: false, diffPreview: null, fileDiffs: {} }),
  toggleEditor: () => set((s) => ({ editorOpen: !s.editorOpen })),
  setOverrideRoot: (root) => set({ overrideRoot: root }),
  setDiffPreview: (preview) => set({ diffPreview: preview }),
  setFileDiff: (path, patch) =>
    set((s) => {
      const next = { ...s.fileDiffs }
      if (patch === null || patch.length === 0) delete next[path]
      else next[path] = patch
      return { fileDiffs: next }
    }),
  clearFileDiffs: () => set({ fileDiffs: {} }),

  openFile: async (path) => {
    const existing = get().openFiles.find((f) => f.path === path)
    if (existing) {
      // Picking a regular file dismisses any diff preview — the buffer
      // should take the main slot so the user can keep editing.
      set({ activeFilePath: path, diffPreview: null })
      return
    }
    try {
      const file = await window.api.editor.readFile(path)
      set((s) => ({
        openFiles: [...s.openFiles, file],
        activeFilePath: file.path,
        diffPreview: null
      }))
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[editor] readFile failed:', (err as Error).message)
    }
  },

  closeFile: (path) => {
    set((s) => {
      const openFiles = s.openFiles.filter((f) => f.path !== path)
      let activeFilePath = s.activeFilePath
      if (activeFilePath === path) {
        activeFilePath = openFiles[openFiles.length - 1]?.path ?? null
      }
      return { openFiles, activeFilePath }
    })
  },

  closeAllFiles: () => set({ openFiles: [], activeFilePath: null }),

  setActive: (path) => set({ activeFilePath: path, diffPreview: null }),

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
    try {
      await window.api.editor.writeFile(file.path, file.bytes)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[editor] writeFile failed:', (err as Error).message)
    }
  }
}))
