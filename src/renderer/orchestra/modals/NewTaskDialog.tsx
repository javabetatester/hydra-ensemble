/**
 * NewTaskDialog — centred modal that creates a new task in a chosen
 * team-instance.
 *
 * Self-contained: open state and initial context come from
 * `useNewTaskDialog`, so every surface that wants to create a task
 * (CanvasFabs FAB, TasksPanel button, IssuesPanel button, AgentCard
 * "Assign task" button, command palette entry, sidebar context menu,
 * global shortcut, `/` on the canvas) routes through it. There is no
 * other path to task submission in the UI.
 *
 * When opened with `context.projectPath`, the dialog resolves the
 * project's instances via IPC and auto-selects the only one (or
 * shows a picker for >1, an empty state for 0). With
 * `context.assignedAgentId`, it pre-selects that agent in the
 * assignee dropdown. Without context it falls back to the
 * orchestrator's `activeTeamId`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import type { Priority, TeamInstance, UUID } from '../../../shared/orchestra'
import { useOrchestra } from '../state/orchestra'
import { useToasts } from '../../state/toasts'
import { useNewTaskDialog } from '../../state/newTaskDialog'
import { useApplyTemplateDialog } from '../../state/applyTemplateDialog'

/** Priority cycle order — visible left-to-right in the pill row. */
const PRIORITIES: readonly Priority[] = ['P0', 'P1', 'P2', 'P3']

/** Pill palette for each priority. */
const PRIORITY_STYLE: Record<Priority, string> = {
  P0: 'border-red-500/60 bg-red-500/15 text-red-300',
  P1: 'border-amber-500/60 bg-amber-500/15 text-amber-300',
  P2: 'border-sky-500/50 bg-sky-500/10 text-sky-300',
  P3: 'border-border-mid bg-bg-3 text-text-3'
}

/** Sentinel values for the assignee select. `__auto__` leaves the router
 *  to pick; `__main__` explicitly targets the team's main agent. Any other
 *  value is a real Agent.id. */
const AUTO = '__auto__'
const MAIN = '__main__'

