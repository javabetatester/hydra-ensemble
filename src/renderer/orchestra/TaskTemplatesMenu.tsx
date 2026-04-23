/**
 * TaskTemplatesMenu — floating popover with a curated list of ready-made
 * task templates the user can pick to pre-fill a new task.
 *
 * Rationale: Orchestra feels empty on first run. Offering 8 one-click
 * starters (review PR, triage bug, refactor, docs, security, perf, etc.)
 * lets the user submit something useful immediately and see the full
 * routing + delegation + reporting flow without staring at a blank form.
 *
 * Parent owns positioning (`anchor`) and visibility (`open`). When
 * `anchor` is null we center the popover in the viewport so callers that
 * don't have a button position handy still render sensibly (e.g. triggered
 * from a keyboard shortcut). Escape or a backdrop click dismisses, and
 * Arrow Up/Down + Enter drive the keyboard flow. First row is auto-focused
 * on open so a user can pick purely by keyboard.
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  BookOpen,
  Bug,
  ClipboardList,
  Gauge,
  Hammer,
  Rocket,
  Shield,
  TestTube2
} from 'lucide-react'
import type { Priority } from '../../shared/orchestra'

export interface TaskTemplate {
  id: string
  title: string
  body: string
  priority: Priority
  tags: string[]
  /** Hint for routing display only — not persisted with the task. */
  suggestedRole?: string
}

interface Props {
  open: boolean
  anchor: { x: number; y: number } | null
  onClose: () => void
  onPick: (template: TaskTemplate) => void
}

/** Width (px) of the floating popover. Kept tight so it doesn't compete
 *  with a nearby compose form. */
const WIDTH = 280
/** Max-height (px) before the list scrolls. Sized to fit ~5 rows. */
const MAX_HEIGHT = 360
/** Viewport margin so the popover never touches the window edge when
 *  clamped away from an anchor near the corner. */
const VIEWPORT_MARGIN = 8

const PRIORITY_PILL: Record<Priority, string> = {
  P0: 'border-red-500/70 bg-red-500/20 text-red-200',
  P1: 'border-amber-500/70 bg-amber-500/20 text-amber-200',
  P2: 'border-sky-500/60 bg-sky-500/15 text-sky-200',
  P3: 'border-border-mid bg-bg-3 text-text-2'
}

/** Icon per template id — kept outside the data array so TASK_TEMPLATES
 *  stays a plain serializable record (easier to snapshot in tests). */
const ICON_FOR: Record<string, React.ReactElement> = {
  'review-pr': <ClipboardList size={14} aria-hidden />,
  'triage-bug': <Bug size={14} aria-hidden />,
  'write-tests': <TestTube2 size={14} aria-hidden />,
  'refactor-module': <Hammer size={14} aria-hidden />,
  'write-docs': <BookOpen size={14} aria-hidden />,
  'security-audit': <Shield size={14} aria-hidden />,
  'perf-hunt': <Gauge size={14} aria-hidden />,
  'release-prep': <Rocket size={14} aria-hidden />
}

export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  {
    id: 'review-pr',
    title: 'Review PR #{{number}}',
    body: [
      'Repo: {{repo}}',
      'PR: {{pr-link}}',
      'Focus: {{what to look at — idiomatic Go, test coverage, etc}}'
    ].join('\n'),
    priority: 'P1',
    tags: ['review', 'pr'],
    suggestedRole: 'reviewer'
  },
  {
    id: 'triage-bug',
    title: 'Triage: {{summary}}',
    body: [
      'Summary: {{one-line description}}',
      'Stack trace:',
      '{{paste stack trace here}}',
      '',
      'Reproduction:',
      '1. {{first step}}',
      '2. {{second step}}',
      'Expected: {{expected behavior}}',
      'Actual: {{actual behavior}}'
    ].join('\n'),
    priority: 'P1',
    tags: ['bug', 'triage']
  },
  {
    id: 'write-tests',
    title: 'Write tests for {{module}}',
    body: [
      'Module: {{path/to/module}}',
      'Target coverage: {{e.g. 80%}}',
      'Critical paths:',
      '- {{path 1}}',
      '- {{path 2}}',
      'Notes: {{edge cases, mocks, fixtures}}'
    ].join('\n'),
    priority: 'P2',
    tags: ['test', 'coverage']
  },
  {
    id: 'refactor-module',
    title: 'Refactor {{module}}',
    body: [
      'Module: {{path/to/module}}',
      'Goal: {{what needs to change and why}}',
      'Constraints: {{public API stability, perf budget, etc}}',
      'Out of scope: {{what NOT to touch}}'
    ].join('\n'),
    priority: 'P2',
    tags: ['refactor']
  },
  {
    id: 'write-docs',
    title: 'Write docs for {{feature}}',
    body: [
      'Feature: {{feature name}}',
      'Audience: {{end-user / integrator / internal}}',
      'Sections:',
      '- Overview',
      '- Usage / examples',
      '- Gotchas',
      'Links: {{related PRs, designs, tickets}}'
    ].join('\n'),
    priority: 'P3',
    tags: ['docs']
  },
  {
    id: 'security-audit',
    title: 'Security audit: {{scope}}',
    body: [
      'Scope: {{service / module / endpoint}}',
      'Threat model: {{STRIDE / top risks}}',
      'Checklist:',
      '- AuthN / AuthZ',
      '- Input validation',
      '- Secret handling',
      '- Dependency CVEs',
      'Deliverable: {{report / PR / tickets}}'
    ].join('\n'),
    priority: 'P0',
    tags: ['security', 'audit']
  },
  {
    id: 'perf-hunt',
    title: 'Performance regression hunt: {{area}}',
    body: [
      'Area: {{endpoint / flow / query}}',
      'Baseline: {{previous p50/p95/p99}}',
      'Current: {{observed metric}}',
      'Suspected commits: {{sha range or PR links}}',
      'Profile / trace: {{link to flamegraph, pprof, etc}}'
    ].join('\n'),
    priority: 'P1',
    tags: ['performance']
  },
  {
    id: 'release-prep',
    title: 'Release prep: {{version}}',
    body: [
      'Version: {{vX.Y.Z}}',
      'Checklist:',
      '- Changelog updated',
      '- Migrations reviewed',
      '- Feature flags audited',
      '- Rollback plan documented',
      '- On-call notified',
      'Ship window: {{date / window}}'
    ].join('\n'),
    priority: 'P2',
    tags: ['release']
  }
] as const

