/**
 * Unit tests for AgentHost. We mock `child_process.fork` via the exported
 * `__setFork` hook so the test suite never actually spawns a runner.
 */

import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentHost,
  __setFork,
  type ForkFn,
  type HostToRunnerMessage,
  type RunnerToHostMessage
} from '../agent-host'
import type { Agent, Task, Team } from '../../../shared/orchestra'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1',
    slug: 'acme',
    name: 'Acme',
    worktreePath: '/tmp/acme',
    safeMode: 'prompt',
    defaultModel: 'claude-opus-4-7',
    apiKeyRef: 'default',
    mainAgentId: null,
    canvas: { zoom: 1, panX: 0, panY: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    instanceId: 'team-1',
    teamId: 'team-1',
    slug: 'dev',
    name: 'Dev',
    role: 'dev',
    description: '',
    position: { x: 0, y: 0 },
    model: '',
    maxTokens: 8192,
    soulPath: 'agents/dev/soul.md',
    skillsPath: 'agents/dev/skills.yaml',
    triggersPath: 'agents/dev/triggers.yaml',
    state: 'idle',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    instanceId: 'team-1',
    teamId: 'team-1',
    title: 'Do the thing',
    body: 'Thing description',
    priority: 'P2',
    tags: [],
    status: 'in_progress',
    assignedAgentId: 'agent-1',
    parentTaskId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// Fake child: EventEmitter + `send` + `kill`, enough to satisfy ChildProcess.
// ---------------------------------------------------------------------------

interface FakeChild extends EventEmitter {
  send: (msg: HostToRunnerMessage) => boolean
  kill: (signal?: NodeJS.Signals) => boolean
  killed: boolean
  sent: HostToRunnerMessage[]
  /** Push a runner-to-host message as if the child emitted it. */
  emitFromChild: (msg: RunnerToHostMessage) => void
}

function makeFakeChild(): FakeChild {
  const ee = new EventEmitter() as FakeChild
  ee.killed = false
  ee.sent = []
  ee.send = (msg) => {
    ee.sent.push(msg)
    return true
  }
  ee.kill = (signal?: NodeJS.Signals) => {
    if (ee.killed) return false
    ee.killed = true
    // Simulate async exit.
    queueMicrotask(() => ee.emit('exit', 0, signal ?? null))
    return true
  }
  ee.emitFromChild = (msg) => ee.emit('message', msg)
  return ee
}

function installFakeFork(): { last: () => FakeChild | null; forkSpy: ReturnType<typeof vi.fn> } {
  let last: FakeChild | null = null
  const forkSpy = vi.fn<ForkFn>(() => {
    last = makeFakeChild()
    return last as unknown as ReturnType<ForkFn>
  })
  __setFork(forkSpy as unknown as ForkFn)
  return { last: () => last, forkSpy }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setImmediate(r))
}

// ---------------------------------------------------------------------------
// Host option helpers
// ---------------------------------------------------------------------------

interface HostHarness {
  host: AgentHost
  messages: unknown[]
  states: string[]
  delegates: unknown[]
}

function newHost(opts: {
  onMessage?: (entry: any) => void
  onStateChange?: (next: any) => void
  onDelegate?: (req: any) => Promise<any>
  agent?: Agent
  team?: Team
}): AgentHost {
  return new AgentHost({
    agent: opts.agent ?? makeAgent(),
    team: opts.team ?? makeTeam(),
    apiKey: 'sk-test',
    onMessage: opts.onMessage ?? (() => {}),
    onStateChange: opts.onStateChange ?? (() => {}),
    onDelegate:
      opts.onDelegate ?? (async () => ({ ok: false, error: 'not wired' })),
    runnerPath: '/tmp/fake-runner.js'
  })
}

function makeHarness(): HostHarness {
  const messages: any[] = []
  const states: string[] = []
  const delegates: any[] = []
  const host = newHost({
    onMessage: (entry) => messages.push(entry),
    onStateChange: (s) => states.push(s),
    onDelegate: async (req) => {
      delegates.push(req)
      return { ok: true, taskId: 'sub-1' }
    }
  })
  return { host, messages, states, delegates }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Fresh fork spy per test.
})

afterEach(() => {
  __setFork(null)
})

describe('AgentHost — lifecycle', () => {
  it('start forks once; stop kills the child and returns to idle', async () => {
    const { last, forkSpy } = installFakeFork()
    const { host } = makeHarness()

    await host.start()
    expect(forkSpy).toHaveBeenCalledTimes(1)
    const child = last()
    expect(child).not.toBeNull()
    expect(child!.killed).toBe(false)

    // Second start is a no-op.
    await host.start()
    expect(forkSpy).toHaveBeenCalledTimes(1)

    await host.stop()
    expect(child!.killed).toBe(true)
    expect(host.state).toBe('idle')
  })

  it('passes api key + agent JSON via env to the runner', async () => {
    const { forkSpy } = installFakeFork()
    const team = makeTeam({ id: 'team-x' })
    const agent = makeAgent({ teamId: 'team-x' })
    const host = newHost({ team, agent })
    await host.start()

    const call = forkSpy.mock.calls[0]
    if (!call) throw new Error('fork was not called')
    const options = call[2] as { env: NodeJS.ProcessEnv }
    expect(options.env.ANTHROPIC_API_KEY).toBe('sk-test')
    expect(options.env.HYDRA_AGENT_JSON).toBeTruthy()
    const parsed = JSON.parse(options.env.HYDRA_AGENT_JSON as string)
    expect(parsed.team.id).toBe('team-x')
    expect(parsed.agent.teamId).toBe('team-x')
    expect(options.env.CLAUDE_CONFIG_DIR).toBeUndefined()

    await host.stop()
  })
})

