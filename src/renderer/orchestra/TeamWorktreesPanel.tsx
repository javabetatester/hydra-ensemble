import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, GitBranch, Plus } from 'lucide-react'
import type { Worktree } from '../../shared/types'
import { useOrchestra } from './state/orchestra'

const POLL_INTERVAL_MS = 10_000

/** Shorten a 40-char SHA to the conventional 7-char prefix. Guards against
 *  empty strings (detached/fresh repos) so the row doesn't render "(empty)". */
function shortSha(sha: string): string {
  if (!sha) return '-------'
  return sha.slice(0, 7)
}

/**
 * Worktree manager for the active Orchestra team.
 *
 * Lists every git worktree found under the team's `worktreePath` repo and
 * lets the user point the team at a different one. Polls every 10s so an
 * external `git worktree add` eventually shows up without a manual reload.
 */
export default function TeamWorktreesPanel() {
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const team = useOrchestra(
    (s) => s.teams.find((t) => t.id === s.activeTeamId) ?? null
  )
  const worktreePath = team?.worktreePath ?? null

  const [worktrees, setWorktrees] = useState<Worktree[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // Inline "new worktree" form state — kept local; a modal would be
  // overkill for the side-panel footprint.
  const [creating, setCreating] = useState<boolean>(false)
  const [newName, setNewName] = useState<string>('')
  const [newBase, setNewBase] = useState<string>('')
  const [createBusy, setCreateBusy] = useState<boolean>(false)

  // Generation counter so a slow listWorktrees from a previous team can't
  // clobber fresh state after the user switches teams mid-flight.
  const gen = useRef(0)

  const loadWorktrees = useCallback(async (): Promise<void> => {
    if (!worktreePath) return
    const myGen = ++gen.current
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.git.listWorktrees(worktreePath)
      if (myGen !== gen.current) return
      if (!res.ok) {
        setError(res.error)
        setWorktrees([])
        return
      }
      setWorktrees(res.value)
    } catch (err) {
      if (myGen !== gen.current) return
      setError((err as Error).message)
    } finally {
      if (myGen === gen.current) setLoading(false)
    }
  }, [worktreePath])

  // Reset + kick off polling whenever the active team (or its worktree path)
  // changes. Bumping gen.current in cleanup orphans any in-flight response
  // from the previous team so it can't land on the new team's state.
  useEffect(() => {
    gen.current += 1
    setWorktrees([])
    setError(null)

    if (!worktreePath) return

    void loadWorktrees()
    const intervalId = window.setInterval(() => {
      void loadWorktrees()
    }, POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
      gen.current += 1
    }
  }, [activeTeamId, worktreePath, loadWorktrees])

  /** Pick the main worktree's path as the repoRoot for `createWorktree`.
   *  `git worktree list` guarantees exactly one entry with `isMain: true`
   *  per repo. Falling back to the active worktreePath keeps things usable
   *  on the initial render before the list resolves. */
  const repoRoot = useMemo<string | null>(() => {
    const main = worktrees.find((w) => w.isMain)
    if (main) return main.path
    return worktreePath
  }, [worktrees, worktreePath])

  const handleSwitch = useCallback(
    (target: Worktree): void => {
      if (!team) return
      if (target.path === team.worktreePath) return
      // TODO(orchestra): promote this to a first-class `updateTeam` action
      // on the store once the main-process surface exposes it. For now we
      // fire a window event so the host app can pick it up without the
      // panel reaching into IPC directly.
      const evt = new CustomEvent('orchestra:switch-team-worktree', {
        detail: { teamId: team.id, worktreePath: target.path }
      })
      window.dispatchEvent(evt)
    },
    [team]
  )

  const handleCreate = useCallback(async (): Promise<void> => {
    if (!repoRoot) return
    const name = newName.trim()
    if (!name) return
    const base = newBase.trim() || undefined
    setCreateBusy(true)
    setError(null)
    try {
      const res = await window.api.git.createWorktree(repoRoot, name, base)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setNewName('')
      setNewBase('')
      setCreating(false)
      await loadWorktrees()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreateBusy(false)
    }
  }, [repoRoot, newName, newBase, loadWorktrees])

  // Empty state ---------------------------------------------------------------

  if (!activeTeamId || !worktreePath || !team) {
    return (
      <div className="flex h-full flex-col overflow-hidden border border-border-soft bg-bg-2">
        <Header count={0} loading={false} />
        <div className="flex flex-1 items-center justify-center px-4 text-center">
          <span className="font-mono text-[11px] text-text-4">
            No active team or worktree
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden border border-border-soft bg-bg-2">
      <Header count={worktrees.length} loading={loading} />

      {error ? (
        <div className="flex shrink-0 items-start gap-1.5 border-b border-status-attention/40 bg-status-attention/10 px-3 py-2 font-mono text-[10.5px] text-status-attention">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            onClick={() => void loadWorktrees()}
            className="shrink-0 rounded-sm border border-status-attention/40 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] hover:bg-status-attention/20"
          >
            retry
          </button>
        </div>
      ) : null}

      <ul className="df-scroll min-h-0 flex-1 overflow-y-auto">
        {worktrees.length === 0 ? (
          <li className="flex h-full min-h-[80px] items-center justify-center px-3 py-6 text-center font-mono text-[11px] text-text-4">
            {loading ? 'Loading worktrees…' : 'No worktrees'}
          </li>
        ) : (
          worktrees.map((w) => {
            const isActive = w.path === team.worktreePath
            return (
              <li
                key={w.path}
                className={`flex flex-col gap-1 border-b border-border-soft/40 px-3 py-2 text-[11px] ${
                  isActive ? 'bg-accent-500/10' : 'hover:bg-bg-3/60'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {isActive ? (
                    <Check
                      size={12}
                      strokeWidth={2}
                      className="shrink-0 text-accent-400"
                      aria-label="Active worktree"
                    />
                  ) : (
                    <GitBranch
                      size={12}
                      strokeWidth={1.75}
                      className="shrink-0 text-text-3"
                    />
                  )}
                  <span
                    className={`min-w-0 flex-1 truncate font-mono ${
                      isActive ? 'text-text-1' : 'text-text-2'
                    }`}
                    title={w.branch}
                  >
                    {w.branch || '(detached)'}
                  </span>
                  <span
                    className="shrink-0 font-mono text-[10px] text-text-4"
                    title={w.head}
                  >
                    {shortSha(w.head)}
                  </span>
                  {w.isMain ? (
                    <span className="shrink-0 rounded-sm bg-bg-3 px-1 font-mono text-[9px] uppercase tracking-[0.12em] text-text-3">
                      main
                    </span>
                  ) : null}
                </div>

                <div
                  className="truncate pl-4 font-mono text-[10px] text-text-4"
                  title={w.path}
                >
                  {w.path}
                </div>

                <div className="flex items-center justify-end pl-4">
                  <button
                    type="button"
                    disabled={isActive}
                    onClick={() => handleSwitch(w)}
                    className="rounded-sm border border-border-soft px-2 py-0.5 font-mono text-[10px] text-text-2 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
                    title={
                      isActive
                        ? 'Team is already on this worktree'
                        : 'Switch team here'
                    }
                  >
                    {isActive ? 'Current' : 'Switch team here'}
                  </button>
                </div>
              </li>
            )
          })
        )}
      </ul>

      <footer className="flex shrink-0 flex-col gap-1.5 border-t border-border-soft bg-bg-2 px-3 py-2">
        {creating ? (
          <div className="flex flex-col gap-1.5">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="worktree name (branch)"
              className="rounded-sm border border-border-soft bg-bg-1 px-2 py-1 font-mono text-[11px] text-text-1 outline-none focus:border-accent-500"
              autoFocus
              disabled={createBusy}
            />
            <input
              type="text"
              value={newBase}
              onChange={(e) => setNewBase(e.target.value)}
              placeholder="base branch (optional)"
              className="rounded-sm border border-border-soft bg-bg-1 px-2 py-1 font-mono text-[11px] text-text-1 outline-none focus:border-accent-500"
              disabled={createBusy}
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setCreating(false)
                  setNewName('')
                  setNewBase('')
                }}
                disabled={createBusy}
                className="rounded-sm border border-border-soft px-2 py-0.5 font-mono text-[10px] text-text-3 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={createBusy || newName.trim().length === 0}
                className="flex items-center gap-1 rounded-sm border border-accent-500/60 bg-accent-500/10 px-2 py-0.5 font-mono text-[10px] text-accent-400 hover:bg-accent-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {createBusy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!repoRoot}
            className="flex items-center justify-center gap-1 rounded-sm border border-border-soft px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-2 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={11} strokeWidth={1.75} />
            New worktree…
          </button>
        )}
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subcomponents — kept in-file so the panel is one import.
// ---------------------------------------------------------------------------

function Header({
  count,
  loading
}: {
  count: number
  loading: boolean
}) {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border-soft bg-bg-2 px-3 py-2">
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-2">
        Worktrees
      </span>
      <span className="font-mono text-[10.5px] text-text-4">
        ({count}
        {loading ? ' …' : ''})
      </span>
    </header>
  )
}
