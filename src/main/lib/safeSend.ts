import type { BrowserWindow } from 'electron'

/**
 * Send an IPC payload to a renderer, guarding against use-after-destroy.
 *
 * `win?.webContents.send(...)` only checks that `win` is truthy — it
 * doesn't catch the case where the BrowserWindow OR its webContents
 * have been destroyed while a background stream (node-pty data, JSONL
 * watcher tick, analyzer output) is still mid-emit. Linux users quitting
 * while a session is streaming was hitting:
 *
 *     A JavaScript error occurred in the main process
 *     TypeError: Object has been destroyed
 *         at TTY.onStreamRead (node:internal/stream_base_commons:191:23)
 *         at Readable.push (node:internal/streams/readable:392:5)
 *         at ReadStream.emit (node:events:518:28)
 *         at webContents.send (…)
 *
 * Wrapping every send through this helper makes the emit a silent no-op
 * once the window is gone. No error dialog on quit, no zombie streams
 * poisoning the process exit.
 */
export function safeSend(
  win: BrowserWindow | null | undefined,
  channel: string,
  payload?: unknown
): void {
  if (!win) return
  // Duck-typed guards so test doubles that omit isDestroyed() still
  // work (analyzer-manager tests use a minimal fake BrowserWindow).
  // Real Electron BrowserWindow always exposes these.
  if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return
  const wc = win.webContents
  if (!wc) return
  if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return
  try {
    wc.send(channel, payload)
  } catch {
    // Window destroyed between the isDestroyed() check and the send()
    // — rare but possible with the right timing. Swallow: there's no
    // recipient anyway.
  }
}
