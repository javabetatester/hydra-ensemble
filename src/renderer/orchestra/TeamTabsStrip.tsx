/**
 * TeamTabsStrip — horizontal tab bar shown at the top of the Orchestra view
 * when there are ≥2 teams. Offers quick switching between teams without
 * opening the TeamSwitcher popover.
 *
 * Each tab renders the team name plus a compact agent-count badge. The
 * trailing "+ New" entry dispatches the shared `orchestra:new-team` custom
 * event so the host (OrchestraView) opens the blank-team flow — same contract
 * TeamSwitcher and TeamRail already use.
 *
 * Right-clicking a tab opens a small context menu with:
 *   - Rename → dispatches `orchestra:rename-team` with `{ teamId }`
 *   - Health → dispatches `orchestra:health-toggle` (global, already handled)
 *   - Delete → dispatches `orchestra:delete-team` with `{ teamId }`
 *
 * The component renders null when fewer than two teams exist — there's no
 * value in a single-tab strip.
 *
 * Reads state from `useOrchestra` — no props are accepted.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useOrchestra } from './state/orchestra'
import type { Agent } from '../../shared/orchestra'

interface Props {}

interface MenuState {
  teamId: string
  x: number
  y: number
}

const MENU_WIDTH = 168
const MENU_HEIGHT = 96

const fire = (name: string, detail?: unknown): void => {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function TeamTabsStrip(_props: Props = {}) {
  const teams = useOrchestra((s) => s.teams)
  const agents = useOrchestra((s) => s.agents)
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const setActiveTeam = useOrchestra((s) => s.setActiveTeam)

  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Group agents per team once — O(n) scan beats N × filter() for every tab
  // when a workspace has many teams.
  const agentsByTeam = useMemo(() => {
    const map = new Map<string, Agent[]>()
    for (const a of agents) {
      const list = map.get(a.teamId)
      if (list) list.push(a)
      else map.set(a.teamId, [a])
    }
    return map
  }, [agents])

  // Clamp the context menu inside the viewport so right-clicking near the
  // right/bottom edge never opens a menu that drops off-screen.
  const clampedMenu = useMemo(() => {
    if (!menu) return null
    const maxX = Math.max(0, window.innerWidth - MENU_WIDTH - 4)
    const maxY = Math.max(0, window.innerHeight - MENU_HEIGHT - 4)
    return {
      ...menu,
      x: Math.min(menu.x, maxX),
      y: Math.min(menu.y, maxY)
    }
  }, [menu])

  // Dismiss the context menu on outside click, Escape, scroll, or blur — same
  // rules the CanvasContextMenu uses.
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onDown = (e: MouseEvent): void => {
      const node = menuRef.current
      if (!node) return
      if (!node.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  if (teams.length < 2) return null

  const onTabClick = (id: string): void => {
    if (id !== activeTeamId) setActiveTeam(id)
  }

  const onTabContextMenu = (e: React.MouseEvent, teamId: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ teamId, x: e.clientX, y: e.clientY })
  }

  const onNewTeam = (): void => {
    fire('orchestra:new-team')
  }

  const rename = (teamId: string): void => {
    setMenu(null)
    fire('orchestra:rename-team', { teamId })
  }

  const health = (teamId: string): void => {
    setMenu(null)
    // `health-toggle` is the global panel toggle already handled by the host.
    // We pass the teamId so future consumers can target a specific team.
    fire('orchestra:health-toggle', { teamId })
  }

  const remove = (teamId: string): void => {
    setMenu(null)
    fire('orchestra:delete-team', { teamId })
  }

  return (
    <>
      <div
        className="df-scroll flex items-end gap-1 overflow-x-auto overflow-y-hidden border-b border-border-soft bg-bg-2 px-2"
        role="tablist"
        aria-label="Teams"
      >
        {teams.map((t) => {
          const isActive = t.id === activeTeamId
          const count = agentsByTeam.get(t.id)?.length ?? 0
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onTabClick(t.id)}
              onContextMenu={(e) => onTabContextMenu(e, t.id)}
              title={t.name}
              className={`shrink-0 px-3 py-1.5 text-[11px] border-b-2 border-transparent inline-flex items-center gap-1.5 transition-colors ${
                isActive
                  ? 'border-accent-500 text-text-1'
                  : 'text-text-3 hover:text-text-1'
              }`}
            >
              <span className="truncate max-w-[160px]">{t.name}</span>
              <span
                className={`font-mono text-[10px] leading-none rounded-sm px-1 py-0.5 ${
                  isActive ? 'bg-bg-3 text-text-2' : 'bg-bg-3/60 text-text-4'
                }`}
                aria-label={`${count} ${count === 1 ? 'agent' : 'agents'}`}
              >
                {count}
              </span>
            </button>
          )
        })}

        <button
          type="button"
          onClick={onNewTeam}
          title="New team"
          className="shrink-0 ml-1 px-3 py-1.5 text-[11px] border-b-2 border-transparent inline-flex items-center gap-1 text-text-3 hover:text-text-1"
        >
          <Plus size={11} strokeWidth={1.75} className="shrink-0" />
          <span>New</span>
        </button>
      </div>

      {clampedMenu ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Team actions"
          className="fixed z-50 rounded-sm border border-border-mid bg-bg-2 py-1 shadow-pop"
          style={{
            left: clampedMenu.x,
            top: clampedMenu.y,
            width: MENU_WIDTH
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => rename(clampedMenu.teamId)}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-text-2 hover:bg-bg-3 hover:text-text-1"
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => health(clampedMenu.teamId)}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-text-2 hover:bg-bg-3 hover:text-text-1"
          >
            Health
          </button>
          <div className="my-1 border-t border-border-soft" />
          <button
            type="button"
            role="menuitem"
            onClick={() => remove(clampedMenu.teamId)}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-red-400 hover:bg-bg-3 hover:text-red-300"
          >
            Delete
          </button>
        </div>
      ) : null}
    </>
  )
}
