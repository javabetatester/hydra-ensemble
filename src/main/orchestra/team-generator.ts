/**
 * Prompt-to-team generator.
 *
 * Takes a free-text user prompt and asks Claude (Sonnet 4.6 by default) to
 * design a complete team of agents. Uses forced tool use so the model is
 * obligated to return a structured payload, then validates and wraps it as
 * a `TeamExportV1` ready for `OrchestraCore.importTeam()`.
 *
 * Notes
 *  - Few-shots are hand-crafted constants in this file (not derived from the
 *    runtime templates because `TeamTemplate` ≠ `TeamExportV1`).
 *  - We never persist anything here; the caller decides whether to accept
 *    the proposal and provision it.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import type {
  AgentProvider,
  DelegationMode,
  SafeMode,
  Skill,
  TeamExportAgent,
  TeamExportEdge,
  TeamExportV1,
  Trigger,
  TriggerKind
} from '../../shared/orchestra'

const DEFAULT_MAX_AGENTS = 6
const DEFAULT_MODEL = 'claude-sonnet-4-6'
const DEFAULT_GENERATION_MAX_TOKENS = 8192
const TIMEOUT_MS = 90_000

export interface GenerateTeamOptions {
  maxAgents?: number
  modelId?: string
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const PROPOSE_TEAM_TOOL: Tool = {
  name: 'propose_team',
  description:
    'Design a team of AI agents that can collaborate on the user task. ' +
    'The team must form a strict DAG (no cycles). Exactly one agent has ' +
    'isMain=true (the entry point / coordinator). Each agent gets a ' +
    'domain-specific soul.md (markdown), a skills list with weighted tags, ' +
    'and at least one trigger.',
  input_schema: {
    type: 'object',
    required: ['team', 'agents', 'edges'],
    properties: {
      team: {
        type: 'object',
        required: ['name', 'safeMode', 'defaultModel', 'claudeMd'],
        properties: {
          name: { type: 'string', description: 'Short, human-readable team name (≤40 chars).' },
          safeMode: { type: 'string', enum: ['strict', 'prompt', 'yolo'] },
          defaultModel: {
            type: 'string',
            description: 'Model id agents fall back to. Use claude-opus-4-7 or claude-sonnet-4-6.'
          },
          claudeMd: {
            type: 'string',
            description: 'Team-level markdown context shared with every agent. ~5-15 lines.'
          }
        }
      },
      agents: {
        type: 'array',
        minItems: 1,
        description: 'List of agents that compose the team. First agent is typically isMain.',
        items: {
          type: 'object',
          required: ['slug', 'name', 'role', 'soul', 'skills', 'triggers', 'isMain', 'position'],
          properties: {
            slug: {
              type: 'string',
              description: 'kebab-case unique identifier (used for edge resolution).'
            },
            name: { type: 'string' },
            role: { type: 'string', description: 'Short role title, e.g. "PR reviewer".' },
            description: { type: 'string' },
            isMain: { type: 'boolean' },
            position: {
              type: 'object',
              required: ['x', 'y'],
              properties: {
                x: { type: 'number' },
                y: { type: 'number' }
              },
              description: 'Canvas position in pixels. Use multiples of 260 for x, 200 for y.'
            },
            color: { type: 'string' },
            model: {
              type: 'string',
              description: 'Optional override; empty string falls back to defaultModel.'
            },
            maxTokens: { type: 'integer', description: 'Default 8192.' },
            soul: {
              type: 'string',
              description:
                'Markdown personality/role context. MUST be domain-specific to the user task — never generic.'
            },
            skills: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name', 'tags', 'weight'],
                properties: {
                  name: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  weight: { type: 'number', description: '0.5 to 2.0; affects router scoring.' },
                  description: { type: 'string' }
                }
              }
            },
            triggers: {
              type: 'array',
              items: {
                type: 'object',
                required: ['kind', 'pattern', 'priority', 'enabled'],
                properties: {
                  kind: {
                    type: 'string',
                    enum: ['manual', 'tag', 'path', 'event', 'schedule']
                  },
                  pattern: { type: 'string' },
                  priority: { type: 'integer', description: '0 to 10.' },
                  enabled: { type: 'boolean' },
                  when: { type: 'string' }
                }
              }
            }
          }
        }
      },
      edges: {
        type: 'array',
        description: 'Reporting hierarchy. Each edge: parent delegates to child.',
        items: {
          type: 'object',
          required: ['parentSlug', 'childSlug'],
          properties: {
            parentSlug: { type: 'string' },
            childSlug: { type: 'string' },
            delegationMode: { type: 'string', enum: ['auto', 'approve'] }
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Few-shots
// ---------------------------------------------------------------------------

const FEW_SHOT_PR_REVIEW: TeamExportV1 = {
  formatVersion: 1,
  exportedAt: '2026-01-15T12:00:00.000Z',
  team: {
    name: 'Go PR Review Swarm',
    safeMode: 'prompt',
    defaultModel: 'claude-sonnet-4-6',
    claudeMd:
      '# Go PR Review Swarm\n\nThis team reviews Go pull requests with attention to ' +
      'idiomatic style, security, and test coverage. The lead reviewer fans work to ' +
      'three specialists and consolidates feedback into a single review comment.',
    canvas: { zoom: 1, panX: 0, panY: 0 }
  },
  agents: [
    {
      slug: 'lead-reviewer',
      name: 'Lead Reviewer',
      role: 'PM / triage',
      description: 'Reads the PR, splits work, consolidates findings into a final comment.',
      position: { x: 260, y: 0 },
      model: '',
      maxTokens: 8192,
      isMain: true,
      soul:
        '# Role\n\nYou are the lead reviewer. You read the PR diff first, decide which ' +
        'aspects need specialist attention, and delegate accordingly. After your reports ' +
        'come back, you consolidate everything into one cohesive review comment.\n\n' +
        '## Style\n\n- Direct, no fluff\n- Cite line numbers\n- Lead with blockers\n',
      skills: [
        {
          name: 'pr-triage',
          tags: ['review', 'triage', 'planning'],
          weight: 1.5,
          description: 'Decompose a PR into review concerns and delegate.'
        },
        {
          name: 'consolidation',
          tags: ['summary', 'feedback'],
          weight: 1.2
        }
      ],
      triggers: [
        { kind: 'manual', pattern: '', priority: 0, enabled: true },
        { kind: 'tag', pattern: 'review', priority: 8, enabled: true }
      ]
    },
    {
      slug: 'go-linter',
      name: 'Go Linter',
      role: 'idiomatic Go',
      description: 'Checks naming, error handling, formatting against Go conventions.',
      position: { x: 0, y: 200 },
      model: '',
      maxTokens: 8192,
      isMain: false,
      soul:
        '# Role\n\nYou enforce idiomatic Go. You flag non-idiomatic patterns, ' +
        'inconsistent error wrapping, exported names that should be unexported, ' +
        'and anything that goes against `effective_go` and the standard library style.\n',
      skills: [
        {
          name: 'go-style',
          tags: ['go', 'lint', 'convention'],
          weight: 1.5
        },
        { name: 'error-handling', tags: ['errors', 'idiom'], weight: 1.3 }
      ],
      triggers: [
        { kind: 'tag', pattern: 'go', priority: 7, enabled: true },
        { kind: 'path', pattern: '**/*.go', priority: 6, enabled: true }
      ]
    },
    {
      slug: 'security-auditor',
      name: 'Security Auditor',
      role: 'security review',
      description: 'Looks for common security issues: SQL injection, secret leaks, unsafe deserialization.',
      position: { x: 260, y: 200 },
      model: '',
      maxTokens: 8192,
      isMain: false,
      soul:
        '# Role\n\nYou audit code for security issues. You flag SQL injection vectors, ' +
        'leaked secrets, unsafe deserialization, missing auth checks, and panics in ' +
        'request paths. You always cite the line and propose a concrete fix.\n',
      skills: [
        { name: 'security-audit', tags: ['security', 'audit'], weight: 1.5 },
        { name: 'secret-detection', tags: ['secrets', 'leak'], weight: 1.3 }
      ],
      triggers: [
        { kind: 'tag', pattern: 'security', priority: 9, enabled: true },
        { kind: 'manual', pattern: '', priority: 0, enabled: true }
      ]
    },
    {
      slug: 'test-gap-finder',
      name: 'Test Gap Finder',
      role: 'coverage analysis',
      description: 'Identifies code paths added without tests, suggests minimal test cases.',
      position: { x: 520, y: 200 },
      model: '',
      maxTokens: 8192,
      isMain: false,
      soul:
        '# Role\n\nYou find code that was changed without test coverage. You list the ' +
        'specific functions or branches that need tests, and suggest minimal test cases ' +
        '(table-driven where possible) to close the gaps.\n',
      skills: [
        { name: 'coverage', tags: ['tests', 'coverage'], weight: 1.5 },
        { name: 'test-design', tags: ['tests', 'tdd'], weight: 1.2 }
      ],
      triggers: [
        { kind: 'tag', pattern: 'tests', priority: 7, enabled: true },
        { kind: 'path', pattern: '**/*_test.go', priority: 6, enabled: true }
      ]
    }
  ],
  edges: [
    { parentSlug: 'lead-reviewer', childSlug: 'go-linter', delegationMode: 'auto' },
    { parentSlug: 'lead-reviewer', childSlug: 'security-auditor', delegationMode: 'auto' },
    { parentSlug: 'lead-reviewer', childSlug: 'test-gap-finder', delegationMode: 'auto' }
  ]
}

