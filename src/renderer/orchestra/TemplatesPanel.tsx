/**
 * TemplatesPanel — left-side collapsible panel listing every
 * `TeamTemplate` known to the orchestrator. Phase-1 of the
 * panel-system rework: gives the "Templates Library" hierarchy level
 * a dedicated surface, separate from the canvas (a single instance)
 * and the projects panel (instances grouped by worktreePath).
 *
 * Each card surfaces the minimum the user needs to decide what to do
 * with the template:
 *   - name
 *   - main agent slug (the entry-point persona)
 *   - count of instances currently using it (helps spot orphan
 *     templates and "popular" ones at a glance)
 *
 * Two actions per card:
 *   - Apply…  → opens ApplyTemplateDialog with `templateId`
 *               pre-selected; the user picks the project there.
 *   - Export  → reuses the per-instance `team.export` IPC against
 *               the first instance bound to this template (the
 *               worktreePath isn't carried in the export, so any
 *               instance produces an equivalent template snapshot).
 *
 * Edit-of-template and Delete-template are intentionally not here
 * yet — both have UX questions worth resolving in their own commits
 * (see the panel-system plan for the open questions).
 */

import { useMemo } from 'react'
import { Boxes, Download, FolderPlus, X } from 'lucide-react'
import { useOrchestra } from './state/orchestra'
import { useApplyTemplateDialog } from '../state/applyTemplateDialog'
import { useOrchestraPanels } from '../state/orchestraPanels'
import { useToasts } from '../state/toasts'

export default function TemplatesPanel() {
  const open = useOrchestraPanels((s) => s.templates)
  const close = useOrchestraPanels((s) => s.toggleTemplates)

  const templates = useOrchestra((s) => s.templates)
  const instances = useOrchestra((s) => s.instances)
  const showApply = useApplyTemplateDialog((s) => s.show)
  const pushToast = useToasts((s) => s.push)

  /** Map templateId → instance count, recomputed when instances
   *  change. Cheap (linear pass). */
  const instanceCountByTemplate = useMemo(() => {
    const map = new Map<string, number>()
    for (const inst of instances) {
      map.set(inst.templateId, (map.get(inst.templateId) ?? 0) + 1)
    }
    return map
  }, [instances])

  const exportTemplate = async (templateId: string): Promise<void> => {
    // The TeamExportV1 shape has no worktreePath, so any instance of
    // this template produces an equivalent snapshot. Pick the oldest
    // one for stability across exports.
    const candidate = instances
      .filter((i) => i.templateId === templateId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    if (!candidate) {
      pushToast({
        kind: 'error',
        title: 'Cannot export',
        body: 'Template has no instances to export from.'
      })
      return
    }
    try {
      const r = await window.api?.orchestra?.team.export(candidate.id)
      if (r?.ok && r.value) {
        pushToast({
          kind: 'info',
          title: 'Exported template',
          body: `Saved to ${r.value}`
        })
      }
    } catch (err) {
      pushToast({
        kind: 'error',
        title: 'Export failed',
        body: err instanceof Error ? err.message : String(err)
      })
    }
  }

  if (!open) return null

  return (
    <aside
      aria-label="Templates Library"
      className="flex h-full w-[260px] shrink-0 flex-col border-r border-border-soft bg-bg-2 text-text-2"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border-soft px-3">
        <div className="flex items-center gap-2">
          <Boxes size={13} strokeWidth={1.75} className="text-accent-400" />
          <span className="df-label">templates</span>
          {templates.length > 0 ? (
            <span className="font-mono text-[10px] text-text-4">
              {templates.length}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={close}
          title="Close (Ctrl+Shift+L)"
          aria-label="Close templates panel"
          className="rounded-sm p-1 text-text-4 hover:bg-bg-3 hover:text-text-1"
        >
          <X size={12} strokeWidth={1.75} />
        </button>
      </header>

      <div className="df-scroll flex-1 overflow-y-auto p-2">
        {templates.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <Boxes
              size={20}
              strokeWidth={1.5}
              className="mx-auto mb-2 text-text-4"
            />
            <div className="text-[11px] leading-relaxed text-text-4">
              No templates yet. Create a team in the canvas — its
              definition becomes a reusable template you can apply to
              other projects from here.
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {templates.map((tpl) => {
              const count = instanceCountByTemplate.get(tpl.id) ?? 0
              return (
                <li
                  key={tpl.id}
                  className="rounded-sm border border-border-soft bg-bg-1 p-2"
                >
                  <div
                    className="truncate text-[12px] font-medium text-text-1"
                    title={tpl.name}
                  >
                    {tpl.name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-text-4">
                    {tpl.mainAgentSlug ? (
                      <span title="Main agent">
                        ⮞ {tpl.mainAgentSlug}
                      </span>
                    ) : (
                      <span className="italic">no main</span>
                    )}
                    <span aria-hidden>·</span>
                    <span title="Instances bound to this template">
                      {count} instance{count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => showApply({ templateId: tpl.id })}
                      className="flex items-center gap-1 rounded-sm border border-accent-500/40 bg-accent-500/10 px-2 py-0.5 font-mono text-[10px] text-accent-300 hover:bg-accent-500/20"
                      title="Apply this template to a project"
                    >
                      <FolderPlus size={10} strokeWidth={1.75} />
                      Apply…
                    </button>
                    <button
                      type="button"
                      onClick={() => void exportTemplate(tpl.id)}
                      disabled={count === 0}
                      className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-2 py-0.5 font-mono text-[10px] text-text-3 hover:border-border-mid hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
                      title={
                        count === 0
                          ? 'No instance to export from'
                          : 'Export template as JSON'
                      }
                    >
                      <Download size={10} strokeWidth={1.75} />
                      Export
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
