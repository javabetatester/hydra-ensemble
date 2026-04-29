/**
 * ImportTeamDialog — import a team from an exported JSON file.
 *
 * Flow: open file picker → preview parsed data → pick worktree → provision.
 * Mirrors the UX of TeamTemplatesDialog with a progress bar during
 * provisioning. The heavy lifting (validation, creation) lives in
 * OrchestraCore on the main side; the dialog orchestrates the UI steps.
 */
import { useCallback, useEffect, useState } from 'react'
import { FileUp, FolderOpen, Users } from 'lucide-react'
import type { TeamExportV1 } from '../../shared/orchestra'
import Modal from '../ui/Modal'
import { useOrchestra } from './state/orchestra'

interface Props {
  open: boolean
  onClose: () => void
}

type Stage = 'idle' | 'previewing' | 'provisioning'

export default function ImportTeamDialog({ open, onClose }: Props) {
  const setActiveTeam = useOrchestra((s) => s.setActiveTeam)

  const [stage, setStage] = useState<Stage>('idle')
  const [data, setData] = useState<TeamExportV1 | null>(null)
  const [teamName, setTeamName] = useState('')
  const [worktreePath, setWorktreePath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [provisioning, setProvisioning] = useState(false)

  const reset = useCallback(() => {
    setStage('idle')
    setData(null)
    setTeamName('')
    setWorktreePath('')
    setError(null)
    setProvisioning(false)
  }, [])

  // Reset state when the dialog opens.
  useEffect(() => {
    if (!open) return
    reset()
    // Immediately trigger the file picker on open.
    void pickFile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const pickFile = async (): Promise<void> => {
    setError(null)
    const api = window.api.orchestra
    if (!api) { setError('Orchestra not available'); return }
    const result = await api.team.importPick()
    if (!result.ok) { setError(result.error); return }
    if (!result.value) { onClose(); return } // user cancelled file picker
    setData(result.value)
    setTeamName(result.value.team.name)
    setStage('previewing')
  }

  const pickWorktree = async (): Promise<void> => {
    const path = await window.api.project.pickDirectory()
    if (path) setWorktreePath(path)
  }

  const provision = async (): Promise<void> => {
    if (!data || !worktreePath.trim()) return
    setProvisioning(true)
    setError(null)
    setStage('provisioning')
    try {
      const api = window.api.orchestra
      if (!api) throw new Error('Orchestra not available')
      // Patch team name if the user edited it.
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
      // Switch to the newly created team.
      const team = result.value as { id: string } | undefined
      if (team?.id) setActiveTeam(team.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage('previewing')
    } finally {
      setProvisioning(false)
    }
  }

  if (!open) return null

  const canProvision =
    stage === 'previewing' && data && teamName.trim().length > 0 && worktreePath.trim().length > 0

  return (
    <Modal
      open={open}
      onClose={provisioning ? () => {} : onClose}
      title="import team"
      titleIcon={<FileUp size={14} strokeWidth={1.75} className="text-accent-400" />}
      maxWidth="max-w-md"
      closeOnBackdrop={!provisioning}
      footer={
        stage === 'previewing' ? (
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={provisioning}
              className="rounded-sm border border-border-soft px-3 py-1.5 text-xs text-text-2 hover:border-border-mid hover:bg-bg-3 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void provision()}
              disabled={!canProvision || provisioning}
              className="rounded-sm bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {provisioning ? 'importing\u2026' : 'Import'}
            </button>
          </>
        ) : undefined
      }
    >
      {stage === 'idle' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center text-xs text-text-3">
          <FileUp size={24} strokeWidth={1.25} className="text-text-4" />
          <span>Opening file picker\u2026</span>
        </div>
      )}

      {stage === 'provisioning' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center text-xs text-text-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-bg-3">
            <div className="h-full animate-pulse rounded-full bg-accent-500" style={{ width: '60%' }} />
          </div>
          <span>Provisioning team\u2026</span>
        </div>
      )}

      {stage === 'previewing' && data && (
        <div className="flex flex-col gap-4">
          {/* Team name (editable) */}
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

          {/* Summary */}
          <div className="rounded-sm border border-border-soft bg-bg-2 px-3 py-2.5">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-text-1">
              <Users size={12} strokeWidth={1.75} className="text-accent-400" />
              Preview
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
              {data.exportedAt && (
                <>
                  <span className="text-text-3">Exported</span>
                  <span className="text-text-1">
                    {new Date(data.exportedAt).toLocaleDateString()}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Worktree picker */}
          <div>
            <label className="df-label mb-1.5 block">worktree directory</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={worktreePath}
                placeholder="Pick a directory\u2026"
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
