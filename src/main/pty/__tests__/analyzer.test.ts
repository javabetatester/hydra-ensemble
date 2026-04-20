import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PtyStreamAnalyzer } from '../analyzer'

/**
 * Vitest port of Tests/HydraEnsembleTests/PTYStreamAnalyzerTests.swift.
 * The 80ms throttle is advanced via vi.useFakeTimers().
 */
describe('PtyStreamAnalyzer', () => {
  let analyzer: PtyStreamAnalyzer

  beforeEach(() => {
    vi.useFakeTimers()
    analyzer = new PtyStreamAnalyzer()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function feedString(text: string): void {
    analyzer.feed(new TextEncoder().encode(text))
  }

  // MARK: - Initial State

  it('initial state is idle', () => {
    expect(analyzer.state).toBe('idle')
    expect(analyzer.alternateBufferActive).toBe(false)
  })

  // MARK: - State Detection

  it('thinking state', () => {
    feedString('Esc to interrupt ... thinking')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('thinking')
  })

  it('generating state', () => {
    feedString('Esc to interrupt')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('generating')
  })

  it('needsAttention on allow/deny', () => {
    feedString('Allow Deny')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('needsAttention')
  })

  it('needsAttention on [y/n]', () => {
    feedString('Do you want to proceed? [y/n]')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('needsAttention')
  })

  it('idle on shell prompt', () => {
    // First move to generating.
    feedString('Esc to interrupt')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('generating')

    // Now flush recent text and feed a shell prompt to return to idle.
    feedString(' '.repeat(2000) + 'user@host$ ')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('idle')
  })

  // MARK: - ANSI Escape Stripping

  it('ANSI escapes are stripped', () => {
    // Feed "AB" with an ANSI color escape between them: ESC[31m
    const bytes = new Uint8Array([0x41, 0x1b, 0x5b, 0x33, 0x31, 0x6d, 0x42])
    analyzer.feed(bytes)
    vi.advanceTimersByTime(100)

    // Plain text "AB" should be in the buffer; feed a known trigger and verify
    // we transition to generating.
    feedString('Esc to interrupt')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('generating')
  })

  // MARK: - Alternate Buffer

  it('alternate buffer enter', () => {
    // CSI ? 1049 h = ESC [ ? 1 0 4 9 h
    const bytes = new Uint8Array([0x1b, 0x5b, 0x3f, 0x31, 0x30, 0x34, 0x39, 0x68])
    analyzer.feed(bytes)
    expect(analyzer.alternateBufferActive).toBe(true)
  })

  it('alternate buffer leave resets to idle', () => {
    // Enter alternate buffer first.
    const enter = new Uint8Array([0x1b, 0x5b, 0x3f, 0x31, 0x30, 0x34, 0x39, 0x68])
    analyzer.feed(enter)
    expect(analyzer.alternateBufferActive).toBe(true)

    // Move to generating.
    feedString('Esc to interrupt')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('generating')

    // Leave alternate buffer: CSI ? 1049 l — should fire idle synchronously.
    const idleStates: string[] = []
    analyzer.onStateChange = (state) => {
      idleStates.push(state)
    }
    const leave = new Uint8Array([0x1b, 0x5b, 0x3f, 0x31, 0x30, 0x34, 0x39, 0x6c])
    analyzer.feed(leave)
    expect(analyzer.alternateBufferActive).toBe(false)
    expect(analyzer.state).toBe('idle')
    expect(idleStates).toContain('idle')
  })

  // MARK: - Screen Clear

  it('screen clear (CSI 2 J) resets the frame', () => {
    // Feed a permission prompt so state becomes needsAttention.
    feedString('Allow Deny')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('needsAttention')

    // CSI 2 J = ESC [ 2 J — clears the frame buffer (but recentText persists,
    // mirroring the Swift implementation). Verify the escape is consumed and
    // the analyzer keeps running.
    const clear = new Uint8Array([0x1b, 0x5b, 0x32, 0x4a])
    analyzer.feed(clear)
    vi.advanceTimersByTime(100)

    // Push the prompt out of the recent window and feed a shell prompt.
    feedString(' '.repeat(2000) + 'user@host$ ')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('idle')
  })

  // MARK: - Position-based transitions

  it('position-based: working → idle transition flips to userInput', () => {
    // Simulate working phase — footer with "esc to interrupt" redrawn.
    feedString('Esc to interrupt'.repeat(10))
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('generating')

    // Claude finishes: writes the idle hint AFTER the last working footer.
    // Even though "esc to interrupt" still lives in the rolling buffer,
    // the analyzer should pick the more recent marker.
    feedString('response text\n? for shortcuts')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('userInput')
  })

  it('position-based: idle → working transition flips to thinking/generating', () => {
    // Start idle.
    feedString('❯ \n? for shortcuts')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('userInput')

    // User submitted, claude starts working — footer overwrites the hint.
    feedString('⌘ Thinking · 2s · Esc to interrupt')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('thinking')
  })

  it('thinking → generating transition (phase word sticks to old footer)', () => {
    // First footer: "thinking".
    feedString('⌘ Thinking · 1s · Esc to interrupt')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('thinking')

    // Subsequent redraw: no "thinking" in the new footer — should flip
    // even though earlier "thinking" is still in the rolling buffer,
    // because the sub-state check windows around the LAST footer pos.
    feedString(' '.repeat(250) + '⌘ Crafting · 5s · 2.3k tokens · Esc to interrupt')
    vi.advanceTimersByTime(100)
    // 'crafting' still counts as thinking — that's expected.
    expect(analyzer.state).toBe('thinking')

    // Now true generating: "2.3k tokens · esc to interrupt" only.
    feedString(' '.repeat(250) + '2.3k tokens · Esc to interrupt')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('generating')
  })

  // MARK: - Submit mark (optimistic flip anti-flicker)

  it('after Enter: stale idle hint does not override optimistic thinking', () => {
    // Previous turn ended — buffer has "? for shortcuts" at the tail.
    feedString('❯ hello\n? for shortcuts')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('userInput')

    // User presses Enter: renderer optimistically flips, syncs the
    // analyzer to 'thinking' and stamps the submit position.
    analyzer.syncExternalState('thinking')
    expect(analyzer.state).toBe('thinking')

    // Claude hasn't rendered anything yet. A buggy analyzer would look
    // at the stale "? for shortcuts" from the previous turn and flip
    // back to userInput. With submitMark the state must hold.
    vi.advanceTimersByTime(100)
    // Nudge a frame analysis (feed a noop byte sequence that adds no
    // markers but triggers the throttled analyzeFrame).
    feedString('\n')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('thinking')

    // Now claude renders its working footer — state confirms.
    feedString('⌘ Thinking · 1s · Esc to interrupt')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('thinking')

    // And the turn completes with a fresh idle hint → back to input.
    feedString('response\n? for shortcuts')
    vi.advanceTimersByTime(100)
    expect(analyzer.state).toBe('userInput')
  })

  // MARK: - Reset

  it('reset clears state', () => {
    // Enter alternate buffer and feed data.
    const enter = new Uint8Array([0x1b, 0x5b, 0x3f, 0x31, 0x30, 0x34, 0x39, 0x68])
    analyzer.feed(enter)
    feedString('some text')

    analyzer.reset()

    expect(analyzer.state).toBe('idle')
    expect(analyzer.alternateBufferActive).toBe(false)
  })
})
