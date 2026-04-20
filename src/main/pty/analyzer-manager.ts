import type { BrowserWindow } from 'electron'
import type { SessionState } from '../../shared/types'
import { PtyStreamAnalyzer } from './analyzer'

/**
 * Owns one PtyStreamAnalyzer per sessionId. On every state transition,
 * forwards the new state to the renderer via the IPC channel `session:state`.
 */
export class AnalyzerManager {
  /** IPC channel emitted to the renderer on every analyzer state change. */
  public static readonly stateChannel = 'session:state'

  private analyzers = new Map<string, PtyStreamAnalyzer>()
  private window: BrowserWindow | null = null

  /** Optional: any-session state observer used by the integration layer. */
  public onAnyStateChange?: (sessionId: string, state: SessionState) => void

  public attachWindow(win: BrowserWindow): void {
    this.window = win
  }

  public forSession(sessionId: string): PtyStreamAnalyzer {
    const existing = this.analyzers.get(sessionId)
    if (existing) return existing

    const analyzer = new PtyStreamAnalyzer()
    analyzer.onStateChange = (state: SessionState): void => {
      this.window?.webContents.send(AnalyzerManager.stateChannel, { sessionId, state })
      this.onAnyStateChange?.(sessionId, state)
    }
    this.analyzers.set(sessionId, analyzer)
    return analyzer
  }

  /**
   * Align an existing analyzer's cached state with an externally-set
   * value (renderer-side optimistic flip). No-op if the session has
   * no analyzer yet. Used by the `session:syncState` IPC handler.
   */
  public syncState(sessionId: string, state: SessionState): void {
    this.analyzers.get(sessionId)?.syncExternalState(state)
  }

  public dispose(sessionId: string): void {
    const analyzer = this.analyzers.get(sessionId)
    if (!analyzer) return
    analyzer.reset()
    analyzer.onStateChange = undefined
    this.analyzers.delete(sessionId)
  }

  public disposeAll(): void {
    for (const [id] of this.analyzers) {
      this.dispose(id)
    }
  }
}
