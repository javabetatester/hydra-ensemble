/**
 * ApplyTemplateDialog — pick an existing TeamTemplate and apply it to
 * a project. The resulting `TeamInstance` shares its template with any
 * sibling instances that already use it; the worktree is provisioned
 * with a fresh copy of soul/skills/triggers cloned from one of those
 * siblings.
 *
 * Phase 4 of issue #12. Self-contained: open state and pre-filled
 * project come from `useApplyTemplateDialog`.
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type { TeamTemplate } from '../../../shared/orchestra'
import { useOrchestra } from '../state/orchestra'
import { useProjects } from '../../state/projects'
import { useToasts } from '../../state/toasts'
import { useApplyTemplateDialog } from '../../state/applyTemplateDialog'

export default function ApplyTemplateDialog() {
  const open = useApplyTemplateDialog((s) => s.open)
  const context = useApplyTemplateDialog((s) => s.context)
  const onClose = useApplyTemplateDialog((s) => s.hide)

  const projects = useProjects((s) => s.projects)
  const currentPath = useProjects((s) => s.currentPath)
  const applyTemplate = useOrchestra((s) => s.applyTemplate)

  const [templates, setTemplates] = useState<TeamTemplate[]>([])
  const [templateId, setTemplateId] = useState<string>('')
  const [projectPath, setProjectPath] = useState<string>('')
  const [name, setName] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  // Load templates whenever the dialog is opened — small list, cheap
  // call, and keeps the picker fresh after a team is created elsewhere.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.api?.orchestra
      ?.template.list()
      .then((list) => {
        if (cancelled) return
        setTemplates(list)
        // Honour pre-selection from context (e.g. Templates Library
        // "Apply" click). Fall back to the first template if the
        // requested id no longer exists.
        const preferred = context.templateId
        if (preferred && list.some((t) => t.id === preferred)) {
          setTemplateId(preferred)
        } else {
          setTemplateId(list[0]?.id ?? '')
        }
      })
      .catch(() => {
        if (cancelled) return
        setTemplates([])
      })
    return () => {
      cancelled = true
    }
  }, [open, context.templateId])

  // Seed projectPath from context, falling back to currentPath, falling
  // back to the first known project. Reset name so a previous draft
  // doesn't bleed across opens.
  useEffect(() => {
    if (!open) return
    setProjectPath(context.projectPath ?? currentPath ?? projects[0]?.path ?? '')
    setName('')
    setSubmitting(false)
  }, [open, context.projectPath, currentPath, projects])

  const selected = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId]
  )

  // Esc cancels.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const canSubmit =
    !submitting && templateId.length > 0 && projectPath.trim().length > 0

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const inst = await applyTemplate({
        templateId,
        worktreePath: projectPath.trim(),
        projectPath: projectPath.trim(),
        ...(name.trim().length > 0 ? { name: name.trim() } : {})
      })
      if (inst) onClose()
      // Failure path is toasted by `applyTemplate` itself.
    } catch (err) {
      useToasts.getState().push({
        kind: 'error',
        title: 'Apply template failed',
        body: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setSubmitting(false)
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
      aria-label="apply team template"
    >
      <div
        className="flex w-[440px] max-w-[92vw] flex-col overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-3 py-2">
          <span className="df-label">apply team template</span>
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
          {templates.length === 0 ? (
            <div className="rounded-sm border border-status-attention/40 bg-status-attention/5 px-2.5 py-2 text-[11px] leading-relaxed text-text-2">
              No team templates yet. Create a team in the Orchestrator
              first — that registers a template you can apply to other
              projects.
            </div>
          ) : (
            <>
              <div>
                <label className="df-label mb-1.5 block" htmlFor="apply-tpl">
                  template
                </label>
                <div className="relative">
                  <select
                    id="apply-tpl"
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className="w-full appearance-none rounded-sm border border-border-mid bg-bg-1 px-2 py-1.5 pr-7 font-mono text-xs text-text-1 focus:border-accent-500 focus:outline-none"
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={12}
                    strokeWidth={1.75}
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-3"
                  />
                </div>
              </div>

              <div>
                <label className="df-label mb-1.5 block" htmlFor="apply-project">
                  project
                </label>
                {projects.length > 0 ? (
                  <div className="relative">
                    <select
                      id="apply-project"
                      value={projectPath}
                      onChange={(e) => setProjectPath(e.target.value)}
                      className="w-full appearance-none rounded-sm border border-border-mid bg-bg-1 px-2 py-1.5 pr-7 font-mono text-xs text-text-1 focus:border-accent-500 focus:outline-none"
                    >
                      {projects.map((p) => (
                        <option key={p.path} value={p.path}>
                          {p.name} — {p.path}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={12}
                      strokeWidth={1.75}
                      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-3"
                    />
                  </div>
                ) : (
                  <input
                    id="apply-project"
                    type="text"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder="/absolute/path/to/project"
                    className="w-full rounded-sm border border-border-mid bg-bg-1 px-2 py-1.5 font-mono text-xs text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
                  />
                )}
              </div>

              <div>
                <label className="df-label mb-1.5 block" htmlFor="apply-name">
                  name (optional)
                </label>
                <input
                  id="apply-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={selected?.name ?? ''}
                  className="w-full rounded-sm border border-border-mid bg-bg-1 px-2 py-1.5 font-mono text-xs text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
                />
              </div>
            </>
          )}
        </div>

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
            {submitting ? 'applying…' : 'Apply'}
          </button>
        </footer>
      </div>
    </div>
  )
}
