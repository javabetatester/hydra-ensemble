/**
 * GenerateTeamDialog — design a team from a free-text prompt.
 *
 * Stages: prompting → generating → previewing → provisioning. The
 * provisioning step reuses the existing `importProvision` IPC since the
 * generator output is already a `TeamExportV1`.
 */
import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Sparkles, Users } from 'lucide-react'
import type { TeamExportV1 } from '../../shared/orchestra'
import Modal from '../ui/Modal'
import { useOrchestra } from './state/orchestra'

interface Props {
  open: boolean
  onClose: () => void
}

type Stage = 'prompting' | 'generating' | 'previewing' | 'provisioning'

const PROMPT_PLACEHOLDER =
  'e.g. "Time para fazer code review de PRs em Go com foco em segurança e cobertura de testes"'
const MIN_PROMPT_LENGTH = 10
const DEFAULT_MAX_AGENTS = 6

export default function GenerateTeamDialog({ open, onClose }: Props) {
  const setActiveTeam = useOrchestra((s) => s.setActiveTeam)

  const [stage, setStage] = useState<Stage>('prompting')
  const [prompt, setPrompt] = useState('')
  const [data, setData] = useState<TeamExportV1 | null>(null)
  const [teamName, setTeamName] = useState('')
  const [worktreePath, setWorktreePath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const reset = useCallback(() => {
    setStage('prompting')
    setPrompt('')
    setData(null)
    setTeamName('')
    setWorktreePath('')
    setError(null)
    setSubmitting(false)
  }, [])

  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const generate = async (): Promise<void> => {
    const trimmed = prompt.trim()
    if (trimmed.length < MIN_PROMPT_LENGTH) return
    setError(null)
    setStage('generating')
    try {
      const api = window.api.orchestra
      if (!api) throw new Error('Orchestra not available')
      const result = await api.team.generateFromPrompt({
        prompt: trimmed,
        maxAgents: DEFAULT_MAX_AGENTS
      })
      if (!result.ok) {
        setError(result.error)
        setStage('prompting')
        return
      }
      setData(result.value)
      setTeamName(result.value.team.name)
      setStage('previewing')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage('prompting')
    }
  }

  const pickWorktree = async (): Promise<void> => {
    const path = await window.api.project.pickDirectory()
    if (path) setWorktreePath(path)
  }

  const provision = async (): Promise<void> => {
    if (!data || !worktreePath.trim()) return
    setSubmitting(true)
    setError(null)
    setStage('provisioning')
    try {
      const api = window.api.orchestra
      if (!api) throw new Error('Orchestra not available')
      const payload: TeamExportV1 = {
        ...data,
        team: { ...data.team, name: teamName.trim() || data.team.name }
      }
      const result = await api.team.importProvision(payload, worktreePath.trim())
      if (!result.ok) {
        setError(result.error)
        setStage('previewing')
        return
      }
      const team = result.value as { id: string } | undefined
      if (team?.id) setActiveTeam(team.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage('previewing')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const canGenerate = prompt.trim().length >= MIN_PROMPT_LENGTH && stage === 'prompting'
  const canProvision =
    stage === 'previewing' &&
    data !== null &&
    teamName.trim().length > 0 &&
    worktreePath.trim().length > 0

  return (
    <Modal
      open={open}
      onClose={submitting || stage === 'generating' ? () => {} : onClose}
      title="generate team from prompt"
      titleIcon={<Sparkles size={14} strokeWidth={1.75} className="text-accent-400" />}
      maxWidth="max-w-lg"
      closeOnBackdrop={!submitting && stage !== 'generating'}
      footer={
        stage === 'prompting' ? (
          <>
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-border-soft px-3 py-1.5 text-xs text-text-2 hover:border-border-mid hover:bg-bg-3"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={!canGenerate}
              className="inline-flex items-center gap-1.5 rounded-sm bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles size={12} strokeWidth={1.75} />
              Generate
            </button>
          </>
        ) : stage === 'previewing' ? (
          <>
            <button
              type="button"
              onClick={() => setStage('prompting')}
              disabled={submitting}
              className="rounded-sm border border-border-soft px-3 py-1.5 text-xs text-text-2 hover:border-border-mid hover:bg-bg-3 disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => void provision()}
              disabled={!canProvision || submitting}
              className="rounded-sm bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? 'creating…' : 'Create team'}
            </button>
          </>
        ) : undefined
      }
    >
      {stage === 'prompting' && (
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-text-3">
            Describe the team you need in plain language. Claude will design the
            agents, their souls, skills, and the delegation hierarchy. You will
            be able to review before anything is created.
          </p>
          <textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={PROMPT_PLACEHOLDER}
            rows={6}
            className="w-full resize-none rounded-sm border border-border-mid bg-bg-1 px-3 py-2 text-sm text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
          />
          <div className="flex items-center justify-between text-[11px] text-text-4">
            <span>
              {prompt.trim().length < MIN_PROMPT_LENGTH
                ? `at least ${MIN_PROMPT_LENGTH} characters`
                : `${prompt.trim().length} chars`}
            </span>
            <span>up to {DEFAULT_MAX_AGENTS} agents</span>
          </div>
        </div>
      )}

      {stage === 'generating' && (
        <div className="flex flex-col items-center gap-3 py-8 text-center text-xs text-text-3">
          <Sparkles size={24} strokeWidth={1.25} className="animate-pulse text-accent-400" />
          <span>Designing your team…</span>
          <span className="text-[11px] text-text-4">
            Claude is composing agents, skills and hierarchy. This usually takes 5-15 seconds.
          </span>
        </div>
      )}

      {stage === 'provisioning' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center text-xs text-text-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-bg-3">
            <div
              className="h-full animate-pulse rounded-full bg-accent-500"
              style={{ width: '60%' }}
            />
          </div>
          <span>Provisioning team…</span>
        </div>
      )}

      {stage === 'previewing' && data && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="df-label mb-1.5 block">team name</label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Team name"
              className="w-full rounded-sm border border-border-mid bg-bg-1 px-2.5 py-1.5 text-sm text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
            />
          </div>

          <div className="rounded-sm border border-border-soft bg-bg-2 px-3 py-2.5">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-text-1">
              <Users size={12} strokeWidth={1.75} className="text-accent-400" />
              Proposed team
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <span className="text-text-3">Agents</span>
              <span className="text-text-1">{data.agents.length}</span>
              <span className="text-text-3">Edges</span>
              <span className="text-text-1">{data.edges.length}</span>
              <span className="text-text-3">Model</span>
              <span className="truncate text-text-1">{data.team.defaultModel}</span>
              <span className="text-text-3">Safe mode</span>
              <span className="text-text-1">{data.team.safeMode}</span>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-text-3 hover:text-text-2">
                show agents
              </summary>
              <ul className="mt-1.5 space-y-1 text-[11px]">
                {data.agents.map((a) => (
                  <li key={a.slug} className="flex items-baseline gap-2">
                    <span
                      className={
                        a.isMain
                          ? 'font-semibold text-accent-400'
                          : 'text-text-1'
                      }
                    >
                      {a.name}
                    </span>
                    <span className="text-text-4">— {a.role}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>

          <div>
            <label className="df-label mb-1.5 block">worktree directory</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={worktreePath}
                placeholder="Pick a directory…"
                className="min-w-0 flex-1 rounded-sm border border-border-mid bg-bg-2 px-2.5 py-1.5 text-xs text-text-2 placeholder:text-text-4"
              />
              <button
                type="button"
                onClick={() => void pickWorktree()}
                className="inline-flex items-center gap-1 rounded-sm border border-border-mid px-2.5 py-1.5 text-xs text-text-2 hover:border-accent-500 hover:text-accent-400"
              >
                <FolderOpen size={12} strokeWidth={1.75} />
                Browse
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-sm border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}
    </Modal>
  )
}
