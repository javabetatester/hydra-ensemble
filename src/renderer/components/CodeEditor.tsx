import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Clipboard,
  ClipboardPaste,
  Code2,
  Eye,
  File as FileIcon,
  FolderTree,
  GitCommit,
  Keyboard,
  Pencil,
  Save,
  Search as SearchIcon,
  Trash2,
  X,
} from 'lucide-react'
import { useEditor } from '../state/editor'
import { useEditorVim } from '../state/editorSettings'
import { useEditorTabs } from '../state/editorTabs'
import { useSessions } from '../state/sessions'
import {
  useEditorSidebarSize,
  EDITOR_SIDEBAR_MIN,
  EDITOR_SIDEBAR_MAX
} from '../state/panels'
import FileTree from './editor/FileTree'
import CodeMirrorView, { getActiveView } from './editor/CodeMirrorView'
import EditorTabs from './editor/EditorTabs'
import JumpToSymbol from './editor/JumpToSymbol'
import MarkdownPreview from './editor/MarkdownPreview'
import GitChangesPanel from './editor/GitChangesPanel'
import InlineSearch from './editor/InlineSearch'
import SearchPanel from './editor/SearchPanel'
import DiffView from './editor/DiffView'
import { fmtShortcut, hasMod } from '../lib/platform'
import { matchesCombo } from '../lib/keybind'
import { resolveBind, useKeybinds } from '../state/keybinds'

type SideTab = 'files' | 'changes' | 'search'

interface Props {
  open: boolean
  onClose: () => void
  /** 'inline' renders as a flex pane (no portal). 'overlay' is full-screen modal. */
  mode?: 'inline' | 'overlay'
}

