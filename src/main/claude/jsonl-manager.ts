import type { BrowserWindow } from 'electron'
import { JsonlWatcher } from './jsonl-watcher'
import type { JsonlUpdate } from '../../shared/types'
import { safeSend } from '../lib/safeSend'

export interface JsonlSessionDescriptor {
  id: string
  claudeConfigDir: string
  cwd: string
  /** ISO-8601 SessionMeta.createdAt — so the watcher can ignore JSONLs
   *  that predate this session (prior sibling in the same cwd). */
  createdAt?: string
}

/**
 * Owns one `JsonlWatcher` per active session and forwards each update over
 * the `session:jsonl` IPC channel to the renderer.
 */
export class JsonlManager {
  private window: BrowserWindow | null = null
  private watchers = new Map<string, JsonlWatcher>()

  /** Optional: any-session JSONL update observer used by the integration layer. */
  public onAnyUpdate?: (update: JsonlUpdate) => void

  attachWindow(win: BrowserWindow): void {
    this.window = win
  }

  start(session: JsonlSessionDescriptor): void {
    if (this.watchers.has(session.id)) return
    const watcher = new JsonlWatcher({
      sessionId: session.id,
      claudeConfigDir: session.claudeConfigDir,
      cwd: session.cwd,
      sessionCreatedAt: session.createdAt,
      onUpdate: (update: JsonlUpdate) => {
        safeSend(this.window, 'session:jsonl', update)
        this.onAnyUpdate?.(update)
        // Transcript lines arrived — ping the renderer so any open visual
        // chat view re-fetches the parsed transcript. Debounced at the
        // watcher level (one emit per consumed chunk) so this is already
        // cheap; the renderer additionally debounces its refetch.
        safeSend(this.window, 'session:transcriptChanged', {
          sessionId: session.id
        })
      }
    })
    this.watchers.set(session.id, watcher)
  }

  stop(sessionId: string): void {
    const watcher = this.watchers.get(sessionId)
    if (!watcher) return
    watcher.stop()
    this.watchers.delete(sessionId)
  }

  stopAll(): void {
    for (const watcher of this.watchers.values()) {
      watcher.stop()
    }
    this.watchers.clear()
  }
}
