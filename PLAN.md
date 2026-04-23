# PLAN — Orchestra Mode Implementation

Status: Draft v1 · 2026-04-21
Depends on: `PRD.md` (read that first for the "why").
Scope: additive, non-destructive, feature-flagged.

---

## 0. Ground Rules

- **Do not change classic Hydra UX.** The classic Dashboard, sessions,
  worktrees, terminals, watchdogs stay untouched. Orchestra is a new
  top-level view, not a competing slide panel.
- **Feature-flag from day one.** A `settings.orchestra.enabled` flag
  in `store.json`, default `false`. Until the flag is on, none of the
  new UI mounts and the new IPC handlers stay registered but inert.
- **No refactors that don't earn their keep.** Add new modules beside
  the existing ones; touch existing files only where the integration
  genuinely requires it (sidebar entry, keybinds registry, `App.tsx`
  route mount).
- **Files are the source of truth.** `soul.md`, `triggers.yaml`,
  `skills.yaml`, team-level `CLAUDE.md` live on disk. The JSON store is
  a cache + index.
- **Ship the MVP loop before anything else.** Create team → drop agent
  → submit task → see it picked up. Everything else comes after.

## 1. Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                         Renderer (React)                           │
│                                                                    │
│  ┌────────────┐  ┌───────────┐  ┌────────────┐  ┌──────────────┐   │
│  │ Classic    │  │ Orchestra │  │  Shared    │  │ Shared state │   │
│  │ (existing) │  │  (new)    │  │  primitives│  │ (zustand)    │   │
│  │            │  │           │  │            │  │              │   │
│  │ Dashboard  │  │ Rail      │  │ Monaco     │  │ sessions     │   │
│  │ Sidebar    │  │ Canvas    │  │ xterm      │  │ projects     │   │
│  │ Session    │  │ Inspector │  │ Toasts     │  │ orchestra ←  │   │
│  │ Pane       │  │ TaskBar   │  │            │  │ (new)        │   │
│  └────────────┘  └───────────┘  └────────────┘  └──────────────┘   │
│                          │                                         │
└──────────────────────────┼─────────────────────────────────────────┘
                           │ IPC
┌──────────────────────────┼─────────────────────────────────────────┐
│                     Main process (Electron)                        │
│                                                                    │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────────────┐  │
│  │ Existing:      │ │ OrchestraCore  │ │ Persistence            │  │
│  │ SessionManager │ │   - RouterSvc  │ │ - store.json (extend)  │  │
│  │ PtyManager     │ │   - Registry   │ │ - team folders on disk │  │
│  │ AnalyzerMgr    │ │   - TriggerSvc │ │ - secrets (keychain)   │  │
│  │ JsonlWatcher   │ │   - AgentHost  │ │                        │  │
│  └────────────────┘ └────────────────┘ └────────────────────────┘  │
│                            │                                       │
│                            ▼                                       │
│           ┌────────────────────────────────────────┐               │
│           │ Per-agent AgentHost processes (forks)  │               │
│           │  - Claude Agent SDK client             │               │
│           │  - tool filter / safeMode enforcement  │               │
│           │  - MessageLog emitter via IPC          │               │
│           └────────────────────────────────────────┘               │
└────────────────────────────────────────────────────────────────────┘
                       │ HTTPS
                       ▼
              api.anthropic.com
```

Orchestra **does not use PTYs**. Classic sessions use `node-pty` + the
interactive `claude` CLI; Orchestra agents are headless Node children
(or worker threads for MVP) that speak to the Anthropic API via the
SDK. This keeps the two worlds fully isolated.

## 2. Data Model

All types in a new file `src/shared/orchestra.ts`. Imported by both
main and renderer.

```ts
export type UUID = string
export type ISO = string

export type Priority = 'P0' | 'P1' | 'P2' | 'P3'
export type SafeMode = 'strict' | 'prompt' | 'yolo'
export type AgentState = 'idle' | 'running' | 'paused' | 'error'
export type TaskStatus = 'queued' | 'routing' | 'in_progress'
                       | 'blocked' | 'done' | 'failed'
export type TriggerKind = 'manual' | 'tag' | 'path' | 'event' | 'schedule'
export type DelegationMode = 'auto' | 'approve'

export interface Team {
  id: UUID
  slug: string                  // kebab-case, used as folder name
  name: string
  worktreePath: string          // absolute, MUST be within a git repo
  safeMode: SafeMode
  defaultModel: string          // claude-opus-4-7 etc.
  apiKeyRef: string             // 'default' for MVP
  mainAgentId: UUID | null
  canvas: { zoom: number; panX: number; panY: number }
  createdAt: ISO
  updatedAt: ISO
}

