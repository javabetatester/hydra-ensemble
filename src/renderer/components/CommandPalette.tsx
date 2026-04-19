import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  Plus,
  X,
  LayoutDashboard,
  Code2,
  GitPullRequest,
  Wand2,
  FolderTree,
  Terminal,
  Mic,
  Wrench
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSessions } from '../state/sessions'
import { useSessionsUi } from '../state/sessionsExtra'
import { useEditor } from '../state/editor'
import { useGh } from '../state/gh'
import { useWatchdog } from '../state/watchdog'
import { useToolkit } from '../state/toolkit'
import { useProjects } from '../state/projects'
import AgentAvatar from './AgentAvatar'
import { ToolkitIcon, guessIconForLabel } from '../lib/toolkit-icons'

interface PaletteItem {
  id: string
  label: string
  hint?: string
  shortcut?: string
  icon?: React.ReactNode
  group: string
  run: () => void
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function CommandPalette({ open, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const sessions = useSessions((s) => s.sessions)
  const setActive = useSessions((s) => s.setActive)
  const createSession = useSessions((s) => s.createSession)
  const destroySession = useSessions((s) => s.destroySession)
  const activeId = useSessions((s) => s.activeId)
  const toggleDashboard = useSessionsUi((s) => s.toggleDashboard)
  const toggleEditor = useEditor((s) => s.toggleEditor)
  const togglePanel = useWatchdog((s) => s.togglePanel)
  const openGh = useGh((s) => s.openPanel)
  const projects = useProjects((s) => s.projects)
  const currentPath = useProjects((s) => s.currentPath)
  const addProject = useProjects((s) => s.addProject)
  const setCurrent = useProjects((s) => s.setCurrent)
  const toolkitItems = useToolkit((s) => s.items)
  const runToolkit = useToolkit((s) => s.run)
  const openToolkitEditor = useToolkit((s) => s.openEditor)

  const cwdContext =
    sessions.find((s) => s.id === activeId)?.worktreePath ??
    sessions.find((s) => s.id === activeId)?.cwd ??
    currentPath ??
    null

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const items: PaletteItem[] = useMemo(() => {
    const out: PaletteItem[] = []

    // Sessions
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i]
      if (!s) continue
      const idx = i + 1
      out.push({
        id: `session:${s.id}`,
        label: s.name,
        hint: `${s.branch ?? '—'} · ${s.model ?? 'sonnet'}`,
        shortcut: idx <= 9 ? `⌘${idx === 9 ? 0 : idx}` : undefined,
        icon: <AgentAvatar session={s} size={18} />,
        group: 'Sessions',
        run: () => {
          setActive(s.id)
          onClose()
        }
      })
    }

    // Project actions
    out.push({
      id: 'cmd:new-session',
      label: 'New Claude session',
      hint: 'spawn agent in active project / cwd',
      shortcut: '⌘T',
      icon: <Plus size={14} strokeWidth={1.75} />,
      group: 'Sessions',
      run: () => {
        void createSession({ cwd: cwdContext ?? undefined })
        onClose()
      }
    })
    if (activeId) {
      const active = sessions.find((s) => s.id === activeId)
      out.push({
        id: 'cmd:close-session',
        label: `Close ${active?.name ?? 'active session'}`,
        shortcut: '⌘W',
        icon: <X size={14} strokeWidth={1.75} />,
        group: 'Sessions',
        run: () => {
          void destroySession(activeId)
          onClose()
        }
      })
    }

    // Projects
    out.push({
      id: 'cmd:open-project',
      label: 'Open project directory…',
      hint: 'pick a folder to scope sessions',
      icon: <FolderTree size={14} strokeWidth={1.75} />,
      group: 'Projects',
      run: () => {
        void addProject()
        onClose()
      }
    })
    for (const p of projects) {
      if (p.path === currentPath) continue
      out.push({
        id: `project:${p.path}`,
        label: `Switch to ${p.name}`,
        hint: p.path,
        icon: <FolderTree size={14} strokeWidth={1.75} />,
        group: 'Projects',
        run: () => {
          void setCurrent(p.path)
          onClose()
        }
      })
    }

    // Panels / overlays — render the LucideIcon via JSX so React 19's
    // strict component-call enforcement doesn't reject the bare call.
    const panel = (
      id: string,
      label: string,
      shortcut: string,
      Icon: LucideIcon,
      run: () => void
    ): PaletteItem => ({
      id,
      label,
      shortcut,
      icon: <Icon size={14} strokeWidth={1.75} />,
      group: 'Panels',
      run
    })

    out.push(panel('cmd:dashboard', 'Dashboard', '⌘D', LayoutDashboard, () => { toggleDashboard(); onClose() }))
    out.push(panel('cmd:editor', 'Code editor', '⌘E', Code2, () => { toggleEditor(); onClose() }))
    out.push(panel('cmd:watchdogs', 'Watchdogs', '⌘⇧W', Wand2, () => { togglePanel(); onClose() }))
    if (cwdContext) {
      out.push({
        id: 'cmd:prs',
        label: 'PR Inspector',
        shortcut: '⌘⇧P',
        icon: <GitPullRequest size={14} strokeWidth={1.75} />,
        group: 'Panels',
        run: () => {
          openGh(cwdContext)
          onClose()
        }
      })
    }
    out.push({
      id: 'cmd:quickterm',
      label: 'Quick terminal',
      shortcut: '⌘`',
      icon: <Terminal size={14} strokeWidth={1.75} />,
      group: 'Panels',
      run: () => {
        void window.api.quickTerm.toggle()
        onClose()
      }
    })
    out.push({
      id: 'cmd:voice',
      label: 'Voice dictation',
      shortcut: '⌘⇧V',
      icon: <Mic size={14} strokeWidth={1.75} />,
      group: 'Panels',
      run: () => {
        // VoiceButton handles the actual hotkey internally; this is just a
        // visual entry to remind the user of the feature.
        onClose()
      }
    })

    // Toolkit
    out.push({
      id: 'cmd:toolkit-edit',
      label: 'Edit toolkit…',
      icon: <Wrench size={14} strokeWidth={1.75} />,
      group: 'Toolkit',
      run: () => {
        openToolkitEditor()
        onClose()
      }
    })
    for (const it of toolkitItems) {
      out.push({
        id: `toolkit:${it.id}`,
        label: `Run: ${it.label || it.id}`,
        hint: it.command,
        icon: <ToolkitIcon name={it.icon ?? guessIconForLabel(it.label || it.id)} size={14} />,
        group: 'Toolkit',
        run: () => {
          if (cwdContext) void runToolkit(it, cwdContext)
          onClose()
        }
      })
    }

    return out
  }, [
    sessions,
    activeId,
    projects,
    currentPath,
    toolkitItems,
    cwdContext,
    setActive,
    createSession,
    destroySession,
    addProject,
    setCurrent,
    toggleDashboard,
    toggleEditor,
    togglePanel,
    openGh,
    runToolkit,
    openToolkitEditor,
    onClose
  ])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => {
      const hay = `${it.label} ${it.hint ?? ''} ${it.group}`.toLowerCase()
      return hay.includes(q)
    })
  }, [items, query])

  const grouped = useMemo(() => {
    const map = new Map<string, PaletteItem[]>()
    for (const it of filtered) {
      const arr = map.get(it.group) ?? []
      arr.push(it)
      map.set(it.group, arr)
    }
    return [...map.entries()]
  }, [filtered])

  // Clamp cursor on filter change
  useEffect(() => {
    if (cursor >= filtered.length) setCursor(Math.max(0, filtered.length - 1))
  }, [filtered.length, cursor])

  // Scroll cursor into view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector(`[data-palette-idx="${cursor}"]`)
    if (el && 'scrollIntoView' in el) {
      ;(el as HTMLElement).scrollIntoView({ block: 'nearest' })
    }
  }, [cursor])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(filtered.length - 1, c + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      filtered[cursor]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  let runningIdx = -1

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-bg-0/80 px-4 pt-[12vh] backdrop-blur-md df-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex w-full max-w-xl flex-col overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}
      >
        <div className="flex items-center gap-2 border-b border-border-soft bg-bg-1 px-3 py-2.5">
          <Search size={14} strokeWidth={1.75} className="text-text-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="search agents, panels, toolkit, projects…"
            className="flex-1 bg-transparent text-sm text-text-1 placeholder:text-text-4 focus:outline-none"
          />
          <span className="font-mono text-[10px] text-text-4">esc</span>
        </div>

        <div ref={listRef} className="df-scroll max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-text-4">no matches</div>
          ) : (
            grouped.map(([group, list]) => (
              <div key={group} className="py-1.5">
                <div className="df-label px-3 py-1">{group}</div>
                {list.map((it) => {
                  runningIdx++
                  const idx = runningIdx
                  const active = idx === cursor
                  return (
                    <button
                      key={it.id}
                      data-palette-idx={idx}
                      type="button"
                      onMouseEnter={() => setCursor(idx)}
                      onClick={it.run}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${
                        active
                          ? 'bg-bg-4 text-text-1'
                          : 'text-text-2 hover:bg-bg-3'
                      }`}
                    >
                      <span className="shrink-0 text-text-3">{it.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {it.hint ? (
                        <span className="ml-2 truncate font-mono text-[11px] text-text-4">
                          {it.hint}
                        </span>
                      ) : null}
                      {it.shortcut ? (
                        <span className="ml-2 shrink-0 rounded-sm border border-border-soft bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] text-text-4">
                          {it.shortcut}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border-soft bg-bg-1 px-3 py-1.5 font-mono text-[10px] text-text-4">
          <span>↑↓ navigate · ↵ run · esc close</span>
          <span>{filtered.length} commands</span>
        </div>
      </div>
    </div>
  )
}
