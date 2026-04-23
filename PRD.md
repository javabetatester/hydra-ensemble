# PRD — Hydra Ensemble: Orchestra Mode

Status: Draft v1 · 2026-04-21
Owner: @javabetatester
Scope: additive feature, non-destructive to existing Hydra UX.

---

## 1. Executive Summary

Hydra Ensemble today helps a single user run several Claude Code terminals in
parallel, each in its own git worktree. It is a *terminal multiplexer for
agents*. **Orchestra** turns Hydra into a *small-company simulator*: the user
paints a topology of specialised agents on a canvas, wires reporting lines
between them, gives the team a task, and watches work get routed, delegated,
and completed — without running any single `claude` command by hand.

Orchestra is an **additional view**, not a replacement. The classic Dashboard
(`⌘D`), sessions, worktrees, watchdogs and terminals stay exactly as they are.
Orchestra is reachable via a new sidebar entry and the keybind `⌘⇧A`.

The reference product is [paperclip](https://github.com/paperclipai/paperclip)
(“if OpenClaw is the employee, Paperclip is the company”). Orchestra takes
paperclip's best ideas — single-assignee tasks with atomic checkout,
reporting-chain authorisation, approval gates, first-class skills — and
adapts them for a local, single-user, filesystem-driven desktop app. It
deviates on three points: freeform canvas instead of auto-laid org chart,
multi-manager DAG instead of strict tree, and agent-pull instead of
server-push heartbeats.

## 2. Problem Statement

Today, running N Claude Code sessions in parallel means:

1. Manually opening N terminals (or N Hydra sessions) and remembering which
   one is "the reviewer", which one is "the tester", which one is "the PM".
2. Copy-pasting a task into whichever pane feels right, with no guarantee
   another pane isn't about to start the same work.
3. Re-typing the same persona prompt ("you are a senior Go reviewer…") into
   every fresh session.
4. Losing the entire topology on reboot.

Hydra already fixes (1) and (4) partially (sessions persist, worktrees give
isolation), but the user still picks targets by hand. Orchestra closes the
loop: **the user describes the team once, then submits tasks to the team.**

## 3. Goals & Non-Goals

### Goals (MVP)

- G1. Let a user design an agent topology visually in under 2 minutes.
- G2. Submit a task to a team and see it picked up by the correct agent
  within 10 seconds, with no human routing.
- G3. Each agent honours a shared project `CLAUDE.md` AND its own
  `soul.md` (role + personality + skill hints).
- G4. Delegation between agents respects the reporting graph (no random
  agent can re-assign work to another random agent).
- G5. All state (topology, tasks, logs) survives app restart.
- G6. Coexist with the classic Dashboard at zero UX cost — existing users
  never encounter Orchestra unless they open it.

### Non-Goals (MVP)

- N1. Multi-user / multi-tenant (one user, one machine).
- N2. Cross-team collaboration (teams are isolated; a task in team A never
  flows into team B).
- N3. Real event sources (GitHub PR webhooks, CI pipelines). Event triggers
  ship as a *shape* only; only `manual`, `path`, `tag` fire in MVP.
- N4. Cron / scheduled triggers.
- N5. Community-shared templates, marketplace, export/import of topologies.
- N6. Web version. Orchestra is Electron-only.

## 4. Target Users & Scenarios

### Primary persona — "Principal Dev running 3–8 parallel explorations"

- Solo dev or tech-lead on a small team.
- Already runs multiple Claude CLI sessions daily.
- Wants to offload the *coordination* of those sessions, not the thinking.
- Comfortable with YAML, CLI, git worktrees.

### Secondary persona — "Tinkerer / researcher"

- Wants to experiment with agent-to-agent dynamics.
- Will push N higher (10–20 agents) and stress-test.
- Expects observability (logs, timelines, "why did this agent get picked").

### Scenarios

- **S1. PR review swarm.** Dev opens a worktree with a feature branch. In
  Orchestra, a team "Reviewers" has three agents: Go-lint, security-audit,
  test-gap-finder. Dev drops the PR link into the task bar with tag
  `#review`; each agent picks up its own slice, posts findings, main
  agent ("Lead Reviewer") collates into a single comment.
- **S2. Feature shop.** Team "FeatureFactory": PM → Architect → {Backend
  Dev, Frontend Dev, QA}. User submits "add fresh-account toggle to
  spawn dialog, priority P1". PM breaks it down; Architect writes an
  ADR; Backend + Frontend work in parallel in separate worktrees; QA
  runs tests against both. Each handoff is a delegation in the graph.
- **S3. Bug triage.** A single "Triage" agent has triggers on path
  `src/main/**`. User pastes a stack trace; task auto-routes to Triage;
  Triage delegates to either "Backend Debugger" or "Frontend Debugger"
  depending on file paths extracted from the trace.

## 5. Product Principles

1. **Additive, never subtractive.** Orchestra never touches classic
   Hydra behaviour. If we can't deliver Orchestra, everything else keeps
   working perfectly.
2. **Two minutes to first task.** Empty state → team created → first
   agent dropped → task submitted → agent picks it up, all inside a
   fresh install. If that loop takes more than 2 min, the UX is wrong.
3. **The graph is law.** The reporting DAG isn't decoration. It gates
   delegation, broadcast, and escalation. If it's wrong, behaviour is
   wrong — and the user sees that immediately.
4. **Files are the source of truth.** `soul.md`, `triggers.yaml`, team
   `CLAUDE.md` are plain files on disk. A user can open them in
   `$EDITOR`, commit them, diff them, share them. The JSON store is
   just cache.
5. **Local-first.** No cloud, no telemetry, no accounts. The only
   network call is to `api.anthropic.com` (and only when the user has
   entered a key).
6. **Failure is loud.** A crashed agent, a misrouted task, a trigger
   that matched nothing — all are surfaced as card-level status and a
   log entry. Silent failures are a P0.

## 6. Competitive Context

| Product | Strengths | Why we differ |
|---|---|---|
| paperclip | Strict tree org chart, atomic checkout, approval gates, skill discovery | We're local-first, freeform canvas, single-user. No company wrapping. Agent-pull instead of server-push. |
| LangGraph / CrewAI | Library-level orchestration | Code-only. Zero GUI. We are desktop-first. |
| Multi-tab Claude Code | What users do today | Manual, no memory of topology, no routing. |
| Raycast / Alfred agent plugins | Great shortcut UX | Not persistent, no graph, no parallelism. |

Orchestra sits in the **"desktop IDE for agent teams"** slot — a slot nobody
fills well today.

## 7. Core Concepts & Vocabulary

| Term | Meaning |
|---|---|
| **Team** | Named group of agents sharing a worktree, a `CLAUDE.md`, a safeMode, an API key scope. A user can have many teams. |
| **Agent** | One node on the canvas. Runs as a Claude Agent SDK process. Has role, soul, skills, triggers, model choice. |
| **Role** | Short human-readable job title. "Go Reviewer", "PM", "QA". Does NOT drive behaviour by itself — it's for the human. |
| **Soul** | `soul.md` file. Free-form prompt addendum that gets prepended to the agent's system prompt. This drives behaviour. |
| **Skill** | Tag + optional tool reference. Skills are matched against task tags during routing to boost an agent's score. |
| **Trigger** | One YAML entry that says "wake me when a task has shape X". Kinds: `manual`, `tag`, `path`, `event`, `schedule`. |
| **Task** | One piece of work submitted to a team. Has title, body, priority (P0–P3), tags, optional source event. |
| **Reporting edge** | Directed edge from manager → subordinate on the canvas. The DAG of edges defines who-can-delegate-to-whom. |
| **Main agent** | Team lead. Marked with a crown icon. Default entry point for routed tasks. Can broadcast. |
| **Route** | Log entry explaining *why* a given task was assigned to a given agent (candidate scores, tiebreaker used). |
| **safeMode** | Per-team setting that gates destructive operations: `strict` (every write needs approval), `prompt` (suspicious commands need approval), `yolo` (no prompts, banner warning). |
| **API-key scope** | An Anthropic API key bound to one or more teams. Keys live in the OS keychain. |

## 8. Information Architecture

```
Hydra window
├── Sidebar (left, persistent)
│   ├── Existing: Sessions / Worktrees / Projects
│   └── NEW: "Orchestra" entry + keybind ⌘⇧A
│
├── Main content (right, switcher)
│   ├── Existing: SessionPane / terminals / slide panels
│   └── NEW: Orchestra workspace (fullscreen overlay)
│
└── Orchestra workspace
    ├── Rail (left, 220px): team list, new-team button, settings
    ├── Canvas (center): team-scoped whiteboard
    ├── Inspector (right, collapsible 360px): selected agent details
    └── Bottom bar: task submit (input + priority + tags + send)
```

Orchestra is NOT a slide panel. It takes over the main content region when
open, with a visible "← Back to Classic" button in the top-left. This
matches the "another view, not another competing panel" model the user
explicitly asked for.

## 9. Entry Points

- **Sidebar**: new "Orchestra" row under an existing separator. Icon:
  `Users`/`Network` (lucide).
- **Keybind**: `⌘⇧A` (mac) / `Ctrl+Shift+A` (linux/win). Slot is free in
  current keybinds registry.
- **Command palette** (`⌘K`): "Open Orchestra", "Submit task to team…",
  "Create new team".
- **First-run nudge**: if the user has opened Hydra ≥5 times and never
  opened Orchestra, show a dismissible toast with a 10-second walkthrough
  link.

## 10. UX Flows

### F1. First time entering Orchestra

1. User hits `⌘⇧A` or clicks "Orchestra" in the sidebar.
2. Canvas loads empty. Centred card:
   *"Orchestra runs teams of Claude agents on tasks you submit. To use
   it, Hydra needs an Anthropic API key (separate from your `claude`
   CLI login — here's why)."* + **[Set API key]** / **[Learn more]**.
3. On "Set API key": modal with masked input + "Store in OS keychain
   (recommended)" checkbox. Validate on submit with a single test call
   to `api.anthropic.com/v1/messages` (1-token ping).
4. After key validation: empty state swaps to *"Create your first
   team"* CTA + 3 starter templates (PR Reviewers, Feature Factory,
   Bug Triager) + **[Blank team]**.

### F2. Creating a team + first agent

1. User clicks **[Blank team]** or picks a template.
2. Prompt for team name inline (no modal). Default = "Team 1".
3. Canvas opens. Empty. Bottom bar enabled but disabled with tooltip
   *"Add an agent first"*.
4. Double-click anywhere on the canvas (or click the floating `+`
   button bottom-right) → **New Agent** popover opens at cursor:
   - Preset picker (Reviewer / Dev / QA / PM / Blank).
   - Name field (prefilled from preset).
   - Role field (prefilled).
   - Model dropdown (default: team default, which defaults to
     `claude-opus-4-7`).
   - **[Create]**.
5. Card lands where the user clicked. First agent on the canvas
   becomes the **main agent** automatically (crown icon).
6. On "Create", Hydra creates:
   - `~/.hydra-ensemble/orchestra/teams/<team-slug>/agents/<agent-slug>/soul.md`
   - `.../triggers.yaml`
   - `.../skills.yaml` (empty array)
7. User can open any of these in `$EDITOR` via the inspector's
   "Open in editor" link.

### F3. Wiring a reporting line

1. Hover over a card → 4 anchor dots appear (N/S/E/W).
2. Drag from one anchor → the line rubber-bands toward the cursor.
3. Drop on another card's anchor.
4. Edge is created with arrow pointing source → target (parent → child).
5. If creating this edge would introduce a cycle, the line snaps red
   and a toast says "cycle would be introduced — Orchestra DAG".
6. Click the edge to open a tiny popover with `delegationMode`:
   - `auto`: manager can auto-delegate without approval.
   - `approve`: manager must ask the child to accept before assigning.

### F4. Authoring an agent (soul + skills + triggers)

1. Click any card → right-side **Inspector** slides in (360px).
2. Tabs: **Identity · Soul · Skills · Triggers · Runtime**.
3. **Identity**: name, role, description, model dropdown, color.
4. **Soul**: embedded Monaco editor over `soul.md`. Save on blur.
   A small "Open in editor" button opens the file in `$EDITOR`.
5. **Skills**: tag input with suggestions pulled from team skills
   pool. Each skill has an optional weight [0.5, 2.0] default 1.0.
6. **Triggers**: a list editor that round-trips to `triggers.yaml`.
   Each row is kind + pattern + priority + enabled toggle. Below the
   list, a read-only YAML preview.
7. **Runtime**: current state (idle / running / paused / error),
   last 20 message-log entries, buttons: **Pause**, **Stop**, **Clear
   queue**, **Open worktree in editor**.

### F5. Submitting a task

1. Bottom bar is a 1-line input + priority pill + tags chips + Send.
2. Enter or click Send:
   - Task created with status `queued`.
   - A floating "task card" animates from the bottom bar to the
     main agent's card (or whichever agent the router chose).
   - Edge traversed is highlighted while the task flows (300ms per hop).
3. Target agent's card pulses accent while running. Status line
   under the card shows `PM → Backend Lead → Go Reviewer (P1, 3s)`.
4. Click the task card (now sitting on the agent) → drawer from the
   right with the full timeline: Route entry + every MessageLog so far.

### F6. Watching delegation

1. Agent A receives task T.
2. A decides (via its own reasoning) to delegate. It emits a
   structured tool call `delegate_task({ to: "b", reason: "..." })`.
3. The orchestrator validates that B is reachable from A in the
   reporting DAG. If not, the delegation is rejected and A is told.
4. If valid, a new sub-task `T'` is created with `parentTaskId = T`.
   An animation shows the sub-task flying along the edge A → B.
5. A remains in `running` but its status line flips to
   *"waiting on Go Reviewer"*.

### F7. Pause / kill an agent

1. Inspector → Runtime tab → **Pause** or **Stop**.
2. Pause: agent finishes current turn, then refuses new tasks
   (state = `paused`, queue frozen). New matching tasks bypass it.
3. Stop: SIGTERM to the SDK process. Current task goes back into
   the team queue with status `requeued` + reason `agent_stopped`.
4. A red dot appears on the card. Banner on the canvas:
   *"Agent X was stopped mid-task. Task Y was requeued."* with
   **[Resume agent]** / **[Dismiss]**.

### F8. Switching back to classic Dashboard

- Sidebar → click "Dashboard" (existing entry).
- OR `⌘D`.
- Orchestra state is preserved. Re-entering with `⌘⇧A` returns to
  the same team + selection.

### F9. Onboarding the keyless user who opens Orchestra after first run

Same as F1 but skip the "what is Orchestra" step. Go straight to the
API-key modal with a link to `console.anthropic.com/settings/keys` and
one paragraph explaining the *two authentications* (claude CLI for
classic Hydra; Anthropic API key for Orchestra headless SDK calls).

### F10. Editing a team's shared CLAUDE.md

- Team rail → team name → context menu → "Edit team CLAUDE.md".
- Opens `.../teams/<team-slug>/CLAUDE.md` inline in Monaco.
- Changes propagate on next agent turn (no restart required — the
  file is re-read per agent call).

### F11. Destructive team deletion

- Team rail → right-click → Delete team.
- Confirm modal: *"This will delete the team, all its agents, all
  cached message logs, and the folder at
  `~/.hydra-ensemble/orchestra/teams/<slug>`. This cannot be undone."*
- Requires typing the team name. Only enables Delete button on match.
- Active running tasks are SIGTERM'd first.

### F12. Export / import (v2, documented for continuity)

- Team rail → context → **Export team…** → writes a `.zip` with the
  team folder. Re-importable via **Import team…** which reads the
  zip and creates a new team from it.

## 11. UI Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Hydra  ▸ Orchestra                                        ← Classic     │
├──────┬──────────────────────────────────────────────────┬────────────────┤
│ Teams│                                                  │ Agent Inspector│
│      │                                                  │                │
│ + New│                ┌─────────┐                       │  Identity      │
│ ✔ PR │                │   PM 👑 │                       │  Soul          │
│   Rev│                └────┬────┘                       │  Skills        │
│  Bug │                     │                            │  Triggers      │
│  Tri │            ┌────────┴────────┐                   │  Runtime       │
│      │            │                 │                   │                │
│      │      ┌───▼──┐          ┌───▼──┐                  │  [Pause]       │
│      │      │ BE   │          │ FE   │                  │  [Stop]        │
│      │      │ Lead │          │ Lead │                  │  [Open soul.md]│
│      │      └───┬──┘          └───┬──┘                  │                │
│      │          │                 │                     │                │
│      │      ┌───▼──┐          ┌───▼──┐                  │                │
│      │      │ Go R │          │React │                  │                │
│      │      └──────┘          └──────┘                  │                │
│      │                                                  │                │
├──────┴──────────────────────────────────────────────────┴────────────────┤
│ > Give team a task…                 [P1 ▾] [#backend ×] [+tag]  [ Send ] │
└──────────────────────────────────────────────────────────────────────────┘
```

### Card anatomy

```
┌──────────────────┐
│ 👑 PM            │  ← crown = main agent; icon varies by role
│ Roberto          │  ← name (editable on double-click)
│ ─────────────    │
│ ● running        │  ← state dot + state word
│ → Backend Lead   │  ← sub-status (current action if any)
└──────────────────┘
```

State dot colours:
- grey — idle
- blue (pulsing) — running
- amber — paused
- red — error
- lime (pulsing) — receiving a task (first 500ms of a new assignment)

## 12. Interaction Details

### Canvas

| Gesture | MVP | Notes |
|---|---|---|
| Pan | Space+drag, middle-click-drag | No keyboard pan in MVP |
| Zoom | Ctrl/Cmd + wheel | Clamp 25% – 200% |
| Select | Click / Shift-click / marquee | Marquee is v2 |
| Multi-drag | Shift-click then drag any selected | MVP |
| Delete selected | `Delete` / `Backspace` | Confirm if >1 |
| Snap to grid | Always on, 16px | No toggle in MVP |
| Undo / redo | `⌘Z` / `⌘⇧Z`, 50-step history | Creation, move, edge, edit |
| Fit to screen | `⌘0` | Animated 200ms |
| Quick-add agent | `A` with canvas focused | Opens popover at cursor |
| Quick-add edge | `E` with one card selected | Drag to target |
| Focus task input | `/` | Like GitHub |
| Open inspector | Click card; `Tab` while selected |
| Close inspector | `Esc` |

### Minimap, auto-layout, alignment guides → v2.

### Keyboard-only workflow (accessibility)

- `Tab` cycles agent cards in reading order (top-left → bottom-right).
- `Enter` on a focused card opens the inspector.
- `Space` on a focused card selects / deselects.
- `Arrow` moves the focused selected card 8px.
- `Shift+Arrow` — 1px nudge.
- Edge creation fallback: with card focused, press `E`, then `Tab` to
  target card, `Enter` to commit.

### Dark mode

Orchestra inherits Hydra's tokens (`--bg`, `--surface`, `--border`,
`--accent`). No theme of its own. Edges use `--border-strong`; state dots
use `--accent`/`--warning`/`--danger`/`--success`. Contrast target: WCAG AA.

## 13. Empty States & Onboarding

- **No teams yet**: centred illustration + "Create your first team"
  CTA. 3 starter templates below, each with a one-line description.
- **Team with no agents**: canvas shows dashed outline + tooltip
  *"Double-click to add an agent, or press A"*. Bottom bar disabled.
- **Team with agents but no edges**: info strip top-of-canvas
  *"Wire up reporting lines to enable delegation"*. Dismissible.
- **Team with agents + edges but no main agent set** (edge case where
  the user deletes the only main): canvas shows red banner *"No main
  agent — select a card and click the crown icon to promote"*.
- **First task submitted ever**: a small coach mark *"Watch for the
  pulse on the agent that picks it up"* overlays for 4s.

## 14. API-Key UX

### Why two auths?

Hydra already works with the `claude` CLI using OAuth. Those sessions
talk to Claude via the interactive CLI and share the host's
`~/.claude` credentials. Orchestra agents run **headless** — no
interactive prompt, no OAuth flow — via the Claude Agent SDK, which
needs an Anthropic API key from [console.anthropic.com](
https://console.anthropic.com/settings/keys). They're additive, not
replacements.

### Key modal

- Title: "Anthropic API key for Orchestra"
- Sub-title: "This is separate from your `claude` CLI login. [Why?]"
- Masked input, paste-aware.
- Checkbox **"Store in OS keychain (recommended)"** (default on).
- Test button **"Validate"** that does a 1-token ping to
  `api.anthropic.com/v1/messages`.
- On success: key stored, modal closes.
- On 401: "That key was rejected. Check it's from
  console.anthropic.com/settings/keys."
- On 429 / network: "Couldn't reach Anthropic. Check your network
  and try again."

### Key storage

- Primary: `keytar` (`hydra-ensemble` / `anthropic-api-key`).
- Fallback (keychain unavailable): Electron `safeStorage.encryptString`
  → `~/.hydra-ensemble/secrets/anthropic.enc`, `chmod 0600`.
- Never plaintext, never in `localStorage` or `store.json`.
- Rotation: Settings → Orchestra → API key → **Rotate** reopens the
  modal preloaded; on success, old key overwritten.

### Key scoping

- MVP: one key, used by every team.
- v2: per-team key binding.

## 15. Failure States

| Failure | UX |
|---|---|
| API key missing when Orchestra opens | Blocking modal (F1). |
| API key invalid mid-task | Task status → `failed` with reason `auth_failed`; red toast; Settings shortcut. |
| Network drop during agent turn | Task status → `blocked` with reason `network`; auto-retry with backoff up to 3x; agent stays `running`. |
| Agent SDK process crashes | Card → `error`, task → `failed`; sub-task tree (`parentTaskId`) unwound with reason chain. |
| Trigger misrouted (user marks) | Inspector → Triggers shows a ⚠ on the offending rule; weight halves; task reroutes from manager. |
| Cycle introduced (attempted) | Edge snaps red, toast, change reverted. No state mutation. |
| Two agents collide on same task | Impossible by design (router is single-threaded in main process); if detected, `critical` log + toast. |
| File on disk (`soul.md`, `triggers.yaml`) edited mid-run | Re-read on next turn; inspector shows "reloaded from disk" pip. |
| `triggers.yaml` becomes unparseable | Inspector → Triggers shows red banner with line/col; agent keeps old rules until fixed; does NOT crash. |

## 16. Security & safeMode

Three per-team modes:

- **strict** — every file write and every non-whitelisted shell command
  emits an approval card on the canvas. The agent's turn blocks until
  the user clicks allow/deny. 5-min timeout → auto-deny.
- **prompt** (default) — file reads/edits inside the team's worktree
  are free; `rm -rf`, `git push`, writes outside worktree, outbound
  HTTP to non-Anthropic domains prompt for approval.
- **yolo** — no prompts. Red banner visible on the canvas whenever
  yolo is active. Toggling on requires a typed confirmation.

All agents are `cwd`-locked to `<team-worktree-root>`. The SDK tool
filter rejects paths outside that root. Secrets (the API key, any
`.env` files) are NEVER passed through as tool input — agents must
request them via a dedicated `get_secret` tool that logs the
requester and returns a redacted stub by default.

## 17. Accessibility

- All interactive elements reachable by keyboard; see §12.
- Focus ring uses Hydra's existing `--ring` token.
- State dots are augmented by text labels for screen readers
  (`aria-label="agent PM — running"`).
- Contrast tested AA against both dark and (future) light themes.
- Motion: respects `prefers-reduced-motion`; animations shrink to
  150ms or disappear.

## 18. Performance Budget

- First paint of Orchestra view: ≤ 200ms.
- Canvas with 20 nodes + 30 edges: 60fps on M1 / Ryzen 5.
- react-flow bundle: lazy-loaded behind Orchestra route (target
  ≤ 250KB gzip added to main bundle, 0 to classic Dashboard).
- Agent spawn (SDK process ready to receive): ≤ 1s warm, ≤ 3s cold.
- Task routing decision: ≤ 30ms for ≤ 50 agents.
- Store write debounced 300ms; no synchronous disk I/O on UI thread.

## 19. Telemetry

**Local-only.** A `usage.log` under
`~/.hydra-ensemble/orchestra/metrics/` records counts and durations
per event (task submitted, agent ran, trigger matched, approval
requested). Rotated daily, capped at 30 days.

No external telemetry in MVP. v2 may offer opt-in export for the
user's own analysis.

## 20. Rollout

- Behind a setting "Enable Orchestra (experimental)". Off by default in
  v0.2.0 → v0.3.0, on by default in v0.4.0 once feedback settles.
- Sidebar entry only appears when the setting is on.
- Feature is advertised in the release notes of the version it lands
  in, never via an in-app modal that interrupts classic users.

## 21. Open Questions

- **Multi-parent edges**: ship in MVP or v2? Data model supports it;
  UX wiring (how to drag two inbound edges to one card) is the cost.
  *Recommendation: v2, keep DAG single-parent in MVP.*
- **Shared skills library**: do we ship with 5 starter skills (Go
  review, React review, test gen, etc.) or leave empty?
  *Recommendation: ship with 5, each with a tiny soul.md example.*
- **Per-agent model override**: already in data model; expose in MVP
  UI or only via file edit?
  *Recommendation: dropdown in Inspector → Identity, MVP.*
- **Token budget per team**: paperclip has monthly budgets; do we
  surface this?
  *Recommendation: warning-only in MVP (show spent total in rail),
  hard cap in v2.*

## 22. Out of Scope (v2+)

- Scheduled triggers (cron, real event sources).
- Cross-team messaging.
- Community-shared topology templates.
- Real-time multi-user co-editing.
- Web/remote mode.
- Agent-authored skill creation.
- Observability timeline (swim lanes, flamegraph).
- Strict and yolo safeModes (MVP ships only `prompt`).
- Approval workflows (paperclip's "hire_agent" gate).

## 23. Discovery & Onboarding

Orchestra is opt-in, so discovery has to work without nagging the user.
The following surfaces were shipped to make the feature findable without
adding a modal to the cold-start of classic Hydra.

### 23.1 Sidebar entry (always visible)

The Orchestra row sits below the existing Sessions / Worktrees / Projects
entries and is **always rendered**, regardless of
`settings.orchestra.enabled`.

- **Flag off (dimmed state)**: row shows at ~40% opacity, icon only,
  subtitle "click to enable". Clicking the row flips
  `settings.orchestra.enabled = true` and opens the Orchestra view in
  a single motion — no JSON editing, no secondary settings round-trip.
- **Flag on (lively state)**: row shows at full opacity, expands to
  list the first 4 teams with their agent counts (`PR Reviewers · 3`,
  `Feature Factory · 5`, …). Clicking a team deep-links into that team
  in the Orchestra workspace.

Rationale: the dimmed-but-visible state teaches the user Orchestra
exists without forcing a decision. The auto-enable on click removes the
"where is the switch?" friction.

### 23.2 StatusBar pill

A compact pill appears in Hydra's bottom status bar **only when at
least one Orchestra agent is `running` or `error`** in any team.

- Content: `Orchestra: 2 running` or `Orchestra: 1 error` (error wins
  the label when both exist).
- Click target: opens the Orchestra view, focusing the first
  erroring/running agent.
- Disappears automatically when all agents return to `idle`/`paused`.

This gives a passive "something is happening" signal from inside
classic Hydra so the user doesn't need to keep Orchestra open.

### 23.3 FirstRunToast (classic surface)

A dismissible corner toast, **never a modal**. Rendered in the classic
Dashboard only.

Heuristic:

```
show toast iff:
  settings.orchestra.enabled === false
  AND app.bootCount >= 5
  AND settings.orchestra.firstRunToastDismissed !== true
```

- Copy: *"Hydra can now orchestrate teams of Claude agents. Want to
  try?"*
- Actions: `[Open Orchestra]`, `[Later]`, `[Don't show again]`.
  - Open Orchestra → flips the flag and navigates to the view.
  - Later → sets a 48h cooldown before re-showing.
  - Don't show again → sets
    `settings.orchestra.firstRunToastDismissed = true` permanently.
- Auto-dismiss: 12 seconds of no interaction counts as "Later".

This keeps existing users unbothered for the first four boots, then
offers a single low-friction nudge.

### 23.4 CoachMarks (4-step tour)

The first time the user actually lands in the Orchestra workspace (flag
just flipped or view just opened for the first time), a 4-step tour
fires. It is skippable at any step.

| Step | Anchor (`data-coach`) | Copy |
|---|---|---|
| 1 | `team-rail` | "Teams live here. Each team is a worktree + a set of agents." |
| 2 | `canvas` | "Drop agents here and wire reporting lines between them." |
| 3 | `inspector` | "Click an agent to edit its soul, skills, and triggers." |
| 4 | `task-bar` | "Submit tasks here. Orchestra routes them to the right agent." |

Anchors are plain `data-coach` attributes on TeamRail, Canvas,
Inspector, and TaskBar so the overlay can locate each target without a
ref dance. The tour stores progress in
`settings.orchestra.coachMarksCompleted` (`boolean`); skipping counts
as completed.

### 23.5 Auto-enable on first keybind

`Ctrl+Shift+A` (`⌘⇧A` on mac) is globally registered even when the
flag is off. First press with the flag off:

1. Flips `settings.orchestra.enabled = true`.
2. Opens Orchestra.
3. Emits a one-shot toast *"Orchestra enabled"* (2.5s).

Subsequent presses just toggle the Orchestra view open/closed like a
normal keybind. This mirrors the sidebar behaviour (§23.1) so both
surfaces do the same thing.

### 23.6 Command palette entries

`⌘K` exposes three entries in the command palette:

- **Open Orchestra** — visible only when the flag is on.
- **Enable Orchestra (experimental)** — visible only when the flag is
  off; flips the flag and opens the view.
- **Disable Orchestra** — visible only when the flag is on; flips the
  flag back to off. Does not delete any data.

## 24. Settings Surface

A dedicated `SettingsPanel.tsx` renders Orchestra-specific settings.
Reachable from:

- The command palette entry "Orchestra settings".
- A gear icon next to the Orchestra row in the sidebar (TBD — pending
  visual review; the panel is reachable via the palette regardless).

The panel has four sections, in order:

### 24.1 Feature flag

Single toggle **"Enable Orchestra (experimental)"**. This is the master
switch. Toggling it off unmounts the workspace and hides the sidebar's
lively/expanded state but preserves all team data.

### 24.2 Anthropic API key

- Masked input with add / rotate / remove actions.
- Radio: **"Store in OS keychain (recommended)"** vs.
  **"Encrypted file (safeStorage)"**. Keychain is default and preferred.
- **Validate on save**: the Save button fires a 1-token ping to
  `api.anthropic.com/v1/messages`; only on 2xx does the key persist.
  401 or 429 leave the previous key intact and surface an inline error.
- Remove clears the key from whatever storage it lives in and
  invalidates any in-flight agent sessions.

### 24.3 Per-team safeMode cycler

For each team the user has, a row: `<team name> · [ strict | prompt |
yolo ]` as a segmented control.

- Switching `strict` → `prompt` or `prompt` → `strict` applies
  immediately.
- Switching **to** `yolo` fires a confirmation dialog:
  *"yolo mode disables every approval prompt. The agent can run shell
  commands and write files without asking. Proceed?"* with typed
  confirmation **"I understand"**. Switching **away** from `yolo` is
  free.

### 24.4 Danger zone

- **Wipe all Orchestra data**: deletes the `orchestra` key from
  `store.json`, removes every team folder under
  `~/.hydra-ensemble/orchestra/teams/`, and clears the API key from
  every storage backend.
- Requires typing **`DELETE ORCHESTRA`** verbatim (case-sensitive).
- Does not touch classic Hydra data (sessions, projects, toolkit,
  watchdogs).

### 24.5 Interaction rules

- When `settings.orchestra.enabled === false`, **only the master
  toggle (§24.1) is interactive**. Sections 24.2–24.4 render in a
  disabled/ghosted state with a hint *"Enable Orchestra to edit these
  settings."* This prevents the user from editing state that won't
  apply.
- The danger zone button is always styled as destructive
  (red border, red label) and always requires the typed phrase, even
  when the flag is off — the wipe works regardless of enabled state.

## 25. Task Drawer & Routing Transparency

Clicking a task card (on the canvas, in the task-bar recent list, or in
the status-bar pill's context menu) opens a right-side drawer
(`w-[420px]`, `TaskDrawer.tsx`).

### 25.1 Drawer anatomy

Top to bottom:

1. **Header** — task title, priority pill, tags, close button.
2. **RouteExplain block** (§25.2) — "Why this agent?"
3. **Timeline** (§25.3) — chronological merge of Route + MessageLog
   entries for the task and its sub-tasks.
4. **Footer** — **Cancel task** button (destructive styling).

### 25.2 RouteExplain block

Renders the `Route` record tied to the task:

- Chosen agent (bold, with crown if main).
- Reason label (`scored`, `fallback:no-match`, `delegation:<id>`).
- Candidate list: each candidate agent + their score, sorted desc.
  The chosen candidate is highlighted.
- Tiebreaker note when two candidates had equal scores
  (e.g. *"tied at 6.0, chose least-recently-active"*).

This is the user-facing surface of the routing algorithm in §7 of
`PLAN.md`; it exists so misroutes are debuggable without digging
through log files.

### 25.3 Timeline

A single chronological stream merging:

- The Route entry at the top (task creation + initial assignment).
- Every `MessageLog` entry with `taskId === task.id` OR with
  `taskId === <any descendant task via parentTaskId>`.
- Sub-task rows are **indented one level** per depth in the
  parent→child chain, with a faint connector line on the left.
- Entry kinds render with distinct affordances:
  - `status`, `output` — plain text blocks.
  - `delegation` — arrow row `A → B  "reason"`.
  - `error` — red bordered block.
  - `approval_request` — see §25.4.

### 25.4 ApprovalCard (inline)

When a timeline entry is a `MessageLog` with
`kind === 'approval_request'`, it renders as an interactive card
in-line (rather than a plain log line):

- Header: the command / write the agent wants to perform.
- Body: the agent's justification (from the tool call arguments).
- Actions: **[Allow]** / **[Deny]**.
- **Auto-deny countdown** — a 5:00 timer visible on the card. At 0:00
  the card auto-denies and becomes a plain log entry labeled
  *"auto-denied (timeout)"*.
- While the card is active, the agent is in `running` state but
  paused between turns — the countdown gives the user a hard deadline
  so stale approvals don't block agents indefinitely.

### 25.5 Cancel task semantics

**Cancel task** in the footer:

- Soft: sends a cancel signal to the AgentHost. The agent finishes its
  current SDK turn (so tool calls already in flight complete), then
  marks the task `failed` with reason `cancelled_by_user`.
- Cascades to sub-tasks: every task with `parentTaskId` matching the
  cancelled task (recursively) is also marked `failed` with reason
  `parent_cancelled`.
- The drawer stays open and the Cancel button becomes
  *"Cancelled"* (disabled).

## 26. Keyboard Discoverability Matrix

Complete list of Orchestra-related shortcuts. Overlaps with §12 (canvas
table) are intentional — this section is the single-source-of-truth
reference.

| Shortcut | Context | Action |
|---|---|---|
| `Ctrl+Shift+A` / `⌘⇧A` | Anywhere in Hydra | Toggle Orchestra view. With flag off, first press flips the flag and opens the view (see §23.5). |
| `⌘K` | Anywhere | Open command palette. Orchestra entries depend on flag state (§23.6). |
| `⌘D` | Anywhere | Return to classic Dashboard. Orchestra state preserved. |
| `Esc` | In Inspector | Close inspector, return focus to canvas. |
| `Esc` | In TaskDrawer | Close drawer, return focus to the task card on canvas. |
| `Esc` | In CoachMarks | Skip the tour (marks as completed). |
| `Esc` | In any modal (ApiKey, DeleteTeam, NewAgent) | Cancel / close. |
| `/` | In Orchestra workspace | Focus the task-bar input. |
| `A` | Canvas focused | Open New Agent popover at cursor. |
| `E` | One card selected | Start drag-to-connect edge creation. |
| `Tab` | Canvas | Cycle through agent cards in reading order. |
| `Enter` | Card focused | Open inspector for focused card. |
| `Space` | Card focused | Select / deselect. |
| `Space+drag` / middle-click-drag | Canvas | Pan viewport. |
| `Ctrl/Cmd + wheel` | Canvas | Zoom (clamped 25%–200%). |
| `Arrow` | Card focused & selected | Nudge 8px. |
| `Shift+Arrow` | Card focused & selected | Nudge 1px. |
| `Delete` / `Backspace` | Selection present | Delete selected nodes/edges (confirm if >1). |
| `⌘Z` / `⌘⇧Z` | Canvas | Undo / redo (50 steps). |
| `⌘0` | Canvas | Fit graph to viewport (200ms anim). |