export interface Agent {
  id: UUID
  teamId: UUID
  slug: string
  name: string
  role: string
  description: string
  position: { x: number; y: number }
  color?: string
  model: string                 // overrides Team.defaultModel if set
  maxTokens: number             // default 8192
  soulPath: string              // relative to team folder
  skillsPath: string
  triggersPath: string
  state: AgentState
  lastActiveAt?: ISO
  createdAt: ISO
}

export interface Skill {
  name: string
  tags: string[]
  weight: number                // [0.5, 2.0]
  description?: string
}

export interface Trigger {
  id: UUID
  kind: TriggerKind
  pattern: string               // glob / tag name / event name / cron
  priority: number              // integer, higher wins
  when?: string                 // optional filter expression
  enabled: boolean
}

export interface ReportingEdge {
  id: UUID
  teamId: UUID
  parentAgentId: UUID
  childAgentId: UUID
  delegationMode: DelegationMode
}

export interface Task {
  id: UUID
  teamId: UUID
  title: string
  body: string
  priority: Priority
  tags: string[]
  sourceEvent?: { type: string; payload: Record<string, unknown> }
  status: TaskStatus
  assignedAgentId: UUID | null
  parentTaskId: UUID | null
  blockedReason?: string
  createdAt: ISO
  updatedAt: ISO
  finishedAt?: ISO
}

export interface Route {
  id: UUID
  taskId: UUID
  chosenAgentId: UUID
  candidateAgentIds: UUID[]
  score: number
  reason: string
  at: ISO
}

export interface MessageLog {
  id: UUID
  teamId: UUID
  taskId: UUID | null
  fromAgentId: UUID | 'system' | 'user'
  toAgentId: UUID | 'broadcast'
  kind: 'delegation' | 'status' | 'output' | 'error' | 'approval_request'
  content: string
  at: ISO
}

export interface OrchestraSettings {
  enabled: boolean              // feature flag
  apiKeyProvider: 'keychain' | 'safeStorage'
  onboardingDismissed: boolean
}
```

## 3. Persistence

### 3.1 JSON store extension

Extend `StoreShape` in `src/main/store.ts`:

```ts
interface StoreShape {
  // existing
  sessions: SessionMeta[]
  projects: SavedProject[]
  toolkit: ToolkitItem[]
  watchdogs: WatchdogRule[]

  // new
  orchestra?: {
    settings: OrchestraSettings
    teams: Team[]
    agents: Agent[]
    edges: ReportingEdge[]
    tasks: Task[]                // in-flight + recent (capped at 500)
    routes: Route[]              // capped at 500
    messageLog: MessageLog[]     // capped at 2000; overflow -> disk per team
  }
}
```

Fields are optional; the loader already merges with defaults, so users
coming from v0.1.3 silently get an empty `orchestra` on first write.

### 3.2 Files on disk

```
~/.hydra-ensemble/
├── orchestra/
│   ├── metrics/
│   │   └── usage.log
│   └── teams/
│       └── <team-slug>/
│           ├── CLAUDE.md          # shared team prompt
│           ├── team.meta.json     # redundant cache of Team
│           └── agents/
│               └── <agent-slug>/
│                   ├── soul.md
│                   ├── triggers.yaml
│                   └── skills.yaml
└── secrets/
    └── anthropic.enc              # only when keychain unavailable
