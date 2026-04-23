import type { BrowserWindow } from 'electron'
import { getStore, patchStore } from '../store'
import type {
  WatchdogFireEvent,
  WatchdogRule,
  NotifyOptions
} from '../../shared/types'
import { safeSend } from '../lib/safeSend'

/** Recent text window kept per session, in bytes. */
const WINDOW_BYTES = 4 * 1024
/** Max length of the "matched" snippet sent to listeners. */
const SNIPPET_MAX = 160

export type WatchdogActionKind = 'sendInput' | 'kill'

export interface WatchdogAction {
  kind: WatchdogActionKind
  sessionId: string
  /** Present when kind === 'sendInput'. */
  data?: string
}

export interface WatchdogServiceOptions {
  /**
   * Wired by the integration step (main/index.ts) to actually carry out
   * 'sendInput' (write to the PtyManager) and 'kill' (call the
   * SessionManager). Keeping the manager pure means tests can assert
   * actions without spinning up Electron / node-pty.
   */
  onAction?: (action: WatchdogAction) => void
}

interface CompiledRule {
  rule: WatchdogRule
  regex: RegExp | null
}

export class WatchdogService {
  private window: BrowserWindow | null = null
  private buffers = new Map<string, string>()
  /** key: `${ruleId}::${sessionId}` -> last fire timestamp ms. */
  private cooldowns = new Map<string, number>()
  private compiled = new Map<string, CompiledRule>()

  constructor(private opts: WatchdogServiceOptions = {}) {
    this.recompileAll(getStore().watchdogs)
  }

  attachWindow(win: BrowserWindow): void {
    this.window = win
  }

  list(): WatchdogRule[] {
    // Return the persisted view (some rules may have been auto-disabled
    // due to invalid regex — that disable is reflected in `compiled` and
    // the persisted rule, see recompileAll).
    return getStore().watchdogs
  }

  save(rules: WatchdogRule[]): void {
    this.recompileAll(rules)
    // Persist the (possibly auto-disabled) rules so the renderer sees
    // the corrected state on the next list() call.
    patchStore({ watchdogs: this.snapshotRules() })
    // Drop cooldowns for removed rule ids.
    const known = new Set(rules.map((r) => r.id))
    for (const key of [...this.cooldowns.keys()]) {
      const ruleId = key.split('::')[0]
      if (ruleId && !known.has(ruleId)) this.cooldowns.delete(key)
    }
  }

  /**
   * Feed a chunk of PTY output for `sessionId`. Maintains a rolling
   * 4 KB window per session and evaluates every enabled rule against
   * the latest data. Returns the rules that fired (handy for tests).
   */
  feed(sessionId: string, data: string): WatchdogFireEvent[] {
    if (!data) return []
    const fired: WatchdogFireEvent[] = []
    const prev = this.buffers.get(sessionId) ?? ''
    const next = appendWindow(prev, data)
    this.buffers.set(sessionId, next)

    const now = Date.now()
    for (const compiled of this.compiled.values()) {
      const { rule, regex } = compiled
      if (!rule.enabled || !regex) continue
      const cdKey = `${rule.id}::${sessionId}`
      const last = this.cooldowns.get(cdKey) ?? 0
      if (now - last < rule.cooldownMs) continue

      // Reset lastIndex defensively (regex compiled without /g but be
      // safe if the user adds /g via flags in a future version).
      regex.lastIndex = 0
      const match = regex.exec(next)
      if (!match) continue

      this.cooldowns.set(cdKey, now)
      const matched = match[0].slice(0, SNIPPET_MAX)
      const event: WatchdogFireEvent = {
        ruleId: rule.id,
        sessionId,
        matched,
        at: new Date(now).toISOString()
      }
      fired.push(event)
      this.dispatch(rule, sessionId, matched, event)
    }
    return fired
  }

  /** Clear per-session state (e.g. when a session is destroyed). */
  forgetSession(sessionId: string): void {
    this.buffers.delete(sessionId)
    for (const key of [...this.cooldowns.keys()]) {
      if (key.endsWith(`::${sessionId}`)) this.cooldowns.delete(key)
    }
  }

  // -----------------------------------------------------------------------
  // internals
  // -----------------------------------------------------------------------

  private dispatch(
    rule: WatchdogRule,
    sessionId: string,
    matched: string,
    event: WatchdogFireEvent
  ): void {
    switch (rule.action) {
      case 'sendInput': {
        const data = rule.payload ?? ''
        this.opts.onAction?.({ kind: 'sendInput', sessionId, data })
        safeSend(this.window, 'watchdog:sendInput', { sessionId, data })
        break
      }
      case 'notify': {
        const notif: NotifyOptions = {
          title: `Watchdog: ${rule.name}`,
          body: `matched: ${matched}`,
          kind: 'attention',
          sessionId
        }
        safeSend(this.window, 'notify:show', notif)
        break
      }
      case 'kill': {
        this.opts.onAction?.({ kind: 'kill', sessionId })
        safeSend(this.window, 'session:killRequest', { sessionId })
        break
      }
    }
    safeSend(this.window, 'watchdog:fired', event)
  }

  private recompileAll(rules: WatchdogRule[]): void {
    this.compiled.clear()
    for (const rule of rules) {
      let regex: RegExp | null = null
      let enabled = rule.enabled
      try {
        regex = new RegExp(rule.triggerPattern)
      } catch {
        regex = null
        // Invalid regex: force-disable so we don't keep retrying on every
        // feed() call. The corrected value is persisted via save().
        enabled = false
      }
      this.compiled.set(rule.id, {
        rule: { ...rule, enabled },
        regex
      })
    }
  }

  private snapshotRules(): WatchdogRule[] {
    return [...this.compiled.values()].map((c) => c.rule)
  }
}

function appendWindow(prev: string, data: string): string {
  const merged = prev + data
  if (merged.length <= WINDOW_BYTES) return merged
  return merged.slice(merged.length - WINDOW_BYTES)
}
