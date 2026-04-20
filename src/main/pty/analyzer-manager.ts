import type { BrowserWindow } from 'electron'
import type { SessionState } from '../../shared/types'
import { PtyStreamAnalyzer } from './analyzer'

interface ActiveAnalyzer {
  analyzer: PtyStreamAnalyzer
  /** Monotonic counter per sessionId — bumped every time `forSession`
   *  creates a new analyzer for the same session. Emitted with every
   *  `session:state` IPC event so the renderer can reject anything
   *  stamped with an older generation (zombie analyzer firing after
   *  a restart, callback queued in the event loop pre-dispose, etc.). */
  generation: number
  /** Last state we actually emitted for this sessionId, plus when.
   *  The watchdog uses these to detect "stuck working" sessions and
   *  trigger a forceReemit. */
  lastState: SessionState
  lastEmittedAt: number
}

/**
 * Owns one PtyStreamAnalyzer per sessionId. Every state transition gets
 * stamped with a monotonic `generation` and `emittedAt` before being
 * forwarded to the renderer — the three fields together form the anti-
 * contamination contract: the renderer will refuse to apply any event
 * whose (sessionId, generation, emittedAt) is not strictly newer than
 * what it last saw. Combined with `analyzer.dispose()` (which turns
 * further entry points into no-ops), this makes it impossible for a
 * torn-down analyzer to pollute the state of a fresh one — the classic
 * "session A twitches and session B's pill goes wrong" bug.
 */
export class AnalyzerManager {
  /** IPC channel emitted to the renderer on every analyzer state change. */
  public static readonly stateChannel = 'session:state'

  /** Watchdog cadence. A tick scans every analyzer and:
   *   - if state ∈ {thinking, generating} and no feed for `stuckFeedMs`,
   *     fires forceReemit so the heuristic re-evaluates against whatever
   *     the TUI painted last (catches "claude finished but never drew
   *     the idle hint" edge cases).
   *   - if lastEmittedAt is older than `driftMs` for a non-idle state
   *     despite feed activity, also re-emits as a liveness kick. */
  private static readonly watchdogIntervalMs = 2000
  private static readonly stuckFeedMs = 12_000
  private static readonly driftMs = 30_000

  private active = new Map<string, ActiveAnalyzer>()
  /** Per-sessionId monotonic counter, preserved across dispose() so that a
   *  session torn down at generation N and respawned (restart) starts at
   *  generation N+1 — never lower. If we ever reset this, the renderer's
   *  high-watermark check would drop every event from the fresh analyzer
   *  as "stale". Cleared only via `forgetSession`, which the caller invokes
   *  when a session is permanently destroyed (id will never reappear). */
  private generations = new Map<string, number>()
  private window: BrowserWindow | null = null
  private watchdogTimer: ReturnType<typeof setInterval> | null = null

  /** Optional: any-session state observer used by the integration layer. */
  public onAnyStateChange?: (sessionId: string, state: SessionState) => void

  constructor() {
    this.watchdogTimer = setInterval(
      () => this.runWatchdog(),
      AnalyzerManager.watchdogIntervalMs
    )
    if (typeof this.watchdogTimer.unref === 'function') {
      this.watchdogTimer.unref()
    }
  }

  public attachWindow(win: BrowserWindow): void {
    this.window = win
  }

  /**
   * Get (or create) the analyzer for a session. If one already exists, it
   * is first disposed and thrown away — we never reuse an analyzer across
   * spawns. This guarantees the `generation` counter is always strictly
   * greater than any generation the old analyzer could have emitted, and
   * that any in-flight frameTimer from the old analyzer is cancelled.
   */
  public forSession(sessionId: string): PtyStreamAnalyzer {
    const prev = this.active.get(sessionId)
    const generation = (this.generations.get(sessionId) ?? 0) + 1
    this.generations.set(sessionId, generation)
    if (prev) {
      // Retire the old analyzer. Post-dispose, its feed/analyzeFrame/
      // onStateChange are no-ops even if the PTY subscriber manages to
      // call feed() once more before unsubscribing.
      prev.analyzer.dispose()
    }

    const analyzer = new PtyStreamAnalyzer()
    const entry: ActiveAnalyzer = {
      analyzer,
      generation,
      lastState: analyzer.state,
      lastEmittedAt: 0
    }
    analyzer.onStateChange = (state: SessionState): void => {
      this.emit(sessionId, entry, state)
    }
    this.active.set(sessionId, entry)
    return analyzer
  }

  /**
   * Align an existing analyzer's cached state with an externally-set
   * value (renderer-side optimistic flip). No-op if the session has
   * no analyzer yet. Used by the `session:syncState` IPC handler.
   */
  public syncState(sessionId: string, state: SessionState): void {
    this.active.get(sessionId)?.analyzer.syncExternalState(state)
  }

  public dispose(sessionId: string): void {
    const entry = this.active.get(sessionId)
    if (!entry) return
    entry.analyzer.dispose()
    this.active.delete(sessionId)
    // Intentionally keep `generations[sessionId]` — a restart will spawn
    // a fresh analyzer with a higher generation, and the renderer's
    // high-watermark must keep rising. `forgetSession` clears it when
    // the session is permanently destroyed.
  }

  /**
   * Final cleanup for a session whose id will never reappear (destroy).
   * Drops the generation counter so memory doesn't grow with the number
   * of ever-created sessions across the app's lifetime.
   */
  public forgetSession(sessionId: string): void {
    this.dispose(sessionId)
    this.generations.delete(sessionId)
  }

  public disposeAll(): void {
    for (const [id] of this.active) {
      this.dispose(id)
    }
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  // --- private -----------------------------------------------------------

  private emit(
    sessionId: string,
    entry: ActiveAnalyzer,
    state: SessionState
  ): void {
    // Belt-and-braces: the analyzer is disposed and dropped from `active`
    // before a restart ever calls forSession again, but a callback could
    // still be in flight. Double-check membership so a zombie analyzer's
    // last gasp can never overwrite the fresh entry's state.
    const current = this.active.get(sessionId)
    if (!current || current !== entry) return

    entry.lastState = state
    entry.lastEmittedAt = Date.now()
    this.window?.webContents.send(AnalyzerManager.stateChannel, {
      sessionId,
      state,
      generation: entry.generation,
      emittedAt: entry.lastEmittedAt
    })
    this.onAnyStateChange?.(sessionId, state)
  }

  private runWatchdog(): void {
    const now = Date.now()
    for (const [sessionId, entry] of this.active) {
      const { analyzer, lastState, lastEmittedAt } = entry
      if (analyzer.isDisposed) continue
      const isWorking = lastState === 'thinking' || lastState === 'generating'
      if (!isWorking) continue

      const sinceFeed = analyzer.lastFeedAt > 0 ? now - analyzer.lastFeedAt : 0
      const sinceEmit = lastEmittedAt > 0 ? now - lastEmittedAt : 0

      const stuckSilent = sinceFeed >= AnalyzerManager.stuckFeedMs
      const drifted = sinceEmit >= AnalyzerManager.driftMs

      if (stuckSilent || drifted) {
        // Trigger a re-evaluation. If the heuristic now computes a
        // different state (e.g. claude rendered the idle hint long ago
        // but the pill missed it), analyzeFrame() inside forceReemit
        // will flip us via onStateChange. If nothing changed, we re-emit
        // the current state — keeps the renderer in lockstep and logs
        // a fresh emittedAt so the next tick doesn't keep firing.
        void sessionId // for telemetry: referenced so lint doesn't drop
        analyzer.forceReemit()
      }
    }
  }
}