const FEW_SHOT_FEATURE_PIPELINE: TeamExportV1 = {
  formatVersion: 1,
  exportedAt: '2026-01-15T12:00:00.000Z',
  team: {
    name: 'Feature Factory',
    safeMode: 'prompt',
    defaultModel: 'claude-opus-4-7',
    claudeMd:
      '# Feature Factory\n\nPipeline that takes a feature spec and produces tested ' +
      'production code. PM clarifies scope → architect designs → backend & frontend ' +
      'implement in parallel → QA writes tests and signs off.',
    canvas: { zoom: 1, panX: 0, panY: 0 }
  },
  agents: [
    {
      slug: 'pm',
      name: 'PM',
      role: 'product manager',
      description: 'Clarifies scope, splits the feature into deliverable chunks, prioritizes.',
      position: { x: 260, y: 0 },
      model: '',
      maxTokens: 8192,
      isMain: true,
      soul:
        '# Role\n\nYou turn fuzzy feature requests into clear, scoped deliverables. ' +
        'You delegate the architecture decision to the architect, then track progress ' +
        'across implementation and QA, closing the loop when everything ships.\n',
      skills: [
        { name: 'scoping', tags: ['planning', 'scope'], weight: 1.5 },
        { name: 'delegation', tags: ['delegate', 'routing'], weight: 1.4 }
      ],
      triggers: [
        { kind: 'tag', pattern: 'feature', priority: 8, enabled: true },
        { kind: 'manual', pattern: '', priority: 0, enabled: true }
      ]
    },
    {
      slug: 'architect',
      name: 'Architect',
      role: 'system design',
      description: 'Decides the component boundaries, data flow, and interfaces.',
      position: { x: 260, y: 200 },
      model: '',
      maxTokens: 8192,
      isMain: false,
      soul:
        '# Role\n\nYou design the implementation: which files to touch, what interfaces ' +
        'to add, and the data flow. Output is a short markdown blueprint the implementers ' +
        'can follow without further questions.\n',
      skills: [
        { name: 'system-design', tags: ['architecture', 'design'], weight: 1.5 },
        { name: 'api-design', tags: ['api', 'interfaces'], weight: 1.3 }
      ],
      triggers: [
        { kind: 'tag', pattern: 'design', priority: 7, enabled: true },
        { kind: 'manual', pattern: '', priority: 0, enabled: true }
      ]
    },
    {
      slug: 'backend-dev',
      name: 'Backend Dev',
      role: 'backend implementation',
      description: 'Implements server-side logic, database changes, and API endpoints.',
      position: { x: 0, y: 400 },
      model: '',
      maxTokens: 8192,
      isMain: false,
      soul:
        '# Role\n\nYou implement backend changes per the architect blueprint: handlers, ' +
        'services, persistence. You keep diffs small and write integration tests as you go.\n',
      skills: [
        { name: 'backend-impl', tags: ['backend', 'api', 'server'], weight: 1.5 },
        { name: 'sql-migrations', tags: ['sql', 'migration', 'db'], weight: 1.2 }
      ],
      triggers: [
        { kind: 'tag', pattern: 'backend', priority: 7, enabled: true },
        { kind: 'path', pattern: 'src/server/**', priority: 6, enabled: true }
      ]
    },
    {
      slug: 'frontend-dev',
      name: 'Frontend Dev',
      role: 'UI implementation',
      description: 'Implements React UI per the design, wires it to the backend API.',
      position: { x: 520, y: 400 },
      model: '',
      maxTokens: 8192,
      isMain: false,
      soul:
        '# Role\n\nYou implement React UI: components, state, API hooks. You match ' +
        'existing patterns in the codebase, keep components small, and ship working ' +
        'interactions before polishing styles.\n',
      skills: [
        { name: 'react-impl', tags: ['react', 'frontend', 'ui'], weight: 1.5 },
        { name: 'state-mgmt', tags: ['state', 'zustand', 'redux'], weight: 1.2 }
      ],
      triggers: [
        { kind: 'tag', pattern: 'frontend', priority: 7, enabled: true },
        { kind: 'path', pattern: 'src/renderer/**', priority: 6, enabled: true }
      ]
    },
    {
      slug: 'qa',
      name: 'QA',
      role: 'test plan & signoff',
      description: 'Writes the test plan, executes smoke tests, signs off.',
      position: { x: 260, y: 600 },
      model: '',
      maxTokens: 8192,
      isMain: false,
      soul:
        '# Role\n\nYou write the test plan from the spec, then execute (unit + smoke) ' +
        'and sign off only when the green path AND the obvious edge cases pass. You ' +
        'never approve without running the suite.\n',
      skills: [
        { name: 'test-plan', tags: ['qa', 'tests'], weight: 1.5 },
        { name: 'smoke', tags: ['smoke', 'e2e'], weight: 1.3 }
      ],
      triggers: [
        { kind: 'tag', pattern: 'qa', priority: 8, enabled: true },
        { kind: 'tag', pattern: 'tests', priority: 7, enabled: true }
      ]
    }
  ],
  edges: [
    { parentSlug: 'pm', childSlug: 'architect', delegationMode: 'auto' },
    { parentSlug: 'architect', childSlug: 'backend-dev', delegationMode: 'auto' },
    { parentSlug: 'architect', childSlug: 'frontend-dev', delegationMode: 'auto' },
    { parentSlug: 'pm', childSlug: 'qa', delegationMode: 'auto' }
  ]
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildSystemPrompt(maxAgents: number): string {
  return [
    'You are an expert at composing teams of AI agents for software engineering tasks.',
    '',
    'Given a free-text description from the user, design a team of specialized agents ',
    'that can collaborate on the task.',
    '',
    'Hard constraints (MUST follow):',
    `- Maximum ${maxAgents} agents per team.`,
    '- Form a strict DAG (no cycles, no self-edges, no edges between unrelated agents).',
    '- Designate exactly ONE agent with isMain=true (the coordinator/entry point).',
    '- Each agent\'s soul.md MUST be specific to the user\'s domain — never generic.',
    '- Skills should have weight between 0.5 and 2.0, with 2-4 tags each.',
    '- Triggers should mix kinds (manual + tag + path) to support routing.',
    '- Slugs must be kebab-case and unique within the team.',
    '- Position agents on a grid: x in multiples of 260, y in multiples of 200.',
    '',
    'You will receive two example teams (in TeamExportV1 format) for reference.',
    'After studying them, call the propose_team tool with your designed team.'
  ].join('\n')
}

function buildUserPrompt(prompt: string): string {
  return [
    '## Examples',
    '',
    '### Example 1 — PR Review Swarm',
    '```json',
    JSON.stringify(FEW_SHOT_PR_REVIEW, null, 2),
    '```',
    '',
    '### Example 2 — Feature Pipeline',
    '```json',
    JSON.stringify(FEW_SHOT_FEATURE_PIPELINE, null, 2),
    '```',
    '',
    '## Your task',
    '',
    'Design a team for the following user request. Use propose_team to return your design.',
    '',
    '<user_request>',
    prompt,
    '</user_request>'
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Generate a team proposal from a free-text prompt. Throws on transport
 * errors, invalid responses, or empty results. The returned `TeamExportV1`
 * is ready for `OrchestraCore.importTeam()`.
 */
export async function generateTeamFromPrompt(
  prompt: string,
  apiKey: string,
  opts: GenerateTeamOptions = {}
): Promise<TeamExportV1> {
  const trimmed = prompt.trim()
  if (trimmed.length < 10) throw new Error('prompt is too short (need at least 10 characters)')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required')

  const maxAgents = clampInt(opts.maxAgents ?? DEFAULT_MAX_AGENTS, 1, 12)
  const model = opts.modelId ?? DEFAULT_MODEL

  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS })

  const response = await client.messages.create({
    model,
    max_tokens: DEFAULT_GENERATION_MAX_TOKENS,
    system: buildSystemPrompt(maxAgents),
    messages: [{ role: 'user', content: buildUserPrompt(trimmed) }],
    tools: [PROPOSE_TEAM_TOOL],
    tool_choice: { type: 'tool', name: 'propose_team' }
  })

  const block = response.content.find((b): b is ToolUseBlock => b.type === 'tool_use')
  if (!block) {
    throw new Error('model did not invoke the propose_team tool — try again')
  }
  if (block.name !== 'propose_team') {
    throw new Error(`unexpected tool: ${block.name}`)
  }

  const raw = block.input as RawProposal
  return validateAndWrap(raw, maxAgents)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface RawProposal {
  team?: {
    name?: string
    safeMode?: string
    defaultModel?: string
    claudeMd?: string
    canvas?: { zoom?: number; panX?: number; panY?: number }
  }
  agents?: Array<Partial<TeamExportAgent> & { slug?: string }>
  edges?: Array<Partial<TeamExportEdge>>
}

const VALID_SAFE_MODES: ReadonlySet<SafeMode> = new Set(['strict', 'prompt', 'yolo'])
const VALID_DELEGATION_MODES: ReadonlySet<DelegationMode> = new Set(['auto', 'approve'])
const VALID_TRIGGER_KINDS: ReadonlySet<TriggerKind> = new Set([
  'manual',
  'tag',
  'path',
  'event',
  'schedule'
])
const VALID_AGENT_PROVIDERS: ReadonlySet<AgentProvider> = new Set([
  'inherit',
  'claude-cli',
  'anthropic-api'
])

function validateAndWrap(raw: RawProposal, maxAgents: number): TeamExportV1 {
  if (!raw || typeof raw !== 'object') {
    throw new Error('proposal is not an object')
  }
  if (!Array.isArray(raw.agents) || raw.agents.length === 0) {
    throw new Error('proposal has no agents')
  }

  const teamName = (raw.team?.name ?? '').trim() || 'Generated Team'
  const safeMode: SafeMode = VALID_SAFE_MODES.has(raw.team?.safeMode as SafeMode)
    ? (raw.team!.safeMode as SafeMode)
    : 'prompt'
  const defaultModel = (raw.team?.defaultModel ?? '').trim() || DEFAULT_MODEL
  const claudeMd = typeof raw.team?.claudeMd === 'string' ? raw.team.claudeMd : ''
  const canvas = {
    zoom: typeof raw.team?.canvas?.zoom === 'number' ? raw.team.canvas.zoom : 1,
    panX: typeof raw.team?.canvas?.panX === 'number' ? raw.team.canvas.panX : 0,
    panY: typeof raw.team?.canvas?.panY === 'number' ? raw.team.canvas.panY : 0
  }

  // Truncate to max and normalize each agent.
  const trimmed = raw.agents.slice(0, maxAgents)
  const seenSlugs = new Set<string>()
  const agents: TeamExportAgent[] = []

  for (let i = 0; i < trimmed.length; i++) {
    const a = trimmed[i]!
    const slug = ensureUniqueSlug(slugify(a.slug ?? a.name ?? `agent-${i + 1}`), seenSlugs)
    seenSlugs.add(slug)
    agents.push(normalizeAgent(a, slug, i))
  }

  if (agents.length === 0) throw new Error('all agents were invalid')

  // Ensure exactly one isMain.
  const mainCount = agents.filter((a) => a.isMain).length
  if (mainCount === 0) {
    agents[0]!.isMain = true
  } else if (mainCount > 1) {
    let kept = false
    for (const a of agents) {
      if (a.isMain) {
        if (kept) a.isMain = false
        else kept = true
      }
    }
  }

  // Build slug set for edge resolution.
  const slugSet = new Set(agents.map((a) => a.slug))
  const edges = normalizeEdges(raw.edges ?? [], slugSet)

  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    team: { name: teamName, safeMode, defaultModel, claudeMd, canvas },
    agents,
    edges
  }
}

function normalizeAgent(
  a: Partial<TeamExportAgent> & { slug?: string },
  slug: string,
  index: number
): TeamExportAgent {
  const name = (a.name ?? '').trim() || titleCase(slug)
  const role = (a.role ?? '').trim() || 'agent'
  const description = typeof a.description === 'string' ? a.description : ''
  const position =
    a.position && typeof a.position.x === 'number' && typeof a.position.y === 'number'
      ? a.position
      : { x: (index % 3) * 260, y: Math.floor(index / 3) * 200 }
  const color = typeof a.color === 'string' ? a.color : undefined
  const model = typeof a.model === 'string' ? a.model : ''
  const maxTokens =
    typeof a.maxTokens === 'number' && Number.isFinite(a.maxTokens) ? a.maxTokens : 8192
  const provider = VALID_AGENT_PROVIDERS.has(a.provider as AgentProvider)
    ? (a.provider as AgentProvider)
    : undefined
  const isMain = a.isMain === true

  const soul = typeof a.soul === 'string' && a.soul.trim().length > 0
    ? a.soul
    : `# Role\n\n${role}\n`

  const skills = Array.isArray(a.skills) ? a.skills.map(normalizeSkill).filter(Boolean) as Skill[] : []
  const rawTriggers = Array.isArray(a.triggers) ? a.triggers : []
  const triggers = rawTriggers
    .map(normalizeTrigger)
    .filter((t): t is Omit<Trigger, 'id'> => t !== null)

  // Always have at least one trigger so the agent is reachable manually.
  if (triggers.length === 0) {
    triggers.push({ kind: 'manual', pattern: '', priority: 0, enabled: true })
  }

  return {
    slug,
    name,
    role,
    description,
    position,
    color,
    model,
    maxTokens,
    provider,
    isMain,
    soul,
    skills,
    triggers
  }
}

function normalizeSkill(s: unknown): Skill | null {
  if (!s || typeof s !== 'object') return null
  const obj = s as Partial<Skill>
  const name = typeof obj.name === 'string' ? obj.name.trim() : ''
  if (!name) return null
  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((t): t is string => typeof t === 'string' && t.length > 0)
    : []
  const rawWeight = typeof obj.weight === 'number' && Number.isFinite(obj.weight) ? obj.weight : 1
  const weight = clamp(rawWeight, 0.5, 2.0)
  const description = typeof obj.description === 'string' ? obj.description : undefined
  return description !== undefined
    ? { name, tags, weight, description }
    : { name, tags, weight }
}

function normalizeTrigger(t: unknown): Omit<Trigger, 'id'> | null {
  if (!t || typeof t !== 'object') return null
  const obj = t as Partial<Trigger>
  const kind = obj.kind && VALID_TRIGGER_KINDS.has(obj.kind as TriggerKind)
    ? (obj.kind as TriggerKind)
    : 'manual'
  const pattern = typeof obj.pattern === 'string' ? obj.pattern : ''
  const priority = clampInt(typeof obj.priority === 'number' ? obj.priority : 0, 0, 10)
  const enabled = obj.enabled !== false
  const when = typeof obj.when === 'string' ? obj.when : undefined
  return when !== undefined
    ? { kind, pattern, priority, enabled, when }
    : { kind, pattern, priority, enabled }
}

function normalizeEdges(
  raw: Array<Partial<TeamExportEdge>>,
  slugSet: ReadonlySet<string>
): TeamExportEdge[] {
  const edges: TeamExportEdge[] = []
  // Build adjacency to detect cycles as we accept edges.
  const childrenOf = new Map<string, Set<string>>()
  for (const slug of slugSet) childrenOf.set(slug, new Set())

  for (const e of raw) {
    const parent = typeof e.parentSlug === 'string' ? e.parentSlug : ''
    const child = typeof e.childSlug === 'string' ? e.childSlug : ''
    if (!parent || !child || parent === child) continue
    if (!slugSet.has(parent) || !slugSet.has(child)) continue
    // Reject if `parent` is reachable from `child` (cycle would form).
    if (reachable(child, parent, childrenOf)) continue
    const mode: DelegationMode = VALID_DELEGATION_MODES.has(e.delegationMode as DelegationMode)
      ? (e.delegationMode as DelegationMode)
      : 'auto'
    edges.push({ parentSlug: parent, childSlug: child, delegationMode: mode })
    childrenOf.get(parent)!.add(child)
  }
  return edges
}

function reachable(
  start: string,
  target: string,
  graph: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  const stack = [start]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node === target) return true
    if (seen.has(node)) continue
    seen.add(node)
    const next = graph.get(node)
    if (next) for (const n of next) stack.push(n)
  }
  return false
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'agent'
}

function ensureUniqueSlug(base: string, seen: ReadonlySet<string>): string {
  if (!seen.has(base)) return base
  let i = 2
  while (seen.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function clampInt(n: number, min: number, max: number): number {
  return Math.round(clamp(n, min, max))
}
