import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  GitCommit,
  List as ListIcon,
  ListTree,
  Loader2,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Square,
} from 'lucide-react'
import type { ChangedFile } from '../../../shared/types'
import { useEditor } from '../../state/editor'

interface Props {
  cwd: string | null
}

/** Join an absolute `cwd` with a path that may be absolute or relative,
 *  normalising away any redundant separators. Kept local to this panel
 *  because it's the only place mixing git-reported relatives with the
 *  fs bridge's absolute-only contract. */
function toAbsolute(cwd: string, p: string): string {
  if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) return p
  const sep = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/'
  const trimmed = cwd.endsWith('/') || cwd.endsWith('\\') ? cwd.slice(0, -1) : cwd
  return `${trimmed}${sep}${p}`
}

const STATUS_META: Record<ChangedFile['status'], { label: string; cls: string }> = {
  modified: { label: 'M', cls: 'text-status-input' },
  added: { label: 'A', cls: 'text-status-generating' },
  deleted: { label: 'D', cls: 'text-status-attention' },
  renamed: { label: 'R', cls: 'text-accent-400' },
  untracked: { label: 'U', cls: 'text-text-3' },
}

type ViewMode = 'list' | 'tree'
const VIEW_MODE_KEY = 'gitChangesViewMode'
// Global (app-wide) commit rules — same across every project/session.
const COMMIT_RULES_KEY = 'commitRules:global'
// Legacy per-cwd keys are migrated to the global key on first read.
const COMMIT_RULES_LEGACY_PREFIX = 'commitRules:'
const COMMIT_HEIGHT_KEY = 'gitChangesCommitHeight'
const COMMIT_HEIGHT_DEFAULT = 180
const COMMIT_HEIGHT_MIN = 120
const COMMIT_HEIGHT_TOP_PADDING = 120

type TreeNode =
  | { kind: 'file'; name: string; path: string; file: ChangedFile }
  | { kind: 'dir'; name: string; path: string; children: TreeNode[] }

function buildTree(files: ChangedFile[]): TreeNode[] {
  const rootChildren: TreeNode[] = []
  const dirCache = new Map<string, TreeNode & { kind: 'dir' }>()

  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let parent = rootChildren
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!
      acc = acc ? `${acc}/${seg}` : seg
      let dir = dirCache.get(acc)
      if (!dir) {
        dir = { kind: 'dir', name: seg, path: acc, children: [] }
        dirCache.set(acc, dir)
        parent.push(dir)
      }
      parent = dir.children
    }
    parent.push({ kind: 'file', name: parts[parts.length - 1]!, path: f.path, file: f })
  }

  const sortNodes = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) if (n.kind === 'dir') sortNodes(n.children)
  }
  sortNodes(rootChildren)

  // VS Code-style compact folders: collapse chains of single-dir children
  // so `src > renderer > components` renders as `src/renderer/components`.
  const compact = (nodes: TreeNode[]): TreeNode[] =>
    nodes.map((n) => {
      if (n.kind !== 'dir') return n
      let merged = n
      while (merged.children.length === 1 && merged.children[0]!.kind === 'dir') {
        const only = merged.children[0] as TreeNode & { kind: 'dir' }
        merged = {
          kind: 'dir',
          name: `${merged.name}/${only.name}`,
          path: only.path,
          children: only.children,
        }
      }
      return { ...merged, children: compact(merged.children) }
    })

  return compact(rootChildren)
}

/**
 * Self-contained git changes panel. Deliberately holds ALL its state in
 * React (no zustand store, no cross-module subscriptions) so the failure
 * modes are local and obvious. Every async op is guarded by a generation
 * counter so late responses from a superseded fetch don't stomp newer
 * UI state — that was the class of bug that used to leave the header
 * spinner stuck forever after the user clicked Refresh a few times.
 */