```

### 3.3 Read-through / write-through

- When an agent runs, its `soul.md`, `triggers.yaml`, `skills.yaml` are
  **re-read from disk** each turn. The store is never authoritative for
  those files.
- When the inspector UI saves, it writes file first, then updates the
  store cache (so the canvas refreshes without re-parsing YAML).
- A chokidar watcher on `~/.hydra-ensemble/orchestra/teams` detects
  external edits and refreshes the inspector with a *"reloaded from
  disk"* indicator.

### 3.4 Migrations

None needed for MVP (purely additive fields). Reserve
`store.orchestra.schemaVersion = 1` for future use.

## 4. Backend (main process)

### 4.1 New modules

```
src/main/orchestra/
├── index.ts                  # wires everything, exports OrchestraCore
├── registry.ts               # Team/Agent/Edge CRUD, validates DAG
├── router.ts                 # Task routing algorithm
├── trigger-engine.ts         # Trigger matching + score calculation
├── agent-host.ts             # Spawns one SDK child per agent
├── message-log.ts            # Append + cap + flush to disk
├── disk.ts                   # Team folder I/O, YAML parsing
├── secrets.ts                # keychain / safeStorage abstraction
└── __tests__/
```

### 4.2 OrchestraCore

`OrchestraCore` is the injectable facade the IPC layer calls. It owns:

- `registry: OrchestraRegistry`
- `router: TaskRouter`
- `hosts: Map<AgentId, AgentHost>`
- `log: MessageLog`

Lifecycle: instantiated once from `src/main/index.ts`, attached to the
Electron window, shuts down on `before-quit` (sends SIGTERM to each
`AgentHost` and flushes the log).

### 4.3 AgentHost

One `AgentHost` per running agent. MVP implementation uses
`child_process.fork` of a small `agent-runner.ts` that:

1. Reads the agent's `soul.md`, `skills.yaml`, `triggers.yaml`, team
   `CLAUDE.md` (merged system prompt in this order: team CLAUDE.md →
   soul.md → task context).
2. Opens a Claude Agent SDK client bound to the team's API key (read
   from keychain at spawn time).
3. Listens on IPC for `runTask({ task })`; on receipt, runs the SDK
   conversation loop, streams events back to main via IPC
   (`messageLog:append` events).
4. On delegate tool call: emits `delegate:request` back to main; main
   validates the target is reachable in the DAG; main answers
   `delegate:ack` or `delegate:reject`.
5. On approval tool call (safeMode `strict`): emits `approval:request`;
   UI shows approval card; user answers; main forwards to agent.

A worker-thread alternative is cheaper but limits safeMode isolation.
MVP uses fork; revisit for perf if >20 concurrent agents per team.

### 4.4 Router (see also §7)

### 4.5 Trigger engine (see also §6)

### 4.6 Secrets

- Primary path: `keytar.setPassword('hydra-ensemble', 'anthropic-api-key', v)`
- Fallback: `safeStorage.encryptString(v)` → write to
  `~/.hydra-ensemble/secrets/anthropic.enc` with `chmod 0600`.
- Reads: `readApiKey()` tries keychain first, then disk, throws if
  neither works. Never logs the key.

## 5. Frontend (renderer)

### 5.1 New folder

```
src/renderer/orchestra/
├── OrchestraView.tsx            # top-level layout (rail + canvas + inspector)
├── TeamRail.tsx                 # left 220px column
├── Canvas.tsx                   # react-flow wrapper, keyboard shortcuts
├── AgentCard.tsx                # custom react-flow node
├── ReportingEdge.tsx            # custom react-flow edge
├── TaskBar.tsx                  # bottom input + priority + tags
├── TaskChip.tsx                 # animated flying task card
├── Inspector/
│   ├── index.tsx                # 5-tab container
│   ├── IdentityTab.tsx
│   ├── SoulTab.tsx              # Monaco over soul.md
│   ├── SkillsTab.tsx
│   ├── TriggersTab.tsx
│   └── RuntimeTab.tsx
├── modals/
│   ├── ApiKeyModal.tsx
│   ├── DeleteTeamModal.tsx
│   └── NewAgentPopover.tsx
└── state/
    └── orchestra.ts             # zustand slice
```

### 5.2 State

```ts
interface OrchestraState {
  // persisted via IPC mirroring of store.orchestra
  settings: OrchestraSettings
  teams: Team[]
  agents: Agent[]
  edges: ReportingEdge[]
  tasks: Task[]
  routes: Route[]

  // view-local
  activeTeamId: UUID | null
  selectedAgentIds: UUID[]
  inspectorOpen: boolean
  taskDrawerTaskId: UUID | null

