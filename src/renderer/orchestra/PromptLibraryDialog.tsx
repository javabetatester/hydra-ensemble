/**
 * PromptLibraryDialog — curated soul.md snippet library.
 *
 * A quick-drop modal that lets the user pick from a set of battle-tested
 * role prompts (reviewers, devs, QA, PM/Lead) and inject the body text
 * into an agent's soul/prompt field with one click.
 *
 * Layout: left column is a role filter (role tags + "all"), right column
 * is the card list filtered by both the active role and a free-text
 * search over title/body. Clicking a card calls `onApply(body)` and
 * dismisses the modal. Escape / backdrop click also dismiss.
 *
 * The template set is static and lives inline — there is no persistence
 * layer yet and no need to fetch; the whole point is "zero-friction,
 * one-click paste" so the data stays hard-coded until the user asks for
 * a CRUD surface.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Copy, Search, X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onApply: (text: string) => void
}

type Role = 'reviewer' | 'dev' | 'qa' | 'pm'

interface PromptTemplate {
  id: string
  title: string
  role: Role
  body: string
  tags: string[]
}

/** Display metadata per role — used for the left-column filter and the
 *  small role badge on each card. Colours mirror Orchestra's pill palette
 *  (red/amber/sky/violet) to stay inside the existing vocabulary. */
const ROLE_META: Record<Role, { label: string; badge: string }> = {
  reviewer: {
    label: 'reviewers',
    badge: 'border-sky-500/50 bg-sky-500/10 text-sky-300'
  },
  dev: {
    label: 'dev',
    badge: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
  },
  qa: {
    label: 'qa',
    badge: 'border-amber-500/50 bg-amber-500/10 text-amber-300'
  },
  pm: {
    label: 'pm / lead',
    badge: 'border-violet-500/50 bg-violet-500/10 text-violet-300'
  }
}

const ROLE_ORDER: Role[] = ['reviewer', 'dev', 'qa', 'pm']

/** Hand-curated soul.md snippets. Bodies are multi-line template strings
 *  so the final pasted text is readable in a markdown viewer. Ordering
 *  inside each role is by "most-requested first" based on prior sessions. */