export default function NewTaskDialog() {
  const open = useNewTaskDialog((s) => s.open)
  const context = useNewTaskDialog((s) => s.context)
  const onClose = useNewTaskDialog((s) => s.hide)
  const showApplyTemplate = useApplyTemplateDialog((s) => s.show)

  const activeTeamId = useOrchestra((s) => s.activeTeamId)
  const teams = useOrchestra((s) => s.teams)
  const agents = useOrchestra((s) => s.agents)
  const submitTask = useOrchestra((s) => s.submitTask)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<Priority>('P2')
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [assignee, setAssignee] = useState<string>(AUTO)
  const [submitting, setSubmitting] = useState(false)

  // Instance resolution. When the dialog opens with `context.instanceId`
  // we use it directly; with `context.projectPath` we ask main for the
  // instances bound to that project; otherwise we fall back to whatever
  // the orchestra view considers active. The fallback path keeps the
  // legacy "click the FAB inside OrchestraView" flow working.
  const [availableInstances, setAvailableInstances] = useState<TeamInstance[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<UUID | null>(null)

  const titleInputRef = useRef<HTMLInputElement>(null)

  const activeTeam = useMemo(
    () => teams.find((t) => t.id === selectedInstanceId) ?? null,
    [teams, selectedInstanceId]
  )
  const teamAgents = useMemo(
    () =>
      selectedInstanceId
        ? agents.filter((a) => a.teamId === selectedInstanceId)
        : [],
    [agents, selectedInstanceId]
  )
  const mainAgent = useMemo(() => {
    if (!activeTeam?.mainAgentId) return null
    return teamAgents.find((a) => a.id === activeTeam.mainAgentId) ?? null
  }, [activeTeam, teamAgents])

  // Reset form on each open — a stale title from a previous cancelled
  // draft would otherwise linger and look like a zombie submission.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setBody('')
    setPriority('P2')
    setTags([])
    setTagDraft('')
    setAssignee(context.assignedAgentId ?? AUTO)
    setSubmitting(false)
  }, [open, context.assignedAgentId])

  // Resolve the target instance from context. Re-runs whenever the
  // dialog opens with new context. Project-scoped opens go through
  // IPC; the others are local lookups.
  useEffect(() => {
    if (!open) {
      setAvailableInstances([])
      return
    }
    if (context.instanceId) {
      setSelectedInstanceId(context.instanceId)
      setAvailableInstances([])
      return
    }
    if (context.projectPath) {
      let cancelled = false
      void window.api?.orchestra
        ?.instance.list({ projectPath: context.projectPath })
        .then((list) => {
          if (cancelled) return
          setAvailableInstances(list)
          setSelectedInstanceId(list[0]?.id ?? null)
        })
        .catch(() => {
          if (cancelled) return
          setAvailableInstances([])
          setSelectedInstanceId(null)
        })
      return () => {
        cancelled = true
      }
    }
    // No context — use whatever the orchestrator considers active.
    setAvailableInstances([])
    setSelectedInstanceId(activeTeamId)
    return undefined
  }, [open, context.instanceId, context.projectPath, activeTeamId])

  // Autofocus the title after the fade-in settles. Focusing inside the
  // same microtask as mount occasionally misses because the backdrop
  // hasn't finished its animation frame yet.
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => titleInputRef.current?.focus(), 20)
    return () => window.clearTimeout(t)
  }, [open])

  // Esc always cancels. The submit IPC now returns as soon as routing is
  // done (the agent runs asynchronously in main), so holding the modal
  // open while "submitting" is active no longer accomplishes anything.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

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

  const canSubmit =
    !submitting && title.trim().length > 0 && selectedInstanceId !== null

  const resolveAssignee = (): { agentId: string | null } => {
    if (assignee === AUTO) return { agentId: null }
    if (assignee === MAIN) return { agentId: mainAgent?.id ?? null }
    const agent = teamAgents.find((a) => a.id === assignee)
    return { agentId: agent?.id ?? null }
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit || !selectedInstanceId) return
    // Fold any un-committed tag draft so "bug,urgent" + Enter without a
    // trailing comma doesn't drop "urgent".
    const draftTrimmed = tagDraft.trim()
    const baseTags =
      draftTrimmed.length > 0 && !tags.includes(draftTrimmed)
        ? [...tags, draftTrimmed]
        : tags

    const { agentId } = resolveAssignee()

    setSubmitting(true)
    try {
      const task = await submitTask({
        instanceId: selectedInstanceId,
        title: title.trim(),
        body,
        priority,
        tags: baseTags,
        assignedAgentId: agentId ?? undefined
      })
      if (task) {
        onClose()
      }
      // Failure case: `submitTask` already toasts internally; we keep the
      // dialog open so the user can amend and retry without re-typing.
    } catch (err) {
      useToasts.getState().push({
        kind: 'error',
        title: 'Submit task failed',
        body: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setSubmitting(false)
    }
  }

  const onTitleKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSubmit) void submit()
    }
  }

  const onTagKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitTagDraft(tagDraft)
    } else if (
      e.key === 'Backspace' &&
      tagDraft.length === 0 &&
      tags.length > 0
    ) {
      removeTag(tags[tags.length - 1]!)
    }
  }

  if (!open) return null

  return (
    <div
      className="df-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-bg-0/85 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="new task"
    >
      <div
        className="flex w-[480px] max-w-[92vw] flex-col overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-3 py-2">
          <span className="df-label">new task</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="close"
          >
            <X size={12} strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex flex-col gap-3 p-3">
          {/* Target — visible only when invoked with a project context.
               When the picker resolved a single instance (or the FAB
               flow used activeTeamId), we hide this row and rely on
               the header to keep the modal visually focused on the
               task itself. */}
          {context.projectPath ? (
            <div>
              <label className="df-label mb-1.5 block" htmlFor="new-task-instance">
                team in this project
              </label>
              {availableInstances.length === 0 ? (
                <div className="flex items-center justify-between gap-2 rounded-sm border border-status-attention/40 bg-status-attention/5 px-2.5 py-2 text-[11px] leading-relaxed text-text-2">
                  <span>
                    No team applied to{' '}
                    <span className="font-mono text-text-1">{context.projectPath}</span>{' '}
                    yet.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const project = context.projectPath
                      onClose()
                      showApplyTemplate({ projectPath: project })
                    }}
                    className="shrink-0 rounded-sm border border-border-soft bg-bg-1 px-2 py-0.5 font-mono text-[10px] text-text-2 hover:border-border-mid hover:text-text-1"
                  >
                    Apply template
                  </button>
                </div>
              ) : availableInstances.length === 1 ? (
                <div className="rounded-sm border border-border-soft bg-bg-1 px-2.5 py-1.5 font-mono text-[11px] text-text-2">
                  {teams.find((t) => t.id === availableInstances[0]!.id)?.name ??
                    availableInstances[0]!.id}
                </div>
              ) : (
                <div className="relative">
                  <select
                    id="new-task-instance"
                    value={selectedInstanceId ?? ''}
                    onChange={(e) => setSelectedInstanceId(e.target.value || null)}
                    className="w-full appearance-none rounded-sm border border-border-mid bg-bg-1 px-2 py-1.5 pr-7 font-mono text-xs text-text-1 focus:border-accent-500 focus:outline-none"
                  >
                    {availableInstances.map((inst) => {
                      const name = teams.find((t) => t.id === inst.id)?.name ?? inst.id
                      return (
                        <option key={inst.id} value={inst.id}>
                          {name}
                        </option>
                      )
                    })}
                  </select>
                  <ChevronDown
                    size={12}
                    strokeWidth={1.75}
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-3"
                  />
                </div>
              )}
            </div>
          ) : null}

          {/* Title */}
          <div>
            <label className="df-label mb-1.5 block" htmlFor="new-task-title">
              title
            </label>
            <input
              id="new-task-title"
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={onTitleKey}
              placeholder="What needs to be done?"
              className="w-full rounded-sm border border-border-mid bg-bg-1 px-2 py-1.5 font-mono text-xs text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
            />
          </div>

          {/* Body */}
          <div>
            <label className="df-label mb-1.5 block" htmlFor="new-task-body">
              body
            </label>
            <textarea
              id="new-task-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="Describe what needs to be done. You can include `path: src/foo.ts` tokens to hint triggers."
              className="df-scroll w-full resize-none rounded-sm border border-border-mid bg-bg-1 px-2 py-1.5 font-mono text-xs leading-relaxed text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
            />
          </div>

          {/* Priority toggle — 4 pills side by side */}
          <div>
            <label className="df-label mb-1.5 block">priority</label>
            <div
              role="radiogroup"
              aria-label="priority"
              className="flex items-center gap-1"
            >
              {PRIORITIES.map((p) => {
                const sel = p === priority
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    onClick={() => setPriority(p)}
                    className={`h-7 flex-1 rounded-sm border font-mono text-[11px] font-semibold tracking-wider transition ${
                      sel
                        ? PRIORITY_STYLE[p]
                        : 'border-border-soft bg-bg-1 text-text-4 hover:border-border-mid hover:text-text-2'
                    }`}
                  >
                    {p}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="df-label mb-1.5 block" htmlFor="new-task-tag-input">
              tags
            </label>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <input
                  id="new-task-tag-input"
                  type="text"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={onTagKey}
                  onBlur={() => commitTagDraft(tagDraft)}
                  placeholder="Enter or comma to add"
                  className="h-7 w-full rounded-sm border border-border-mid bg-bg-1 px-2 font-mono text-xs text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => commitTagDraft(tagDraft)}
                  disabled={tagDraft.trim().length === 0}
                  className="flex h-7 shrink-0 items-center gap-1 rounded-sm border border-border-soft bg-bg-3 px-2 font-mono text-[10px] text-text-3 hover:bg-bg-4 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Add tag"
                  aria-label="Add tag"
                >
                  <Plus size={10} strokeWidth={2} />
                </button>
              </div>

              {tags.length > 0 ? (
                <ul
                  className="flex flex-wrap items-center gap-1"
                  aria-label="Selected tags"
                >
                  {tags.map((tag) => (
                    <li key={tag}>
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="group flex h-6 items-center gap-1 rounded-sm border border-border-soft bg-bg-3 px-1.5 font-mono text-[10px] text-text-2 hover:border-red-500/50 hover:text-red-300"
                        title={`Remove ${tag}`}
                      >
                        <span>#{tag}</span>
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
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className="df-label mb-1.5 block" htmlFor="new-task-assignee">
              assignee
            </label>
            <div className="relative">
              <select
                id="new-task-assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full appearance-none rounded-sm border border-border-mid bg-bg-1 px-2 py-1.5 pr-7 font-mono text-xs text-text-1 focus:border-accent-500 focus:outline-none"
              >
                <option value={AUTO}>
                  Auto-route (matches triggers; else falls back to main agent)
                </option>
                <option value={MAIN} disabled={!mainAgent}>
                  {mainAgent
                    ? `Main agent (${mainAgent.name})`
                    : 'Main agent (none set)'}
                </option>
                {teamAgents.length > 0 ? (
                  <optgroup label="Agents">
                    {teamAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.role ? ` · ${a.role}` : ''}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <ChevronDown
                size={12}
                strokeWidth={1.75}
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-3"
              />
            </div>
          </div>

          {/* Honest note about the delegation gap. The claude-CLI/OAuth
              runtime can't call the delegate_task tool — only the SDK
              path (ANTHROPIC_API_KEY present) wires orchestration tools.
              Users running without a key see the assigned agent finish
              the whole task solo, which is why a PM task can look like
              it "broadcasts and stops." Surface here so expectations
              match reality until MCP handoff lands. */}
          <div className="rounded-sm border border-border-soft bg-bg-1 px-2.5 py-2 text-[10px] leading-relaxed text-text-4">
            <span className="font-semibold text-text-3">heads up:</span>{' '}
            multi-agent delegation (PM → architect → dev…) currently
            requires an <span className="text-text-2">Anthropic API key</span>.
            Without one we fall back to <span className="text-text-2">claude CLI</span>{' '}
            + OAuth, and the assigned agent handles the task solo. Open{' '}
            <span className="font-semibold text-text-3">Providers</span>{' '}
            to add a key and unlock handoffs.
          </div>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-1.5 border-t border-border-soft bg-bg-1 px-3 py-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-border-soft px-2.5 py-1 text-[11px] text-text-2 hover:border-border-mid hover:bg-bg-3"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="rounded-sm bg-accent-500 px-3 py-1 text-[11px] font-semibold text-bg-0 hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'submitting…' : 'Submit'}
          </button>
        </footer>
      </div>
    </div>
  )
}