export default function CodeEditor({ open, onClose, mode = 'inline' }: Props) {
  const sessions = useSessions((s) => s.sessions)
  const activeSessionId = useSessions((s) => s.activeId)
  const openFiles = useEditor((s) => s.openFiles)
  const activeFilePath = useEditor((s) => s.activeFilePath)
  const openFile = useEditor((s) => s.openFile)
  const closeFile = useEditor((s) => s.closeFile)
  const setActive = useEditor((s) => s.setActive)
  const updateActiveBuffer = useEditor((s) => s.updateActiveBuffer)
  const saveActive = useEditor((s) => s.saveActive)
  const setOverrideRoot = useEditor((s) => s.setOverrideRoot)
  const openDiffs = useEditor((s) => s.openDiffs)
  const activeDiffPath = useEditor((s) => s.activeDiffPath)
  const activeKind = useEditor((s) => s.activeKind)
  const setActiveDiff = useEditor((s) => s.setActiveDiff)
  const closeDiff = useEditor((s) => s.closeDiff)
  const activeDiff = useMemo(
    () => openDiffs.find((d) => d.path === activeDiffPath) ?? null,
    [openDiffs, activeDiffPath]
  )
  const fileDiffs = useEditor((s) => s.fileDiffs)
  const closeAllFiles = useEditor((s) => s.closeAllFiles)
  // Subscribe to the savedBytes map so the Save button re-renders the
  // moment the active buffer diverges from disk. Dirty state is derived
  // here (not from a stored flag) to stay consistent with the live
  // buffer on every keystroke.
  const savedBytes = useEditor((s) => s.savedBytes)

  // Toolbar compaction is driven by a ResizeObserver on the header
  // element rather than a viewport media query: the editor pane lives
  // inside a slide panel whose width varies independently of the
  // window (project sidebar + sessions panel both eat horizontal
  // space). Below ~440px we drop button labels and keep icons.
  const headerRef = useRef<HTMLElement>(null)
  const [headerCompact, setHeaderCompact] = useState(false)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setHeaderCompact(entry.contentRect.width < 440)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Sidebar width (Files / Changes / Search pane). Persisted + drag-resizable.
  const sidebarWidth = useEditorSidebarSize((s) => s.width)
  const setSidebarWidth = useEditorSidebarSize((s) => s.setWidth)

  // Vim modal bindings — persisted across sessions via zustand persist.
  const vimMode = useEditorVim((s) => s.vimMode)
  const toggleVimMode = useEditorVim((s) => s.toggleVimMode)
  // External-change conflict map. Read selectively so unrelated paths
  // don't re-render the whole editor.
  const externalChange = useEditor((s) => s.externalChange)
  const applyExternalReload = useEditor((s) => s.applyExternalReload)
  const dismissExternalChange = useEditor((s) => s.dismissExternalChange)
  const openDiff = useEditor((s) => s.openDiff)
  const sidebarCollapsed = useEditor((s) => s.sidebarCollapsed)
  // Markdown preview flag — only relevant when the active file is .md.
  const [previewMd, setPreviewMd] = useState(false)
  // Which sidebar pane is active — files tree or git changes.
  const [sideTab, setSideTab] = useState<SideTab>('files')

  // Cross-component bridge so the guided tour (and other features
  // that live outside this component) can flip the sidebar tab —
  // e.g. the "Changes — stage, diff, commit" tour step needs the
  // changes pane visible to anchor on it.
  useEffect(() => {
    const onSet = (e: Event): void => {
      const detail = (e as CustomEvent<SideTab>).detail
      if (detail === 'files' || detail === 'changes' || detail === 'search') {
        setSideTab(detail)
      }
    }
    window.addEventListener('hydra.editor.setSideTab', onSet as EventListener)
    return () => window.removeEventListener('hydra.editor.setSideTab', onSet as EventListener)
  }, [])
  // Lazy-mount guard for the git changes pane. Mounting it immediately
  // fires a `git status` + `git diff` the moment the editor opens, which
  // in a repo with a huge lockfile staged can ship megabytes across the
  // IPC bridge and kill the renderer. We only mount it after the user
  // first asks for it; once mounted, it stays resident so the `hidden`
  // toggle does its job (no more remount-per-click storms).
  const [changesEverOpened, setChangesEverOpened] = useState(false)
  useEffect(() => {
    if (sideTab === 'changes') setChangesEverOpened(true)
  }, [sideTab])

  // Inline search overlay — Ctrl+F toggles it. Carries an optional seed
  // so that opening with a selection prefills the query.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchSeed, setSearchSeed] = useState('')

  // Tracked selection state of the active CodeMirror view so the
  // header's Copy button can disable when nothing is selected.
  const [hasEditorSelection, setHasEditorSelection] = useState(false)
  const [canPasteEditor, setCanPasteEditor] = useState(false)

  // Cross-file search (Ctrl+Shift+F). Lazy-mount the sidebar tab and
  // bump the nonce when the shortcut fires so the input refocuses even
  // if the tab was already open.
  const [searchEverOpened, setSearchEverOpened] = useState(false)
  const [globalSearchSeed, setGlobalSearchSeed] = useState('')
  const [globalSearchFocusNonce, setGlobalSearchFocusNonce] = useState(0)
  useEffect(() => {
    if (sideTab === 'search') setSearchEverOpened(true)
  }, [sideTab])

  // Jump-to-symbol palette (mod+P inside the editor). Controlled from
  // here so Escape inside the palette lands back in the editor without
  // tearing down state.
  const [jumpOpen, setJumpOpen] = useState(false)

  // Tabs store (persisted across reloads). The CodeEditor explicitly
  // mirrors into `useEditorTabs` only when the user OPENS a file — never
  // when we happen to render one (e.g. overrideRoot cleanup, diff
  // close-to-file fallback). This keeps the tab strip honest: it only
  // shows paths the user actually asked to surface.
  const tabsActivePath = useEditorTabs((s) => s.activePath)
  const openInTabs = useEditorTabs.getState().open

  // Guard against out-of-order `readFile` responses when the user flips
  // tabs while an earlier read is still in flight. Every tab-switch or
  // explicit open bumps this id; the async consumer drops stale replies.
  const tabLoadRunId = useRef(0)

  // Single entrypoint for "user asked to open this file". Bumps the run
  // id, calls the editor store's openFile (which does the IPC read), and
  // — only on success — surfaces the resolved path in the tabs store.
  // Callers MUST use this instead of openFile directly so tabs stay in
  // sync; forgetting to mirror into tabs is the whole reason this exists.
  const openAndTrack = async (path: string): Promise<void> => {
    const id = ++tabLoadRunId.current
    const resolved = await openFile(path)
    if (id !== tabLoadRunId.current) return
    if (resolved) openInTabs(resolved)
  }

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  )
  const sessionRoot = activeSession?.worktreePath ?? activeSession?.cwd ?? null
  // When the user opens a file from the .claude tab, the store pins the
  // file tree to that .claude dir. Cleared on close so the next Ctrl+E
  // starts fresh at the session worktree. Changes & Search still follow
  // the session's real cwd — they only make sense in that context.
  const overrideRoot = useEditor((s) => s.overrideRoot)
  const root = overrideRoot ?? sessionRoot

  // When the editor transitions from open → closed:
  //   * drop any .claude root override so the next open starts at the
  //     session worktree.
  //   * if we were in .claude mode, also flush every open file tab. The
  //     next Ctrl+E should feel like a fresh editor instead of landing
  //     on whichever .claude file the user was last browsing.
  useEffect(() => {
    if (open) return
    if (overrideRoot) {
      closeAllFiles()
      setOverrideRoot(null)
    } else {
      setOverrideRoot(null)
    }
  }, [open, overrideRoot, setOverrideRoot, closeAllFiles])

  // Force the sidebar to the Files tab whenever the user enters
  // .claude-mode — they just asked to browse that dir, so surfacing
  // the tree is the only thing that makes sense.
  useEffect(() => {
    if (overrideRoot) setSideTab('files')
  }, [overrideRoot])

  // Reset selection tracking when the editor closes or the active file
  // changes — avoids the Copy button staying "enabled" from whatever was
  // last selected in a different file.
  useEffect(() => {
    setHasEditorSelection(false)
  }, [activeFilePath])

  // Poll clipboard while the editor is open so Paste disables cleanly
  // when nothing is on the clipboard. Re-checks on window focus.
  useEffect(() => {
    if (!open) return
    let alive = true
    const refresh = async (): Promise<void> => {
      try {
        const txt = await navigator.clipboard.readText()
        if (alive) setCanPasteEditor(!!txt)
      } catch {
        if (alive) setCanPasteEditor(false)
      }
    }
    void refresh()
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
    }
  }, [open])

  const doEditorCopy = async (): Promise<void> => {
    const view = getActiveView()
    if (!view) return
    const sel = view.state.selection.main
    if (sel.from === sel.to) return
    const text = view.state.sliceDoc(sel.from, sel.to)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // noop
    }
  }

  const doEditorPaste = async (): Promise<void> => {
    const view = getActiveView()
    if (!view) return
    try {
      const txt = await navigator.clipboard.readText()
      if (!txt) return
      const sel = view.state.selection.main
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: txt },
        selection: { anchor: sel.from + txt.length }
      })
      view.focus()
    } catch {
      // noop
    }
  }

  // Delete = drop the current selection. If nothing is selected, delete
  // the line the cursor is on — same fallback VSCode's "Delete" command
  // uses, so the menu item is always useful.
  const doEditorDelete = (): void => {
    const view = getActiveView()
    if (!view) return
    const sel = view.state.selection.main
    if (sel.from !== sel.to) {
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: '' },
        selection: { anchor: sel.from }
      })
    } else {
      const line = view.state.doc.lineAt(sel.from)
      // Include the trailing newline when it exists so the line is fully
      // removed, not just blanked.
      const to = line.to < view.state.doc.length ? line.to + 1 : line.to
      view.dispatch({
        changes: { from: line.from, to, insert: '' },
        selection: { anchor: line.from }
      })
    }
    view.focus()
  }

  // Floating context menu position for the editor content area.
  const [editorMenu, setEditorMenu] = useState<{ x: number; y: number } | null>(
    null
  )

  // Ref into the FileTree's root container so editor.focusTree can move
  // focus there from anywhere. The tree itself wires the actual
  // navigation handlers internally.
  const treeContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editorMenu) return
    const onDown = (): void => setEditorMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setEditorMenu(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('wheel', onDown, { passive: true })
    window.addEventListener('resize', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('wheel', onDown)
      window.removeEventListener('resize', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [editorMenu])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Close the inline search first if it's up; otherwise close editor.
        if (searchOpen) {
          setSearchOpen(false)
          return
        }
        // With vim mode ON, Esc is the user's way back to NORMAL
        // mode — letting onClose() fire would slam the editor shut
        // every time the user wants to leave INSERT. Defer to
        // CodeMirror's vim keymap instead; close via the X button.
        if (vimMode) return
        onClose()
        return
      }

      // Editor-scoped keybinds. Resolved on every keydown so user
      // overrides take effect without a remount. Editor scope wins
      // over the global session-close binding when the editor pane
      // is open (mod+w semantically belongs to the focused tab strip).
      const overrides = useKeybinds.getState().overrides
      const isMatch = (id: string): boolean => {
        const combo = resolveBind(id, overrides)
        return !!combo && matchesCombo(e, combo)
      }
      if (isMatch('editor.save')) {
        e.preventDefault()
        e.stopPropagation()
        void saveActive()
        return
      }
      if (isMatch('editor.saveAll')) {
        e.preventDefault()
        e.stopPropagation()
        void Promise.all(
          openFiles.map(async (f) => {
            if (f.encoding !== 'utf-8') return
            const baseline = useEditor.getState().savedBytes[f.path]
            if (baseline === undefined || baseline === f.bytes) return
            useEditor.setState({ activeFilePath: f.path, activeKind: 'file' })
            await useEditor.getState().saveActive()
          })
        )
        return
      }
      if (isMatch('editor.closeTab')) {
        e.preventDefault()
        e.stopPropagation()
        if (activeKind === 'diff' && activeDiffPath) {
          closeDiff(activeDiffPath)
        } else if (activeFilePath) {
          closeFile(activeFilePath)
        }
        return
      }
      if (isMatch('editor.nextTab')) {
        e.preventDefault()
        e.stopPropagation()
        if (openFiles.length === 0) return
        const i = openFiles.findIndex((f) => f.path === activeFilePath)
        const next = openFiles[(i + 1) % openFiles.length]
        if (next) setActive(next.path)
        return
      }
      if (isMatch('editor.prevTab')) {
        e.preventDefault()
        e.stopPropagation()
        if (openFiles.length === 0) return
        const i = openFiles.findIndex((f) => f.path === activeFilePath)
        const prev =
          openFiles[(i - 1 + openFiles.length) % openFiles.length]
        if (prev) setActive(prev.path)
        return
      }
      if (isMatch('editor.focusTree')) {
        e.preventDefault()
        e.stopPropagation()
        const root = treeContainerRef.current
        if (root) {
          const focusable = root.querySelector<HTMLElement>(
            '[data-tree-node][tabindex="0"]'
          )
          if (focusable) focusable.focus()
          else root.focus()
        }
        return
      }
      if (isMatch('editor.focusEditor')) {
        e.preventDefault()
        e.stopPropagation()
        const view = getActiveView()
        if (view) view.focus()
        return
      }
      if (isMatch('editor.toggleSidebar')) {
        e.preventDefault()
        e.stopPropagation()
        useEditor.getState().toggleSidebar()
        return
      }
      if (isMatch('editor.toggleVim')) {
        e.preventDefault()
        e.stopPropagation()
        useEditorVim.getState().toggleVimMode()
        return
      }
      // Mod+S fallback (kept so users without explicit overrides still
      // get save when editor.save is somehow not bound).
      if (hasMod(e) && e.key.toLowerCase() === 's' && !e.shiftKey) {
        e.preventDefault()
        void saveActive()
        return
      }
      // Ctrl/Cmd+F — toggle the inline search overlay. When opening,
      // seed the query with the current selection (if any) so typing
      // on top is the fast path for "find this word under my cursor".
      if (hasMod(e) && e.key.toLowerCase() === 'f' && !e.shiftKey) {
        const view = getActiveView()
        if (!view) return
        e.preventDefault()
        if (searchOpen) {
          setSearchOpen(false)
          return
        }
        const sel = view.state.sliceDoc(
          view.state.selection.main.from,
          view.state.selection.main.to
        )
        // Don't seed multi-line selections — that's never what the user
        // is trying to search for.
        setSearchSeed(sel && !sel.includes('\n') ? sel : '')
        setSearchOpen(true)
        return
      }
      // Ctrl/Cmd+Shift+F — toggle the cross-file Search tab in the
      // sidebar. If it's already showing, bounce back to Files. When
      // opening, seed the query from the current selection (single-line)
      // and bump the focus nonce so the input grabs focus.
      if (hasMod(e) && e.key.toLowerCase() === 'f' && e.shiftKey) {
        e.preventDefault()
        if (sideTab === 'search') {
          setSideTab('files')
          return
        }
        const view = getActiveView()
        const sel = view
          ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
          : ''
        if (sel && !sel.includes('\n')) {
          setGlobalSearchSeed(sel)
        }
        setSideTab('search')
        setGlobalSearchFocusNonce((n) => n + 1)
        return
      }
    }
    // Capture phase so we beat CodeMirror's own keymap for Esc handling.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    open,
    onClose,
    saveActive,
    searchOpen,
    sideTab,
    openFiles,
    activeFilePath,
    activeDiffPath,
    activeKind,
    closeFile,
    closeDiff,
    setActive,
    vimMode
  ])

  // Overlay mode is gated on `open` (no portal when closed). Inline
  // mode renders body unconditionally so the parent slide-pane can
  // animate its width 0 → panelWidth → 0 with the body still painted —
  // unmounting on `!open` would yank the content out mid-transition
  // and the user would see the editor "vanish" instead of slide.
  if (!open && mode === 'overlay') return null
  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null
  const isMarkdown = !!activeFile && /\.(md|markdown|mdx)$/i.test(activeFile.path)
  const showPreview = isMarkdown && previewMd
  // Save is a no-op on a clean buffer — gate the button so users get
  // an immediate visual cue (disabled = nothing to save) and can't
  // trigger spurious writeFile round-trips by mashing Ctrl+S.
  const isDirty =
    !!activeFile &&
    activeFile.encoding === 'utf-8' &&
    savedBytes[activeFile.path] !== undefined &&
    savedBytes[activeFile.path] !== activeFile.bytes

  const body = (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-bg-2">
      <header
        ref={headerRef}
        className="flex shrink-0 items-center justify-between gap-2 border-b border-border-soft bg-bg-2 px-3 py-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <Code2 size={14} strokeWidth={1.75} className="shrink-0 text-accent-400" />
          {!headerCompact && (
            <span className="shrink-0 font-semibold text-text-1">editor</span>
          )}
          {overrideRoot && !headerCompact ? (
            <span
              className="flex shrink-0 items-center gap-1 rounded-sm border border-accent-500/40 bg-accent-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-200"
              title={`pinned to ${overrideRoot} — close the editor to unpin`}
            >
              .claude
            </span>
          ) : null}
          {root ? (
            <span className="min-w-0 truncate font-mono text-[11px] text-text-3" title={root}>
              {!headerCompact && <span className="text-text-4">·</span>}{' '}
              {root.split(/[/\\]/).filter(Boolean).pop() ?? root}
            </span>
          ) : null}
        </div>
        {/* Toolbar buttons. Labels collapse to icon-only when the header
            is below ~440px (measured by ResizeObserver — viewport media
            queries can't see the editor's actual width inside a slide
            panel). Tooltips carry the full intent in either mode. */}
        <div className="flex shrink-0 items-center gap-1">
          {isMarkdown ? (
            <button
              type="button"
              onClick={() => setPreviewMd((v) => !v)}
              className={`flex shrink-0 items-center gap-1 rounded-sm border px-2 py-1 text-[11px] transition ${
                previewMd
                  ? 'border-accent-500/40 bg-accent-500/10 text-accent-200'
                  : 'border-border-soft text-text-3 hover:border-border-mid hover:text-text-1'
              }`}
              title={previewMd ? 'switch to source' : 'render markdown preview'}
              aria-label={previewMd ? 'switch to source' : 'render markdown preview'}
            >
              {previewMd ? (
                <Pencil size={11} strokeWidth={1.75} />
              ) : (
                <Eye size={11} strokeWidth={1.75} />
              )}
              {!headerCompact && (previewMd ? 'source' : 'preview')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => toggleVimMode()}
            className={`flex shrink-0 items-center gap-1 rounded-sm border px-2 py-1 font-mono text-[11px] transition ${
              vimMode
                ? 'border-status-generating/40 bg-status-generating/10 text-status-generating'
                : 'border-border-soft text-text-3 hover:border-border-mid hover:text-text-1'
            }`}
            title={vimMode ? 'disable vim bindings' : 'enable vim bindings (hjkl / i / :w / etc)'}
            aria-label={vimMode ? 'disable vim bindings' : 'enable vim bindings'}
          >
            <Keyboard size={11} strokeWidth={1.75} />
            {!headerCompact && 'vim'}
          </button>
          <button
            type="button"
            onClick={() => void saveActive()}
            disabled={!isDirty}
            className={`flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
              isDirty
                ? 'border-accent-500/50 bg-accent-500/15 text-accent-200 hover:bg-accent-500/25'
                : 'border-border-soft bg-bg-3 text-text-2'
            }`}
            title={
              isDirty
                ? `Save (${fmtShortcut('S')})`
                : 'No unsaved changes'
            }
            aria-label={isDirty ? 'Save (unsaved changes)' : 'Save'}
          >
            <Save size={12} strokeWidth={1.75} />
            {!headerCompact && (isDirty ? 'save •' : 'save')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-sm p-1.5 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="Close editor"
            title="Esc"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={`relative flex shrink-0 flex-col overflow-hidden border-r bg-bg-2 transition-[width] duration-200 ${
            sidebarCollapsed ? 'border-transparent' : 'border-border-soft'
          }`}
          style={{
            width: sidebarCollapsed ? 0 : `${sidebarWidth}px`,
            minWidth: sidebarCollapsed ? 0 : `${EDITOR_SIDEBAR_MIN}px`,
            maxWidth: sidebarCollapsed ? 0 : `${EDITOR_SIDEBAR_MAX}px`
          }}
          aria-hidden={sidebarCollapsed}
        >
          {/* Sidebar tabs: Search | Files | Changes. Search sits left of
              Files so Ctrl+Shift+F lands the user at the far-left anchor. */}
          <div
            data-tour-id="editor-side-tabs"
            className="flex shrink-0 items-stretch border-b border-border-soft bg-bg-2"
          >
            {(['search', 'files', 'changes'] as const).map((tab) => {
              const Icon =
                tab === 'files' ? FolderTree : tab === 'changes' ? GitCommit : SearchIcon
              const active = sideTab === tab
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSideTab(tab)}
                  data-tour-id={tab === 'changes' ? 'editor-changes-tab' : undefined}
                  className={`flex flex-1 items-center justify-center gap-1.5 border-r border-border-soft px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] last:border-r-0 transition ${
                    active
                      ? 'bg-bg-1 text-accent-300'
                      : 'text-text-3 hover:bg-bg-3 hover:text-text-1'
                  }`}
                >
                  <Icon size={11} strokeWidth={1.75} />
                  {tab}
                </button>
              )
            })}
          </div>
          {/* Both panes stay mounted — we toggle visibility with `hidden`
              instead of unmounting so switching tabs doesn't tear down the
              file tree (collapses all open dirs + reruns listDir on disk)
              or re-fetch the git status from scratch. That churn was
              visibly freezing the UI on rapid toggling. */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              className={`absolute inset-0 ${sideTab === 'files' ? '' : 'hidden'}`}
              aria-hidden={sideTab !== 'files'}
            >
              <div ref={treeContainerRef} className="h-full" tabIndex={-1}>
                {root ? (
                  <FileTree
                    root={root}
                    onOpenFile={(p) => void openAndTrack(p)}
                    sessionId={
                      overrideRoot
                        ? `override:${overrideRoot}`
                        : (activeSession?.id ?? null)
                    }
                    breadcrumb={(() => {
                      // "<agent.name> · <basename(root)> · <branch>"
                      const parts: string[] = []
                      if (activeSession?.name) parts.push(activeSession.name)
                      const base = root.split(/[/\\]/).filter(Boolean).pop()
                      if (base) parts.push(base)
                      if (activeSession?.branch) parts.push(activeSession.branch)
                      return parts.length > 0 ? parts.join(' · ') : null
                    })()}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                    <FileIcon size={28} strokeWidth={1.25} className="text-text-4" />
                    <div className="text-xs text-text-2">no active session</div>
                    <div className="text-[11px] text-text-4">
                      open a session to browse its files.
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div
              className={`absolute inset-0 ${sideTab === 'changes' ? '' : 'hidden'}`}
              aria-hidden={sideTab !== 'changes'}
            >
              {changesEverOpened ? <GitChangesPanel cwd={root} /> : null}
            </div>
            <div
              className={`absolute inset-0 ${sideTab === 'search' ? '' : 'hidden'}`}
              aria-hidden={sideTab !== 'search'}
            >
              {searchEverOpened ? (
                <SearchPanel
                  cwd={root}
                  onOpenMatch={(p) => void openAndTrack(p)}
                  initialQuery={globalSearchSeed}
                  focusNonce={globalSearchFocusNonce}
                />
              ) : null}
            </div>
          </div>

          {/* Resize handle — 4px strip pinned to the aside's right edge.
              Drag to pick a new width; double-click resets to the default. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-accent-500/30 active:bg-accent-500/60"
            onMouseDown={(e) => {
              e.preventDefault()
              const startX = e.clientX
              const startWidth = sidebarWidth
              // Throttle setSidebarWidth to one call per animation frame.
              // Zustand persists width to localStorage on every setWidth,
              // and raw mousemove fires 60+/s — syncing that many writes
              // blocks layout and makes the drag feel stuck. rAF coalesces.
              let rafId: number | null = null
              let latest = startWidth
              const onMove = (ev: MouseEvent): void => {
                latest = startWidth + (ev.clientX - startX)
                if (rafId !== null) return
                rafId = requestAnimationFrame(() => {
                  rafId = null
                  setSidebarWidth(latest)
                })
              }
              const onUp = (): void => {
                if (rafId !== null) cancelAnimationFrame(rafId)
                setSidebarWidth(latest)
                document.removeEventListener('mousemove', onMove)
                document.removeEventListener('mouseup', onUp)
                document.body.style.userSelect = ''
              }
              document.body.style.userSelect = 'none'
              document.addEventListener('mousemove', onMove)
              document.addEventListener('mouseup', onUp)
            }}
            onDoubleClick={() => setSidebarWidth(256)}
            title="Drag to resize · double-click to reset"
          />
        </aside>
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-1">
          <div className="df-scroll flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-soft bg-bg-2 px-2 pt-1.5">
            {openFiles.length === 0 && openDiffs.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-text-4">no file open</div>
            )}
            {openFiles.map((f) => {
              const name = f.path.split(/[/\\]/).pop() ?? f.path
              const active = activeKind === 'file' && f.path === activeFilePath
              return (
                <div
                  key={`file:${f.path}`}
                  className={`group flex items-center gap-2 rounded-t-sm px-2.5 py-1 text-[11px] ${
                    active
                      ? '-mb-px border-t-2 border-accent-500 bg-bg-1 text-text-1'
                      : 'mt-0.5 border-t-2 border-transparent bg-bg-3 text-text-3 hover:bg-bg-4 hover:text-text-2'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActive(f.path)}
                    className="max-w-[12rem] truncate text-left font-mono"
                    title={f.path}
                  >
                    {name}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeFile(f.path)}
                    className={`rounded-sm p-0.5 text-text-4 hover:bg-bg-4 hover:text-text-1 ${
                      active ? '' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    aria-label="Close tab"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </div>
              )
            })}
            {openDiffs.map((d) => {
              const name = d.path.split(/[/\\]/).pop() ?? d.path
              const active = activeKind === 'diff' && d.path === activeDiffPath
              return (
                <div
                  key={`diff:${d.path}`}
                  className={`group flex items-center gap-2 rounded-t-sm px-2.5 py-1 text-[11px] ${
                    active
                      ? '-mb-px border-t-2 border-accent-500 bg-bg-1 text-text-1'
                      : 'mt-0.5 border-t-2 border-transparent bg-bg-3 text-text-3 hover:bg-bg-4 hover:text-text-2'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveDiff(d.path)}
                    className="flex max-w-[12rem] items-center gap-1.5 truncate text-left font-mono"
                    title={`${d.path} — diff`}
                  >
                    <GitCommit
                      size={10}
                      strokeWidth={1.75}
                      className={active ? 'text-accent-400' : 'text-text-4'}
                    />
                    <span className="truncate">{name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => closeDiff(d.path)}
                    className={`rounded-sm p-0.5 text-text-4 hover:bg-bg-4 hover:text-text-1 ${
                      active ? '' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    aria-label="Close diff tab"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </div>
              )
            })}
          </div>
          <div
            className="relative min-h-0 flex-1 overflow-hidden bg-bg-1 p-2"
            onContextMenu={(e) => {
              // Only surface the menu over an editable text buffer — not in
              // the diff/preview/binary/empty states where copy/paste/delete
              // don't have a well-defined target.
              if (!activeFile || activeFile.encoding !== 'utf-8') return
              if (activeKind === 'diff') return
              if (showPreview) return
              e.preventDefault()
              setEditorMenu({ x: e.clientX, y: e.clientY })
            }}
          >
            {activeKind === 'diff' && activeDiff ? (
              <div className="flex h-full flex-col gap-2">
                <div className="flex items-center gap-2 rounded-md border border-border-soft bg-bg-2 px-3 py-1.5">
                  <GitCommit size={12} strokeWidth={1.75} className="text-accent-400" />
                  <span className="font-mono text-[11px] text-text-1">{activeDiff.path}</span>
                  <span className="rounded-sm border border-border-soft bg-bg-3 px-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-3">
                    {activeDiff.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => closeDiff(activeDiff.path)}
                    className="ml-auto rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1"
                    aria-label="Close diff"
                    title="Close diff"
                  >
                    <X size={12} strokeWidth={1.75} />
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <DiffView diff={activeDiff.patch} fill emptyLabel="no textual diff" />
                </div>
              </div>
            ) : activeFile && activeFile.encoding === 'utf-8' ? (
              showPreview ? (
                <MarkdownPreview markdown={activeFile.bytes} />
              ) : (
                <div className="flex h-full flex-col">
                  {externalChange[activeFile.path] ? (
                    <ExternalChangeBanner
                      path={activeFile.path}
                      deleted={!!externalChange[activeFile.path]?.deleted}
                      onReload={async () => {
                        await applyExternalReload(activeFile.path)
                      }}
                      onKeep={() => dismissExternalChange(activeFile.path)}
                      onShowDiff={async () => {
                        try {
                          const fresh = await window.api.editor.readFile(
                            activeFile.path
                          )
                          if (fresh.encoding !== 'utf-8') {
                            return
                          }
                          openDiff({
                            path: activeFile.path,
                            patch: buildSyntheticDiff(
                              activeFile.path,
                              activeFile.bytes,
                              fresh.bytes
                            ),
                            status: 'modified'
                          })
                        } catch {
                          // best-effort — skip if read fails
                        }
                      }}
                    />
                  ) : null}
                  <div className="min-h-0 flex-1">
                    <CodeMirrorView
                      key={activeFile.path}
                      path={activeFile.path}
                      initial={activeFile.bytes}
                      onChange={(text) => updateActiveBuffer(text)}
                      onSave={() => void saveActive()}
                      vimMode={vimMode}
                      diffPatch={fileDiffs[activeFile.path] ?? null}
                      onSelectionChange={setHasEditorSelection}
                    />
                  </div>
                </div>
              )
            ) : activeFile ? (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <FileIcon size={32} strokeWidth={1.25} className="text-text-4" />
                <div className="text-sm text-text-2">binary file</div>
                <div className="text-xs text-text-4">
                  {activeFile.size.toLocaleString()} bytes — cannot be displayed
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <FileIcon size={32} strokeWidth={1.25} className="text-text-4" />
                <div className="text-sm text-text-2">no file selected</div>
                <div className="text-xs text-text-4">
                  pick a file from the tree to start editing.
                </div>
              </div>
            )}

            {/* Inline find/replace overlay. Mounts only when toggled and
                only when we have an actual CodeMirror view to drive. */}
            {searchOpen && activeFile && activeFile.encoding === 'utf-8' && !showPreview ? (
              (() => {
                const view = getActiveView()
                if (!view) return null
                return (
                  <InlineSearch
                    key={activeFile.path}
                    view={view}
                    initialQuery={searchSeed}
                    onClose={() => setSearchOpen(false)}
                  />
                )
              })()
            ) : null}
          </div>
        </section>
      </div>
      {editorMenu
        ? createPortal(
            <EditorCtxMenu
              x={editorMenu.x}
              y={editorMenu.y}
              canCopy={hasEditorSelection}
              canPaste={
                !!activeFile && activeFile.encoding === 'utf-8' && canPasteEditor
              }
              canDelete={!!activeFile && activeFile.encoding === 'utf-8'}
              onCopy={() => {
                void doEditorCopy()
                setEditorMenu(null)
              }}
              onPaste={() => {
                void doEditorPaste()
                setEditorMenu(null)
              }}
              onDelete={() => {
                doEditorDelete()
                setEditorMenu(null)
              }}
            />,
            document.body
          )
        : null}
    </div>
  )

  if (mode === 'inline') return body

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-bg-0/85 p-6 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="df-fade-in mx-auto h-full max-w-[1600px] overflow-hidden rounded-lg border border-border-mid bg-bg-2 shadow-pop">
        {body}
      </div>
    </div>,
    document.body
  )
}

interface EditorCtxMenuProps {
  x: number
  y: number
  canCopy: boolean
  canPaste: boolean
  canDelete: boolean
  onCopy: () => void
  onPaste: () => void
  onDelete: () => void
}

function EditorCtxMenu({
  x,
  y,
  canCopy,
  canPaste,
  canDelete,
  onCopy,
  onPaste,
  onDelete
}: EditorCtxMenuProps) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.min(x, vw - 170)
  const top = Math.min(y, vh - 130)
  return (
    <div
      className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-border-mid bg-bg-2 py-1 text-xs text-text-2 shadow-xl shadow-black/40"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        onClick={onCopy}
        disabled={!canCopy}
        title={canCopy ? undefined : 'select text first'}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-3 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Clipboard size={12} strokeWidth={1.75} />
        <span>Copy</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onPaste}
        disabled={!canPaste}
        title={canPaste ? undefined : 'clipboard is empty'}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-3 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ClipboardPaste size={12} strokeWidth={1.75} />
        <span>Paste</span>
      </button>
      <div className="my-1 h-px bg-border-soft" />
      <button
        type="button"
        role="menuitem"
        onClick={onDelete}
        disabled={!canDelete}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-status-attention hover:bg-bg-3 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Trash2 size={12} strokeWidth={1.75} />
        <span>Delete</span>
      </button>
    </div>
  )
}