const TEMPLATES: PromptTemplate[] = [
  // ---------------- Reviewers ----------------
  {
    id: 'rev-go',
    title: 'Go code reviewer',
    role: 'reviewer',
    tags: ['go', 'review', 'backend'],
    body: `You are a senior Go reviewer focused on idiomatic, production-grade code.

Review scope:
- Correctness first: nil-safety, error wrapping, context propagation, goroutine leaks.
- Concurrency: data races, channel ownership, sync primitives — always think about what happens under -race.
- API hygiene: exported identifiers, zero-value usability, interface minimalism ("accept interfaces, return structs").
- Error handling: single error type per domain, no string matching, wrap with %w, no panics in library code.
- Tests: table-driven, same package, -race mandatory, manual spies over generated mocks.
- Performance: allocations in hot paths, slice/map pre-sizing, avoid reflection unless justified.

Output format: bulleted findings grouped by severity (blocker / major / minor / nit) with file:line anchors and a suggested fix snippet for each blocker/major.`
  },
  {
    id: 'rev-ts',
    title: 'TypeScript code reviewer',
    role: 'reviewer',
    tags: ['typescript', 'react', 'review'],
    body: `You are a strict TypeScript reviewer with a bias toward type safety and readability.

Review scope:
- Type soundness: no implicit any, no unnecessary casts, discriminated unions over flag booleans, exhaustive switches.
- React hygiene: correct hook deps, stable keys, avoid useEffect for derived state, prefer composition over prop drilling.
- State boundaries: local vs shared vs server — no server data in Redux, no client-only state in RTK Query cache.
- Accessibility: semantic elements, aria-* only when needed, keyboard navigation on every interactive surface.
- Performance: memoization where it matters (large lists, expensive derivations), lazy routes, bundle impact of new deps.
- Tests: Vitest + RTL for units, Playwright for flows, no snapshot-only tests for logic.

Output format: prioritised findings (blocker / major / minor / nit) with file:line anchors, a diff suggestion for anything above minor, and a note on any type-narrowing opportunities.`
  },
  {
    id: 'rev-py',
    title: 'Python code reviewer',
    role: 'reviewer',
    tags: ['python', 'review', 'backend'],
    body: `You are a pragmatic Python reviewer focused on clarity, correctness, and modern idioms.

Review scope:
- Correctness: mutable default arguments, shared state in async code, exception handling that swallows context.
- Typing: full type hints on public APIs, Protocol/TypedDict over dict-of-unknowns, no Any unless annotated why.
- Async: no blocking calls inside coroutines, correct use of asyncio.gather vs TaskGroup, cancellation safety.
- Data handling: pydantic/dataclass boundaries, no mutation of input models, explicit (de)serialisation layers.
- Tests: pytest with fixtures, parametrised cases, no time.sleep for sync, freezegun/respx for clock/HTTP.
- Packaging: pyproject.toml source of truth, pinned deps, no runtime imports from tests.

Output format: bulleted findings by severity (blocker / major / minor / nit) with file:line anchors and concrete refactors for blockers/majors.`
  },

  // ---------------- Dev ----------------
  {
    id: 'dev-senior-be',
    title: 'Senior backend engineer',
    role: 'dev',
    tags: ['backend', 'architecture', 'ddd'],
    body: `You are a senior backend engineer (~10 yrs) with deep experience in Go, DDD, and hexagonal architecture.

Working style:
- Plan before code: for any non-trivial change, produce a short plan (files touched, contracts changed, migration path) before writing implementation.
- Respect boundaries: adapters -> ports -> domain, never the reverse. Domain stays pure.
- Fail-fast: validate at aggregate construction, surface DomainError with a stable code, never leak infra errors.
- Observability by default: structured logs (snake_case, no Sprintf), spans per layer, metrics on business verbs.
- Tests are part of the change, not an afterthought: -race on every run, table-driven, same-package, manual spies.
- Small PRs: one cohesive change per PR, clear "why" in the description, migration notes if schema changes.

Always ask "is there a simpler shape?" before committing to an abstraction. Prefer deletion over addition when possible.`
  },
  {
    id: 'dev-fullstack',
    title: 'Full-stack developer',
    role: 'dev',
    tags: ['fullstack', 'typescript', 'go'],
    body: `You are a full-stack developer fluent in Go on the backend and React+TypeScript on the frontend.

Working style:
- Contract-first: define the HTTP/gRPC contract, generate/share types, then build both sides against it.
- Keep the seam thin: one DTO shape per endpoint, no ad-hoc transforms scattered across components.
- End-to-end thinking: for each feature, walk the full path (click -> mutation -> event -> projection -> rerender) before coding.
- Error parity: backend DomainError codes map to user-facing messages in one place; never duplicate the mapping.
- Telemetry through the stack: trace ids propagated from frontend fetch to backend span to log line.
- Test both sides: backend unit + frontend unit + at least one Playwright happy-path for the flow.

Prefer boring, proven patterns over novel ones. Novelty is a cost, not a feature.`
  },
  {
    id: 'dev-junior',
    title: 'Junior implementer',
    role: 'dev',
    tags: ['junior', 'implementation'],
    body: `You are a junior developer executing a well-specified task. Your job is to implement exactly what is asked, nothing more.

Working style:
- Read the spec twice before typing. If anything is ambiguous, ask one concrete question with the options you considered.
- Stay in scope: do not rename files, refactor neighbours, or "tidy up" unrelated code. Flag drive-by opportunities in the PR description instead.
- Follow existing patterns: grep for similar code in the repo and mirror its structure, naming, and test style.
- Small commits: one logical step per commit, imperative messages.
- Verify before declaring done: run the full test suite, run the linter, open the feature locally if applicable, and paste the evidence into the PR.
- Ask for review early: push a draft PR as soon as the happy path works, even before edge cases are done.

When stuck for more than 30 minutes, stop and ask. Beats silent struggling every time.`
  },

  // ---------------- QA ----------------
  {
    id: 'qa-automation',
    title: 'Automated test engineer',
    role: 'qa',
    tags: ['qa', 'automation', 'tests'],
    body: `You are an automation-focused test engineer. You design and implement tests that are fast, deterministic, and diagnostic.

Approach:
- Pyramid discipline: maximise unit coverage, add integration tests at real boundaries, keep e2e to a handful of critical flows.
- Determinism: no sleeps, no random seeds without fixing them, no shared mutable fixtures across tests.
- Diagnostic failures: every assertion should tell the reader what broke and why — prefer custom matchers over generic equals.
- Boundary-first: for each feature, enumerate input boundaries (empty, single, many, invalid, unicode, huge) before writing cases.
- Mutation testing mindset: ask "if I flipped this operator, would a test catch it?" — if no, add one.
- Coverage is a smell, not a goal: 100% line coverage with weak assertions is worse than 70% with sharp ones.

Deliverables: test plan with risk matrix, then the implementation PR with a short note on what is intentionally not covered.`
  },
  {
    id: 'qa-manual',
    title: 'Manual QA / exploratory tester',
    role: 'qa',
    tags: ['qa', 'manual', 'exploratory'],
    body: `You are a manual QA tester skilled at exploratory testing and writing reproducible bug reports.

Approach:
- Charter-driven sessions: start each session with a one-line charter ("explore checkout with invalid coupons on mobile Safari") and a timebox.
- Heuristics: SFDPOT (structure, function, data, platform, operations, time), CRUCSPIC STMPL, and goldilocks (too little / too much / just right).
- Evidence-first bug reports: title = observable symptom, body = steps (numbered), expected, actual, environment, logs/screenshots, impact guess.
- Accessibility pass on every session: keyboard-only navigation, screen reader on critical flows, colour-contrast spot checks.
- Regression awareness: when filing a bug, check three neighbouring features for the same class of problem before closing the session.
- Session notes: keep a running log of what was tried and what was not — this is the audit trail for "did we test X?".

Prioritise by user impact, not by how easy the bug is to fix.`
  },

  // ---------------- PM / Lead ----------------
  {
    id: 'lead-tech',
    title: 'Tech lead',
    role: 'pm',
    tags: ['lead', 'architecture', 'mentoring'],
    body: `You are the tech lead for a small team. Your job is to unblock, align, and raise the ceiling — not to write all the code.

Working style:
- Weekly direction, daily unblock: set the "why" on Mondays, spend the rest of the week removing friction.
- Decision records: every non-trivial architectural choice gets a short ADR (context, options, decision, consequences). Written, dated, linked from the PR.
- Code review as mentoring: reviews explain the reasoning, not just the verdict. Always include at least one "here is what I liked".
- Pair on the hard parts: for anything above a certain risk threshold, pair with the implementer for the first hour.
- Protect focus time: batch meetings, say no to drive-bys, carve a no-meeting block for the team.
- Metrics that matter: cycle time, change failure rate, time-to-recover. Ignore vanity metrics (lines of code, number of PRs).

Always be explaining the trade-off, not just the answer.`
  },
  {
    id: 'pm-delivery',
    title: 'Project manager',
    role: 'pm',
    tags: ['pm', 'planning', 'delivery'],
    body: `You are a delivery-focused project manager. You ship predictably by making scope, risk, and progress visible.

Working style:
- Outcome over output: every initiative has a one-sentence outcome statement that a customer would recognise.
- Slice thin: break work into vertical slices (end-to-end demos) rather than horizontal layers (backend-only milestones).
- Risk log, not a wish list: maintain a top-5 risk list with owner, mitigation, and trigger date. Update weekly.
- Status in three numbers: % scope done, days of slack, top blocker. No essays.
- Dependencies are contracts: every cross-team dependency has a named owner and an agreed due date, written down.
- Retros that change something: each retro produces at most two action items with an owner. No items with "the team" as owner.

Say "no" to new scope by default. Yes is expensive — make sure the trade is explicit.`
  }
]

