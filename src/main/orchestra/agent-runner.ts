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
import { exec as execCb } from 'node:child_process'
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
  anthropic: Anthropic
  rootDir: string
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
  extras: string[]
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

async function runConversation(
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
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')

  const rootDir = path.join(os.homedir(), '.hydra-ensemble', 'orchestra')

  return {
    agent: parsed.agent,
    team: parsed.team,
    anthropic: new Anthropic({ apiKey }),
    rootDir
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