/** One-line preview of the body for the row subtitle. Collapses newlines
 *  so the truncate CSS can actually clip — without this, a body whose
 *  first line is short would leave the second line visible. */
function bodyPreview(body: string): string {
  return body.replace(/\s+/g, ' ').trim()
}

export default function TaskTemplatesMenu({ open, anchor, onClose, onPick }: Props) {
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Clamp the anchor point into the viewport so the popover is always
  // fully visible even if the caller passes coordinates near a corner.
  // Computed lazily — anchor is usually stable for the lifetime of an
  // open popover, but recomputing on every render is cheap enough.
  const position = useMemo(() => {
    if (!anchor) return null
    if (typeof window === 'undefined') return { left: anchor.x, top: anchor.y }
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - WIDTH - VIEWPORT_MARGIN)
    const maxTop = Math.max(
      VIEWPORT_MARGIN,
      window.innerHeight - MAX_HEIGHT - VIEWPORT_MARGIN
    )
    return {
      left: Math.min(Math.max(anchor.x, VIEWPORT_MARGIN), maxLeft),
      top: Math.min(Math.max(anchor.y, VIEWPORT_MARGIN), maxTop)
    }
  }, [anchor])

  // Focus the first row on open. Deferred to a microtask because the
  // buttons are conditionally rendered — focusing in the same render would
  // run before the refs are attached.
  useEffect(() => {
    if (!open) return
    queueMicrotask(() => rowRefs.current[0]?.focus())
  }, [open])

  // Global listeners for Escape and outside clicks. We attach to `window`
  // rather than a wrapping overlay so the popover doesn't steal focus from
  // whatever triggered it (e.g. a compose textarea should stay usable
  // until the user actively interacts with the menu).
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      const el = containerRef.current
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        onClose()
      }
    }
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDocMouseDown)
    window.addEventListener('keydown', onDocKeyDown)
    return () => {
      window.removeEventListener('mousedown', onDocMouseDown)
      window.removeEventListener('keydown', onDocKeyDown)
    }
  }, [open, onClose])

  const activate = useCallback(
    (tpl: TaskTemplate) => {
      onPick(tpl)
      onClose()
    },
    [onPick, onClose]
  )

  const onRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = (index + 1) % TASK_TEMPLATES.length
        rowRefs.current[next]?.focus()
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = (index - 1 + TASK_TEMPLATES.length) % TASK_TEMPLATES.length
        rowRefs.current[prev]?.focus()
        return
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        const target = TASK_TEMPLATES[index]
        if (target) activate(target)
      }
    },
    [activate]
  )

  if (!open) return null

  // Centered fallback when no anchor is provided. We use fixed positioning
  // with transform instead of flex so the popover keeps its hard width
  // even when the parent has unusual layout.
  const style: React.CSSProperties = position
    ? { left: position.left, top: position.top }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label="Task templates"
      className="fixed z-[200] overflow-hidden rounded-lg border border-border-mid bg-bg-2 shadow-2xl"
      style={{ width: WIDTH, maxHeight: MAX_HEIGHT, ...style }}
    >
      <div className="border-b border-border-mid px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-3">
        Task templates
      </div>
      <div
        className="overflow-y-auto py-1"
        style={{ maxHeight: MAX_HEIGHT - 32 }}
      >
        {TASK_TEMPLATES.map((tpl, i) => {
          const icon = ICON_FOR[tpl.id]
          const preview = bodyPreview(tpl.body)
          const visibleTags = tpl.tags.slice(0, 3)
          return (
            <button
              key={tpl.id}
              type="button"
              role="menuitem"
              ref={(el) => {
                rowRefs.current[i] = el
              }}
              onClick={() => activate(tpl)}
              onKeyDown={(e) => onRowKeyDown(e, i)}
              className="flex w-full flex-col gap-1 px-3 py-2 text-left outline-none hover:bg-bg-3 focus:bg-bg-3"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`shrink-0 rounded-sm border px-1 py-[1px] text-[9px] font-semibold tracking-wider ${PRIORITY_PILL[tpl.priority]}`}
                  aria-label={`Priority ${tpl.priority}`}
                >
                  {tpl.priority}
                </span>
                {icon ? <span className="shrink-0 text-text-3">{icon}</span> : null}
                <span className="truncate text-sm font-semibold text-text-1">
                  {tpl.title}
                </span>
              </div>
              <div
                className="truncate text-xs text-text-4"
                title={preview}
              >
                {preview}
              </div>
              {visibleTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {visibleTags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded border border-border-mid bg-bg-3 px-1.5 py-[1px] text-[10px] text-text-3"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
