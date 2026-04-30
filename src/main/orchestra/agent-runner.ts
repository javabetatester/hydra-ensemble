/**
 * agent-runner — child process forked by AgentHost.
 *
 * Owns the Claude Agent SDK conversation loop for exactly one agent. Talks
 * to the host over `process.send` / `process.on('message')`.
 *
 * See PLAN.md §4.3 and §8.
 *
 * Tool filter (MVP):
 *   - `delegate_task` — handshake back to the host.
 *   - `read_file(path)` / `write_file(path, contents)` — enforced cwd lock
 *     inside `team.worktreePath`.
 *   - `bash(cmd)` — executed with `cwd: team.worktreePath`.
 *
 * safeMode approval UI is the renderer's job and NOT implemented here.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  ContentBlock,
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock
} from '@anthropic-ai/sdk/resources/messages'
import { exec as execCb, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  Agent,
  MessageLog,
  Task,
  Team,
  UUID
} from '../../shared/orchestra'
import type {
  DelegateRequestPayload,
  DelegateResponse,
  HostToRunnerMessage,
  RunnerToHostMessage
} from './agent-host'

const exec = promisify(execCb)

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

const delegateTool: Tool = {
  name: 'delegate_task',
  description:
    'Delegate a sub-task to a direct report. Use ONLY an agent id that ' +
    'appears under "Your direct reports" in your system prompt. After ' +
    'delegating, the child agent takes over — do not keep working on the ' +
    'parent task.',
  input_schema: {
    type: 'object',
    properties: {
      toAgentId: { type: 'string' },
      reason: { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string' },
      priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
      tags: { type: 'array', items: { type: 'string' } }
    },
    required: ['toAgentId', 'reason', 'title', 'body']
  }
}

const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read a UTF-8 file from inside the team worktree.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path within team.worktreePath' }
    },
    required: ['path']
  }
}

const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write (overwrite) a UTF-8 file inside the team worktree.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      contents: { type: 'string' }
    },
    required: ['path', 'contents']
  }
}

const bashTool: Tool = {
  name: 'bash',
  description: 'Run a bash command with cwd pinned to the team worktree.',
  input_schema: {
    type: 'object',
    properties: {
      cmd: { type: 'string' }
    },
    required: ['cmd']
  }
}

const TOOLS: Tool[] = [delegateTool, readFileTool, writeFileTool, bashTool]

// ---------------------------------------------------------------------------
// cwd-lock helpers
// ---------------------------------------------------------------------------

/** Resolve and verify `raw` stays inside `worktreePath`. Throws if not. */
function resolveInsideWorktree(worktreePath: string, raw: string): string {
  const absWorktree = path.resolve(worktreePath)
  const absTarget = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(absWorktree, raw)
  const rel = path.relative(absWorktree, absTarget)
  const outside = rel.startsWith('..') || path.isAbsolute(rel)
  if (outside) throw new Error('path outside worktree')
  return absTarget
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

interface RunnerContext {
  agent: Agent
  team: Team
  /** Non-null only when ANTHROPIC_API_KEY is set and we're on the SDK path. */
  anthropic: Anthropic
  rootDir: string
  /** When false, runConversation hands off to the claude-CLI spawner that
   *  reuses the OAuth login in ~/.claude. Default for users who never
   *  configured an API key. */
  hasApiKey: boolean
}

interface InflightRunState {
  delegateSeq: number
  pendingDelegates: Map<string, (response: DelegateResponse) => void>
}

// ---------------------------------------------------------------------------
// IPC primitives
// ---------------------------------------------------------------------------

function emit(msg: RunnerToHostMessage): void {
  if (!process.send) return
  try {
    process.send(msg)
  } catch {
    // Host is gone — nothing we can do.
  }
}

function logMessage(
  ctx: RunnerContext,
  task: Task | null,
  kind: MessageLog['kind'],
  content: string,
  toAgentId: UUID | 'broadcast' = 'broadcast'
): void {
  emit({
    kind: 'message',
    entry: {
      // Phase 5 of issue #12: instanceId is the canonical owner;
      // teamId is kept as an alias until the rename completes across
      // every consumer (a follow-up PR).
      instanceId: ctx.team.id,
      teamId: ctx.team.id,
      taskId: task?.id ?? null,
      fromAgentId: ctx.agent.id,
      toAgentId,
      kind,
      content
    }
  })
}

// ---------------------------------------------------------------------------
// System prompt build
// ---------------------------------------------------------------------------

async function safeReadFile(p: string): Promise<string> {
  try {
    return await fs.readFile(p, 'utf8')
  } catch {
    return ''
  }
}

async function buildSystemPrompt(
  ctx: RunnerContext,
  task: Task,
  extras: string[],
  opts?: { cliDelegationProtocol?: boolean }
): Promise<string> {
  const teamClaudeMd = await safeReadFile(
    path.join(ctx.team.worktreePath, 'CLAUDE.md')
  )
  const soulAbs = path.join(
    ctx.rootDir,
    'teams',
    ctx.team.slug,
    'agents',
    ctx.agent.slug,
    'soul.md'
  )
  const soul = await safeReadFile(soulAbs)

  const sections: string[] = []
  if (teamClaudeMd.trim()) sections.push(teamClaudeMd.trim())
  if (soul.trim()) sections.push(soul.trim())
  // Topology/context extras go BEFORE the current task so the task is the
  // last — and therefore most salient — section of the system prompt.
  for (const x of extras) if (x?.trim()) sections.push(x.trim())

  // CLI path has no delegate_task tool, so we teach the agent a
  // textual escape hatch: emit a <delegate> block at the end of its
  // turn when the task belongs to a direct report. The runner parses
  // that block post-hoc and kicks off a sub-task through the same
  // handleDelegate path the SDK path uses.
  if (opts?.cliDelegationProtocol) {
    sections.push(
      [
        `# Delegation protocol (text mode)`,
        `You are running without the delegate_task tool. If the current task should`,
        `go to a direct report listed above, finish your turn by emitting EXACTLY`,
        `one <delegate> block per handoff, like this:`,
        ``,
        `<delegate>`,
        `  <toAgentId>the-exact-id-from-your-direct-reports</toAgentId>`,
        `  <reason>one sentence on why this agent</reason>`,
        `  <title>short task title for the child</title>`,
        `  <body>full task body for the child; may span multiple lines</body>`,
        `  <priority>P2</priority>`,
        `</delegate>`,
        ``,
        `Rules:`,
        `- Use ONLY ids that appear under "Your direct reports".`,
        `- No free-form prose between blocks. Place all delegations at the end.`,
        `- If you can answer yourself, DO — don't delegate trivia.`,
        `- After the <delegate> block(s), stop. Your turn is over.`
      ].join('\n')
    )
  }

  sections.push(
    [
      `# Current task`,
      `Title: ${task.title}`,
      `Priority: ${task.priority}`,
      task.tags.length > 0 ? `Tags: ${task.tags.join(', ')}` : '',
      ``,
      task.body
    ]
      .filter(Boolean)
      .join('\n')
  )
  return sections.join('\n\n---\n\n')
}

/** Parses every well-formed <delegate>…</delegate> block out of `text`.
 *  Malformed blocks (missing required field, unknown agent id) are
 *  reported to the caller via the second tuple element so they can
 *  surface a status message rather than failing silent. */
interface ParsedDelegate {
  toAgentId: string
  reason: string
  title: string
  body: string
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  tags: string[]
}

function parseCliDelegations(
  text: string
): { delegations: ParsedDelegate[]; errors: string[] } {
  const delegations: ParsedDelegate[] = []
  const errors: string[] = []
  const blockRe = /<delegate>([\s\S]*?)<\/delegate>/gi
  const fieldRe = (tag: string): RegExp =>
    new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i')

  let match: RegExpExecArray | null
  while ((match = blockRe.exec(text)) !== null) {
    const inner = match[1] ?? ''
    const toAgentId = fieldRe('toAgentId').exec(inner)?.[1]?.trim() ?? ''
    const reason = fieldRe('reason').exec(inner)?.[1]?.trim() ?? ''
    const title = fieldRe('title').exec(inner)?.[1]?.trim() ?? ''
    const body = fieldRe('body').exec(inner)?.[1]?.trim() ?? ''
    const rawPrio = fieldRe('priority').exec(inner)?.[1]?.trim() ?? 'P2'
    const priority = (['P0', 'P1', 'P2', 'P3'] as const).includes(
      rawPrio as 'P0' | 'P1' | 'P2' | 'P3'
    )
      ? (rawPrio as 'P0' | 'P1' | 'P2' | 'P3')
      : 'P2'
    const tagsRaw = fieldRe('tags').exec(inner)?.[1]?.trim() ?? ''
    const tags = tagsRaw
      ? tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : []

    if (!toAgentId || !title || !body) {
      errors.push('delegate block missing toAgentId/title/body')
      continue
    }
    delegations.push({ toAgentId, reason: reason || 'delegated via CLI', title, body, priority, tags })
  }
  return { delegations, errors }
}

/** Strip every <delegate>…</delegate> block from the reply so the
 *  human-readable output doesn't contain the raw XML envelopes. */
function stripDelegateBlocks(text: string): string {
  return text.replace(/<delegate>[\s\S]*?<\/delegate>/gi, '').trim()
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

interface ToolOutcome {
  block: ToolResultBlockParam
  delegated?: boolean
}

async function executeToolUse(
  ctx: RunnerContext,
  task: Task,
  state: InflightRunState,
  block: ToolUseBlock
): Promise<ToolOutcome> {
  const { name, input, id } = block
  const args = (input as Record<string, unknown>) ?? {}
  try {
    switch (name) {
      case 'delegate_task':
        return await runDelegate(ctx, task, state, id, args)
      case 'read_file':
        return runReadFile(id, ctx.team.worktreePath, args)
      case 'write_file':
        return runWriteFile(id, ctx.team.worktreePath, args)
      case 'bash':
        return runBash(id, ctx.team.worktreePath, args)
      default:
        return {
          block: {
            type: 'tool_result',
            tool_use_id: id,
            is_error: true,
            content: `unknown tool: ${name}`
          }
        }
    }
  } catch (err) {
    return {
      block: {
        type: 'tool_result',
        tool_use_id: id,
        is_error: true,
        content: (err as Error).message ?? String(err)
      }
    }
  }
}

async function runDelegate(
  ctx: RunnerContext,
  task: Task,
  state: InflightRunState,
  toolUseId: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const toAgentId = typeof args.toAgentId === 'string' ? args.toAgentId : ''
  const reason = typeof args.reason === 'string' ? args.reason : ''
  const title = typeof args.title === 'string' ? args.title : ''
  const body = typeof args.body === 'string' ? args.body : ''
  const priority = (args.priority as 'P0' | 'P1' | 'P2' | 'P3') ?? 'P2'
  const tags = Array.isArray(args.tags)
    ? (args.tags as unknown[]).filter((t) => typeof t === 'string').map(String)
    : []

  if (!toAgentId || !reason || !title || !body) {
    return {
      block: {
        type: 'tool_result',
        tool_use_id: toolUseId,
        is_error: true,
        content: 'missing required fields: toAgentId, reason, title, body'
      }
    }
  }

  const payload: DelegateRequestPayload = {
    toAgentId,
    reason,
    sub: { title, body, priority, tags }
  }

  state.delegateSeq += 1
  const requestId = `d${state.delegateSeq}`
  const response = await new Promise<DelegateResponse>((resolve) => {
    state.pendingDelegates.set(requestId, resolve)
    emit({ kind: 'delegate', requestId, payload })
  })

  logMessage(
    ctx,
    task,
    'delegation',
    `delegate -> ${toAgentId}: ${reason}`,
    toAgentId
  )

  if (response.ok) {
    return {
      delegated: true,
      block: {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: `delegated. child_task_id=${response.taskId}`
      }
    }
  }
  return {
    block: {
      type: 'tool_result',
      tool_use_id: toolUseId,
      is_error: true,
      content: `delegate rejected: ${response.error}`
    }
  }
}

function runReadFile(
  toolUseId: string,
  worktreePath: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const raw = typeof args.path === 'string' ? args.path : ''
  if (!raw) {
    return Promise.resolve({
      block: {
        type: 'tool_result',
        tool_use_id: toolUseId,
        is_error: true,
        content: 'missing path'
      }
    })
  }
  let abs: string
  try {
    abs = resolveInsideWorktree(worktreePath, raw)
  } catch (err) {
    return Promise.resolve({
      block: {
        type: 'tool_result',
        tool_use_id: toolUseId,
        is_error: true,
        content: (err as Error).message
      }
    })
  }
  return fs.readFile(abs, 'utf8').then(
    (content) => ({
      block: {
        type: 'tool_result' as const,
        tool_use_id: toolUseId,
        content
      }
    }),
    (err: Error) => ({
      block: {
        type: 'tool_result' as const,
        tool_use_id: toolUseId,
        is_error: true,
        content: err.message
      }
    })
  )
}

function runWriteFile(
  toolUseId: string,
  worktreePath: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const raw = typeof args.path === 'string' ? args.path : ''
  const contents = typeof args.contents === 'string' ? args.contents : ''
  if (!raw) {
    return Promise.resolve({
      block: {
        type: 'tool_result',
        tool_use_id: toolUseId,
        is_error: true,
        content: 'missing path'
      }
    })
  }
  let abs: string
  try {
    abs = resolveInsideWorktree(worktreePath, raw)
  } catch (err) {
    return Promise.resolve({
      block: {
        type: 'tool_result',
        tool_use_id: toolUseId,
        is_error: true,
        content: (err as Error).message
      }
    })
  }
  return fs
    .mkdir(path.dirname(abs), { recursive: true })
    .then(() => fs.writeFile(abs, contents, 'utf8'))
    .then(
      () => ({
        block: {
          type: 'tool_result' as const,
          tool_use_id: toolUseId,
          content: `wrote ${abs} (${contents.length} bytes)`
        }
      }),
      (err: Error) => ({
        block: {
          type: 'tool_result' as const,
          tool_use_id: toolUseId,
          is_error: true,
          content: err.message
        }
      })
    )
}

function runBash(
  toolUseId: string,
  worktreePath: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const cmd = typeof args.cmd === 'string' ? args.cmd : ''
  if (!cmd) {
    return Promise.resolve({
      block: {
        type: 'tool_result',
        tool_use_id: toolUseId,
        is_error: true,
        content: 'missing cmd'
      }
    })
  }
  return exec(cmd, { cwd: worktreePath, timeout: 60_000, maxBuffer: 1_048_576 }).then(
    ({ stdout, stderr }) => ({
      block: {
        type: 'tool_result' as const,
        tool_use_id: toolUseId,
        content: `stdout:\n${stdout}\nstderr:\n${stderr}`.trim()
      }
    }),
    (err: Error & { stdout?: string; stderr?: string }) => ({
      block: {
        type: 'tool_result' as const,
        tool_use_id: toolUseId,
        is_error: true,
        content: `${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim()
      }
    })
  )
}

// ---------------------------------------------------------------------------
// Conversation loop
// ---------------------------------------------------------------------------

/**
 * Top-level dispatch: pick the execution backend based on whether an
 * explicit API key was provided. CLI is the default so users who only
 * ever logged in via `claude /login` get Orchestra working out of the
 * box without creating a console.anthropic.com key.
 */
async function runConversation(
  ctx: RunnerContext,
  task: Task,
  extras: string[]
): Promise<void> {
  // Per-agent provider wins; 'inherit' (or undefined) falls back to
  // 'API key when available, else CLI' — the original global default.
  const provider = ctx.agent.provider ?? 'inherit'
  const chosen: 'cli' | 'sdk' =
    provider === 'claude-cli'
      ? 'cli'
      : provider === 'anthropic-api'
        ? 'sdk'
        : ctx.hasApiKey
          ? 'sdk'
          : 'cli'
  if (chosen === 'sdk' && !ctx.hasApiKey) {
    emit({
      kind: 'error',
      message:
        'Agent provider is set to anthropic-api but no ANTHROPIC_API_KEY is configured. Open Providers to add a key or switch this agent to claude-cli.'
    })
    return
  }
  if (chosen === 'cli') {
    await runConversationCli(ctx, task, extras)
    return
  }
  await runConversationSdk(ctx, task, extras)
}

/**
 * Spawn `claude -p` inside the team's worktree. Inherits OAuth
 * credentials from ~/.claude so no API key is required. The CLI runs
 * its full agent loop (tool use, file edits, bash) on its own; we only
 * stream stdout back to the host as output messages.
 */
async function runConversationCli(
  ctx: RunnerContext,
  task: Task,
  extras: string[]
): Promise<void> {
  emit({ kind: 'state', state: 'running' })

  const sys = await buildSystemPrompt(ctx, task, extras, {
    cliDelegationProtocol: true
  })
  const userPrompt = task.body || task.title

  const args = [
    '-p',
    '--append-system-prompt',
    sys,
    '--model',
    ctx.agent.model || ctx.team.defaultModel || 'claude-sonnet-4-6'
  ]

  // Scrub anything that would make the CLI reach for an isolated or
  // stale config dir. Orchestra runs must share the host's ~/.claude so
  // the user's OAuth login is reused.
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.CLAUDE_CONFIG_DIR
  delete env.ANTHROPIC_API_KEY

  const claudeBin = process.env.HYDRA_CLAUDE_PATH?.trim() || 'claude'

  return await new Promise<void>((resolve) => {
    const child = spawn(claudeBin, args, {
      cwd: ctx.team.worktreePath,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    // Pipe the user prompt in via stdin so we don't blow past argv
    // limits on long task bodies.
    child.stdin.write(userPrompt)
    child.stdin.end()

    let stdoutBuf = ''
    let stderrBuf = ''

    // Accumulate stdout silently. We used to emit each line as a
    // separate 'output' MessageLog entry, which flooded the TaskDrawer
    // with 40+ "caixinhas" per reply (every markdown bullet was its own
    // card). Claude -p doesn't stream partial thought either — it
    // prints the full response in one burst at the end — so there's
    // nothing live to show. We emit a single final card in `close`.
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8')
    })

    child.on('error', (err) => {
      emit({
        kind: 'error',
        message:
          `claude CLI spawn failed: ${err.message}. ` +
          `Is the claude binary installed and on PATH?`
      })
      resolve()
    })

    child.on('close', (code) => {
      if (code === 0) {
        const fullReply = stdoutBuf.trim()
        const { delegations, errors } = parseCliDelegations(fullReply)
        // Human-facing reply minus the delegation envelopes so the
        // TaskDrawer card shows prose, not XML.
        const humanReply = stripDelegateBlocks(fullReply)
        if (humanReply) logMessage(ctx, task, 'output', humanReply)

        // Fire-and-forget every parsed delegation. We don't await the
        // delegate-response message because the CLI agent already
        // exited — there's no conversation to resume. Each delegate
        // spins a child task through core.handleDelegate, and the
        // child task routes/runs on its own.
        let seq = 0
        for (const d of delegations) {
          seq += 1
          const requestId = `cli-${Date.now()}-${seq}`
          emit({
            kind: 'delegate',
            requestId,
            payload: {
              toAgentId: d.toAgentId,
              reason: d.reason,
              sub: {
                title: d.title,
                body: d.body,
                priority: d.priority,
                tags: d.tags
              }
            }
          })
          logMessage(
            ctx,
            task,
            'delegation',
            `delegate -> ${d.toAgentId}: ${d.reason}`,
            d.toAgentId
          )
        }

        for (const err of errors) logMessage(ctx, task, 'error', err)

        logMessage(
          ctx,
          task,
          'status',
          delegations.length > 0
            ? `✓ handed off to ${delegations.length} agent(s)`
            : '✓ task complete'
        )
        emit({ kind: 'done' })
      } else {
        const tail = (stderrBuf || stdoutBuf).slice(-300).trim()
        emit({
          kind: 'error',
          message: `claude CLI exited ${code}${tail ? ` — ${tail}` : ''}`
        })
      }
      resolve()
    })
  })
}

async function runConversationSdk(
  ctx: RunnerContext,
  task: Task,
  extras: string[]
): Promise<void> {
  const sys = await buildSystemPrompt(ctx, task, extras)
  const state: InflightRunState = {
    delegateSeq: 0,
    pendingDelegates: new Map()
  }

  const messages: MessageParam[] = [
    { role: 'user', content: task.body || task.title }
  ]

  const model = ctx.agent.model || ctx.team.defaultModel
  const maxTokens = ctx.agent.maxTokens ?? 8192

  emit({ kind: 'state', state: 'running' })

  // Re-route delegate responses into their waiting promise.
  const delegateRouter = (msg: HostToRunnerMessage): void => {
    if (msg.kind !== 'delegate-response') return
    const resolver = state.pendingDelegates.get(msg.requestId)
    if (!resolver) return
    state.pendingDelegates.delete(msg.requestId)
    resolver(msg.response)
  }
  process.on('message', delegateRouter as (m: unknown) => void)

  try {
    for (let turn = 0; turn < 32; turn++) {
      const resp = await ctx.anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: sys,
        messages,
        tools: TOOLS,
        tool_choice: { type: 'auto' }
      })

      messages.push({ role: 'assistant', content: resp.content })

      // Surface text blocks as output messages.
      for (const block of resp.content as ContentBlock[]) {
        if (block.type === 'text' && block.text) {
          logMessage(ctx, task, 'output', block.text)
        }
      }

      if (resp.stop_reason === 'end_turn' || resp.stop_reason === 'stop_sequence') {
        emit({ kind: 'done' })
        return
      }

      if (resp.stop_reason !== 'tool_use') {
        // max_tokens or another terminal reason without a tool call.
        emit({ kind: 'done' })
        return
      }

      const toolUses = (resp.content as ContentBlock[]).filter(
        (b): b is ToolUseBlock => b.type === 'tool_use'
      )
      if (toolUses.length === 0) {
        emit({ kind: 'done' })
        return
      }

      const resultBlocks: ToolResultBlockParam[] = []
      let delegatedBreak = false
      for (const block of toolUses) {
        const outcome = await executeToolUse(ctx, task, state, block)
        resultBlocks.push(outcome.block)
        if (outcome.delegated) delegatedBreak = true
      }
      messages.push({ role: 'user', content: resultBlocks })

      if (delegatedBreak) {
        // Hand-off: the host decides when to wake this agent up again.
        emit({ kind: 'done' })
        return
      }
    }
    emit({ kind: 'error', message: 'turn limit exceeded' })
  } finally {
    process.off('message', delegateRouter as (m: unknown) => void)
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function bootstrap(): RunnerContext {
  const raw = process.env.HYDRA_AGENT_JSON
  if (!raw) throw new Error('HYDRA_AGENT_JSON missing')
  const parsed = JSON.parse(raw) as { agent: Agent; team: Team }
  // API key is now OPTIONAL. When missing, we fall back to spawning
  // `claude -p` which inherits the OAuth login from ~/.claude — that's
  // the default experience users expect because they already logged in
  // via the classic Hydra CLI.
  const apiKey = process.env.ANTHROPIC_API_KEY

  const rootDir = path.join(os.homedir(), '.hydra-ensemble', 'orchestra')

  return {
    agent: parsed.agent,
    team: parsed.team,
    // `anthropic` is lazily instantiated only on the SDK path.
    anthropic: apiKey ? new Anthropic({ apiKey }) : (null as unknown as Anthropic),
    rootDir,
    hasApiKey: !!apiKey
  }
}

export async function main(): Promise<void> {
  let ctx: RunnerContext
  try {
    ctx = bootstrap()
  } catch (err) {
    emit({ kind: 'error', message: (err as Error).message })
    return
  }

  emit({ kind: 'ready' })

  process.on('message', async (msg: unknown) => {
    const m = msg as HostToRunnerMessage
    if (m?.kind === 'run-task') {
      try {
        await runConversation(ctx, m.task, m.systemPromptExtras ?? [])
      } catch (err) {
        emit({ kind: 'error', message: (err as Error).message ?? 'run failed' })
      }
    }
    // 'pause' / 'resume' / 'delegate-response' handled elsewhere or no-op in MVP.
  })
}

// Export internals for tests. `main()` is invoked only when this module is
// the process entry point (i.e., forked by AgentHost).
if (require.main === module) {
  void main()
}

export const __internals = {
  resolveInsideWorktree,
  buildSystemPrompt,
  executeToolUse,
  TOOLS
}
