import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PtyStreamAnalyzer } from '/home/gengar/Templates/workspace2/Hydra/src/main/pty/analyzer'
import { AnalyzerManager } from '/home/gengar/Templates/workspace2/Hydra/src/main/pty/analyzer-manager'

describe('state bleed repro', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('independent PtyStreamAnalyzer instances do not leak state', () => {
    const a = new PtyStreamAnalyzer()
    const b = new PtyStreamAnalyzer()
    const c = new PtyStreamAnalyzer()
    expect(a.state).toBe('idle')
    expect(b.state).toBe('idle')
    expect(c.state).toBe('idle')

    // All three sessions are "thinking" via optimistic flip
    a.syncExternalState('thinking')
    b.syncExternalState('thinking')
    c.syncExternalState('thinking')
    expect(a.state).toBe('thinking')
    expect(b.state).toBe('thinking')
    expect(c.state).toBe('thinking')

    // Session A transitions to userInput via real PTY output
    a.feed(new TextEncoder().encode('\n? for shortcuts'))
    vi.advanceTimersByTime(100)
    expect(a.state).toBe('userInput')

    // B and C must remain thinking — no bytes have been fed to them.
    expect(b.state).toBe('thinking')
    expect(c.state).toBe('thinking')
  })

  it('AnalyzerManager: only the affected sessionId is emitted', () => {
    const sends: Array<{ channel: string; payload: any }> = []
    const win = {
      webContents: { send: (channel: string, payload: unknown) => sends.push({ channel, payload: payload as any }) }
    } as any
    const mgr = new AnalyzerManager()
    mgr.attachWindow(win)
    const a = mgr.forSession('A')
    const b = mgr.forSession('B')
    const c = mgr.forSession('C')

    // All three go to thinking
    mgr.syncState('A', 'thinking')
    mgr.syncState('B', 'thinking')
    mgr.syncState('C', 'thinking')

    // Only A gets fresh bytes
    a.feed(new TextEncoder().encode('\n? for shortcuts'))
    vi.advanceTimersByTime(100)

    // Only A should have a state emission; B and C silent
    const emissions = sends.filter(s => s.channel === 'session:state').map(s => s.payload.sessionId)
    console.log('emissions', emissions)
    expect(emissions.filter(id => id === 'A').length).toBeGreaterThan(0)
    expect(emissions.filter(id => id === 'B').length).toBe(0)
    expect(emissions.filter(id => id === 'C').length).toBe(0)

    mgr.disposeAll()
  })
})
