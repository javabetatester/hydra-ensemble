import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyzerManager } from '../analyzer-manager'
import type { SessionState } from '../../../shared/types'

/**
 * AnalyzerManager invariants:
 *  1. Every session's analyzer emission carries a strictly monotonic
 *     `generation` counter per sessionId — never decreases across restart
 *     (dispose → re-forSession) cycles.
 *  2. Zombie analyzers (old generations) cannot pollute the fresh one's
 *     channel: post-dispose their callbacks are inert.
 *  3. Sessions are isolated — one session's dispose must never affect
 *     another's generation or in-flight state.
 *  4. `forgetSession` resets the counter so the memory footprint stays
 *     bounded across the app lifetime.
 */
describe('AnalyzerManager', () => {
  let manager: AnalyzerManager
  let emissions: Array<{
    sessionId: string
    state: SessionState
    generation: number
    emittedAt: number
  }>

  // Lightweight fake BrowserWindow stub — only webContents.send is used.
  const makeStubWindow = (): {
    win: import('electron').BrowserWindow
    sends: Array<{ channel: string; payload: unknown }>
  } => {
    const sends: Array<{ channel: string; payload: unknown }> = []
    const win = {
      webContents: {
        send: (channel: string, payload: unknown): void => {
          sends.push({ channel, payload })
        }
      }
    } as unknown as import('electron').BrowserWindow
    return { win, sends }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new AnalyzerManager()
    emissions = []
  })

  afterEach(() => {
    manager.disposeAll()
    vi.useRealTimers()
  })

  function feedInterrupt(analyzer: ReturnType<AnalyzerManager['forSession']>): void {
    analyzer.feed(new TextEncoder().encode('Esc to interrupt'))
    vi.advanceTimersByTime(100)
  }

  function feedIdle(analyzer: ReturnType<AnalyzerManager['forSession']>): void {
    analyzer.feed(new TextEncoder().encode('response\n? for shortcuts'))
    vi.advanceTimersByTime(100)
  }

  it('first spawn for a session emits generation=1', () => {
    const { win, sends } = makeStubWindow()
    manager.attachWindow(win)
    const analyzer = manager.forSession('sess-a')
    feedInterrupt(analyzer)

    const relevant = sends.filter((s) => s.channel === 'session:state')
    expect(relevant.length).toBeGreaterThan(0)
    const last = relevant.at(-1)!.payload as {
      sessionId: string
      generation: number
    }
    expect(last.sessionId).toBe('sess-a')
    expect(last.generation).toBe(1)
  })

  it('restart (dispose + forSession) bumps generation monotonically', () => {
    const { win, sends } = makeStubWindow()
    manager.attachWindow(win)

    const a1 = manager.forSession('sess-a')
    feedInterrupt(a1)
    expect((sends.at(-1)!.payload as { generation: number }).generation).toBe(1)

    manager.dispose('sess-a')
    const a2 = manager.forSession('sess-a')
    feedInterrupt(a2)
    expect((sends.at(-1)!.payload as { generation: number }).generation).toBe(2)

    manager.dispose('sess-a')
    const a3 = manager.forSession('sess-a')
    feedInterrupt(a3)
    expect((sends.at(-1)!.payload as { generation: number }).generation).toBe(3)
  })

  it('forgetSession resets the counter for that id (permanent destroy)', () => {
    const { win, sends } = makeStubWindow()
    manager.attachWindow(win)

    const a1 = manager.forSession('sess-a')
    feedInterrupt(a1)
    expect((sends.at(-1)!.payload as { generation: number }).generation).toBe(1)

    manager.forgetSession('sess-a')

    // Post-forget, a fresh session reusing the id starts over. In practice
    // sessions get fresh UUIDs and this case is rare, but the counter map
    // would otherwise grow unbounded across app lifetime.
    const a2 = manager.forSession('sess-a')
    feedInterrupt(a2)
    expect((sends.at(-1)!.payload as { generation: number }).generation).toBe(1)
  })

  it('zombie analyzer cannot emit after dispose', () => {
    const { win, sends } = makeStubWindow()
    manager.attachWindow(win)

    const zombie = manager.forSession('sess-a')
    // Queue up a frame analysis by feeding bytes — throttle sets a timer.
    zombie.feed(new TextEncoder().encode('Esc to interrupt'))
    // Dispose BEFORE the throttle fires.
    manager.dispose('sess-a')

    const sendsBefore = sends.length
    vi.advanceTimersByTime(500)
    // No new emissions from the disposed analyzer — its frameTimer was
    // cleared and isDisposed blocks any stray entry.
    expect(sends.length).toBe(sendsBefore)
  })

  it('disposing session A does not affect session B generation or emissions', () => {
    const { win, sends } = makeStubWindow()
    manager.attachWindow(win)

    const a = manager.forSession('sess-a')
    const b = manager.forSession('sess-b')

    feedInterrupt(a)
    feedIdle(b)

    const aFirst = sends.find(
      (s) => (s.payload as { sessionId: string }).sessionId === 'sess-a'
    )!.payload as { generation: number }
    const bFirst = sends.find(
      (s) => (s.payload as { sessionId: string }).sessionId === 'sess-b'
    )!.payload as { generation: number }
    expect(aFirst.generation).toBe(1)
    expect(bFirst.generation).toBe(1)

    // Restart only A. B's generation must remain untouched.
    manager.dispose('sess-a')
    const a2 = manager.forSession('sess-a')
    feedInterrupt(a2)
    feedIdle(b)

    const aLast = [...sends]
      .reverse()
      .find((s) => (s.payload as { sessionId: string }).sessionId === 'sess-a')!
      .payload as { generation: number }
    const bLast = [...sends]
      .reverse()
      .find((s) => (s.payload as { sessionId: string }).sessionId === 'sess-b')!
      .payload as { generation: number }
    expect(aLast.generation).toBe(2)
    expect(bLast.generation).toBe(1)
  })

  it('emission payload shape includes sessionId, state, generation, emittedAt', () => {
    const { win, sends } = makeStubWindow()
    manager.attachWindow(win)
    const a = manager.forSession('sess-a')
    feedInterrupt(a)
    const last = sends.at(-1)!.payload as {
      sessionId: string
      state: SessionState
      generation: number
      emittedAt: number
    }
    expect(last.sessionId).toBe('sess-a')
    expect(last.state).toBe('generating')
    expect(last.generation).toBe(1)
    expect(typeof last.emittedAt).toBe('number')
    expect(last.emittedAt).toBeGreaterThan(0)
  })

  it('onAnyStateChange fires alongside IPC and is scoped to sessionId', () => {
    manager.attachWindow(makeStubWindow().win)
    manager.onAnyStateChange = (sessionId, state) =>
      emissions.push({ sessionId, state, generation: 0, emittedAt: 0 })

    const a = manager.forSession('sess-a')
    const b = manager.forSession('sess-b')
    feedInterrupt(a)
    feedIdle(b)

    const aEmit = emissions.find((e) => e.sessionId === 'sess-a')
    const bEmit = emissions.find((e) => e.sessionId === 'sess-b')
    expect(aEmit?.state).toBe('generating')
    expect(bEmit?.state).toBe('userInput')
  })

  it('syncState only touches the requested sessionId', () => {
    manager.attachWindow(makeStubWindow().win)
    const a = manager.forSession('sess-a')
    const b = manager.forSession('sess-b')
    feedIdle(a)
    feedIdle(b)

    // Flip only A via syncState; B's cached state stays put.
    manager.syncState('sess-a', 'thinking')
    expect(a.state).toBe('thinking')
    expect(b.state).toBe('userInput')
  })
})