describe('AgentHost — runTask', () => {
  it('rejects second runTask while busy', async () => {
    const { last } = installFakeFork()
    const { host } = makeHarness()
    await host.start()

    const task = makeTask()
    const p1 = host.runTask(task, [])
    // Immediately schedule a second one — must be rejected with 'busy'.
    const p2 = host.runTask(task, [])
    await expect(p2).resolves.toEqual({ ok: false, error: 'busy' })

    // Now resolve the first one via `done`.
    last()!.emitFromChild({ kind: 'done' })
    await expect(p1).resolves.toEqual({ ok: true })
  })

  it('returns ok on done and transitions idle -> running -> idle', async () => {
    const { last } = installFakeFork()
    const { host, states } = makeHarness()
    await host.start()

    expect(host.state).toBe('idle')
    const promise = host.runTask(makeTask(), [])
    expect(host.state).toBe('running')

    last()!.emitFromChild({ kind: 'done' })
    const result = await promise
    expect(result).toEqual({ ok: true })
    expect(host.state).toBe('idle')
    expect(states).toContain('running')
    expect(states).toContain('idle')
  })

  it('returns error when the child crashes mid-task', async () => {
    const { last } = installFakeFork()
    const { host, states } = makeHarness()
    await host.start()
    const promise = host.runTask(makeTask(), [])

    // Simulate child crash.
    last()!.emit('exit', 1, null)
    const result = await promise
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/child exited/)
    expect(host.state).toBe('error')
    expect(states).toContain('error')
  })

  it('errors from the runner are surfaced and state flips to error', async () => {
    const { last } = installFakeFork()
    const { host } = makeHarness()
    await host.start()
    const promise = host.runTask(makeTask(), [])

    last()!.emitFromChild({ kind: 'error', message: 'api exploded' })
    const result = await promise
    expect(result).toEqual({ ok: false, error: 'api exploded' })
    expect(host.state).toBe('error')
  })

  it('runTask before start returns error', async () => {
    installFakeFork()
    const { host } = makeHarness()
    const result = await host.runTask(makeTask(), [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not started/)
  })
})

describe('AgentHost — message forwarding', () => {
  it('forwards runner message events to onMessage callback', async () => {
    const { last } = installFakeFork()
    const { host, messages } = makeHarness()
    await host.start()

    last()!.emitFromChild({
      kind: 'message',
      entry: {
        instanceId: 'team-1',
        teamId: 'team-1',
        taskId: 'task-1',
        fromAgentId: 'agent-1',
        toAgentId: 'broadcast',
        kind: 'output',
        content: 'hello world'
      }
    })
    await flushMicrotasks()
    expect(messages).toHaveLength(1)
    expect((messages[0] as { content: string }).content).toBe('hello world')
  })

  it('propagates runner state updates through onStateChange', async () => {
    const { last } = installFakeFork()
    const { host, states } = makeHarness()
    await host.start()

    last()!.emitFromChild({ kind: 'state', state: 'paused' })
    expect(host.state).toBe('paused')
    expect(states).toContain('paused')
  })
})

describe('AgentHost — delegate', () => {
  it('resolves delegate request through onDelegate and acks back to runner', async () => {
    const { last } = installFakeFork()
    const delegates: any[] = []
    const host = newHost({
      onDelegate: async (req) => {
        delegates.push(req)
        return { ok: true, taskId: 'sub-99' }
      }
    })
    await host.start()

    last()!.emitFromChild({
      kind: 'delegate',
      requestId: 'd1',
      payload: {
        toAgentId: 'agent-2',
        reason: 'needs code review',
        sub: { title: 'Review PR', body: 'Please review', priority: 'P1', tags: [] }
      }
    })
    // Let the async onDelegate settle.
    await flushMicrotasks()
    await flushMicrotasks()

    expect(delegates).toHaveLength(1)
    expect(delegates[0].toAgentId).toBe('agent-2')

    const sent = last()!.sent
    const ack = sent.find((m) => m.kind === 'delegate-response')
    expect(ack).toBeDefined()
    expect(ack!.kind).toBe('delegate-response')
    if (ack!.kind === 'delegate-response') {
      expect(ack!.requestId).toBe('d1')
      expect(ack!.response).toEqual({ ok: true, taskId: 'sub-99' })
    }
  })
})

describe('AgentHost — __setFork test hook', () => {
  it('injected fork is used for every start; clearing restores default', async () => {
    const spy = vi.fn<ForkFn>(() => makeFakeChild() as unknown as ReturnType<ForkFn>)
    __setFork(spy as unknown as ForkFn)

    const host = newHost({})
    await host.start()
    expect(spy).toHaveBeenCalledTimes(1)
    await host.stop()

    // After clearing, ensure __setFork(null) doesn't throw.
    expect(() => __setFork(null)).not.toThrow()
  })
})
