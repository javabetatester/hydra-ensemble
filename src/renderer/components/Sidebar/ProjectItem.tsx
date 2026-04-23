import { useState } from 'react'
import {
  Folder,
  FolderOpen,
  ArrowRightLeft,
  Copy,
  Trash2
} from 'lucide-react'
import type { ProjectMeta } from '../../../shared/types'
import ContextMenu, { type ContextMenuItem } from '../ContextMenu'

interface ProjectItemProps {
  project: ProjectMeta
  active: boolean
  onSelect: () => void
  onRemove: () => void
  onCopyPath: () => void
}

export default function ProjectItem({
  project,
  active,
  onSelect,
  onRemove,
  onCopyPath
}: ProjectItemProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const items: ContextMenuItem[] = [
    {
      label: 'Switch to project',
      onSelect,
      icon: <ArrowRightLeft size={14} strokeWidth={1.75} />
    },
    {
      label: 'Copy path',
      onSelect: onCopyPath,
      icon: <Copy size={14} strokeWidth={1.75} />
    },
    {
      label: 'Remove from list',
      onSelect: onRemove,
      danger: true,
      icon: <Trash2 size={14} strokeWidth={1.75} />
    }
  ]

  const FolderIcon = active ? FolderOpen : Folder

  const rowTone = active
    ? 'bg-bg-4 text-text-1'
    : 'text-text-2 hover:bg-bg-3 hover:text-text-1'

  return (
    <>
      <button
        type="button"
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        title={project.path}
        className={`group flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${rowTone}`}
      >
        <FolderIcon
          size={14}
          strokeWidth={1.75}
          className={active ? 'text-accent-400' : 'text-text-3'}
          aria-hidden
        />
        <span className={`flex-1 truncate ${active ? 'font-medium' : ''}`}>
          {project.name}
        </span>
        {active && (
          <span
            className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400"
            aria-label="active"
            title="active"
          />
        )}
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onDismiss={() => setMenu(null)} />}
    </>
  )
}