interface ExternalChangeBannerProps {
  path: string
  deleted: boolean
  onReload: () => Promise<void>
  onKeep: () => void
  onShowDiff: () => Promise<void>
}

/**
 * Sticky conflict banner shown above the editor when an open file
 * mutates on disk while the in-renderer buffer is dirty. We never show
 * this for clean buffers — those are reloaded silently with a toast.
 *
 * Reload disk gates behind a confirm so the user doesn't lose the
 * in-memory edits with one stray click. Keep mine just dismisses;
 * Show diff opens a synthetic diff tab so the user can see WHAT
 * changed before deciding.
 */
function ExternalChangeBanner({
  path,
  deleted,
  onReload,
  onKeep,
  onShowDiff
}: ExternalChangeBannerProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border border-status-attention/40 bg-status-attention/10 px-3 py-2 font-mono text-xs text-status-attention">
      <AlertTriangle size={14} strokeWidth={1.75} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {deleted
          ? `${path.split(/[\\/]/).pop()} was removed externally — your unsaved buffer is still here.`
          : `${path.split(/[\\/]/).pop()} changed on disk while you have unsaved edits.`}
      </span>
      {!deleted ? (
        <button
          type="button"
          onClick={() => {
            const proceed = window.confirm(
              'Reload from disk and discard your unsaved changes?'
            )
            if (!proceed) return
            void onReload()
          }}
          className="rounded-sm border border-status-attention/60 bg-status-attention/20 px-2 py-0.5 text-[11px] font-semibold text-status-attention hover:bg-status-attention/30"
        >
          Reload disk
        </button>
      ) : null}
      <button
        type="button"
        onClick={onKeep}
        className="rounded-sm border border-border-soft bg-bg-2 px-2 py-0.5 text-[11px] text-text-2 hover:border-border-mid hover:text-text-1"
      >
        Keep mine
      </button>
      {!deleted ? (
        <button
          type="button"
          onClick={() => void onShowDiff()}
          className="rounded-sm border border-border-soft bg-bg-2 px-2 py-0.5 text-[11px] text-text-2 hover:border-border-mid hover:text-text-1"
        >
          Show diff
        </button>
      ) : null}
    </div>
  )
}

/**
 * Build a synthetic unified diff between two strings, line-by-line. Not
 * aligned by an LCS — each side is dumped wholesale with `-` / `+`
 * markers — but it's enough for the user to eyeball "what's different".
 * The DiffView component reads unified-diff syntax, and the synthetic
 * patch round-trips through it cleanly because we only need to render,
 * not apply.
 */
function buildSyntheticDiff(path: string, mine: string, theirs: string): string {
  const header = `--- ${path} (your buffer)\n+++ ${path} (on disk)\n`
  if (mine === theirs) {
    return `${header}@@ identical @@\n`
  }
  const myLines = mine.split('\n')
  const theirLines = theirs.split('\n')
  const hunkHeader = `@@ -1,${myLines.length} +1,${theirLines.length} @@\n`
  const minus = myLines.map((l) => `-${l}`).join('\n')
  const plus = theirLines.map((l) => `+${l}`).join('\n')
  return `${header}${hunkHeader}${minus}\n${plus}\n`
}
