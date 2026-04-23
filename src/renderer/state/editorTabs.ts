import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Editor tabs slice — tracks the set of "open" file paths the user has
 * surfaced as tabs in the CodeEditor, plus which one is active and which
 * are pinned.
 *
 * Kept deliberately separate from `useEditor` (which owns the heavyweight
 * buffer/diff state): tabs are a pure UI preference that must survive
 * reloads, while buffers are rehydrated lazily from disk when a tab is
 * focused. Decoupling also avoids bloating the persisted blob with file
 * contents.
 *
 * Ordering invariant: pinned tabs always live at the front of `tabs` in
 * insertion order, followed by unpinned tabs in insertion order. This is
 * enforced inside `togglePin` / `open` / `closeOthers` rather than as a
 * post-hoc sort, so the visual order matches user intent (newly pinned
 * tabs drift to the rightmost pinned slot, not to the very front).
 */
export interface OpenTab {
  path: string
  pinned?: boolean
}

interface EditorTabsState {
  tabs: OpenTab[]
  activePath: string | null
  open: (path: string, opts?: { pin?: boolean }) => void
  close: (path: string) => void
  setActive: (path: string) => void
  togglePin: (path: string) => void
  closeOthers: (keepPath: string) => void
  closeAll: () => void
}

/** Insert a tab respecting the "pinned-first" ordering invariant. */
function insertOrdered(tabs: OpenTab[], tab: OpenTab): OpenTab[] {
  if (tab.pinned) {
    // Append after the last pinned tab.
    let idx = 0
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i]
      if (t && t.pinned) idx = i + 1
      else break
    }
    return [...tabs.slice(0, idx), tab, ...tabs.slice(idx)]
  }
  return [...tabs, tab]
}

/** Pick the fallback active path after closing `removedPath`. Prefers the
 *  tab that was immediately BEFORE it in the strip (VSCode-style), else
 *  the first remaining tab, else null. */
function pickNextActive(
  previousTabs: OpenTab[],
  removedPath: string,
  remaining: OpenTab[]
): string | null {
  const first = remaining[0]
  if (!first) return null
  const removedIdx = previousTabs.findIndex((t) => t.path === removedPath)
  if (removedIdx <= 0) return first.path
  // Walk backwards from removedIdx-1 looking for a still-present tab.
  for (let i = removedIdx - 1; i >= 0; i--) {
    const cand = previousTabs[i]
    if (cand && remaining.some((t) => t.path === cand.path)) return cand.path
  }
  return first.path
}

export const useEditorTabs = create<EditorTabsState>()(
  persist(
    (set) => ({
      tabs: [],
      activePath: null,

      open: (path, opts) =>
        set((s) => {
          const existing = s.tabs.find((t) => t.path === path)
          if (existing) {
            // Already open — only mutate if caller asked to pin and it
            // isn't pinned yet (avoids reordering on every focus).
            if (opts?.pin && !existing.pinned) {
              const withoutExisting = s.tabs.filter((t) => t.path !== path)
              const reordered = insertOrdered(withoutExisting, {
                path,
                pinned: true
              })
              return { tabs: reordered, activePath: path }
            }
            return { activePath: path }
          }
          const tab: OpenTab = opts?.pin ? { path, pinned: true } : { path }
          return { tabs: insertOrdered(s.tabs, tab), activePath: path }
        }),

      close: (path) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => t.path !== path)
          if (s.activePath !== path) return { tabs }
          const activePath = pickNextActive(s.tabs, path, tabs)
          return { tabs, activePath }
        }),

      setActive: (path) =>
        set((s) => (s.tabs.some((t) => t.path === path) ? { activePath: path } : s)),

      togglePin: (path) =>
        set((s) => {
          const target = s.tabs.find((t) => t.path === path)
          if (!target) return s
          const withoutTarget = s.tabs.filter((t) => t.path !== path)
          const next: OpenTab = { path, pinned: !target.pinned }
          return { tabs: insertOrdered(withoutTarget, next) }
        }),

      closeOthers: (keepPath) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => t.pinned || t.path === keepPath)
          const activePath =
            s.activePath && tabs.some((t) => t.path === s.activePath)
              ? s.activePath
              : tabs.some((t) => t.path === keepPath)
                ? keepPath
                : (tabs[0]?.path ?? null)
          return { tabs, activePath }
        }),

      closeAll: () => set({ tabs: [], activePath: null })
    }),
    {
      name: 'hydra.editorTabs',
      // Only persist the user-facing tab list + active pointer. No
      // derived state here today, but keeping partialize explicit so
      // future additions (ephemeral flags, loading state) don't sneak
      // into localStorage by accident.
      partialize: (s) => ({ tabs: s.tabs, activePath: s.activePath })
    }
  )
)
