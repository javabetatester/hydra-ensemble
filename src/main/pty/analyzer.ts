import type { SessionState } from '../../shared/types'

/**
 * Analyzes raw PTY byte stream in real-time to detect Claude Code session state.
 * Strips ANSI escape sequences and tracks alternate buffer mode, frame boundaries,
 * and content patterns.
 *
 * Ported 1:1 from Sources/HydraEnsembleCore/PTYStreamAnalyzer.swift.
 * The 50ms debounce uses setTimeout (the JS equivalent of DispatchQueue.main.asyncAfter).
 */
export class PtyStreamAnalyzer {
  public onStateChange?: (state: SessionState) => void

  private _state: SessionState = 'idle'

  // Dispose flag — once set, every public entry point (feed, analyzeFrame,
  // syncExternalState, forceReemit) is a no-op. Belt-and-suspenders against
  // stray callbacks firing after the session was torn down, which could
  // otherwise push a stale state into the wrong generation of the pill.
  private disposed = false

  // ANSI parser state
  private inEscape = false
  private escapeBuffer: number[] = []

  // Alternate buffer tracking (Claude's TUI uses alternate screen)
  private _alternateBufferActive = false

  // Frame text — reset on screen clear or frame boundary
  private frameText = ''
  private frameTimer: ReturnType<typeof setTimeout> | null = null

  // Timestamp of the last PTY byte fed in — used by the manager's watchdog
  // to detect "stuck working" sessions (state=thinking/generating with no
  // fresh bytes for too long, which usually means a missed transition).
  private lastFedAt = 0

  // Rolling recent text (last ~8000 chars of plaintext). Bumped from 2000 so
  // long turns don't roll the working/idle markers out of the comparison
  // window, which used to freeze the pill mid-state on chatty sessions.
  private recentText = ''
  private readonly recentTextLimit = 8000

  // Position in recentText at the moment the user submitted (pressed
  // Enter). Idle markers ("? for shortcuts" etc.) written before this
  // point are stale — they belong to the previous turn. Cleared once
  // claude renders ANY new marker after the submit, or implicitly
  // when the recentText buffer rolls past it.
  private submitMark: number | null = null
  /** ms timestamp the current submitMark was set. After
   *  `submitMarkTtlMs` we clear the mark unconditionally — failsafe so
   *  a misfired optimistic flip can't strand the pill in 'thinking'
   *  forever (e.g. if claude consumed our input without ever drawing
   *  the working footer). */
  private submitMarkAt = 0
  /** Base TTL. Actual deadline extends every time fresh bytes arrive —
   *  lastFedAt + base gives a rolling "still-thinking" window that survives
   *  long tool runs without reverting to the stale idle hint. Hard-capped
   *  by `submitMarkMaxMs` so a truly silent stall eventually self-heals. */
  private static readonly submitMarkTtlMs = 8000
  private static readonly submitMarkMaxMs = 45000

  // UTF-8 decoder for text runs between ANSI escapes. stream:true so
  // a multi-byte sequence split across feed() calls is buffered and
  // resolved on the next chunk. Without this we filtered to ASCII
  // only — claude's prompt glyph (❯), footer separator (·) and arrow
  // markers were invisible to the heuristics.
  private readonly decoder = new TextDecoder('utf-8')

  // Throttle interval — analyzeFrame runs at most once per window.
  // Using a throttle instead of a debounce is deliberate: during a
  // continuous stream (claude generating output) bytes arrive faster
  // than the window, so a debounce would keep resetting forever and
  // analyzeFrame would never fire until claude paused — leaving the
  // state pill frozen at whatever it was before work started.
  private static readonly throttleMs = 80

  public get state(): SessionState {
    return this._state
  }

  public get alternateBufferActive(): boolean {
    return this._alternateBufferActive
  }

