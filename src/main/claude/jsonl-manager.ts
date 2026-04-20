import type { BrowserWindow } from 'electron'
import { JsonlWatcher } from './jsonl-watcher'
import type { JsonlUpdate } from '../../shared/types'

export interface JsonlSessionDescriptor {
  id: string
  claudeConfigDir: string
  cwd: string
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
      onUpdate: (update: JsonlUpdate) => {
        this.window?.webContents.send('session:jsonl', update)
        this.onAnyUpdate?.(update)
        // Transcript lines arrived — ping the renderer so any open visual
        // chat view re-fetches the parsed transcript. Debounced at the
        // watcher level (one emit per consumed chunk) so this is already
        // cheap; the renderer additionally debounces its refetch.
        this.window?.webContents.send('session:transcriptChanged', {
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