export default function GitChangesPanel({ cwd }: Props) {
  const openDiff = useEditor((s) => s.openDiff)
  const closeAllDiffs = useEditor((s) => s.closeAllDiffs)
  const setFileDiff = useEditor((s) => s.setFileDiff)
  const openFile = useEditor((s) => s.openFile)
  const [files, setFiles] = useState<ChangedFile[]>([])
  // Selection must track both path AND which side (staged/unstaged) was
  // clicked because the backend now emits the same path twice when a file
  // has both index and worktree changes.
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(null)
  // Unified patch for the currently-selected file — rendered inline below
  // the file list (VS Code / Claude-CLI feel). Cleared on selection change
  // and on refresh. The SAME patch is also pushed to `fileDiffs` so the
  // main editor can paint inline green/red marks while the user edits.
  const [currentDiff, setCurrentDiff] = useState<string>('')
  const [stagedCollapsed, setStagedCollapsed] = useState<boolean>(false)
  const [unstagedCollapsed, setUnstagedCollapsed] = useState<boolean>(false)
  const [busyPaths, setBusyPaths] = useState<Set<string>>(() => new Set())
  const [message, setMessage] = useState<string>('')

  const [loading, setLoading] = useState<boolean>(false)
  const [generating, setGenerating] = useState<boolean>(false)
  /** Seconds since the last generate-AI click — drives the "drafting… (12s)"
   *  label so the user knows the CLI is still alive during long diffs. */
  const [generateElapsed, setGenerateElapsed] = useState<number>(0)
  const [committing, setCommitting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // App-wide free-form "rules" injected into the AI commit-message prompt
  // (scope conventions, language, ticket-id format, etc.). Saved once and
  // shared across every session/cwd so the user doesn't re-type them.
  const [rules, setRules] = useState<string>(() => {
    try {
      const global = localStorage.getItem(COMMIT_RULES_KEY)
      if (global && global.length > 0) return global
      // One-time migration: promote the first non-empty legacy per-cwd entry
      // to the new global key, then drop every legacy entry we see.
      let migrated = ''
      const legacyKeys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k) continue
        if (k === COMMIT_RULES_KEY) continue
        if (k.startsWith(COMMIT_RULES_LEGACY_PREFIX)) legacyKeys.push(k)
      }
      for (const k of legacyKeys) {
        const v = localStorage.getItem(k) ?? ''
        if (!migrated && v.trim().length > 0) migrated = v
        localStorage.removeItem(k)
      }
      if (migrated) localStorage.setItem(COMMIT_RULES_KEY, migrated)
      return migrated
    } catch {
      return ''
    }
  })
  const [rulesOpen, setRulesOpen] = useState<boolean>(false)
  // `rulesDraft` is what the user is actively editing in the modal.
  // It's only committed to `rules` (and persisted) when Save is clicked,
  // so dismissing the modal discards unsaved changes.
  const [rulesDraft, setRulesDraft] = useState<string>('')
  useEffect(() => {
    try {
      if (rules.trim().length === 0) localStorage.removeItem(COMMIT_RULES_KEY)
      else localStorage.setItem(COMMIT_RULES_KEY, rules)
    } catch {
      // ignore
    }
  }, [rules])
  // Seed the draft when the modal opens so the textarea shows the current
  // saved value; closing without Save simply drops the draft.
  useEffect(() => {
    if (rulesOpen) setRulesDraft(rules)
  }, [rulesOpen, rules])
  useEffect(() => {
    if (!rulesOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setRulesOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rulesOpen])
  const saveRules = useCallback(() => {
    setRules(rulesDraft)
    setRulesOpen(false)
  }, [rulesDraft])

  // Height (in px) of the bottom commit panel. User can drag the divider
  // above it to reclaim space for the file list or expand the textarea
  // for long messages.
  const containerRef = useRef<HTMLDivElement>(null)
  const [commitHeight, setCommitHeight] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(COMMIT_HEIGHT_KEY)
      const parsed = raw ? parseInt(raw, 10) : NaN
      if (Number.isFinite(parsed) && parsed >= COMMIT_HEIGHT_MIN) return parsed
    } catch {
      // ignore
    }
    return COMMIT_HEIGHT_DEFAULT
  })
  useEffect(() => {
    try {
      localStorage.setItem(COMMIT_HEIGHT_KEY, String(Math.round(commitHeight)))
    } catch {
      // ignore
    }
  }, [commitHeight])
  const resizingRef = useRef(false)
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    resizingRef.current = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent): void => {
      if (!resizingRef.current) return
      const rect = container.getBoundingClientRect()
      const raw = rect.bottom - ev.clientY
      const max = Math.max(COMMIT_HEIGHT_MIN, rect.height - COMMIT_HEIGHT_TOP_PADDING)
      const clamped = Math.min(Math.max(raw, COMMIT_HEIGHT_MIN), max)
      setCommitHeight(clamped)
    }
    const onUp = (): void => {
      resizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem(VIEW_MODE_KEY)
      return v === 'tree' ? 'tree' : 'list'
    } catch {
      return 'list'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode)
    } catch {
      // ignore
    }
  }, [viewMode])
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set())
  const toggleDir = useCallback((path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  // Request generations — every async call captures the current value and
  // bails when it's superseded. Survives the component's lifetime.
  const statusGen = useRef(0)
  const diffGen = useRef(0)

  // ---------- loaders ----------

  const loadStatus = useCallback(async (): Promise<void> => {
    if (!cwd) return
    const gen = ++statusGen.current
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.git.listChangedFiles(cwd)
      if (gen !== statusGen.current) return // superseded
      if (!res.ok) {
        setError(res.error)
        setFiles([])
        return
      }
      setFiles(res.value)
      setSelected((prev) =>
        prev && res.value.some((f) => f.path === prev.path && (f.staged ?? false) === prev.staged)
          ? prev
          : null
      )
    } catch (err) {
      if (gen !== statusGen.current) return
      setError((err as Error).message)
    } finally {
      if (gen === statusGen.current) setLoading(false)
    }
  }, [cwd])

  const loadDiff = useCallback(
    async (path: string, useStaged: boolean): Promise<void> => {
      if (!cwd) return
      const gen = ++diffGen.current
      try {
        const file = files.find((f) => f.path === path && (f.staged ?? false) === useStaged)
        const res = await window.api.git.getDiff(cwd, path, useStaged)
        if (gen !== diffGen.current) return
        if (!res.ok) {
          setFileDiff(path, null)
          setCurrentDiff('')
          setError(res.error)
          return
        }
        setCurrentDiff(res.value)
        // Clicking a file appends (or upserts) a diff tab in the editor
        // and focuses it. Tabs persist until the user closes them or
        // switches cwd.
        if (file) {
          openDiff({ path, patch: res.value, status: file.status })
        }
      } catch (err) {
        if (gen !== diffGen.current) return
        setError((err as Error).message)
      }
    },
    [cwd, files, openDiff, setFileDiff, openFile]
  )

  // ---------- effects ----------

  // Reset local state + auto-load when cwd changes. The cleanup bumps
  // the gen counters so any in-flight fetch is orphaned cleanly.
  useEffect(() => {
    statusGen.current += 1
    diffGen.current += 1
    setFiles([])
    setSelected(null)
    // Diffs from the previous cwd don't apply to this one — drop them.
    closeAllDiffs()
    setCurrentDiff('')
    setBusyPaths(new Set())
    setMessage('')
    setError(null)
    if (cwd) void loadStatus()
  }, [cwd, loadStatus, closeAllDiffs])

  // Load the diff whenever the selection changes. When nothing is
  // selected we just clear the local buffer — existing diff tabs stay
  // open so the user can flip back to them.
  useEffect(() => {
    if (!selected) {
      setCurrentDiff('')
      return
    }
    setCurrentDiff('')
    void loadDiff(selected.path, selected.staged)
  }, [selected, loadDiff])

  // ---------- derived ----------

  const stagedFiles = useMemo(() => files.filter((f) => f.staged), [files])
  const unstagedFiles = useMemo(() => files.filter((f) => !f.staged), [files])
  const stagedTree = useMemo(
    () => (viewMode === 'tree' ? buildTree(stagedFiles) : []),
    [viewMode, stagedFiles]
  )
  const unstagedTree = useMemo(
    () => (viewMode === 'tree' ? buildTree(unstagedFiles) : []),
    [viewMode, unstagedFiles]
  )
  const canCommit = !committing && message.trim().length > 0 && stagedFiles.length > 0

  // ---------- actions ----------

  const markBusy = useCallback((paths: string[], busy: boolean) => {
    setBusyPaths((prev) => {
      const next = new Set(prev)
      for (const p of paths) {
        if (busy) next.add(p)
        else next.delete(p)
      }
      return next
    })
  }, [])

  // Stage the given paths and refresh. The checkbox in each row is the
  // actual git action — no client-side "picked" intermediate. Keeping the
  // operation async-safe means a fast double-click can't desync UI state
  // from the index.
  const stagePaths = useCallback(
    async (paths: string[]): Promise<void> => {
      if (!cwd || paths.length === 0) return
      markBusy(paths, true)
      setError(null)
      try {
        const res = await window.api.git.stageFiles(cwd, paths)
        if (!res.ok) {
          setError(res.error)
          return
        }
        await loadStatus()
      } catch (err) {
        setError((err as Error).message)
      } finally {
        markBusy(paths, false)
      }
    },
    [cwd, loadStatus, markBusy]
  )

  const unstagePaths = useCallback(
    async (paths: string[]): Promise<void> => {
      if (!cwd || paths.length === 0) return
      markBusy(paths, true)
      setError(null)
      try {
        const res = await window.api.git.unstageFiles(cwd, paths)
        if (!res.ok) {
          setError(res.error)
          return
        }
        await loadStatus()
      } catch (err) {
        setError((err as Error).message)
      } finally {
        markBusy(paths, false)
      }
    },
    [cwd, loadStatus, markBusy]
  )

  const toggleStage = useCallback(
    (file: ChangedFile): void => {
      if (file.staged) void unstagePaths([file.path])
      else void stagePaths([file.path])
    },
    [stagePaths, unstagePaths]
  )

  const stageAllUnstaged = useCallback(
    () => void stagePaths(unstagedFiles.map((f) => f.path)),
    [stagePaths, unstagedFiles]
  )
  const unstageAll = useCallback(
    () => void unstagePaths(stagedFiles.map((f) => f.path)),
    [unstagePaths, stagedFiles]
  )

  // Open the modified file in the main editor, attach the unified diff
  // so CodeMirrorView paints inline green/red marks, and key fileDiffs
  // by the RESOLVED path (CodeMirrorView reads patches from
  // `fileDiffs[activeFilePath]`, and activeFilePath is the realpath the
  // fs bridge hands back — never the relative string git reports).
  const onEdit = useCallback(
    async (f: ChangedFile): Promise<void> => {
      if (!cwd) return
      if (f.status === 'deleted') return // nothing to edit
      const abs = toAbsolute(cwd, f.path)
      const resolved = await openFile(abs)
      const key = resolved ?? abs
      // Reuse the already-loaded diff if it's this file/side, otherwise fetch.
      const staged = f.staged === true
      if (selected && selected.path === f.path && selected.staged === staged && currentDiff) {
        setFileDiff(key, currentDiff)
        return
      }
      const res = await window.api.git.getDiff(cwd, f.path, staged)
      if (res.ok) setFileDiff(key, res.value)
    },
    [cwd, openFile, setFileDiff, selected, currentDiff]
  )

  const onGenerate = useCallback(async (): Promise<void> => {
    if (!cwd || generating) return
    setGenerating(true)
    setGenerateElapsed(0)
    setError(null)
    const startedAt = Date.now()
    // 1-Hz tick so the button reads "drafting… (7s)" instead of spinning
    // silently. Claude on a big diff can legitimately take 30-60s; without
    // feedback users assume it's frozen and cancel.
    const tick = window.setInterval(() => {
      setGenerateElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    try {
      const res = await window.api.git.generateCommitMessage(cwd, rules)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setMessage(res.value)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      window.clearInterval(tick)
      setGenerating(false)
      setGenerateElapsed(0)
    }
  }, [cwd, generating, rules])

  const onCommit = useCallback(async (): Promise<void> => {
    if (!cwd) return
    const msg = message.trim()
    if (msg.length === 0) {
      setError('commit message cannot be empty')
      return
    }
    setCommitting(true)
    setError(null)
    try {
      // Staging now happens incrementally via the per-file checkboxes,
      // so by the time the user clicks Commit the index already holds
      // exactly what they want — just commit what's there.
      const res = await window.api.git.commit(cwd, msg)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setMessage('')
      await loadStatus()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCommitting(false)
    }
  }, [cwd, message, loadStatus])

  // ---------- render ----------

  if (!cwd) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <Header
          hasCwd={false}
          loading={false}
          onRefresh={() => undefined}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <GitCommit size={24} strokeWidth={1.25} className="text-text-4" />
          <div className="text-xs text-text-2">no active session</div>
          <div className="text-[11px] text-text-4">
            pick a session to view its git changes.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      <Header
        hasCwd
        loading={loading}
        count={files.length}
        onRefresh={() => void loadStatus()}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      <div className="df-scroll min-h-0 flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-text-4">
            working tree clean
          </div>
        ) : (
          <>
            {stagedFiles.length > 0 ? (
              <Section
                title="Staged Changes"
                count={stagedFiles.length}
                collapsed={stagedCollapsed}
                onToggleCollapse={() => setStagedCollapsed((v) => !v)}
                action={{
                  icon: <Minus size={11} strokeWidth={1.75} />,
                  title: 'Unstage all',
                  onClick: unstageAll,
                }}
              >
                {viewMode === 'list'
                  ? stagedFiles.map((f) => (
                      <FileRow
                        key={`staged::${f.path}`}
                        file={f}
                        depth={0}
                        labelMode="path"
                        isActive={
                          !!selected && selected.path === f.path && selected.staged === true
                        }
                        busy={busyPaths.has(f.path)}
                        toggleStage={toggleStage}
                        onSelect={() => setSelected({ path: f.path, staged: true })}
                        onEdit={onEdit}
                      />
                    ))
                  : stagedTree.map((node) => (
                      <TreeRow
                        key={`staged::${node.path}`}
                        node={node}
                        depth={0}
                        collapsedDirs={collapsedDirs}
                        toggleDir={toggleDir}
                        stagedSide
                        selected={selected}
                        busyPaths={busyPaths}
                        toggleStage={toggleStage}
                        onSelectFile={(p) => setSelected({ path: p, staged: true })}
                        onDirBulk={unstagePaths}
                        onEdit={onEdit}
                      />
                    ))}
              </Section>
            ) : null}
            {unstagedFiles.length > 0 ? (
              <Section
                title="Changes"
                count={unstagedFiles.length}
                collapsed={unstagedCollapsed}
                onToggleCollapse={() => setUnstagedCollapsed((v) => !v)}
                action={{
                  icon: <Plus size={11} strokeWidth={1.75} />,
                  title: 'Stage all changes',
                  onClick: stageAllUnstaged,
                }}
              >
                {viewMode === 'list'
                  ? unstagedFiles.map((f) => (
                      <FileRow
                        key={`unstaged::${f.path}`}
                        file={f}
                        depth={0}
                        labelMode="path"
                        isActive={
                          !!selected && selected.path === f.path && selected.staged === false
                        }
                        busy={busyPaths.has(f.path)}
                        toggleStage={toggleStage}
                        onSelect={() => setSelected({ path: f.path, staged: false })}
                        onEdit={onEdit}
                      />
                    ))
                  : unstagedTree.map((node) => (
                      <TreeRow
                        key={`unstaged::${node.path}`}
                        node={node}
                        depth={0}
                        collapsedDirs={collapsedDirs}
                        toggleDir={toggleDir}
                        stagedSide={false}
                        selected={selected}
                        busyPaths={busyPaths}
                        toggleStage={toggleStage}
                        onSelectFile={(p) => setSelected({ path: p, staged: false })}
                        onDirBulk={stagePaths}
                        onEdit={onEdit}
                      />
                    ))}
              </Section>
            ) : null}
          </>
        )}
      </div>

      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize commit panel"
        onMouseDown={onResizeStart}
        className="group relative h-1 shrink-0 cursor-row-resize border-t border-border-soft bg-transparent transition-colors hover:bg-accent-500/40"
        title="Drag to resize"
      >
        <div className="pointer-events-none absolute inset-x-0 -top-1 h-3" />
      </div>

      <div
        className="flex shrink-0 flex-col overflow-hidden bg-bg-2 p-2"
        style={{ height: `${commitHeight}px` }}
      >
        <div className="mb-1.5 flex shrink-0 items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-4">
            commit message
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void onGenerate()}
              disabled={generating || files.length === 0}
              data-tour-id="editor-generate-ai"
              className="flex items-center gap-1 rounded-sm border border-accent-500/40 bg-accent-500/10 px-2 py-0.5 font-mono text-[10px] text-accent-200 transition hover:bg-accent-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              title={
                files.length === 0
                  ? 'No changes to describe — stage or modify files first'
                  : 'Generate with Claude'
              }
            >
              {generating ? (
                <Loader2 size={10} strokeWidth={1.75} className="animate-spin" />
              ) : (
                <Sparkles size={10} strokeWidth={1.75} />
              )}
              {generating
                ? generateElapsed > 0
                  ? `drafting… (${generateElapsed}s)`
                  : 'drafting…'
                : 'generate with AI'}
            </button>
            <button
              type="button"
              onClick={() => setRulesOpen((v) => !v)}
              className={`relative flex items-center rounded-sm border px-1 py-0.5 transition ${
                rulesOpen
                  ? 'border-accent-500/60 bg-accent-500/20 text-accent-100'
                  : 'border-border-soft bg-bg-3/60 text-text-3 hover:border-accent-500/40 hover:text-accent-200'
              }`}
              title="Commit message rules"
              aria-label="Commit message rules"
              aria-haspopup="dialog"
              aria-expanded={rulesOpen}
            >
              <Settings2 size={10} strokeWidth={1.75} />
              {rules.trim().length > 0 ? (
                <span
                  className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent-400"
                  aria-hidden
                />
              ) : null}
            </button>
          </div>
          {rulesOpen ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
              onMouseDown={() => setRulesOpen(false)}
            >
              <div
                role="dialog"
                aria-label="Commit message rules"
                aria-modal="true"
                onMouseDown={(e) => e.stopPropagation()}
                className="w-[min(32rem,calc(100vw-2rem))] rounded-md border border-border-soft bg-bg-2 p-4 shadow-xl"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-2">
                    commit rules
                  </span>
                  <button
                    type="button"
                    onClick={() => setRulesOpen(false)}
                    className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] text-text-3 hover:bg-bg-3 hover:text-text-1"
                  >
                    close
                  </button>
                </div>
                <textarea
                  value={rulesDraft}
                  onChange={(e) => setRulesDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      saveRules()
                    }
                  }}
                  rows={8}
                  autoFocus
                  placeholder={`e.g.\n- use scopes: ui, api, db\n- always mention ticket id\n- write subject in portuguese`}
                  className="df-scroll w-full resize-none rounded-sm border border-border-soft bg-bg-1 px-2 py-2 font-mono text-[12px] text-text-1 placeholder:text-text-4 focus:border-accent-500/60 focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-text-4">
                    appended to the AI prompt — saved per session directory.
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {rulesDraft.trim().length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setRulesDraft('')}
                        className="rounded-sm border border-border-soft px-2 py-1 font-mono text-[10px] text-text-3 hover:bg-bg-3 hover:text-text-1"
                      >
                        clear
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={saveRules}
                      disabled={rulesDraft === rules}
                      className="flex items-center gap-1 rounded-sm border border-accent-500/50 bg-accent-500/15 px-2 py-1 font-mono text-[10px] text-accent-100 transition hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Save rules (⌘/Ctrl+Enter)"
                    >
                      <Check size={10} strokeWidth={1.75} />
                      save
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="type a message or click Generate with AI"
          className="df-scroll w-full min-h-0 flex-1 resize-none rounded-sm border border-border-soft bg-bg-1 px-2 py-1.5 font-mono text-[11.5px] text-text-1 placeholder:text-text-4 focus:border-accent-500/60 focus:outline-none"
        />
        {error ? (
          <div className="mt-1.5 flex shrink-0 items-start gap-1.5 rounded-sm border border-status-attention/40 bg-status-attention/10 px-2 py-1 font-mono text-[10px] text-status-attention">
            <AlertCircle size={11} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => void onCommit()}
          disabled={!canCommit}
          className="mt-1.5 flex w-full shrink-0 items-center justify-center gap-1.5 rounded-sm bg-accent-500 px-2 py-1.5 font-mono text-[11px] font-semibold text-white transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {committing ? (
            <Loader2 size={11} strokeWidth={2} className="animate-spin" />
          ) : (
            <Check size={11} strokeWidth={2} />
          )}
          {committing ? 'committing…' : 'commit'}
        </button>
      </div>
    </div>
  )
}

