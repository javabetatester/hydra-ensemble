import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { Activity, ChevronRight, Download, FolderTree, HelpCircle, Plus, Search, Settings, Sparkles, Trash2, Upload, Users, X } from 'lucide-react'
import type { SafeMode, Team, UUID } from '../../shared/orchestra'
import ContextMenu, { type ContextMenuItem } from '../components/ContextMenu'
import { useEditor } from '../state/editor'
import { useOrchestra } from './state/orchestra'
import DeleteTeamModal from './modals/DeleteTeamModal'
import TeamRailGroup, { type GroupStatus } from './TeamRailGroup'
import { useOrchestraPanels } from '../state/orchestraPanels'

/** Last segment of a unix/windows path. Used to surface the project
 *  binding under each team's name without flooding the rail. */
function basename(p: string): string {
  if (!p) return ''
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** Persisted collapse state per project path. The key is namespaced by
 *  path so users can fold "noisy" projects independently. */
const COLLAPSE_PREFIX = 'hydra.orchestra.rail.group.'

function readCollapsed(path: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(COLLAPSE_PREFIX + path) === 'true'
  } catch {
    return false
  }
}

function writeCollapsed(path: string, collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_PREFIX + path, collapsed ? 'true' : 'false')
  } catch {
    /* localStorage unavailable; in-memory state still reflects toggle. */
  }
}

const INPUT_CLS =
  'min-w-0 flex-1 rounded-sm px-1.5 py-0.5 text-xs text-text-1 outline-none ring-1 ring-accent-500'

const onEnterEsc = (
  onEnter: () => void,
  onEsc: () => void
): ((e: ReactKeyboardEvent<HTMLInputElement>) => void) => (e) => {
  if (e.key === 'Enter') { e.preventDefault(); onEnter() }
  else if (e.key === 'Escape') { e.preventDefault(); onEsc() }
}

