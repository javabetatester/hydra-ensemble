import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Pin, PinOff, X } from 'lucide-react'
import { useEditorTabs } from '../../state/editorTabs'

interface Props {}

interface MenuState {
  path: string
  x: number
  y: number
}

/** Last path segment — split on both `/` and `\` so Windows paths render
 *  sensibly too. Falls back to the raw string for degenerate inputs. */
function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/**
 * Horizontal tab strip for the CodeEditor. Each open file becomes a tab
 * the user can click to focus, pin (to keep it at the front of the
 * strip), middle-click to close, or right-click for the full menu.
 *
 * The strip itself is a pure view over `useEditorTabs`; all mutations
 * round-trip through the store so they persist across reloads.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
export default function EditorTabs(_props: Props = {}) {
  const tabs = useEditorTabs((s) => s.tabs)
  const activePath = useEditorTabs((s) => s.activePath)
  const setActive = useEditorTabs((s) => s.setActive)
  const close = useEditorTabs((s) => s.close)
  const togglePin = useEditorTabs((s) => s.togglePin)
  const closeOthers = useEditorTabs((s) => s.closeOthers)
  const closeAll = useEditorTabs((s) => s.closeAll)

  const [menu, setMenu] = useState<MenuState | null>(null)

  // Dismiss the context menu on any outside interaction.
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

  if (tabs.length === 0) return null

  const copyPath = async (path: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(path)
    } catch {
      // Clipboard API can reject in unfocused windows; nothing actionable.
    }
  }

  return (
    <div
      className="df-scroll flex w-full items-stretch overflow-x-auto overflow-y-hidden border-b border-border-soft bg-bg-1"
      role="tablist"
      aria-label="Open files"
    >
      {tabs.map((tab) => {
        const active = tab.path === activePath
        const name = basename(tab.path)
        return (
          <div
            key={tab.path}
            role="tab"
            aria-selected={active}
            title={tab.path}
            onMouseDown={(e) => {
              // Middle-click closes the tab (VSCode/browser convention).
              if (e.button === 1) {
                e.preventDefault()
                close(tab.path)
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ path: tab.path, x: e.clientX, y: e.clientY })
            }}
            className={`group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border-soft px-3 py-1.5 text-xs ${
              active
                ? 'bg-bg-2 text-text-1'
                : 'bg-bg-1 text-text-3 hover:text-text-1'
            }`}
          >
            {/* Accent underline for the active tab. Positioned absolutely so
                 it doesn't shift the content box on state change. */}
            {active ? (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-[2px] bg-accent-500"
              />
            ) : null}
            <button
              type="button"
              onClick={() => setActive(tab.path)}
              className="flex min-w-0 items-center gap-1.5 focus:outline-none"
            >
              {tab.pinned ? (
                <Pin
                  size={11}
                  strokeWidth={2}
                  className="shrink-0 text-accent-400"
                  aria-label="Pinned"
                />
              ) : (
                <FileText
                  size={12}
                  strokeWidth={1.75}
                  className="shrink-0 text-text-4"
                  aria-hidden
                />
              )}
              <span className="truncate font-mono text-[11px]">{name}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${name}`}
              onClick={(e) => {
                e.stopPropagation()
                close(tab.path)
              }}
              className="shrink-0 rounded-sm p-0.5 text-text-4 opacity-60 hover:bg-bg-3 hover:text-text-1 hover:opacity-100"
            >
              <X size={11} strokeWidth={2} />
            </button>
          </div>
        )
      })}

      {menu
        ? createPortal(
            <TabContextMenu
              menu={menu}
              pinned={!!tabs.find((t) => t.path === menu.path)?.pinned}
              onClose={() => {
                close(menu.path)
                setMenu(null)
              }}
              onCloseOthers={() => {
                closeOthers(menu.path)
                setMenu(null)
              }}
              onCloseAll={() => {
                closeAll()
                setMenu(null)
              }}
              onTogglePin={() => {
                togglePin(menu.path)
                setMenu(null)
              }}
              onCopyPath={() => {
                void copyPath(menu.path)
                setMenu(null)
              }}
            />,
            document.body
          )
        : null}
    </div>
  )
}

interface TabContextMenuProps {
  menu: MenuState
  pinned: boolean
  onClose: () => void
  onCloseOthers: () => void
  onCloseAll: () => void
  onTogglePin: () => void
  onCopyPath: () => void
}

function TabContextMenu({
  menu,
  pinned,
  onClose,
  onCloseOthers,
  onCloseAll,
  onTogglePin,
  onCopyPath
}: TabContextMenuProps) {
  // Keep the menu inside the viewport. Rough bounds rather than measured:
  // the menu is small and short-lived, and a ResizeObserver would just
  // replay the same clamp one frame later.
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.min(menu.x, vw - 200)
  const top = Math.min(menu.y, vh - 200)
  return (
    <div
      className="fixed z-[120] min-w-[180px] overflow-hidden rounded-md border border-border-mid bg-bg-2 py-1 text-xs text-text-2 shadow-xl shadow-black/40"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
    >
      <MenuItem
        icon={<X size={12} strokeWidth={1.75} />}
        label="Close"
        onClick={onClose}
      />
      <MenuItem
        icon={<X size={12} strokeWidth={1.75} />}
        label="Close others"
        onClick={onCloseOthers}
      />
      <MenuItem
        icon={<X size={12} strokeWidth={1.75} />}
        label="Close all"
        onClick={onCloseAll}
      />
      <div className="my-1 h-px bg-border-soft" />
      <MenuItem
        icon={
          pinned ? (
            <PinOff size={12} strokeWidth={1.75} />
          ) : (
            <Pin size={12} strokeWidth={1.75} />
          )
        }
        label={pinned ? 'Unpin' : 'Pin'}
        onClick={onTogglePin}
      />
      <div className="my-1 h-px bg-border-soft" />
      <MenuItem
        icon={<FileText size={12} strokeWidth={1.75} />}
        label="Copy path"
        onClick={onCopyPath}
      />
    </div>
  )
}

interface MenuItemProps {
  icon: React.ReactNode
  label: string
  onClick: () => void
}

function MenuItem({ icon, label, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-3 hover:text-text-1"
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}