function Header({
  hasCwd,
  loading,
  count,
  onRefresh,
  viewMode,
  onViewModeChange,
}: {
  hasCwd: boolean
  loading: boolean
  count?: number
  onRefresh: () => void
  viewMode: ViewMode
  onViewModeChange: (m: ViewMode) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border-soft bg-bg-2 px-3 py-2">
      <GitCommit size={12} strokeWidth={1.75} className="text-accent-400" />
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-2">
        changes
      </span>
      {hasCwd ? (
        <span className="font-mono text-[10px] text-text-4">
          {count && count > 0 ? `${count} file${count > 1 ? 's' : ''}` : 'clean'}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading || !hasCwd}
        className="ml-auto rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1 disabled:opacity-40"
        title="Refresh"
        aria-label="Refresh changes"
      >
        {loading ? (
          <Loader2 size={11} strokeWidth={1.75} className="animate-spin" />
        ) : (
          <RefreshCw size={11} strokeWidth={1.75} />
        )}
      </button>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className={`rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1 ${
            menuOpen ? 'bg-bg-3 text-text-1' : ''
          }`}
          title="View options"
          aria-label="View options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={11} strokeWidth={1.75} />
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-1 w-44 rounded-sm border border-border-soft bg-bg-2 py-1 shadow-lg"
          >
            <div className="px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-text-4">
              view &amp; sort
            </div>
            <MenuItem
              active={viewMode === 'list'}
              icon={<ListIcon size={11} strokeWidth={1.75} />}
              label="List"
              onClick={() => {
                onViewModeChange('list')
                setMenuOpen(false)
              }}
            />
            <MenuItem
              active={viewMode === 'tree'}
              icon={<ListTree size={11} strokeWidth={1.75} />}
              label="Tree"
              onClick={() => {
                onViewModeChange('tree')
                setMenuOpen(false)
              }}
            />
          </div>
        ) : null}
      </div>
    </header>
  )
}

function MenuItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-bg-3 ${
        active ? 'text-text-1' : 'text-text-2'
      }`}
    >
      <span className="flex w-3 shrink-0 items-center justify-center text-text-3">
        {active ? <Check size={10} strokeWidth={2} className="text-accent-400" /> : null}
      </span>
      <span className="flex w-4 shrink-0 items-center justify-center text-text-3">{icon}</span>
      <span className="font-mono">{label}</span>
    </button>
  )
}

function Section({
  title,
  count,
  collapsed,
  onToggleCollapse,
  action,
  children,
}: {
  title: string
  count: number
  collapsed: boolean
  onToggleCollapse: () => void
  action: { icon: React.ReactNode; title: string; onClick: () => void }
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-border-soft last:border-b-0">
      <header className="group sticky top-0 z-10 flex items-center gap-1.5 bg-bg-2 px-2 py-1">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-text-2 hover:text-text-1"
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight size={11} strokeWidth={1.75} className="shrink-0 text-text-3" />
          ) : (
            <ChevronDown size={11} strokeWidth={1.75} className="shrink-0 text-text-3" />
          )}
          <span className="truncate font-mono text-[10px] uppercase tracking-[0.12em]">
            {title}
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            action.onClick()
          }}
          title={action.title}
          aria-label={action.title}
          className="df-hover-reveal shrink-0 rounded-sm p-0.5 text-text-3 hover:bg-bg-3 hover:text-text-1 group-hover:opacity-100"
        >
          {action.icon}
        </button>
        <span className="shrink-0 rounded-sm bg-bg-3 px-1.5 font-mono text-[9px] text-text-2">
          {count}
        </span>
      </header>
      {collapsed ? null : <ul>{children}</ul>}
    </section>
  )
}

function FileRow({
  file,
  depth,
  labelMode,
  isActive,
  busy,
  toggleStage,
  onSelect,
  onEdit,
}: {
  file: ChangedFile
  depth: number
  labelMode: 'path' | 'name'
  isActive: boolean
  busy: boolean
  toggleStage: (f: ChangedFile) => void
  onSelect: () => void
  onEdit: (f: ChangedFile) => Promise<void>
}) {
  const meta = STATUS_META[file.status]
  const name =
    labelMode === 'name' ? file.path.split('/').pop() || file.path : file.path
  const stageLabel = file.staged ? 'Unstage' : 'Stage'
  return (
    <li
      className={`group flex items-center gap-1.5 px-2 py-1 text-[11px] ${
        isActive ? 'bg-bg-3' : 'hover:bg-bg-3/60'
      }`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (!busy) toggleStage(file)
        }}
        disabled={busy}
        className="shrink-0 rounded-sm p-0.5 text-text-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
        title={`${stageLabel} ${file.path}`}
        aria-label={`${stageLabel} ${file.path}`}
      >
        {busy ? (
          <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
        ) : file.staged ? (
          <CheckSquare size={12} strokeWidth={1.75} className="text-accent-400" />
        ) : (
          <Square size={12} strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {labelMode === 'name' ? (
          <FileIcon size={10} strokeWidth={1.75} className="shrink-0 text-text-4" />
        ) : null}
        <span
          className={`truncate font-mono ${isActive ? 'text-text-1' : 'text-text-2'}`}
          title={file.path}
        >
          {name}
        </span>
        <span
          className={`ml-auto w-3 shrink-0 text-right font-mono text-[10px] font-semibold ${meta.cls}`}
        >
          {meta.label}
        </span>
      </button>
      {file.status !== 'deleted' ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void onEdit(file)
          }}
          className="df-hover-reveal shrink-0 rounded-sm p-0.5 text-text-3 hover:bg-bg-4 hover:text-accent-300 group-hover:opacity-100"
          title="Edit in editor"
          aria-label={`Edit ${file.path}`}
        >
          <Pencil size={11} strokeWidth={1.75} />
        </button>
      ) : null}
    </li>
  )
}

/** Collect every file path under a tree node (recursively). Used so the
 *  folder-level checkbox can stage/unstage the entire subtree in one call. */
function collectFilePaths(node: TreeNode): string[] {
  if (node.kind === 'file') return [node.file.path]
  const out: string[] = []
  for (const child of node.children) out.push(...collectFilePaths(child))
  return out
}

function TreeRow({
  node,
  depth,
  collapsedDirs,
  toggleDir,
  stagedSide,
  selected,
  busyPaths,
  toggleStage,
  onSelectFile,
  onDirBulk,
  onEdit,
}: {
  node: TreeNode
  depth: number
  collapsedDirs: Set<string>
  toggleDir: (path: string) => void
  stagedSide: boolean
  selected: { path: string; staged: boolean } | null
  busyPaths: Set<string>
  toggleStage: (f: ChangedFile) => void
  onSelectFile: (path: string) => void
  onDirBulk: (paths: string[]) => void
  onEdit: (f: ChangedFile) => Promise<void>
}) {
  if (node.kind === 'file') {
    return (
      <FileRow
        file={node.file}
        depth={depth}
        labelMode="name"
        isActive={
          !!selected && selected.path === node.file.path && selected.staged === stagedSide
        }
        busy={busyPaths.has(node.file.path)}
        toggleStage={toggleStage}
        onSelect={() => onSelectFile(node.file.path)}
        onEdit={onEdit}
      />
    )
  }
  const isCollapsed = collapsedDirs.has(node.path)
  const folderPaths = collectFilePaths(node)
  const folderBusy = folderPaths.some((p) => busyPaths.has(p))
  const bulkLabel = stagedSide ? 'Unstage folder' : 'Stage folder'
  return (
    <>
      <li
        className="group flex items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-bg-3/60"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (!folderBusy) onDirBulk(folderPaths)
          }}
          disabled={folderBusy}
          className="shrink-0 rounded-sm p-0.5 text-text-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
          title={`${bulkLabel} (${folderPaths.length})`}
          aria-label={`${bulkLabel}: ${node.path}`}
        >
          {folderBusy ? (
            <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
          ) : stagedSide ? (
            <CheckSquare size={12} strokeWidth={1.75} className="text-accent-400" />
          ) : (
            <Square size={12} strokeWidth={1.75} />
          )}
        </button>
        <button
          type="button"
          onClick={() => toggleDir(node.path)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-text-2 hover:text-text-1"
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? (
            <ChevronRight size={11} strokeWidth={1.75} className="shrink-0 text-text-3" />
          ) : (
            <ChevronDown size={11} strokeWidth={1.75} className="shrink-0 text-text-3" />
          )}
          <Folder size={11} strokeWidth={1.75} className="shrink-0 text-accent-400/80" />
          <span className="truncate font-mono" title={node.path}>
            {node.name}
          </span>
        </button>
      </li>
      {!isCollapsed
        ? node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              collapsedDirs={collapsedDirs}
              toggleDir={toggleDir}
              stagedSide={stagedSide}
              selected={selected}
              busyPaths={busyPaths}
              toggleStage={toggleStage}
              onSelectFile={onSelectFile}
              onDirBulk={onDirBulk}
              onEdit={onEdit}
            />
          ))
        : null}
    </>
  )
}
