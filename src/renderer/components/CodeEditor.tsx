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
  Terminal as TerminalIcon,
  X,
} from 'lucide-react'
import { useEditor } from '../state/editor'
import { useSessions } from '../state/sessions'
import FileTree from './editor/FileTree'
import CodeMirrorView from './editor/CodeMirrorView'
import MarkdownPreview from './editor/MarkdownPreview'
import GitChangesPanel from './editor/GitChangesPanel'
import { fmtShortcut, hasMod } from '../lib/platform'

type SideTab = 'files' | 'changes'

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

  // Vim modal bindings — persisted for the session only.
  const [vimMode, setVimMode] = useState(false)
  // Markdown preview flag — only relevant when the active file is .md.
  const [previewMd, setPreviewMd] = useState(false)
  // Which sidebar pane is active — files tree or git changes.
  const [sideTab, setSideTab] = useState<SideTab>('files')

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId]
  )
  const root = activeSession?.worktreePath ?? activeSession?.cwd ?? null

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // If the CodeMirror search / replace panel is visible, Esc belongs
        // to it (closes the panel). Don't tear down the whole editor.
        if (document.querySelector('.cm-panels .cm-search')) return
        onClose()
        return
      }
      if (hasMod(e) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveActive()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, saveActive])

  if (!open) return null
  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null
  const isMarkdown = !!activeFile && /\.(md|markdown|mdx)$/i.test(activeFile.path)
  const showPreview = isMarkdown && previewMd

  const body = (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-bg-2">
      <header className="flex shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Code2 size={14} strokeWidth={1.75} className="text-accent-400" />
          <span className="font-semibold text-text-1">editor</span>
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
            disabled={!activeFile || activeFile.encoding !== 'utf-8'}
            className="flex items-center gap-1.5 rounded-sm border border-border-soft bg-bg-3 px-2.5 py-1 text-[11px] text-text-2 hover:bg-bg-4 disabled:cursor-not-allowed disabled:opacity-40"
            title={`Save (${fmtShortcut('S')})`}
          >
            <Save size={12} strokeWidth={1.75} />
            save
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
        <aside className="flex w-64 shrink-0 flex-col border-r border-border-soft bg-bg-2">
          {/* Sidebar tabs: Files (existing tree) | Changes (git diff + commit) */}
          <div className="flex shrink-0 items-stretch border-b border-border-soft bg-bg-2">
            {(['files', 'changes'] as const).map((tab) => {
              const Icon = tab === 'files' ? FolderTree : GitCommit
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
          <div className="min-h-0 flex-1 overflow-hidden">
            {sideTab === 'files' ? (
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
            ) : (
              <GitChangesPanel cwd={root} />
            )}
          </div>
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
          <div className="min-h-0 flex-1 overflow-hidden bg-bg-1 p-2">
            {activeFile && activeFile.encoding === 'utf-8' ? (
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