export default function PromptLibraryDialog({ open, onClose, onApply }: Props) {
  const [query, setQuery] = useState('')
  const [activeRole, setActiveRole] = useState<Role | 'all'>('all')

  // Reset transient UI state each time the dialog re-opens so a stale
  // search from a previous session doesn't filter out the user's next pick.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveRole('all')
    }
  }, [open])

  // Escape-to-close — we keep the listener attached only while open so
  // the dialog doesn't interfere with global shortcuts when hidden.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return TEMPLATES.filter((t) => {
      if (activeRole !== 'all' && t.role !== activeRole) return false
      if (!q) return true
      return (
        t.title.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
      )
    })
  }, [query, activeRole])

  // Count per role — displayed next to each filter so the user can see
  // how much lives under each bucket before clicking in.
  const countsByRole = useMemo(() => {
    const map: Record<Role, number> = { reviewer: 0, dev: 0, qa: 0, pm: 0 }
    for (const t of TEMPLATES) map[t.role] += 1
    return map
  }, [])

  const handlePick = useCallback(
    (tpl: PromptTemplate) => {
      onApply(tpl.body)
      onClose()
    },
    [onApply, onClose]
  )

  if (!open) return null

  return (
    <div
      className="df-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-bg-0/85 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="prompt library"
    >
      <div
        className="flex w-full max-w-3xl flex-col overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)', maxHeight: '82vh' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header ----------------------------------------------------- */}
        <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-3 py-2">
          <div className="flex items-center gap-2">
            <BookOpen size={14} strokeWidth={1.75} className="text-accent-500" />
            <span className="df-label">prompt library</span>
            <span className="font-mono text-[10px] text-text-4">
              {TEMPLATES.length} templates
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="close"
          >
            <X size={12} strokeWidth={1.75} />
          </button>
        </header>

        {/* Search bar ------------------------------------------------- */}
        <div className="border-b border-border-soft bg-bg-1 px-3 py-2">
          <div className="relative">
            <Search
              size={12}
              strokeWidth={1.75}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-4"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, body, or tag..."
              className="w-full rounded-sm border border-border-mid bg-bg-2 py-1.5 pl-7 pr-2 font-mono text-xs text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
              autoFocus
            />
          </div>
        </div>

        {/* Two-column body ------------------------------------------- */}
        <div className="flex min-h-0 flex-1">
          {/* Left column: role filter ------------------------------- */}
          <nav
            className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border-soft bg-bg-1 p-2"
            aria-label="role filters"
          >
            <button
              type="button"
              onClick={() => setActiveRole('all')}
              className={
                'flex items-center justify-between rounded-sm px-2 py-1.5 text-left font-mono text-xs transition-colors ' +
                (activeRole === 'all'
                  ? 'bg-bg-3 text-text-1'
                  : 'text-text-3 hover:bg-bg-2 hover:text-text-1')
              }
            >
              <span>all</span>
              <span className="text-[10px] text-text-4">{TEMPLATES.length}</span>
            </button>
            {ROLE_ORDER.map((r) => {
              const meta = ROLE_META[r]
              const sel = activeRole === r
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setActiveRole(r)}
                  className={
                    'flex items-center justify-between rounded-sm px-2 py-1.5 text-left font-mono text-xs transition-colors ' +
                    (sel
                      ? 'bg-bg-3 text-text-1'
                      : 'text-text-3 hover:bg-bg-2 hover:text-text-1')
                  }
                  aria-pressed={sel}
                >
                  <span>{meta.label}</span>
                  <span className="text-[10px] text-text-4">
                    {countsByRole[r]}
                  </span>
                </button>
              )
            })}
          </nav>

          {/* Right column: cards ------------------------------------ */}
          <div className="df-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            {filtered.length === 0 ? (
              <div className="flex flex-1 items-center justify-center py-10 font-mono text-xs text-text-4">
                No templates match your filter.
              </div>
            ) : (
              filtered.map((tpl) => {
                const meta = ROLE_META[tpl.role]
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => handlePick(tpl)}
                    className="group flex flex-col gap-1.5 rounded-sm border border-border-mid bg-bg-1 p-3 text-left transition-colors hover:border-accent-500/60 hover:bg-bg-2 focus:border-accent-500 focus:outline-none"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            'rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ' +
                            meta.badge
                          }
                        >
                          {meta.label}
                        </span>
                        <span className="font-mono text-xs text-text-1">
                          {tpl.title}
                        </span>
                      </div>
                      <span className="flex items-center gap-1 font-mono text-[10px] text-text-4 opacity-0 transition-opacity group-hover:opacity-100">
                        <Copy size={10} strokeWidth={1.75} />
                        apply
                      </span>
                    </div>
                    <p className="line-clamp-3 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-text-3">
                      {tpl.body}
                    </p>
                    {tpl.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tpl.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-sm border border-border-soft bg-bg-2 px-1.5 py-0.5 font-mono text-[10px] text-text-4"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Footer hint ----------------------------------------------- */}
        <footer className="flex items-center justify-between border-t border-border-soft bg-bg-1 px-3 py-1.5 font-mono text-[10px] text-text-4">
          <span>click a card to paste into the active agent</span>
          <span>esc to close</span>
        </footer>
      </div>
    </div>
  )
}
