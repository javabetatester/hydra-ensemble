/**
 * TaskBar — 52px bottom-pinned row that owns task submission.
 *
 * Layout: [ title input (flex-1) ] [ priority pill ] [ tags + add ] [ Send ].
 * See PRD.md §10 F5 (submit flow), §11 (layout), §13 (empty states).
 *
 * The actual bottom-bar chrome (border, height, bg) lives in the parent
 * <footer> in OrchestraView — this component only renders the controls so the
 * disabled-state tooltip can still wrap them cleanly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Send, Tag, X } from 'lucide-react'
import { useOrchestra } from './state/orchestra'
import type { Priority } from '../../shared/orchestra'

/** Priority cycle order — P3 (lowest) up to P0 (blocker), then wraps. */
const PRIORITY_ORDER: readonly Priority[] = ['P3', 'P2', 'P1', 'P0']

/** Next priority in the cycle (wraps P0 → P3). */
function nextPriority(p: Priority): Priority {
  const idx = PRIORITY_ORDER.indexOf(p)
  return PRIORITY_ORDER[(idx + 1) % PRIORITY_ORDER.length]!
}

/** Tailwind palette for each priority pill. Matches status tokens in globals.css. */
const PRIORITY_STYLE: Record<Priority, string> = {
  P0: 'border-red-500/60 bg-red-500/15 text-red-300',
  P1: 'border-amber-500/60 bg-amber-500/15 text-amber-300',
  P2: 'border-sky-500/50 bg-sky-500/10 text-sky-300',
  P3: 'border-border-mid bg-bg-3 text-text-3'
}

/** Shared focus event name — Canvas dispatches this on `/` keypress (PRD §12). */
export const FOCUS_TASK_BAR_EVENT = 'orchestra:focus-task-bar'

