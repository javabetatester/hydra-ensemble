/**
 * NewTeamDialog — first-class modal for creating an Orchestra team.
 *
 * Replaces the previous `window.prompt` + direct `project.pickDirectory`
 * dance. User sees a real form with a folder picker, validation, and a
 * Create button that stays disabled until the inputs are viable.
 *
 * Optionally pre-filled from a starter template id (PR review, Feature
 * factory, Bug triage). If a template is picked, the dialog calls the
 * Templates provisioning path via `TEAM_TEMPLATES` lookup; otherwise
 * a blank team is created and the user is dropped into the wizard.
 */

import { useEffect, useRef, useState } from 'react'
import {
  FolderOpen,
  Loader2,
  Network,
  Sparkles,
  X
} from 'lucide-react'
import { useOrchestra } from '../state/orchestra'
import { useToasts } from '../../state/toasts'
import {
  TEAM_TEMPLATES,
  materializeAgentDrafts,
  materializeEdgeDrafts
} from '../lib/templates'

export type NewTeamMode = 'blank' | 'template'

export interface NewTeamDialogProps {
  open: boolean
  mode: NewTeamMode
  /** When mode is 'template', pick one of the ids in TEAM_TEMPLATES. */
  templateId?: string
  onClose: () => void
  /** Called after the team (+ agents + edges) are created. */
  onCreated?: (teamId: string) => void
}

export default function NewTeamDialog({
  open,
  mode,
  templateId,
  onClose,
  onCreated
}: NewTeamDialogProps) {
  const createTeam = useOrchestra((s) => s.createTeam)
  const createAgent = useOrchestra((s) => s.createAgent)
  const createEdge = useOrchestra((s) => s.createEdge)
  const pushToast = useToasts((s) => s.push)

  const template =
    mode === 'template' && templateId
      ? TEAM_TEMPLATES.find((t) => t.id === templateId)
      : undefined

  const [name, setName] = useState<string>('')
  const [worktree, setWorktree] = useState<string>('')
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const firstInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setName(template?.name ?? '')
    setWorktree('')
    setSubmitting(false)
    setError(null)
    setTimeout(() => firstInputRef.current?.focus(), 0)
  }, [open, template])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, submitting, onClose])

  if (!open) return null

  const pickFolder = async (): Promise<void> => {
    const api = (window as unknown as {
      api?: { project?: { pickDirectory?: () => Promise<string | null> } }
    }).api
    const fn = api?.project?.pickDirectory
    if (!fn) {
      setError('Folder picker not available in this build')
      return
    }
    const picked = await fn()
    if (picked) setWorktree(picked)
  }

  const canSubmit =
    !submitting && name.trim().length > 0 && worktree.trim().length > 0

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const team = await createTeam({
        name: name.trim(),
        worktreePath: worktree.trim(),
        safeMode: template?.defaultSafeMode,
        defaultModel: template?.defaultModel
      })
      if (!team) {
        // createTeam surfaces its own toast on failure.
        setSubmitting(false)
        return
      }

      // For a template, walk the drafts sequentially so the user sees
      // each agent pop in. Any partial failure keeps the team around —
      // the user can still work on it.
      if (template) {
        const drafts = materializeAgentDrafts(template)
        const idByKey: Record<string, string> = {}
        for (const draft of drafts) {
          const agent = await createAgent({ ...draft, teamId: team.id })
          if (!agent) continue
          idByKey[draft.localKey] = agent.id
        }
        const edgeDrafts = materializeEdgeDrafts(template, idByKey)
        for (const e of edgeDrafts) {
          await createEdge({ ...e, teamId: team.id })
        }
        pushToast({
          kind: 'success',
          title: 'Team ready',
          body: `${team.name} · ${drafts.length} agents provisioned`
        })
      } else {
        pushToast({
          kind: 'success',
          title: 'Team created',
          body: team.name
        })
      }

      onCreated?.(team.id)
      onClose()
    } catch (err) {
      setError((err as Error).message || 'failed to create team')
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-bg-0/85 backdrop-blur-md df-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={template ? `Create team from ${template.name}` : 'Create new team'}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}
      >
        <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-4 py-3">
          <div className="flex items-center gap-2">
            {template ? (
              <Sparkles size={14} strokeWidth={1.75} className="text-accent-400" />
            ) : (
              <Network size={14} strokeWidth={1.75} className="text-accent-400" />
            )}
            <span className="df-label text-sm font-semibold text-text-1">
              {template ? `Template · ${template.name}` : 'New team'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1 disabled:opacity-40"
            aria-label="close"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {template ? (
            <div className="rounded-sm border border-border-soft bg-bg-1 p-3 text-[11px] text-text-3">
              {template.tagline}
              <div className="mt-1 font-mono text-[10px] text-text-4">
                {template.agents.length} agents · {template.edges.length} edges · safeMode{' '}
                <span className="text-text-2">{template.defaultSafeMode}</span>
              </div>
            </div>
          ) : null}

          <div>
            <label className="df-label mb-1 block">Team name</label>
            <input
              ref={firstInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) void submit()
              }}
              placeholder="e.g. Release Reviewers"
              className="w-full rounded-sm border border-border-mid bg-bg-1 px-2.5 py-1.5 text-sm text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="df-label mb-1 flex items-center justify-between">
              <span>Worktree folder</span>
              <span className="font-mono text-[10px] text-text-4">
                must be a git repo checkout
              </span>
            </label>
            <div className="flex items-stretch gap-2">
              <input
                type="text"
                value={worktree}
                onChange={(e) => setWorktree(e.target.value)}
                placeholder="/path/to/your/repo"
                className="flex-1 rounded-sm border border-border-mid bg-bg-1 px-2.5 py-1.5 font-mono text-[11px] text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
                disabled={submitting}
              />
              <button
                type="button"
                onClick={() => void pickFolder()}
                disabled={submitting}
                className="flex items-center gap-1.5 rounded-sm border border-border-mid bg-bg-2 px-3 py-1.5 text-[11px] text-text-2 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FolderOpen size={12} strokeWidth={1.75} />
                <span>Pick…</span>
              </button>
            </div>
            <p className="mt-1 text-[10px] text-text-4">
              Orchestrador agents run inside this folder. They can only read/write files beneath it.
            </p>
          </div>

          {error ? (
            <div className="rounded-sm border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border-soft bg-bg-1 px-4 py-3">
          <div className="font-mono text-[10px] text-text-4">
            {worktree
              ? `~/.hydra-ensemble/orchestra/teams/${slugHint(name)}`
              : 'Pick a folder to continue'}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-sm border border-border-soft px-3 py-1.5 text-[11px] text-text-2 hover:border-border-mid hover:bg-bg-3"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="flex items-center gap-1.5 rounded-sm bg-accent-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? (
                <Loader2 size={12} className="animate-spin" strokeWidth={1.75} />
              ) : null}
              <span>{template ? 'Create + provision' : 'Create team'}</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function slugHint(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'team'
}
