/**
 * AgentHost — owns one forked child process (`agent-runner`) per running
 * Orchestra agent. The host is in the Electron main process; the runner is a
 * Node child with its own lifecycle. All SDK calls and tool execution live in
 * the child so a misbehaving agent cannot crash main.
 *
 * See PLAN.md §4.3 and §8 for the overall architecture.
 *
 * This module is deliberately I/O-light: it doesn't know about the registry,
 * disk layout, or router. Wiring happens one level up in `orchestra/index.ts`.
 */

import { fork as defaultFork, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type {
  Agent,
  AgentState,
  MessageLog,
  SubmitTaskInput,
  Task,
  Team,
  UUID
} from '../../shared/orchestra'

// ---------------------------------------------------------------------------
// IPC message contracts — keep in sync with agent-runner.ts
// ---------------------------------------------------------------------------

/** Messages sent main -> runner. */
export type HostToRunnerMessage =
  | { kind: 'run-task'; task: Task; systemPromptExtras: string[] }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | {
      kind: 'delegate-response'
      requestId: string
      response: DelegateResponse
    }

/** Messages sent runner -> main. */
export type RunnerToHostMessage =
  | { kind: 'ready' }
  | {
      kind: 'message'
      entry: Omit<MessageLog, 'id' | 'at'>
    }
  | { kind: 'state'; state: AgentState }
  | {
      kind: 'delegate'
      requestId: string
      payload: DelegateRequestPayload
    }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export interface DelegateRequestPayload {
  toAgentId: UUID
  reason: string
  sub: Omit<SubmitTaskInput, 'teamId'>
}

export type DelegateResponse =
  | { ok: true; taskId: UUID }
  | { ok: false; error: string }

export type ForkFn = (
  modulePath: string,
  args: readonly string[],
  options: {
    env: NodeJS.ProcessEnv
    stdio: 'pipe' | 'inherit' | 'ignore'
    silent?: boolean
  }
) => ChildProcess

// ---------------------------------------------------------------------------
// Test hook: allow tests to inject a fake fork implementation.
// ---------------------------------------------------------------------------

let forkImpl: ForkFn = defaultFork as unknown as ForkFn

/** Replace the fork implementation. Tests only. */
export function __setFork(next: ForkFn | null): void {
  forkImpl = (next ?? (defaultFork as unknown as ForkFn)) as ForkFn
}

export interface AgentHostOptions {
  agent: Agent
  team: Team
  apiKey: string
  onMessage: (entry: Omit<MessageLog, 'id' | 'at'>) => void
  onStateChange: (next: AgentState) => void
  onDelegate: (
    req: DelegateRequestPayload
  ) => Promise<DelegateResponse>
  /** Override for the compiled runner module path. Default resolves from __dirname. */
  runnerPath?: string
}

type RunTaskResult = { ok: true } | { ok: false; error: string }

interface InflightTask {
  taskId: UUID
  resolve: (result: RunTaskResult) => void
}

// NOTE: `agent-runner.js` must be emitted as a separate main-process entry by
// `electron.vite.config.ts` (alongside `index.js`). Until that wiring lands,
// callers should pass `runnerPath` explicitly. In dev (electron-vite watch),
// the compiled .js lives under `out/main/`.
const DEFAULT_RUNNER_PATH = path.join(__dirname, 'agent-runner.js')

/**
 * AgentHost owns the child's lifecycle. One in-flight task at a time.
 * Subsequent `runTask` calls return `{ ok:false, error:'busy' }` until the
 * current one settles via `done` or `error`.
 */
export class AgentHost {
  private child: ChildProcess | null = null
  private inflight: InflightTask | null = null
  private _state: AgentState = 'idle'
  private readonly pendingDelegates = new Map<
    string,
    (response: DelegateResponse) => void
  >()
  private delegateSeq = 0
  private stopped = false

  constructor(private readonly opts: AgentHostOptions) {}

  get state(): AgentState {
    return this._state
  }

  async start(): Promise<void> {
    if (this.child) return
    const runnerPath = this.opts.runnerPath ?? DEFAULT_RUNNER_PATH
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HYDRA_AGENT_JSON: JSON.stringify({
        agent: this.opts.agent,
        team: this.opts.team
      })
    }
    // Only expose an API key when the caller actually has one — empty
    // string means "user never set one", and the runner should then
    // fall back to spawning `claude -p` with the host's OAuth login.
    if (this.opts.apiKey && this.opts.apiKey.trim().length > 0) {
      env.ANTHROPIC_API_KEY = this.opts.apiKey
    } else {
      delete env.ANTHROPIC_API_KEY
    }
    // Strip CLAUDE_CONFIG_DIR for isolation (see PLAN.md §14) — the CLI
    // path wants ~/.claude, and the SDK path doesn't read it either.
    delete env.CLAUDE_CONFIG_DIR

    const child = forkImpl(runnerPath, [], {
      env,
      stdio: 'pipe',
      silent: true
    })
    this.child = child
    this.stopped = false

    child.on('message', (msg) => this.handleChildMessage(msg as RunnerToHostMessage))
    child.on('exit', (code, signal) => this.handleChildExit(code, signal))
    child.on('error', (err) => this.handleChildError(err))
  }

  async stop(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): Promise<void> {
    this.stopped = true
    if (!this.child) return
    const child = this.child
    try {
      child.kill(signal)
    } catch {
      // Already dead — fall through.
    }
    this.child = null
    this.failInflight('stopped')
    this.setState('idle')
  }

  async pause(): Promise<void> {
    this.send({ kind: 'pause' })
    this.setState('paused')
  }

  async resume(): Promise<void> {
    this.send({ kind: 'resume' })
    // State flips back to 'running' only when the runner confirms via `state`.
    if (this._state === 'paused') this.setState('idle')
  }

  async runTask(
    task: Task,
    systemPromptExtras: string[]
  ): Promise<RunTaskResult> {
    if (!this.child) return { ok: false, error: 'not started' }
    if (this.inflight) return { ok: false, error: 'busy' }

    return await new Promise<RunTaskResult>((resolve) => {
      this.inflight = { taskId: task.id, resolve }
      const ok = this.send({ kind: 'run-task', task, systemPromptExtras })
      if (!ok) {
        this.inflight = null
        resolve({ ok: false, error: 'failed to send run-task to runner' })
      } else {
        this.setState('running')
      }
    })
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private send(msg: HostToRunnerMessage): boolean {
    const child = this.child
    if (!child || !child.send) return false
    try {
      return child.send(msg)
    } catch {
      return false
    }
  }

  private setState(next: AgentState): void {
    if (this._state === next) return
    this._state = next
    try {
      this.opts.onStateChange(next)
    } catch {
      // Ignore callback errors — never let user code kill the host.
    }
  }

  private handleChildMessage(msg: RunnerToHostMessage): void {
    switch (msg.kind) {
      case 'ready':
        // Runner is up; nothing to do until runTask is called.
        break
      case 'message':
        try {
          this.opts.onMessage(msg.entry)
        } catch {
          /* swallow */
        }
        break
      case 'state':
        this.setState(msg.state)
        break
      case 'delegate':
        void this.handleDelegate(msg.requestId, msg.payload)
        break
      case 'done':
        this.resolveInflight({ ok: true })
        this.setState('idle')
        break
      case 'error':
        this.resolveInflight({ ok: false, error: msg.message })
        this.setState('error')
        break
    }
  }

  private async handleDelegate(
    requestId: string,
    payload: DelegateRequestPayload
  ): Promise<void> {
    let response: DelegateResponse
    try {
      response = await this.opts.onDelegate(payload)
    } catch (err) {
      response = { ok: false, error: (err as Error).message ?? 'delegate failed' }
    }
    this.send({ kind: 'delegate-response', requestId, response })
  }

  private handleChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = null
    if (this.stopped) {
      this.failInflight('stopped')
      this.setState('idle')
      return
    }
    const reason = signal ? `signal=${signal}` : `code=${code ?? 'null'}`
    this.failInflight(`child exited (${reason})`)
    this.setState('error')
  }

  private handleChildError(err: Error): void {
    this.failInflight(err.message ?? 'child error')
    this.setState('error')
  }

  private resolveInflight(result: RunTaskResult): void {
    const inflight = this.inflight
    if (!inflight) return
    this.inflight = null
    inflight.resolve(result)
  }

  private failInflight(message: string): void {
    if (!this.inflight) return
    this.resolveInflight({ ok: false, error: message })
  }

  /** Allocate a new delegate request id. Not used yet but kept for future host-side flows. */
  protected nextDelegateId(): string {
    this.delegateSeq += 1
    return `d${this.delegateSeq}`
  }

  /** Expose pending delegates for diagnostics (tests). */
  protected getPendingDelegateCount(): number {
    return this.pendingDelegates.size
  }
}
