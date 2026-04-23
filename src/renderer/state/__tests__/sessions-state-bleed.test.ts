import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionMeta } from '../../../shared/types'
import { useSessions } from '../sessions'

/**
 * Regression guard for the classic-Dashboard cross-session state-bleed.
 *
 * Repro: three sessions optimistically flipped to `thinking` by the user
 * pressing Enter in each pane. Only the active session actually has the
 * PTY analyzer emitting — the renderer's optimistic flip is NOT mirrored
 * into the main-side SessionMeta cache (syncExternalState intentionally
 * suppresses the emit to avoid flap). When session A's analyzer later
 * emits `userInput`, the main bridges it to patchLive which in turn
 * broadcasts `session:changed` with the full meta list. Before the fix,
 * `setSessions` naively replaced the store array — so sessions B and C
 * lost their optimistic `thinking` and snapped back to whatever state
 * the main-side cache was still carrying (typically the previous turn's
 * `userInput`). Visually: A flips to `userInput`, and B+C flip too —
 * exactly the "state leaking across sessions" the user reported.
 *
 * Fix: `setSessions` now preserves the existing per-session `state`
 * field across broadcasts, since `state` is owned exclusively by the
 * `session:state` channel (and by renderer-side optimistic flips) —
 * never by the structural `session:changed` payload.
 */
function mkSession(id: string, state: SessionMeta['state']): SessionMeta {
  return {
    id,
    ptyId: id,
    name: `sess-${id}`,
    cwd: '/tmp',
    createdAt: new Date().toISOString(),
    state
  } as SessionMeta
}

describe('sessions store — state bleed across sessions', () => {
  beforeEach(() => {
    // Each test starts from a clean store. Zustand keeps module-level
    // state between tests, so reset the relevant slice explicitly.
    useSessions.setState({
      sessions: [],
      activeId: null,
      isCreating: false,
      unread: {},
      stateHighWater: {}
    })
  })

  it('setSessions preserves existing per-session state across broadcasts', () => {
    // Initial: three sessions, all optimistically flipped to `thinking`
    // by the renderer. Main-side cache is still stale at `userInput`.
    useSessions.setState({
      sessions: [
        mkSession('A', 'thinking'),
        mkSession('B', 'thinking'),
        mkSession('C', 'thinking')
      ],
      activeId: 'A'
    })

    // Main-side meta cache has NOT caught up to the optimistic flips.
    // A `session:changed` broadcast arrives carrying the stale states.
    useSessions.getState().setSessions([
      mkSession('A', 'userInput'),
      mkSession('B', 'userInput'),
      mkSession('C', 'userInput')
    ])

    const after = useSessions.getState().sessions
    const byId = new Map(after.map((s) => [s.id, s]))
    // All three must keep the renderer-owned `thinking`. The broadcast
    // payload's `state` is explicitly ignored — the `session:state`
    // channel is the sole writer for live state.
    expect(byId.get('A')?.state).toBe('thinking')
    expect(byId.get('B')?.state).toBe('thinking')
    expect(byId.get('C')?.state).toBe('thinking')
  })

  it('setSessions still ingests new sessions with their reported state', () => {
    // Empty store. A brand-new session appears via broadcast — we have
    // no renderer-owned state for it yet, so the payload's state is
    // what we must keep.
    useSessions.getState().setSessions([mkSession('D', 'idle')])
    expect(useSessions.getState().sessions[0]?.state).toBe('idle')
  })

  it('setSessions preserves state but updates non-state structural fields', () => {
    useSessions.setState({
      sessions: [mkSession('A', 'thinking')]
    })
    const renamed = { ...mkSession('A', 'userInput'), name: 'renamed' } as SessionMeta
    useSessions.getState().setSessions([renamed])
    const s = useSessions.getState().sessions[0]!
    expect(s.state).toBe('thinking') // renderer-owned
    expect(s.name).toBe('renamed')   // broadcast-owned
  })

  it('patchSession (the session:state handler) remains the authoritative writer', () => {
    useSessions.setState({
      sessions: [
        mkSession('A', 'thinking'),
        mkSession('B', 'thinking'),
        mkSession('C', 'thinking')
      ]
    })
    // Only A flips via the authoritative channel.
    useSessions.getState().patchSession('A', { state: 'userInput' })
    const byId = new Map(useSessions.getState().sessions.map((s) => [s.id, s]))
    expect(byId.get('A')?.state).toBe('userInput')
    expect(byId.get('B')?.state).toBe('thinking')
    expect(byId.get('C')?.state).toBe('thinking')
  })
})
