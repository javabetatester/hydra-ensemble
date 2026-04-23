import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react'
import type { Skill } from '../../../shared/orchestra'

interface Props {
  agentId: string
}

type LoadState = 'loading' | 'ready' | 'error' | 'unwired'

/** Debounce for the write-through on any edit. Skills edits are chunkier
 *  than a typing buffer (slider drags, tag lists), so 400ms keeps writes
 *  infrequent while still landing within a human blink of the last change. */
const AUTOSAVE_DEBOUNCE_MS = 400
const SAVED_PIP_MS = 1200

const WEIGHT_MIN = 0.5
const WEIGHT_MAX = 2.0
const WEIGHT_STEP = 0.1
const DEFAULT_WEIGHT = 1.0

class UnwiredError extends Error {
  constructor() {
    super('file I/O not wired')
    this.name = 'UnwiredError'
  }
}

async function readSkills(agentId: string): Promise<Skill[]> {
  const fn = window.api?.orchestra?.agent?.readSkills
  if (!fn) throw new UnwiredError()
  const res = await fn(agentId)
  if (!res.ok) throw new Error(res.error)
  return Array.isArray(res.value) ? res.value : []
}

async function writeSkills(agentId: string, skills: Skill[]): Promise<void> {
  const fn = window.api?.orchestra?.agent?.writeSkills
  if (!fn) throw new UnwiredError()
  const res = await fn(agentId, skills)
  if (!res.ok) throw new Error(res.error)
}

const emptySkill = (): Skill => ({
  name: '',
  tags: [],
  weight: DEFAULT_WEIGHT,
  description: ''
})

/** Tags round-trip through a comma-separated string so the user can type
 *  freely without losing mid-word state to a re-render. Parsing on save
 *  is idempotent: trim + drop empties + dedupe. */
