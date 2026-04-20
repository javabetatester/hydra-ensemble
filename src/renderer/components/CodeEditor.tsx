import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Code2,
  Eye,
  File as FileIcon,
  FolderTree,
  GitCommit,
  Pencil,
  Save,
  Search as SearchIcon,
  Terminal as TerminalIcon,
  X,
} from 'lucide-react'
import { useEditor } from '../state/editor'
import { useSessions } from '../state/sessions'
import {
  useEditorSidebarSize,
  EDITOR_SIDEBAR_MIN,
  EDITOR_SIDEBAR_MAX
} from '../state/panels'
import FileTree from './editor/FileTree'
import CodeMirrorView, { getActiveView } from './editor/CodeMirrorView'
import MarkdownPreview from './editor/MarkdownPreview'
import GitChangesPanel from './editor/GitChangesPanel'
import InlineSearch from './editor/InlineSearch'
import SearchPanel from './editor/SearchPanel'
import DiffView from './editor/DiffView'
import { fmtShortcut, hasMod } from '../lib/platform'

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
  const diffPreview = useEditor((s) => s.diffPreview)
  const setDiffPreview = useEditor((s) => s.setDiffPreview)
  const fileDiffs = useEditor((s) => s.fileDiffs)
  const closeAllFiles = useEditor((s) => s.closeAllFiles)
  // Subscribe to the savedBytes map so the Save button re-renders the
  // moment the active buffer diverges from disk. Dirty state is derived
  // here (not from a stored flag) to stay consistent with the live
  // buffer on every keystroke.
  const savedBytes = useEditor((s) => s.savedBytes)

  // Sidebar width (Files / Changes / Search pane). Persisted + drag-resizable.
  const sidebarWidth = useEditorSidebarSize((s) => s.width)
  const setSidebarWidth = useEditorSidebarSize((s) => s.setWidth)

  // Vim modal bindings — persisted for the session only.
  const [vimMode, setVimMode] = useState(false)
  // Markdown preview flag — only relevant when the active file is .md.
  const [previewMd, setPreviewMd] = useState(false)
  // Which sidebar pane is active — files tree or git changes.
  const [sideTab, setSideTab] = useState<SideTab>('files')
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

  // Cross-file search (Ctrl+Shift+F). Lazy-mount the sidebar tab and
  // bump the nonce when the shortcut fires so the input refocuses even
  // if the tab was already open.
  const [searchEverOpened, setSearchEverOpened] = useState(false)
  const [globalSearchSeed, setGlobalSearchSeed] = useState('')
  const [globalSearchFocusNonce, setGlobalSearchFocusNonce] = useState(0)
  useEffect(() => {
    if (sideTab === 'search') setSearchEverOpened(true)
  }, [sideTab])

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

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // Close the inline search first if it's up; otherwise close editor.
        if (searchOpen) {
          setSearchOpen(false)
          return
        }
        onClose()
        return
      }
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
  }, [open, onClose, saveActive, searchOpen, sideTab])

  if (!open) return null
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
      <header className="flex shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Code2 size={14} strokeWidth={1.75} className="text-accent-400" />
          <span className="font-semibold text-text-1">editor</span>
          {overrideRoot ? (
            <span
              className="flex items-center gap-1 rounded-sm border border-accent-500/40 bg-accent-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-200"
              title={`pinned to ${overrideRoot} — close the editor to unpin`}
            >
              .claude
            </span>
          ) : null}
          {root ? (
            <span className="truncate font-mono text-[11px] text-text-3" title={root}>
              <span className="text-text-4">·</span> {root.split(/[/\\]/).filter(Boolean).pop() ?? root}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {isMarkdown ? (
            <button
              type="button"
              onClick={() => setPreviewMd((v) => !v)}
              className={`flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] transition ${
                previewMd
                  ? 'border-accent-500/40 bg-accent-500/10 text-accent-200'
                  : 'border-border-soft text-text-3 hover:border-border-mid hover:text-text-1'
              }`}
              title={previewMd ? 'switch to source' : 'render markdown preview'}
            >
              {previewMd ? (
                <Pencil size={11} strokeWidth={1.75} />
              ) : (
                <Eye size={11} strokeWidth={1.75} />
              )}
              {previewMd ? 'source' : 'preview'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setVimMode((v) => !v)}
            className={`flex items-center gap-1 rounded-sm border px-2 py-1 font-mono text-[11px] transition ${
              vimMode
                ? 'border-status-generating/40 bg-status-generating/10 text-status-generating'
                : 'border-border-soft text-text-3 hover:border-border-mid hover:text-text-1'
            }`}
            title={vimMode ? 'disable vim bindings' : 'enable vim bindings (hjkl / i / :w / etc)'}
          >
            <TerminalIcon size={11} strokeWidth={1.75} />
            vim {vimMode ? 'on' : 'off'}
          </button>
          <button
            type="button"
            onClick={() => void saveActive()}
            disabled={!isDirty}
            className={`flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
              isDirty
                ? 'border-accent-500/50 bg-accent-500/15 text-accent-200 hover:bg-accent-500/25'
                : 'border-border-soft bg-bg-3 text-text-2'
            }`}
            title={
              isDirty
                ? `Save (${fmtShortcut('S')})`
                : 'No unsaved changes'
            }
          >
            <Save size={12} strokeWidth={1.75} />
            {isDirty ? 'save •' : 'save'}
            <span className="font-mono text-[10px] text-text-4">{fmtShortcut('S')}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1.5 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="Close editor"
            title="Esc"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className="relative flex shrink-0 flex-col border-r border-border-soft bg-bg-2"
          style={{
            width: `${sidebarWidth}px`,
            minWidth: `${EDITOR_SIDEBAR_MIN}px`,
            maxWidth: `${EDITOR_SIDEBAR_MAX}px`
          }}
        >
          {/* Sidebar tabs: Search | Files | Changes. Search sits left of
              Files so Ctrl+Shift+F lands the user at the far-left anchor. */}
          <div className="flex shrink-0 items-stretch border-b border-border-soft bg-bg-2">
            {(['search', 'files', 'changes'] as const).map((tab) => {
              const Icon =
                tab === 'files' ? FolderTree : tab === 'changes' ? GitCommit : SearchIcon
              const active = sideTab === tab
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setSideTab(tab)}
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
              <div className="df-scroll h-full overflow-y-auto">
                {root ? (
                  <FileTree root={root} onOpenFile={(p) => void openFile(p)} />
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
                  onOpenMatch={(p) => void openFile(p)}
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
            {openFiles.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-text-4">no file open</div>
            )}
            {openFiles.map((f) => {
              const name = f.path.split(/[/\\]/).pop() ?? f.path
              const active = f.path === activeFilePath
              return (
                <div
                  key={f.path}
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
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-bg-1 p-2">
            {diffPreview ? (
              <div className="flex h-full flex-col gap-2">
                <div className="flex items-center gap-2 rounded-md border border-border-soft bg-bg-2 px-3 py-1.5">
                  <GitCommit size={12} strokeWidth={1.75} className="text-accent-400" />
                  <span className="font-mono text-[11px] text-text-1">{diffPreview.path}</span>
                  <span className="rounded-sm border border-border-soft bg-bg-3 px-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-text-3">
                    {diffPreview.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDiffPreview(null)}
                    className="ml-auto rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1"
                    aria-label="Close diff"
                    title="Close diff"
                  >
                    <X size={12} strokeWidth={1.75} />
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <DiffView diff={diffPreview.patch} fill emptyLabel="no textual diff" />
                </div>
              </div>
            ) : activeFile && activeFile.encoding === 'utf-8' ? (
              showPreview ? (
                <MarkdownPreview markdown={activeFile.bytes} />
              ) : (
                <CodeMirrorView
                  key={activeFile.path}
                  path={activeFile.path}
                  initial={activeFile.bytes}
                  onChange={(text) => updateActiveBuffer(text)}
                  onSave={() => void saveActive()}
                  vimMode={vimMode}
                  diffPatch={fileDiffs[activeFile.path] ?? null}
                />
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