  // actions
  createTeam(input: NewTeamInput): Promise<void>
  createAgent(teamId: UUID, input: NewAgentInput): Promise<void>
  connectAgents(teamId: UUID, parentId: UUID, childId: UUID): Promise<void>
  submitTask(teamId: UUID, input: NewTaskInput): Promise<void>
  pauseAgent(agentId: UUID): Promise<void>
  stopAgent(agentId: UUID): Promise<void>
  // ...
}
```

Live updates flow through an IPC channel
`orchestra:event` dispatching one of: `team.changed`, `agent.changed`,
`task.changed`, `route.added`, `messageLog.appended`.

### 5.3 Canvas library

**react-flow (`@xyflow/react`, latest).** Rationale:

- Mature, Tailwind-friendly.
- Custom nodes + edges are first-class.
- Built-in pan / zoom / select / keyboard focus.
- Accessibility hooks available.

Bundled behind a dynamic import inside `OrchestraView.tsx` so classic
Hydra pays nothing when Orchestra is off.

### 5.4 Integration points in existing files

| File | Change |
|---|---|
| `src/renderer/App.tsx` | Render `<OrchestraView />` when the new "orchestra" top-level route is active. Guard behind `settings.orchestra.enabled`. |
| `src/renderer/state/keybinds.ts` | Add `orchestra.open` action, default `mod+shift+a`. |
| `src/renderer/components/Sidebar/*` | Add "Orchestra" entry below existing entries. Hide when flag off. |
| `src/main/index.ts` | Instantiate `OrchestraCore`, register IPC. |
| `src/main/store.ts` | Extend `StoreShape` as in §3.1. |
| `src/shared/types.ts` | Re-export `./orchestra.ts` shared types. |
| `src/preload/index.ts` | Add `window.api.orchestra` namespace. |
| `package.json` | `@xyflow/react`, `keytar`, `js-yaml`, `chokidar`, `@anthropic-ai/sdk`. |

No other existing file is touched in MVP.

## 6. Trigger Engine

### 6.1 YAML schema

One file per agent at `triggers.yaml`:

```yaml
- id: t_01j…                    # auto-inserted on save
  kind: manual
  priority: 0
  enabled: true

- kind: tag
  pattern: review
  priority: 8

- kind: path
  pattern: "internal/domain/**/*.go"
  priority: 6

- kind: event                   # shape-only in MVP, does not fire
  pattern: pr.opened
  when: "author != me"
  priority: 9

- kind: schedule                # shape-only in MVP
  pattern: "0 9 * * 1-5"
  priority: 3
```

Parsed with `js-yaml`. Missing IDs get a ULID injected on save.

### 6.2 Matching rules

- `manual` — matches only if the task has `assignedAgentId` set to this
  agent already (user typed `@agent`), or if no other rule matched.
- `tag` — matches if `pattern` appears in `task.tags`.
- `path` — uses `minimatch`. In MVP matches only against paths the
  user puts in the task body after `path:` tokens (e.g.
  `path: internal/domain/delivery/foo.go`). Proper path extraction is
  v2.
- `event` — **disabled in MVP**: router logs a `route.note` when a task
  carries `sourceEvent` but the trigger kind is scheduled for v2.
- `schedule` — **disabled in MVP** (no scheduler loop yet).

### 6.3 Score formula

```
score(trigger, task) = (match ? trigger.priority : 0)
                     + skillBoost(agent, task.tags)
                     + recencyPenalty(agent)