function parseTags(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input.split(',')) {
    const t = raw.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function tagsToInput(tags: string[]): string {
  return tags.join(', ')
}

export default function SkillsTab({ agentId }: Props) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [skills, setSkills] = useState<Skill[]>([])
  const [tagDrafts, setTagDrafts] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastLoadedAgentRef = useRef<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoadState('loading')
    setError(null)
    try {
      const list = await readSkills(agentId)
      lastLoadedAgentRef.current = agentId
      setSkills(list)
      setTagDrafts(list.map((s) => tagsToInput(s.tags)))
      setLoadState('ready')
    } catch (err) {
      if (err instanceof UnwiredError) {
        lastLoadedAgentRef.current = agentId
        setSkills([])
        setTagDrafts([])
        setLoadState('unwired')
        return
      }
      setError((err as Error).message)
      setLoadState('error')
    }
  }, [agentId])

  useEffect(() => {
    void load()
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [load])

  const save = useCallback(
    async (next: Skill[]): Promise<void> => {
      if (loadState === 'unwired') return
      if (lastLoadedAgentRef.current !== agentId) return
      try {
        await writeSkills(agentId, next)
        setSavedAt(Date.now())
      } catch (err) {
        if (err instanceof UnwiredError) {
          setLoadState('unwired')
          return
        }
        setError((err as Error).message)
        setLoadState('error')
      }
    },
    [agentId, loadState]
  )

  const scheduleSave = useCallback(
    (next: Skill[]): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        void save(next)
      }, AUTOSAVE_DEBOUNCE_MS)
    },
    [save]
  )

  useEffect(() => {
    if (savedAt === null) return
    const t = setTimeout(() => setSavedAt(null), SAVED_PIP_MS)
    return () => clearTimeout(t)
  }, [savedAt])

  /** Commit a per-row mutation. Handles the array rebuild + the mirrored
   *  tag-draft array so callers don't have to think about both. */
  const mutate = useCallback(
    (index: number, patch: Partial<Skill>, nextDraft?: string): void => {
      setSkills((prev) => {
        const next = prev.slice()
        const base = next[index]
        if (!base) return prev
        next[index] = { ...base, ...patch }
        scheduleSave(next)
        return next
      })
      if (nextDraft !== undefined) {
        setTagDrafts((prev) => {
          const next = prev.slice()
          next[index] = nextDraft
          return next
        })
      }
    },
    [scheduleSave]
  )

  const addSkill = (): void => {
    setSkills((prev) => {
      const next = [...prev, emptySkill()]
      scheduleSave(next)
      return next
    })
    setTagDrafts((prev) => [...prev, ''])
  }

  const removeSkill = (index: number): void => {
    setSkills((prev) => {
      const next = prev.filter((_, i) => i !== index)
      scheduleSave(next)
      return next
    })
    setTagDrafts((prev) => prev.filter((_, i) => i !== index))
  }

  const headerCount = useMemo(() => skills.length, [skills])

  const editable = loadState !== 'unwired' && loadState !== 'loading'

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="df-label">skills</span>
          <span className="font-mono text-[10px] text-text-4">
            {headerCount} {headerCount === 1 ? 'skill' : 'skills'}
          </span>
        </div>
        {loadState === 'ready' && savedAt !== null ? (
          <span className="font-mono text-[10px] text-accent-400">saved</span>
        ) : null}
      </div>

      {loadState === 'unwired' ? (
        <div className="flex items-center gap-2 border-b border-border-soft bg-bg-3 px-3 py-2 text-[11px] text-text-3">
          <AlertCircle size={12} strokeWidth={1.75} className="text-accent-400" />
          <span>File I/O not wired yet — see PLAN.md phase 6.</span>
        </div>
      ) : null}

      {loadState === 'error' ? (
        <div className="flex items-center justify-between gap-2 border-b border-border-soft bg-bg-3 px-3 py-2 text-[11px]">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle size={12} strokeWidth={1.75} />
            <span>Failed to load skills.yaml: {error ?? 'unknown error'}</span>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-sm border border-border-soft bg-bg-2 px-2 py-0.5 text-[11px] text-text-2 hover:border-border-mid hover:text-text-1"
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {loadState === 'loading' ? (
          <div className="flex h-full items-center justify-center gap-2 text-[11px] text-text-3">
            <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
            <span>loading…</span>
          </div>
        ) : skills.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[11px] text-text-3">
            {loadState === 'unwired'
              ? 'Skills are read-only until file I/O is wired.'
              : 'No skills yet. Add one to boost routing scores for matching tags.'}
          </div>
        ) : (
          <ul className="divide-y divide-border-soft">
            {skills.map((skill, i) => (
              <li key={i} className="space-y-2 px-3 py-3">
                <div className="flex items-start gap-2">
                  <input
                    type="text"
                    value={skill.name}
                    onChange={(e) => mutate(i, { name: e.target.value })}
                    disabled={!editable}
                    placeholder="skill name (e.g. go-review)"
                    className="flex-1 rounded-sm border border-border-mid bg-bg-1 px-2 py-1 font-mono text-xs text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => removeSkill(i)}
                    disabled={!editable}
                    className="rounded-sm border border-border-soft bg-bg-2 p-1 text-text-3 hover:border-border-mid hover:text-red-400 disabled:opacity-60"
                    aria-label={`delete skill ${skill.name || i + 1}`}
                    title="delete skill"
                  >
                    <Trash2 size={12} strokeWidth={1.75} />
                  </button>
                </div>

                <div>
                  <label className="df-label mb-1 block">tags (comma-separated)</label>
                  <input
                    type="text"
                    value={tagDrafts[i] ?? ''}
                    onChange={(e) => {
                      const draft = e.target.value
                      // Parse on every keystroke so routing can already use
                      // the committed tags without waiting for blur; the
                      // draft string preserves trailing commas / whitespace.
                      mutate(i, { tags: parseTags(draft) }, draft)
                    }}
                    disabled={!editable}
                    placeholder="review, backend, go"
                    className="w-full rounded-sm border border-border-mid bg-bg-1 px-2 py-1 text-xs text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none disabled:opacity-60"
                  />
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="df-label">weight</label>
                    <span className="font-mono text-[10px] text-text-3">
                      {skill.weight.toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={WEIGHT_MIN}
                    max={WEIGHT_MAX}
                    step={WEIGHT_STEP}
                    value={skill.weight}
                    onChange={(e) =>
                      mutate(i, { weight: Number.parseFloat(e.target.value) })
                    }
                    disabled={!editable}
                    className="w-full accent-accent-500 disabled:opacity-60"
                    aria-label={`weight for ${skill.name || 'skill'}`}
                  />
                </div>

                <div>
                  <label className="df-label mb-1 block">description (optional)</label>
                  <input
                    type="text"
                    value={skill.description ?? ''}
                    onChange={(e) => mutate(i, { description: e.target.value })}
                    disabled={!editable}
                    placeholder="one-line hint for the router / humans"
                    className="w-full rounded-sm border border-border-mid bg-bg-1 px-2 py-1 text-xs text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none disabled:opacity-60"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border-soft bg-bg-1 px-3 py-2">
        <button
          type="button"
          onClick={addSkill}
          disabled={!editable}
          className="flex items-center gap-1.5 rounded-sm border border-border-soft bg-bg-2 px-2.5 py-1.5 text-[11px] text-text-2 hover:border-border-mid hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus size={12} strokeWidth={1.75} />
          <span>Add skill</span>
        </button>
      </div>
    </div>
  )
}