/** Left 220px rail of the Orchestra workspace. See PRD §10.F2 / §11. */
export default function TeamRail() {
  const teams = useOrchestra((s) => s.teams)
  const agents = useOrchestra((s) => s.agents)
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const togglePanel = useOrchestraPanels((s) => s.toggleProjects)
  const setActiveTeam = useOrchestra((s) => s.setActiveTeam)
  const createTeam = useOrchestra((s) => s.createTeam)
  const renameTeam = useOrchestra((s) => s.renameTeam)
  const setSafeMode = useOrchestra((s) => s.setSafeMode)

  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [renamingId, setRenamingId] = useState<UUID | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; team: Team } | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<UUID | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const pendingDeleteTeam = useMemo(
    () => teams.find((t) => t.id === pendingDeleteId) ?? null,
    [teams, pendingDeleteId]
  )
  const activeIndex = useMemo(() => {
    const i = teams.findIndex((t) => t.id === activeTeamId)
    return i === -1 ? 0 : i
  }, [teams, activeTeamId])
  const activeTeam = useMemo(
    () => teams.find((t) => t.id === activeTeamId) ?? null,
    [teams, activeTeamId]
  )

  /** Group teams by their worktreePath. Order preserves the first
   *  appearance of each path in `teams[]` so the rail order is stable
   *  across renders. Grouping is auto-elided when there's only one
   *  project — no point showing a group header for a single bucket. */
  const groups = useMemo(() => {
    const buckets = new Map<string, Team[]>()
    for (const t of teams) {
      const k = t.worktreePath || ''
      const list = buckets.get(k)
      if (list) list.push(t)
      else buckets.set(k, [t])
    }
    return Array.from(buckets.entries()).map(([path, list]) => ({
      path,
      teams: list
    }))
  }, [teams])

  /** When exactly one group is present, the group header would be
   *  pure noise — the basename is already on each row. */
  const showGroups = groups.length > 1

  /** Per-path collapse state (persisted). Initialised lazily; updates
   *  go straight to localStorage via `writeCollapsed`. */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const g of groups) init[g.path] = readCollapsed(g.path)
    return init
  })

  const toggleCollapsed = useCallback((path: string): void => {
    setCollapsed((prev) => {
      const next = !(prev[path] ?? false)
      writeCollapsed(path, next)
      return { ...prev, [path]: next }
    })
  }, [])

  /** Aggregate status dot for a group. Priority: any agent with
   *  state `error` → attention; else any `running` → running; else
   *  idle. Mirrors the canvas' agent-state vocabulary. */
  const groupStatus = useCallback(
    (groupTeams: Team[]): GroupStatus => {
      const ids = new Set(groupTeams.map((t) => t.id))
      let hasRunning = false
      for (const a of agents) {
        if (!ids.has(a.teamId)) continue
        if (a.state === 'error') return 'attention'
        if (a.state === 'running') hasRunning = true
      }
      return hasRunning ? 'running' : 'idle'
    },
    [agents]
  )

  const cancelCreate = useCallback((): void => { setCreating(false); setDraftName('') }, [])
  const beginCreate = useCallback((): void => { setCreating(true); setDraftName('') }, [])
  const commitCreate = useCallback(async (): Promise<void> => {
    const name = draftName.trim()
    if (!name) return cancelCreate()
    const worktreePath = await window.api.project.pickDirectory()
    if (!worktreePath) return // user bailed at picker; keep input live
    const created = await createTeam({ name, worktreePath })
    if (created) cancelCreate()
  }, [draftName, createTeam, cancelCreate])

  const beginRename = useCallback((team: Team): void => {
    setRenamingId(team.id); setRenameDraft(team.name)
  }, [])
  const commitRename = useCallback(async (): Promise<void> => {
    if (!renamingId) return
    const name = renameDraft.trim()
    const original = teams.find((t) => t.id === renamingId)
    if (!name || !original || name === original.name) return setRenamingId(null)
    await renameTeam(renamingId, name)
    setRenamingId(null)
  }, [renamingId, renameDraft, teams, renameTeam])

  const buildMenuItems = useCallback(
    (team: Team): ContextMenuItem[] => {
      const openClaudeMd = (): void => {
        // Worktree CLAUDE.md is the practical target until main exposes the
        // team-folder path as a separate IPC.
        const path = `${team.worktreePath.replace(/\/$/, '')}/CLAUDE.md`
        void useEditor.getState().openFile(path)
        useEditor.getState().openEditor()
      }
      const sm = (mode: SafeMode): ContextMenuItem => ({
        label: `Safe mode: ${mode}${mode === team.safeMode ? ' (current)' : ''}`,
        onSelect: () => void setSafeMode(team.id, mode),
        disabled: mode === team.safeMode
      })
      return [
        { label: 'Rename', onSelect: () => beginRename(team) },
        sm('strict'), sm('prompt'), sm('yolo'),
        { label: 'Open team CLAUDE.md', onSelect: openClaudeMd },
        {
          label: 'Export team\u2026',
          icon: <Download size={14} strokeWidth={1.75} />,
          onSelect: () => {
            void window.api.orchestra?.team.export(team.id).then((r) => {
              if (r?.ok && r.value) {
                window.dispatchEvent(
                  new CustomEvent('orchestra:toast', { detail: `Exported to ${r.value}` })
                )
              }
            })
          }
        },
        {
          label: 'Delete team',
          danger: true,
          icon: <Trash2 size={14} strokeWidth={1.75} />,
          onSelect: () => setPendingDeleteId(team.id)
        }
      ]
    },
    [beginRename, setSafeMode]
  )

  const onRailKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (creating || renamingId || teams.length === 0) return
      const n = teams.length
      if (e.key === 'ArrowDown') {
        e.preventDefault(); setActiveTeam(teams[(activeIndex + 1) % n]!.id)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); setActiveTeam(teams[(activeIndex - 1 + n) % n]!.id)
      } else if (e.key === 'Enter') {
        e.preventDefault(); setActiveTeam(teams[activeIndex]!.id)
      }
    },
    [creating, renamingId, teams, activeIndex, setActiveTeam]
  )

  const renderRow = (team: Team) => {
    const active = team.id === activeTeamId
    const isRenaming = renamingId === team.id
    const tone = active
      ? 'bg-accent-500/15 text-text-1'
      : 'text-text-2 hover:bg-bg-3 hover:text-text-1'
    const onCtx = (e: ReactMouseEvent<HTMLDivElement>): void => {
      e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, team })
    }
    return (
      <div
        key={team.id}
        data-team-id={team.id}
        onContextMenu={onCtx}
        className={`group flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-sm transition-colors ${tone}`}
      >
        <ChevronRight size={12} strokeWidth={1.75} aria-hidden
          className={active ? 'text-accent-400' : 'text-text-4'} />
        {isRenaming ? (
          <input autoFocus aria-label="Rename team" value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={onEnterEsc(() => void commitRename(), () => setRenamingId(null))}
            className={`${INPUT_CLS} bg-bg-3`} />
        ) : (
          <button type="button" title={`${team.name}\n${team.worktreePath}`}
            onClick={() => setActiveTeam(team.id)}
            onDoubleClick={() => beginRename(team)}
            className="flex min-w-0 flex-1 flex-col items-start gap-0 text-left">
            <span className="flex w-full min-w-0 items-center gap-1">
              <span className={`min-w-0 truncate ${active ? 'font-medium' : ''}`}>{team.name}</span>
              {team.safeMode === 'yolo' && (
                <span title="yolo safe mode"
                  className="shrink-0 rounded-sm bg-status-attention/20 px-1 text-[9px] font-medium uppercase tracking-wider text-status-attention">
                  yolo
                </span>
              )}
            </span>
            {/* Project basename — surfaces the team↔project binding
                 so two instances of the same template in different
                 projects are visually distinguishable. */}
            <span className="block w-full truncate font-mono text-[9px] leading-tight text-text-4">
              {basename(team.worktreePath)}
            </span>
          </button>
        )}
        {!isRenaming && (
          <button type="button" title="Delete team" aria-label={`Delete team ${team.name}`}
            onClick={(e) => { e.stopPropagation(); setPendingDeleteId(team.id) }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-4 opacity-0 transition hover:bg-bg-4 hover:text-status-attention group-hover:opacity-100">
            <Trash2 size={12} strokeWidth={1.75} />
          </button>
        )}
      </div>
    )
  }

  const empty = teams.length === 0 && !creating

  return (
    <aside aria-label="Projects & teams" data-coach="team-rail"
      className="flex h-full w-[220px] shrink-0 flex-col border-r border-border-soft bg-bg-2 text-text-2">
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border-soft px-3">
        <div className="flex items-center gap-2">
          <FolderTree size={13} strokeWidth={1.75} className="text-accent-400" />
          <span className="df-label">projects · teams</span>
        </div>
        <button
          type="button"
          onClick={togglePanel}
          title="Close (Ctrl+Shift+P)"
          aria-label="Close projects panel"
          className="rounded-sm p-1 text-text-4 hover:bg-bg-3 hover:text-text-1"
        >
          <X size={12} strokeWidth={1.75} />
        </button>
      </header>

      <div ref={listRef} tabIndex={0} onKeyDown={onRailKeyDown}
        className="df-scroll flex-1 overflow-y-auto py-2 outline-none focus-visible:bg-bg-2/80">
        {empty ? (
          <div className="px-3 py-10 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-bg-3 text-text-3">
              <Users size={18} strokeWidth={1.5} />
            </div>
            <div className="mb-3 text-xs text-text-4">No teams yet</div>
            <button type="button"
              onClick={() =>
                window.dispatchEvent(new CustomEvent('orchestra:new-team'))
              }
              className="df-lift inline-flex items-center gap-1.5 rounded-md border border-border-mid px-3 py-1.5 text-[11px] font-medium text-text-3 hover:border-accent-500 hover:text-accent-400">
              <Plus size={12} strokeWidth={1.75} /><span>Create first team</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 px-1">
            {showGroups
              ? groups.map((g) => {
                  const isCollapsed = collapsed[g.path] ?? false
                  return (
                    <div key={g.path || '__none__'} className="flex flex-col gap-0.5">
                      <TeamRailGroup
                        projectPath={g.path}
                        basename={basename(g.path)}
                        teamCount={g.teams.length}
                        expanded={!isCollapsed}
                        onToggle={() => toggleCollapsed(g.path)}
                        status={groupStatus(g.teams)}
                      />
                      {!isCollapsed
                        ? g.teams.map((t) => (
                            <div key={t.id} className="pl-2">{renderRow(t)}</div>
                          ))
                        : null}
                    </div>
                  )
                })
              : teams.map(renderRow)}
            {creating && (
              <div className="flex items-center gap-1.5 rounded-sm bg-bg-3 px-2 py-1.5">
                <ChevronRight size={12} strokeWidth={1.75} aria-hidden className="text-accent-400" />
                <input autoFocus aria-label="New team name" placeholder="Team name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => { if (!draftName.trim()) cancelCreate() }}
                  onKeyDown={onEnterEsc(() => void commitCreate(), cancelCreate)}
                  className={`${INPUT_CLS} bg-bg-2`} />
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-border-soft p-1">
        {activeTeam && (
          <div className="px-2 pb-1 pt-0.5">
            <span title={`Active team: ${activeTeam.name}`}
              className="inline-block max-w-full truncate rounded-sm bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent-400">
              {activeTeam.name}
            </span>
          </div>
        )}
        <button type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('orchestra:new-team'))}
          className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs text-text-3 transition-colors hover:bg-bg-3 hover:text-accent-400">
          <Plus size={12} strokeWidth={1.75} /><span>New Team</span>
        </button>
        <button type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('orchestra:import-team'))}
          className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs text-text-3 transition-colors hover:bg-bg-3 hover:text-accent-400">
          <Upload size={12} strokeWidth={1.75} /><span>Import Team</span>
        </button>
        <button type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('orchestra:generate-team'))}
          className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs text-text-3 transition-colors hover:bg-bg-3 hover:text-accent-400">
          <Sparkles size={12} strokeWidth={1.75} /><span>Generate from prompt</span>
        </button>
        <div className="mt-1 border-t border-border-soft pt-1">
          <button type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('orchestra:settings-toggle'))}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-text-3 hover:bg-bg-3 hover:text-text-1">
            <Settings size={12} strokeWidth={1.75} /><span>Settings</span>
          </button>
          <button type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('orchestra:help-toggle'))}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-text-3 hover:bg-bg-3 hover:text-text-1">
            <HelpCircle size={12} strokeWidth={1.75} /><span>Help</span>
          </button>
          <button type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('orchestra:search-toggle'))}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-text-3 hover:bg-bg-3 hover:text-text-1">
            <Search size={12} strokeWidth={1.75} /><span>Search</span>
          </button>
          <button type="button"
            disabled={!activeTeam}
            onClick={() => window.dispatchEvent(new CustomEvent('orchestra:health-toggle'))}
            aria-disabled={!activeTeam}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] text-text-3 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-3">
            <Activity size={12} strokeWidth={1.75} /><span>Health</span>
          </button>
        </div>
      </footer>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={buildMenuItems(menu.team)}
          onDismiss={() => setMenu(null)} />
      )}
      {pendingDeleteTeam && (
        <DeleteTeamModal team={pendingDeleteTeam} onClose={() => setPendingDeleteId(null)} />
      )}
    </aside>
  )
}