export default function TaskBar() {
  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const teams = useOrchestra((s) => s.teams)
  const agents = useOrchestra((s) => s.agents)
  const submitTask = useOrchestra((s) => s.submitTask)

  const [title, setTitle] = useState('')
  const [body] = useState('') // MVP: single-line — F5 lets body stay empty.
  const [priority, setPriority] = useState<Priority>('P2')
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const tagInputRef = useRef<HTMLInputElement>(null)

  // Gating: no active team, or the active team has zero agents → disabled.
  // We compute both so the tooltip can be specific per case.
  const { disabled, disabledReason } = useMemo(() => {
    if (teams.length === 0) {
      return { disabled: true, disabledReason: 'Create a team first' }
    }
    if (!activeTeamId) {
      return { disabled: true, disabledReason: 'Select a team first' }
    }
    const teamAgents = agents.filter((a) => a.teamId === activeTeamId)
    if (teamAgents.length === 0) {
      return { disabled: true, disabledReason: 'Add an agent first' }
    }
    return { disabled: false, disabledReason: '' }
  }, [teams.length, activeTeamId, agents])

  const canSubmit = !disabled && title.trim().length > 0 && !submitting

  // Global focus hook — `/` on the canvas (or command palette action) fires
  // `orchestra:focus-task-bar`. We listen here rather than reaching up into
  // OrchestraView so the input ref never leaks through props.
  useEffect(() => {
    const onFocus = (): void => {
      if (disabled) return
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener(FOCUS_TASK_BAR_EVENT, onFocus)
    return () => window.removeEventListener(FOCUS_TASK_BAR_EVENT, onFocus)
  }, [disabled])

  // Commit an in-flight tag draft. Splits on comma so paste-drop of a
  // comma-separated list Just Works.
  const commitTagDraft = useCallback((raw: string): void => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (parts.length === 0) return
    setTags((prev) => {
      const merged = [...prev]
      for (const p of parts) {
        if (!merged.includes(p)) merged.push(p)
      }
      return merged
    })
    setTagDraft('')
  }, [])

  const removeTag = useCallback((tag: string): void => {
    setTags((prev) => prev.filter((t) => t !== tag))
  }, [])

  const resetForm = useCallback((): void => {
    setTitle('')
    setTags([])
    setTagDraft('')
    setShowTagInput(false)
    // Priority intentionally preserved between submits — users commonly
    // triage a batch at the same urgency.
  }, [])

  const onSubmit = useCallback(async (): Promise<void> => {
    if (!canSubmit || !activeTeamId) return
    // Fold any un-committed tag draft in before sending so typing
    // "bug,urgent" + Enter without hitting comma last doesn't drop "urgent".
    const finalTags = tagDraft.trim().length > 0 ? mergeTag(tags, tagDraft) : tags
    setSubmitting(true)
    try {
      const task = await submitTask({
        teamId: activeTeamId,
        title: title.trim(),
        body,
        priority,
        tags: finalTags
      })
      if (task) resetForm()
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, activeTeamId, tagDraft, tags, submitTask, title, body, priority, resetForm])

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void onSubmit()
    }
  }

  const onTagKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitTagDraft(tagDraft)
    } else if (e.key === 'Backspace' && tagDraft.length === 0 && tags.length > 0) {
      // Symmetrical with most chip-inputs: backspace on empty draft peels the
      // last chip instead of doing nothing.
      removeTag(tags[tags.length - 1]!)
    } else if (e.key === 'Escape') {
      setShowTagInput(false)
      setTagDraft('')
    }
  }

  return (
    <div
      data-coach="task-bar"
      className="flex w-full items-center gap-2"
      title={disabled ? disabledReason : undefined}
      aria-disabled={disabled}
    >
      {/* Title input — flex-1 dominates the bar */}
      <div className="relative flex min-w-0 flex-1 items-center">
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onInputKey}
          disabled={disabled}
          placeholder={
            disabled
              ? disabledReason
              : 'Describe the task…  (Enter to submit)'
          }
          className="h-8 w-full rounded-md border border-border-soft bg-bg-3 px-3 font-mono text-xs text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Task title"
        />
      </div>

      {/* Priority pill — click to cycle */}
      <button
        type="button"
        onClick={() => setPriority((p) => nextPriority(p))}
        disabled={disabled}
        title={`Priority: ${priority} — click to cycle`}
        className={`h-8 rounded-md border px-2 font-mono text-[11px] font-semibold tracking-wider hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-60 ${PRIORITY_STYLE[priority]}`}
        aria-label={`Task priority, currently ${priority}. Click to cycle.`}
      >
        {priority}
      </button>

      {/* Tags row + add button */}
      <div className="flex items-center gap-1">
        {tags.length > 0 ? (
          <ul className="flex items-center gap-1" aria-label="Selected tags">
            {tags.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  disabled={disabled}
                  className="group flex h-6 items-center gap-1 rounded-sm border border-border-soft bg-bg-3 px-1.5 font-mono text-[10px] text-text-2 hover:border-red-500/50 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-60"
                  title={`Remove ${tag}`}
                >
                  <span>{tag}</span>
                  <X
                    size={10}
                    strokeWidth={2}
                    className="text-text-4 group-hover:text-red-300"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {showTagInput ? (
          <input
            ref={tagInputRef}
            type="text"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={onTagKey}
            onBlur={() => {
              commitTagDraft(tagDraft)
              setShowTagInput(false)
            }}
            placeholder="tag,tag"
            className="h-6 w-24 rounded-sm border border-border-soft bg-bg-3 px-1.5 font-mono text-[10px] text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
            aria-label="Add tag"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setShowTagInput(true)
              // Defer focus so the input exists first — avoids a
              // `focus()` on the button that just vanished.
              setTimeout(() => tagInputRef.current?.focus(), 0)
            }}
            disabled={disabled}
            className="flex h-6 items-center gap-1 rounded-sm border border-border-soft bg-bg-3 px-1.5 font-mono text-[10px] text-text-3 hover:bg-bg-4 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-60"
            title="Add tag"
            aria-label="Add tag"
          >
            {tags.length === 0 ? (
              <>
                <Tag size={10} strokeWidth={1.75} />
                <span>tags</span>
              </>
            ) : (
              <Plus size={10} strokeWidth={2} />
            )}
          </button>
        )}
      </div>

      {/* Send */}
      <button
        type="button"
        onClick={() => void onSubmit()}
        disabled={!canSubmit}
        className="flex h-8 items-center gap-1.5 rounded-md border border-accent-600 bg-accent-500/90 px-3 font-mono text-[11px] font-semibold text-bg-0 hover:bg-accent-500 disabled:cursor-not-allowed disabled:border-border-soft disabled:bg-bg-3 disabled:text-text-4"
        title={
          disabled
            ? disabledReason
            : title.trim().length === 0
              ? 'Write a task title first'
              : 'Submit task (Enter)'
        }
        aria-label="Submit task"
      >
        <Send size={12} strokeWidth={1.75} />
        {submitting ? 'sending…' : 'Send'}
      </button>
    </div>
  )
}

/** Dedup-and-append helper for the "on Enter without trailing comma" case. */
function mergeTag(prev: string[], draft: string): string[] {
  const t = draft.trim()
  if (t.length === 0) return prev
  if (prev.includes(t)) return prev
  return [...prev, t]
}
