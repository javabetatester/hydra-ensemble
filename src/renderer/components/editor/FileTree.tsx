import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  ChevronRight,
  Clipboard,
  ClipboardPaste,
  File as FileIcon,
  Folder,
  Loader2,
  Trash2
} from 'lucide-react'
import type { DirEntry } from '../../../shared/types'

interface Props {
  root: string
  onOpenFile: (path: string) => void
}

interface NodeProps {
  entry: DirEntry
  depth: number
  onOpenFile: (path: string) => void
  selectedPath: string | null
  onSelect: (entry: DirEntry) => void
  onContextMenu: (entry: DirEntry, x: number, y: number) => void
  refreshToken: number
}

function rowPad(depth: number): string {
  // Tailwind doesn't handle truly dynamic class names; use inline padding for indents.
  return `${10 + depth * 12}px`
}

function DirNode({
  entry,
  depth,
  onOpenFile,
  selectedPath,
  onSelect,
  onContextMenu,
  refreshToken
}: NodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = async (): Promise<void> => {
    setLoading(true)
    try {
      const next = await window.api.editor.listDir(entry.path)
      setChildren(next)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[editor] listDir failed:', (err as Error).message)
      setChildren([])
    } finally {
      setLoading(false)
    }
  }

  // Re-list children when the tree signals a refresh (e.g. after paste
  // or delete) AND this directory is currently expanded. Collapsed dirs
  // reload on next expand anyway.
  useEffect(() => {
    if (expanded && refreshToken > 0) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  const toggle = async (): Promise<void> => {
    onSelect(entry)
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (children !== null) return
    await reload()
  }

  const selected = selectedPath === entry.path
  return (
    <div>
      <button
        type="button"
        onClick={() => void toggle()}
        onContextMenu={(e) => {
          e.preventDefault()
          onSelect(entry)
          onContextMenu(entry, e.clientX, e.clientY)
        }}
        className={`flex w-full items-center gap-1.5 truncate py-1 pr-2 text-left text-xs hover:bg-bg-3 hover:text-text-1 ${
          selected ? 'bg-accent-500/15 text-text-1' : 'text-text-2'
        }`}
        style={{ paddingLeft: rowPad(depth) }}
        title={entry.path}
      >
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={`shrink-0 text-text-4 transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        />
        <Folder size={14} strokeWidth={1.75} className="shrink-0 text-accent-400" />
        <span className="truncate">{entry.name}</span>
      </button>
      {expanded && (
        <div>
          {loading && (
            <div
              className="flex items-center gap-1.5 py-1 text-[11px] text-text-4"
              style={{ paddingLeft: rowPad(depth + 1) }}
            >
              <Loader2 size={11} className="animate-spin" />
              Loading…
            </div>
          )}
          {children?.map((c) =>
            c.isDir ? (
              <DirNode
                key={c.path}
                entry={c}
                depth={depth + 1}
                onOpenFile={onOpenFile}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                refreshToken={refreshToken}
              />
            ) : (
              <FileNode
                key={c.path}
                entry={c}
                depth={depth + 1}
                onOpenFile={onOpenFile}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                refreshToken={refreshToken}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}

function FileNode({
  entry,
  depth,
  onOpenFile,
  selectedPath,
  onSelect,
  onContextMenu
}: NodeProps) {
  // Files are indented one chevron-width past their depth so they line up with
  // sibling folders' icons (which sit after the chevron).
  const padPx = 10 + depth * 12 + 14
  const selected = selectedPath === entry.path
  return (
    <button
      type="button"
      onClick={() => {
        onSelect(entry)
        onOpenFile(entry.path)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onSelect(entry)
        onContextMenu(entry, e.clientX, e.clientY)
      }}
      className={`flex w-full items-center gap-1.5 truncate py-1 pr-2 text-left text-xs hover:bg-bg-3 hover:text-text-1 ${
        selected ? 'bg-accent-500/15 text-text-1' : 'text-text-3'
      }`}
      style={{ paddingLeft: `${padPx}px` }}
      title={entry.path}
    >
      <FileIcon size={14} strokeWidth={1.5} className="shrink-0 text-text-4" />
      <span className="truncate">{entry.name}</span>
    </button>
  )
}

interface MenuState {
  entry: DirEntry
  x: number
  y: number
}

export default function FileTree({ root, onOpenFile }: Props) {
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Last clicked entry. Drives selection highlight and the paste target
  // (its path for a folder, its parent for a file).
  const [selected, setSelected] = useState<DirEntry | null>(null)
  // Absolute path currently on the clipboard (this app's internal one,
  // not the OS clipboard — file paths on the OS clipboard don't map
  // cleanly to a recursive copy action).
  const [clipboard, setClipboard] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // Bumped after a successful paste/delete so any expanded DirNode reloads.
  const [refreshToken, setRefreshToken] = useState(0)
  const [menu, setMenu] = useState<MenuState | null>(null)
  // Pending delete confirmation. Rendered as an in-app modal (not the
  // native `window.confirm`, which on multi-monitor setups can pop up
  // on the wrong screen). `null` when no prompt is open.
  const [pendingDelete, setPendingDelete] = useState<DirEntry | null>(null)

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    setError(null)
    setSelected(null)
    window.api.editor
      .listDir(root)
      .then((rows) => {
        if (!cancelled) setEntries(rows)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [root, refreshToken])

  // Close menu on outside click / escape / scroll.
  useEffect(() => {
    if (!menu) return
    const onDown = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
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
  }, [menu])

  const pasteTargetFor = (entry: DirEntry): string => {
    if (entry.isDir) return entry.path
    const sep = entry.path.includes('\\') ? '\\' : '/'
    const idx = entry.path.lastIndexOf(sep)
    return idx > 0 ? entry.path.slice(0, idx) : root
  }

  const showToast = (msg: string, ms = 1800): void => {
    setToast(msg)
    window.setTimeout(() => setToast(null), ms)
  }

  const doCopy = (entry: DirEntry): void => {
    setClipboard(entry.path)
    showToast(`copied: ${entry.name}`)
  }

  const doPaste = async (entry: DirEntry): Promise<void> => {
    if (!clipboard) return
    const dest = pasteTargetFor(entry)
    setBusy(true)
    try {
      const final = await window.api.editor.copyPath(clipboard, dest)
      const name = final.split(/[\\/]/).pop() ?? final
      showToast(`pasted: ${name}`, 2400)
      setRefreshToken((n) => n + 1)
    } catch (err) {
      showToast(`paste failed: ${(err as Error).message}`, 2800)
    } finally {
      setBusy(false)
    }
  }

  const requestDelete = (entry: DirEntry): void => {
    setPendingDelete(entry)
  }

  const confirmDelete = async (): Promise<void> => {
    const entry = pendingDelete
    if (!entry) return
    setPendingDelete(null)
    setBusy(true)
    try {
      await window.api.editor.deletePath(entry.path)
      showToast(`deleted: ${entry.name}`, 2000)
      if (clipboard === entry.path) setClipboard(null)
      if (selected?.path === entry.path) setSelected(null)
      setRefreshToken((n) => n + 1)
    } catch (err) {
      showToast(`delete failed: ${(err as Error).message}`, 3500)
    } finally {
      setBusy(false)
    }
  }

  const openMenu = (entry: DirEntry, x: number, y: number): void => {
    setMenu({ entry, x, y })
  }

  return (
    <div className="relative flex h-full flex-col">
      {toast ? (
        <div className="shrink-0 border-b border-border-soft bg-bg-2 px-2 py-1 font-mono text-[10px] text-text-3">
          {toast}
        </div>
      ) : null}
      <div className="df-scroll min-h-0 flex-1 overflow-y-auto py-1.5">
        {error ? (
          <div className="m-3 flex items-start gap-2 rounded-md border border-status-attention/30 bg-status-attention/10 px-3 py-2 text-sm text-status-attention">
            <AlertCircle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <div className="break-words">{error}</div>
          </div>
        ) : !entries ? (
          <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-3">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : (
          entries.map((e) =>
            e.isDir ? (
              <DirNode
                key={e.path}
                entry={e}
                depth={0}
                onOpenFile={onOpenFile}
                selectedPath={selected?.path ?? null}
                onSelect={setSelected}
                onContextMenu={openMenu}
                refreshToken={refreshToken}
              />
            ) : (
              <FileNode
                key={e.path}
                entry={e}
                depth={0}
                onOpenFile={onOpenFile}
                selectedPath={selected?.path ?? null}
                onSelect={setSelected}
                onContextMenu={openMenu}
                refreshToken={refreshToken}
              />
            )
          )
        )}
      </div>

      {menu
        ? createPortal(
            <ContextMenu
              menu={menu}
              busy={busy}
              hasClipboard={!!clipboard}
              onCopy={() => {
                doCopy(menu.entry)
                setMenu(null)
              }}
              onPaste={() => {
                void doPaste(menu.entry)
                setMenu(null)
              }}
              onDelete={() => {
                requestDelete(menu.entry)
                setMenu(null)
              }}
            />,
            document.body
          )
        : null}

      {pendingDelete
        ? createPortal(
            <ConfirmModal
              title="Delete?"
              message={`Delete ${pendingDelete.name}? This cannot be undone.`}
              confirmLabel="Delete"
              danger
              busy={busy}
              onCancel={() => setPendingDelete(null)}
              onConfirm={() => void confirmDelete()}
            />,
            document.body
          )
        : null}
    </div>
  )
}

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onCancel,
  onConfirm
}: ConfirmModalProps) {
  // Escape cancels, Enter confirms. Backdrop click cancels too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onMouseDown={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-[360px] max-w-[90vw] overflow-hidden rounded-md border border-border-mid bg-bg-2 shadow-2xl shadow-black/60"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border-soft px-4 py-2 text-sm font-semibold text-text-1">
          {title}
        </div>
        <div className="px-4 py-3 text-xs text-text-2">{message}</div>
        <div className="flex justify-end gap-2 border-t border-border-soft bg-bg-1/50 px-3 py-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-sm border border-border-soft bg-bg-3 px-3 py-1 text-xs text-text-2 hover:bg-bg-4 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className={`rounded-sm px-3 py-1 text-xs font-medium text-white disabled:opacity-40 ${
              danger
                ? 'bg-status-attention/80 hover:bg-status-attention'
                : 'bg-accent-500 hover:bg-accent-400'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ContextMenuProps {
  menu: MenuState
  busy: boolean
  hasClipboard: boolean
  onCopy: () => void
  onPaste: () => void
  onDelete: () => void
}

function ContextMenu({
  menu,
  busy,
  hasClipboard,
  onCopy,
  onPaste,
  onDelete
}: ContextMenuProps) {
  // Nudge the menu inside the viewport so the right/bottom edge doesn't
  // clip. 160px/120px is close enough to the real size; we avoid a
  // ResizeObserver here because the menu is tiny and short-lived.
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.min(menu.x, vw - 170)
  const top = Math.min(menu.y, vh - 130)
  return (
    <div
      className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-border-mid bg-bg-2 py-1 text-xs text-text-2 shadow-xl shadow-black/40"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
    >
      <MenuItem
        icon={<Clipboard size={12} strokeWidth={1.75} />}
        label="Copy"
        onClick={onCopy}
      />
      <MenuItem
        icon={<ClipboardPaste size={12} strokeWidth={1.75} />}
        label="Paste"
        onClick={onPaste}
        disabled={!hasClipboard || busy}
        hint={hasClipboard ? undefined : 'clipboard is empty'}
      />
      <div className="my-1 h-px bg-border-soft" />
      <MenuItem
        icon={<Trash2 size={12} strokeWidth={1.75} />}
        label="Delete"
        onClick={onDelete}
        disabled={busy}
        danger
      />
    </div>
  )
}

interface MenuItemProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  hint?: string
}

function MenuItem({ icon, label, onClick, disabled, danger, hint }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      title={hint}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-3 disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? 'text-status-attention hover:text-status-attention' : ''
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}