skillBoost = sum(skill.weight for skill in agent.skills if skill.name in task.tags)
recencyPenalty = -0.5 * minutesSinceLastActive / 60   (caps at -3)
```

Recency penalty nudges tasks toward agents that haven't worked
recently — serves as natural load balancing.

## 7. Task Router

### 7.1 Algorithm

```ts
async function route(task: Task): Promise<Route> {
  const agents = registry.agentsOfTeam(task.teamId).filter(a => a.state !== 'paused')
  const candidates: Array<{ agent: Agent; score: number }> = []

  for (const agent of agents) {
    const triggers = await disk.readTriggers(agent)
    let best = 0
    for (const t of triggers) {
      if (!t.enabled) continue
      const s = triggerEngine.score(t, agent, task)
      if (s > best) best = s
    }
    if (best > 0) candidates.push({ agent, score: best })
  }

  if (candidates.length === 0) {
    const main = registry.mainOf(task.teamId)
    if (!main) throw new Error('no main agent set')
    return recordRoute(task, main, 0, 'fallback:no-match')
  }

  candidates.sort((a, b) =>
    b.score - a.score
    || lastActiveAtAsc(a.agent, b.agent)
  )
  const chosen = candidates[0]
  return recordRoute(task, chosen.agent, chosen.score, 'scored')
}
```

### 7.2 Queue + priority

Each agent has its own FIFO priority queue (`P0 > P1 > P2 > P3`). P0
preempts: the currently running task is suspended, its in-flight turn
completes, then the queue resumes with P0 at head.

### 7.3 Delegation

When an agent emits a `delegate_task` tool call:

```ts
function handleDelegate(fromId: UUID, toId: UUID, reason: string, sub: NewTaskInput) {
  const reachable = registry.descendants(fromId) // BFS through edges
  if (!reachable.has(toId)) {
    return { ok: false, error: 'target not reachable in DAG' }
  }
  const subtask = createTask({ ...sub, parentTaskId: task.id, teamId: task.teamId })
  // route subtask to `toId` directly (skip trigger matching)
  route.force(subtask, toId, 'delegation:' + fromId)
  return { ok: true, taskId: subtask.id }
}
```

The parent task's state flips to `blocked` with reason
`"waiting on <child name>"` until the subtree settles.

## 8. SDK Integration

- `@anthropic-ai/sdk` — direct client in `agent-runner.ts`.
- **Tool filter**: before every tool call we intercept in
  `agent-runner`, we check:
  - The tool name against the agent's allowlist (`skills.yaml` and
    safeMode rules).
  - The arguments against the `cwd` lock (no paths outside
    `team.worktreePath`).
- **System prompt build order**:
  1. Team `CLAUDE.md` (if file exists).
  2. Agent `soul.md`.
  3. Ephemeral per-turn suffix (task description + tags +
     reporting-chain info).
- **Model**: `agent.model ?? team.defaultModel`.
- **Context budget**: `agent.maxTokens`; default 8192.

### 8.1 Conversation loop sketch

```ts
async function runTask(agent: Agent, task: Task) {
  const sys = await buildSystemPrompt(agent, task)
  let messages = [initialUserMessage(task)]
  for (;;) {
    const resp = await anthropic.messages.create({
      model: agent.model, max_tokens: agent.maxTokens, system: sys,
      messages, tools: toolsFor(agent), tool_choice: 'auto',
    })
    appendMessageLog({ agent, task, resp })
    if (resp.stop_reason === 'end_turn') break
    if (resp.stop_reason === 'tool_use') {
      const result = await executeToolCalls(resp.content, { agent, task })
      messages = messages.concat(result.messages)
      if (result.delegated) break          // handoff to other agent
      if (result.awaitingApproval) break   // pause until user decides
    }
  }
}
```

## 9. Canvas Implementation Notes

- Single `ReactFlow` instance inside `Canvas.tsx`.
- Custom node type `"agent"` registered once. Renders `<AgentCard />`.
- Custom edge type `"reporting"` registered once. Default edge style
  uses Hydra's `--border-strong`.
- `onConnect` validates:
  - Target is not source.
  - No cycle would be created (BFS from target forward; fail if
    source is hit).
- `onNodesChange`, `onEdgesChange` funnel through zustand actions
  rather than mutating react-flow state directly; IPC write-through.

## 10. IPC Contract

Namespace `orchestra` under `window.api`:

| Method | Params | Returns |
|---|---|---|
| `settings.get` | — | `OrchestraSettings` |
| `settings.set` | `Partial<OrchestraSettings>` | `void` |
| `team.list` | — | `Team[]` |
| `team.create` | `{ name, worktreePath, safeMode, defaultModel }` | `Team` |
| `team.rename` | `{ id, name }` | `void` |
| `team.setSafeMode` | `{ id, safeMode }` | `void` |
| `team.delete` | `{ id }` | `void` |
| `agent.create` | `{ teamId, position, preset?, name, role, model }` | `Agent` |
| `agent.update` | `{ id, patch }` | `void` |
| `agent.delete` | `{ id }` | `void` |
| `agent.promoteMain` | `{ id }` | `void` |
| `agent.pause` | `{ id }` | `void` |
| `agent.stop` | `{ id }` | `void` |
| `edge.create` | `{ teamId, parentId, childId, delegationMode }` | `ReportingEdge` |
| `edge.delete` | `{ id }` | `void` |
| `task.submit` | `{ teamId, title, body, priority, tags }` | `Task` |
| `task.cancel` | `{ id }` | `void` |
| `task.list` | `{ teamId }` | `Task[]` |
| `messageLog.forTask` | `{ taskId }` | `MessageLog[]` |
| `apiKey.set` | `{ value, storage: 'keychain' \| 'safeStorage' }` | `void` |
| `apiKey.test` | — | `{ ok: boolean, error?: string }` |
| `apiKey.clear` | — | `void` |
| `event` subscribe | — | stream of `OrchestraEvent` |

All methods return `Promise<{ ok: true; value: T } | { ok: false; error: string }>`
for consistency with existing Hydra conventions.

## 11. Testing Strategy

- **Unit tests** (Vitest, `src/main/orchestra/__tests__/`):
  - `trigger-engine.test.ts` — score formula, match rules, YAML parsing,
    malformed YAML handling.
  - `router.test.ts` — single match, multiple matches, priority
    queue, P0 preemption, delegation DAG validation, cycle rejection.
  - `registry.test.ts` — CRUD + DAG invariants + main-agent selection.
  - `secrets.test.ts` — keychain fallback to safeStorage, redaction
    in logs.
  - `message-log.test.ts` — cap + overflow flush to disk.

- **Integration** (main-process harness, no UI):
  - `orchestra.e2e.test.ts` — spawn a fake AgentHost that echoes, feed
    it a task, assert route + log + state transitions.

- **Renderer** (`@testing-library/react`):
  - Inspector tabs render from fixture.
  - Canvas renders nodes + edges from a team fixture.
  - ApiKeyModal flows validate/store.

- **Manual smoke**: checklist in `.claude/docs/orchestra-smoke.md`
  ("drop two agents, wire them, submit task, watch it run on live API").

## 12. Phase-by-Phase Delivery

Each phase leaves the app in a shippable state. Merge to `master` at
each phase boundary.

### Phase 0 — Groundwork (1 PR)

- Add feature flag `settings.orchestra.enabled` in `store.json`
  (default false).
- Add shared types `src/shared/orchestra.ts`.
- Add empty `src/main/orchestra/` and `src/renderer/orchestra/` folders
  with README stubs.
- Add `@xyflow/react`, `keytar`, `js-yaml`, `chokidar`,
  `@anthropic-ai/sdk` to package.json.
- No UI changes visible.
- **Exit**: typecheck, tests still pass, zero user-visible change.

### Phase 1 — Empty Orchestra view behind flag (1 PR)

- New sidebar entry under flag.
- Keybind `mod+shift+a` under flag.
- `OrchestraView` renders the three-column skeleton (Rail / Canvas /
  Inspector) with placeholder content.
- No persistence, no router, no agents yet.
- **Exit**: user toggles flag on, sees the empty view, can toggle
  back with `mod+d` and everything classic works.

### Phase 2 — API key modal + storage (1 PR)

- Keychain + safeStorage fallback module `main/orchestra/secrets.ts`.
- `ApiKeyModal` with validate button.
- Open Orchestra with no key → modal appears; after validation, key
  is stored and modal closes.
- **Exit**: user can set/rotate a key; it survives restart; it
  survives setting removal of `store.json`.

### Phase 3 — Team CRUD + disk layout (1 PR)

- `registry.ts` (Team portion only).
- `disk.ts` to create team folder skeleton on `team.create`.
- `TeamRail.tsx` fully functional: create, rename, delete.
- No agents yet.
- **Exit**: user creates 3 teams, restarts app, sees them all.

### Phase 4 — Agent CRUD + canvas (1 PR)

- Canvas with react-flow, custom AgentCard node.
- New Agent popover (MVP preset list + blank).
- Drag to move, delete key to remove (with confirm).
- First agent promoted to main automatically.
- Inspector **Identity** tab only. Other tabs stubbed.
- **Exit**: user drops agents, moves them around, sees them persist.

### Phase 5 — Reporting edges + DAG (1 PR)

- `ReportingEdge` custom edge, drag-to-connect with 4 anchors.
- Cycle validation with visual feedback.
- Edge popover for `delegationMode`.
- Inspector shows live incoming/outgoing counts.
- **Exit**: user builds a 5-node team, saves, reopens, same graph.

### Phase 6 — Soul, Skills, Triggers authoring (1 PR)

- Monaco integration for `soul.md`.
- YAML editors for `skills.yaml` and `triggers.yaml`, with live parse
  errors.
- File watcher surfaces "reloaded from disk" pip.
- **Exit**: user authors one agent end-to-end; the disk files match
  expectations.

### Phase 7 — Trigger engine + router (no agent execution yet) (1 PR)

- `trigger-engine.ts` and `router.ts`.
- `task.submit` creates a task, computes a route, writes a Route
  entry, sets `task.assignedAgentId`, but does NOT spawn any agent.
- Task bar + task drawer + route explanation UI.
- **Exit**: user submits a task, sees "routed to X (reason: ...)",
  can inspect candidates.

### Phase 8 — AgentHost + SDK execution (1 PR, the big one)

- `agent-runner.ts` forked process with SDK client.
- Streaming MessageLog entries via IPC.
- Basic tool filter (cwd lock + a minimal tool allowlist: read, edit,
  bash inside the worktree).
- safeMode `prompt` (the default) with approval card UI.
- **Exit**: user drops one agent, submits "say hi", agent responds
  and log shows the exchange.

### Phase 9 — Delegation (1 PR)

- Delegate tool wired up.
- Sub-task creation, DAG validation, parent `blocked` state.
- UI animation for task traversal along edges.
- **Exit**: two-agent topology (PM + Reviewer) can actually delegate.

### Phase 10 — Failure handling + observability (1 PR)

- Error surfacing on cards.
- MessageLog drawer finalised.
- Misroute flagging and weight halving.
- **Exit**: induced crashes and misroutes produce clear UX.

### Phase 11 — Flag flip to default-on (0 code, 1 version bump)

- After 2 weeks of manual use without regressions, `settings.orchestra.enabled`
  defaults to `true` in new installs.
- Release notes called out.

## 13. Migration & Compat

- First-boot of a post-Phase-0 binary on a pre-Phase-0 store: loader
  merges missing `orchestra` key with defaults. No migration script
  needed.
- Downgrade: if user reverts to a pre-Phase-0 binary, extra
  `orchestra` keys in `store.json` are ignored by the old loader.
  Team folders on disk are untouched. No data loss.

## 14. Security Checklist

- [ ] API key never stored in `store.json` or `localStorage`.
- [ ] API key never logged (zerolog equivalent + test).
- [ ] Tool filter rejects any path outside `team.worktreePath`.
- [ ] `rm -rf`, `git push`, outbound non-Anthropic HTTPS gated by
      safeMode `prompt`.
- [ ] Approval requests time out at 5 minutes with explicit deny.
- [ ] Agent child processes run with no elevated privileges; inherit
      user's env minus any `CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY`
      (set fresh from keychain).
- [ ] `.env` files within `team.worktreePath` are readable only via
      the `get_secret` tool, which logs the access and returns a
      redacted stub unless `safeMode = 'yolo'`.

## 15. Open Technical Questions

- **Multiple AgentHosts sharing a worktree**: git operations can race.
  Proposal for MVP: serialise `bash` tool calls per team with a
  per-team mutex in main. Accepts some latency; avoids corruption.
  Revisit with per-agent micro-worktrees in v2.
- **How to surface Anthropic token usage per team**: MVP prints total
  tokens + approximate cost under the team name in the rail, updated
  from `resp.usage` of each SDK call. No hard cap yet.
- **Inspector vs. docking**: Inspector is a right-drawer by default.
  Should it also support a popped-out window? MVP: no, drawer only.
  v2: consider.
- **Persistence of in-flight task when the app is force-killed**:
  MVP accepts "task reverts to queued on next boot if the AgentHost
  was mid-run". A structured resume is v2.

## 16. Deliverables Checklist (MVP)

- [ ] `PRD.md`, `PLAN.md` merged.
- [ ] Phase 0–10 PRs merged behind flag.
- [ ] `.claude/docs/orchestra-smoke.md` checklist.
- [ ] Release notes entry for the first version shipping Orchestra.
- [ ] AUR / winget / package-lock all bumped, same pattern as v0.1.3.
- [x] Settings screen has an "Enable Orchestra (experimental)" toggle.
- [x] README mentions Orchestra with a 3-line blurb + link to PRD.
- [ ] Orchestra works with 10 agents, 1 team, 20 tasks queued, no UI
      jank on M1 / Ryzen-5-class machines.

## 17. Estimation

Rough single-developer, focused hours:

| Phase | Hours |
|---|---|
| 0 Groundwork | 3 |
| 1 Empty view | 4 |
| 2 API key | 6 |
| 3 Team CRUD | 5 |
| 4 Agent canvas | 10 |
| 5 Edges + DAG | 6 |
| 6 Soul/Skills/Triggers UX | 10 |
| 7 Router | 8 |
| 8 AgentHost + SDK | 16 |
| 9 Delegation | 8 |
| 10 Failure UX | 6 |
| Tests + polish | 12 |
| **Total MVP** | **~94 h** |

~12 working days of focus. Could land in two calendar weeks with
parallel PRs but probably lands cleaner in three.

## 18. UX Layer Phases (post-MVP increments)

These phases extend the MVP delivery (§12) with the discoverability and
transparency surfaces described in `PRD.md` §23–§26. They are cut to
merge in any order after Phase 10, each one landing a self-contained
shippable slice.

### Phase 12 — Discovery

Scope: always-visible sidebar entry (dimmed when off / lively when on,
listing first 4 teams + agent counts), StatusBar pill that surfaces
running/error agents, FirstRunToast with the `bootCount >= 5`
heuristic, auto-enable-on-first-keybind behaviour for `Ctrl+Shift+A`,
and the three command-palette entries ("Open Orchestra",
"Enable Orchestra (experimental)", "Disable Orchestra"). No new backend
work — everything here hangs off `settings.orchestra.enabled` and the
existing event stream.

**Exit**: a user who has never touched Orchestra can, from a cold
classic Hydra, get into the workspace in one action via any of: the
sidebar row, the palette, the keybind, or the first-run toast — with
the flag flipping itself on as a side-effect.

### Phase 13 — Settings panel

Scope: the dedicated `SettingsPanel.tsx` with four sections (master
toggle, API key add/rotate/remove with validate-on-save + keychain
preference radio, per-team safeMode cycler with typed confirmation to
enter `yolo`, danger-zone wipe requiring the `DELETE ORCHESTRA`
phrase). Interaction rules: non-master sections are disabled when the
flag is off.

**Exit**: a user can configure everything Orchestra-related without
editing `store.json` or shell-diving into
`~/.hydra-ensemble/secrets/`. Wiping is reversible only by recreating
teams from scratch (as designed).

### Phase 14 — Task drawer + route transparency + approval cards

Scope: right-side `TaskDrawer` (`w-[420px]`) opened by clicking a task
card. Contains the RouteExplain block ("why this agent?" with
candidate scores and tiebreaker label), the merged timeline of Route +
MessageLog entries with sub-task indentation, and inline ApprovalCard
rendering for every `approval_request` entry (Allow/Deny + 5-minute
auto-deny countdown). Footer exposes Cancel task with cascading
sub-task cancellation.

**Exit**: a user can diagnose why a task landed where it did, approve
or deny safeMode prompts without leaving the drawer, and kill a
misbehaving task plus its descendants in one click.

### Phase 15 — Coach marks

Scope: 4-step skippable tour triggered on first entry to the Orchestra
workspace. Steps anchor to `data-coach="team-rail"`,
`data-coach="canvas"`, `data-coach="inspector"`,
`data-coach="task-bar"`. Progress persisted under
`settings.orchestra.coachMarksCompleted`; skipping counts as
completed.

**Exit**: a user opening Orchestra for the first time sees the tour
once, never again, and can exit with `Esc` or the Skip button at any
step.

### Phase 16 — File-IO wiring for inspector tabs

Scope: cabear o IPC real de `soul.md`, `skills.yaml`, `triggers.yaml`
entre o inspector e o disco. The "unwired stub" banner that used to
sit on top of the Soul / Skills / Triggers tabs is removed. Writes
round-trip through `main/orchestra/disk.ts`, reads are re-issued on
chokidar events with the "reloaded from disk" pip. No new schema —
this phase is purely wiring + removing the placeholder UI.

**Exit**: editing a soul in Monaco, hitting blur, and `cat`-ing the
file on disk shows the new content; editing the file from `$EDITOR`
and returning to the inspector shows the external change with the
reload pip.

## 19. Revised Deliverables Checklist

Mirrors §16 but reflects what the UX layer phases (§18) have actually
shipped. Unticked items remain in the v2 backlog.

### Done

- [x] Sidebar entry (always visible; dimmed off, lively on).
- [x] StatusBar pill for running/error agents.
- [x] Dedicated Orchestra settings panel (`SettingsPanel.tsx`) with
      feature flag, API key, per-team safeMode, danger zone.
- [x] TaskDrawer with RouteExplain + merged timeline + Cancel task.
- [x] ApprovalCard inline in the timeline (auto-deny countdown).
- [x] CoachMarks (4-step tour, skippable, `data-coach` anchors).
- [x] Auto-enable on first `Ctrl+Shift+A` press.
- [x] Command palette entries (Open / Enable / Disable Orchestra).
- [x] File I/O IPC cabeado — soul/skills/triggers round-trip to disk.
- [x] README mentions Orchestra with a blurb + link to PRD.
- [x] Settings screen has an "Enable Orchestra (experimental)" toggle.

### Still open

- [ ] Real event triggers (GitHub PR webhooks, CI pipelines).
- [ ] Cron / scheduled trigger engine.
- [ ] Observability timeline (swim lanes / flamegraph).
- [ ] Cross-team messaging.