  public feed(input: Uint8Array | Buffer | string): void {
    if (this.disposed) return
    this.lastFedAt = Date.now()
    const bytes = this.toBytes(input)
    // Accumulate contiguous text bytes (between ANSI escapes) so the
    // UTF-8 decoder sees them as one chunk — required for multi-byte
    // glyphs like ❯ / · / ▸ that claude's TUI uses for its footer.
    let runStart = -1
    const flushRun = (end: number): void => {
      if (runStart < 0 || end <= runStart) {
        runStart = -1
        return
      }
      const slice = bytes.subarray(runStart, end)
      const decoded = this.decoder.decode(slice, { stream: true })
      for (const ch of decoded) {
        const code = ch.codePointAt(0)!
        if (code === 0x0a) {
          // LF
          this.frameText += '\n'
          this.recentText += '\n'
        } else if (code === 0x0d || code < 0x20) {
          // CR and other control chars — ignore for analysis
        } else {
          this.frameText += ch
          this.recentText += ch
        }
      }
      runStart = -1
    }

    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i]!
      if (this.inEscape) {
        this.processEscapeByte(byte)
      } else if (byte === 0x1b) {
        // ESC — flush any pending text run before switching modes.
        flushRun(i)
        this.inEscape = true
        this.escapeBuffer = [byte]
      } else if (runStart < 0) {
        runStart = i
      }
    }
    flushRun(bytes.length)

    // Trim recent text buffer
    if (this.recentText.length > this.recentTextLimit) {
      const cut = this.recentText.length - this.recentTextLimit
      this.recentText = this.recentText.slice(cut)
      if (this.submitMark !== null) {
        this.submitMark = Math.max(0, this.submitMark - cut)
      }
    }

    // Throttle frame analysis — if a timer is already scheduled, do
    // nothing and let it fire. This guarantees analyzeFrame runs at
    // least every `throttleMs` during continuous PTY streams, so the
    // state pill updates at real-time speed while claude is working.
    if (this.frameTimer === null) {
      this.frameTimer = setTimeout(() => {
        this.frameTimer = null
        this.analyzeFrame()
      }, PtyStreamAnalyzer.throttleMs)
    }
  }

  /**
   * Sync the analyzer's internal state cache with an externally-set
   * value (e.g., renderer-side optimistic flip on Enter). Does NOT
   * emit — the next analyzeFrame will diff against this new baseline
   * and fire onStateChange if the terminal disagrees.
   *
   * Why this matters: without syncing, an optimistic flip pushes the
   * renderer to 'thinking' while the analyzer's cache is still
   * 'userInput'. When claude's prompt reappears and the analyzer
   * computes 'userInput' again, it equals the cached value and no
   * IPC fires — leaving the card stuck on the optimistic guess.
   */
  public syncExternalState(state: SessionState): void {
    if (this.disposed) return
    this._state = state
    // When the renderer optimistically flips us to a working state
    // (Enter pressed), stamp the current buffer position so the next
    // analyzeFrame doesn't latch onto the stale "? for shortcuts" the
    // previous idle frame left behind. Cleared the moment claude
    // writes any fresh marker past this point.
    if (state === 'thinking' || state === 'generating') {
      this.submitMark = this.recentText.length
      this.submitMarkAt = Date.now()
    } else {
      this.submitMark = null
      this.submitMarkAt = 0
    }
  }

  /**
   * Force a state re-evaluation and re-emission even if the computed
   * state hasn't changed. Used after the renderer optimistically flips
   * state so the analyzer can "re-confirm" its view and push the card
   * back in sync. Safe to call any time.
   */
  public forceReemit(): void {
    if (this.disposed) return
    const prev = this._state
    // Run analyzeFrame — if it computes a different state it fires
    // onStateChange normally; otherwise we manually re-fire so the
    // renderer's out-of-sync value is corrected.
    this.analyzeFrame()
    if (this._state === prev) {
      this.onStateChange?.(this._state)
    }
  }

  /** Time of the most recent `feed()` call, ms since epoch. 0 if never fed. */
  public get lastFeedAt(): number {
    return this.lastFedAt
  }

  public get isDisposed(): boolean {
    return this.disposed
  }

  /** Reset the analyzer (e.g., when restarting a session). */
  public reset(): void {
    this._state = 'idle'
    this._alternateBufferActive = false
    this.inEscape = false
    this.escapeBuffer = []
    this.frameText = ''
    this.recentText = ''
    this.submitMark = null
    this.submitMarkAt = 0
    this.lastFedAt = 0
    if (this.frameTimer !== null) {
      clearTimeout(this.frameTimer)
      this.frameTimer = null
    }
  }

  /**
   * Permanently retire this analyzer. All further entry points become
   * no-ops. The manager creates a fresh instance for the next generation
   * of the same session, so a torn-down analyzer must never emit again
   * — even if a callback was already queued on the event loop before
   * dispose landed.
   */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.onStateChange = undefined
    if (this.frameTimer !== null) {
      clearTimeout(this.frameTimer)
      this.frameTimer = null
    }
  }

  // MARK: - ANSI Escape Sequence Parser

  private processEscapeByte(byte: number): void {
    this.escapeBuffer.push(byte)

    // ESC [ ... <final byte> — CSI sequence
    if (this.escapeBuffer.length === 2 && byte === 0x5b) {
      // [
      return // start of CSI, keep reading
    }

    // ESC ] ... BEL/ST — OSC sequence
    if (this.escapeBuffer.length === 2 && byte === 0x5d) {
      // ]
      return // start of OSC, keep reading
    }

    // Inside CSI sequence — wait for final byte (0x40-0x7E)
    if (this.escapeBuffer.length >= 3 && this.escapeBuffer[1] === 0x5b) {
      if (byte >= 0x40 && byte <= 0x7e) {
        // CSI sequence complete — check for important ones
        this.checkCSISequence()
        this.endEscape()
      }
      return
    }

    // Inside OSC sequence — wait for BEL (0x07) or ST (ESC \)
    if (this.escapeBuffer.length >= 3 && this.escapeBuffer[1] === 0x5d) {
      if (byte === 0x07) {
        // BEL terminates OSC
        this.endEscape()
      } else if (
        byte === 0x5c &&
        this.escapeBuffer.length >= 2 &&
        this.escapeBuffer[this.escapeBuffer.length - 2] === 0x1b
      ) {
        // ESC \ terminates OSC
        this.endEscape()
      }
      // Keep reading OSC content (don't let it grow unbounded)
      if (this.escapeBuffer.length > 256) {
        this.endEscape() // bail on absurdly long sequences
      }
      return
    }

    // Simple two-byte escape (ESC + single char) — e.g., ESC M, ESC 7, ESC 8
    if (this.escapeBuffer.length === 2) {
      this.endEscape()
      return
    }

    // Safety: if escape buffer gets too long, bail
    if (this.escapeBuffer.length > 64) {
      this.endEscape()
    }
  }

  private checkCSISequence(): void {
    // Extract parameter string (bytes between '[' and final byte)
    if (this.escapeBuffer.length < 3) return
    const paramBytes = this.escapeBuffer.slice(2, this.escapeBuffer.length - 1)
    const finalByte = this.escapeBuffer[this.escapeBuffer.length - 1]!
    let paramStr = ''
    for (const b of paramBytes) {
      // Mirror Swift's Unicode.Scalar(UInt32) — accept anything in valid range.
      if (b <= 0x10ffff) {
        paramStr += String.fromCharCode(b)
      }
    }

    // Detect alternate buffer switch
    // CSI ? 1049 h = enter alternate buffer
    // CSI ? 1049 l = leave alternate buffer
    if (paramStr === '?1049') {
      if (finalByte === 0x68) {
        // 'h' — new TUI starting (claude launching, or re-entering after a
        // /quit → `claude` retry). Wipe recentText too, otherwise stale
        // markers from the previous TUI lifetime (or from a bash session
        // that printed "esc to interrupt" in some other context) bias the
        // heuristic against the fresh frame.
        this._alternateBufferActive = true
        this.frameText = ''
        this.recentText = ''
        this.submitMark = null
        this.submitMarkAt = 0
      } else if (finalByte === 0x6c) {
        // 'l' — TUI exited. Same rationale: once claude is gone, any
        // marker text lingering in the buffer is stale and must not leak
        // into the next session if the user restarts in-place.
        this._alternateBufferActive = false
        this.frameText = ''
        this.recentText = ''
        this.submitMark = null
        this.submitMarkAt = 0
        this.updateState('idle')
      }
    }

    // Detect screen clear: CSI 2 J
    if (paramStr === '2' && finalByte === 0x4a) {
      // 'J'
      this.frameText = '' // new frame
    }

    // Detect cursor home: CSI H (no params)
    if (paramStr.length === 0 && finalByte === 0x48) {
      // 'H'
      // Often precedes a full redraw, but don't clear yet
    }
  }

  private endEscape(): void {
    this.inEscape = false
    this.escapeBuffer = []
  }

  // MARK: - Frame Analysis

  private analyzeFrame(): void {
    if (this.disposed) return
    const text = this.recentText
    const lower = text.toLowerCase()

    let newState: SessionState

    // 1. Permission prompts — highest priority, override everything.
    //    Anchored on claude's actual prompt copy (all four variants are
    //    verbatim from the TUI across opus/sonnet/haiku releases). The
    //    previous "allow" && "deny" heuristic fired on any file output
    //    that happened to mention those words, which pinned the pill on
    //    'needsAttention' forever. "❯ 1. yes" is the numbered-choice
    //    menu used for tool execution prompts; "do you trust the files"
    //    is the first-run workspace prompt. "esc to reject" is unique
    //    enough on its own. All of these imply a keypress is literally
    //    required — any other surface-area keyword is too noisy.
    // Position of the most recent permission marker, if any. Stale prompts
    // rolled over by a fresh working/idle footer should NOT trigger — the
    // keypress has already been given.
    const attentionMarkers = [
      'do you want to proceed',
      'do you trust the files',
      'press y to accept',
      'esc to reject',
      '[y/n]',
      '(y/n)'
    ]
    let lastAttention = -1
    for (const m of attentionMarkers) {
      const idx = lower.lastIndexOf(m)
      if (idx > lastAttention) lastAttention = idx
    }
    // Numbered-choice menu ("❯ 1. Yes" / "❯ 1. yes, proceed") uses the
    // original-case buffer because the arrow glyph is above ASCII.
    const numberedChoice = text.search(/❯\s*1\.\s*[Yy]es/)
    if (numberedChoice > lastAttention) lastAttention = numberedChoice

    const lastWorkingEarly = Math.max(
      lower.lastIndexOf('esc to interrupt'),
      lower.lastIndexOf('esc to cancel')
    )
    const lastIdleEarly = Math.max(
      lower.lastIndexOf('? for shortcuts'),
      lower.lastIndexOf('/ for commands'),
      lower.lastIndexOf('shift+tab to cycle')
    )
    const attentionIsFresh =
      lastAttention >= 0 &&
      lastAttention > lastWorkingEarly &&
      lastAttention > lastIdleEarly

    if (attentionIsFresh) {
      newState = 'needsAttention'
    }
    // 2. Position-based working-vs-idle. Claude's TUI writes two mutually
    //    exclusive markers into the footer: "esc to interrupt" while
    //    working, "? for shortcuts" (or "/ for commands", etc.) while
    //    waiting for input. Because the screen redraws visually but the
    //    rolling buffer accumulates both markers across the session,
    //    presence alone is unreliable — we compare the LAST index of
    //    each and whichever was written more recently wins. This is
    //    self-correcting across every transition (idle → work → idle →
    //    work → ...) without needing to clear buffers or track frames.
    else {
      const rawWorking = lastWorkingEarly
      const rawIdle = lastIdleEarly
      // Failsafe: drop the submit mark when the optimistic flip has gone
      // stale. "Stale" means either:
      //  (a) no fresh PTY bytes for `submitMarkTtlMs` (claude is done
      //      and silently consumed the submit — e.g. a slash command
      //      with no visible output), OR
      //  (b) a hard cap of `submitMarkMaxMs` since submit, even if bytes
      //      keep flowing but no marker ever appears (broken TUI).
      // This is a compromise: we want to survive long tool runs that
      // can take 30+ seconds, but we can't wait forever or the pill
      // gets stuck on 'thinking' forever when a no-op slash command
      // eats the Enter.
      const now = Date.now()
      if (this.submitMark !== null) {
        const sinceSubmit = now - this.submitMarkAt
        const sinceFeed = this.lastFedAt > 0 ? now - this.lastFedAt : sinceSubmit
        const quietTooLong = sinceFeed > PtyStreamAnalyzer.submitMarkTtlMs
        const totalTooLong = sinceSubmit > PtyStreamAnalyzer.submitMarkMaxMs
        if (quietTooLong || totalTooLong) {
          this.submitMark = null
          this.submitMarkAt = 0
        }
      }

      // Demote pre-submit markers: anything the user hasn't caused is
      // stale once they press Enter. Prevents the idle hint from the
      // just-closed frame from yanking the card back to 'userInput'
      // before claude has a chance to render its working footer.
      const mark = this.submitMark ?? -1
      const lastWorking = rawWorking > mark ? rawWorking : -1
      const lastIdle = rawIdle > mark ? rawIdle : -1

      // Nothing fresh since submit — claude is still processing; don't
      // emit (keeps the optimistic 'thinking' in place).
      if (this.submitMark !== null && lastWorking < 0 && lastIdle < 0) {
        return
      }

      // Clear the mark as soon as we have a confirmed post-submit
      // signal so subsequent frames use raw positions again.
      if (lastWorking >= 0 || lastIdle >= 0) {
        this.submitMark = null
      }

      if (lastWorking >= 0 && lastWorking > lastIdle) {
        // Sub-state: inspect the ~200 chars around the footer for the
        // claude phase word. Windowing prevents an old "thinking" from
        // the very first footer of the turn from sticking once claude
        // has moved on to generating.
        const window = lower.slice(
          Math.max(0, lastWorking - 200),
          lastWorking + 40
        )
        if (
          window.includes('thinking') ||
          window.includes('crafting') ||
          window.includes('planning')
        ) {
          newState = 'thinking'
        } else {
          newState = 'generating'
        }
      } else if (lastIdle >= 0) {
        newState = 'userInput'
      }
      // 3. No claude marker at all — look at the very tail for shell or
      //    alternate-buffer fallbacks.
      else {
        const tail = text.slice(Math.max(0, text.length - 120))
        const tailLower = tail.toLowerCase()
        if (
          tailLower.endsWith('$ ') ||
          tailLower.endsWith('# ') ||
          tailLower.endsWith('% ')
        ) {
          newState = 'idle'
        } else if (this._alternateBufferActive) {
          newState = 'userInput'
        } else if (
          tail.includes('/effort') ||
          tail.includes('> ') ||
          /[>\u276f\u25b8\u2023\u203a]\s*$/.test(tail)
        ) {
          newState = 'userInput'
        } else {
          // Can't determine — keep current state.
          return
        }
      }
    }

    this.updateState(newState)
  }

  private updateState(newState: SessionState): void {
    if (newState === this._state) return
    this._state = newState
    this.onStateChange?.(newState)
  }

  private toBytes(input: Uint8Array | Buffer | string): Uint8Array {
    if (typeof input === 'string') {
      return new TextEncoder().encode(input)
    }
    if (input instanceof Uint8Array) {
      return input
    }
    // Buffer extends Uint8Array, but be defensive.
    return new Uint8Array(input)
  }
}
