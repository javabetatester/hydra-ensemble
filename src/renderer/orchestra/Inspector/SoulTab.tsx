import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, ExternalLink, Loader2 } from 'lucide-react'

interface Props {
  agentId: string
}

type LoadState = 'loading' | 'ready' | 'error' | 'unwired'

/** Idle window after the last keystroke before an auto-save fires. Matches
 *  the 800ms described in PLAN.md §5/§F4 — short enough to feel live, long
 *  enough that a burst of typing doesn't thrash the disk. */
const AUTOSAVE_DEBOUNCE_MS = 800

/** How long the "saved" pip stays visible after a successful write. */
const SAVED_PIP_MS = 1200

class UnwiredError extends Error {
  constructor() {
    super('file I/O not wired')
    this.name = 'UnwiredError'
  }
}

async function readSoul(agentId: string): Promise<string> {
  const fn = window.api?.orchestra?.agent?.readSoul
  if (!fn) throw new UnwiredError()
  const res = await fn(agentId)
  if (!res.ok) throw new Error(res.error)
  return res.value ?? ''
}

async function writeSoul(agentId: string, text: string): Promise<void> {
  const fn = window.api?.orchestra?.agent?.writeSoul
  if (!fn) throw new UnwiredError()
  const res = await fn(agentId, text)
  if (!res.ok) throw new Error(res.error)
}

export default function SoulTab({ agentId }: Props) {
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [value, setValue] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef<boolean>(false)
  // `agentId` changes should cancel any in-flight debounce so we don't save
  // the outgoing agent's buffer into the incoming agent's soul.md.
  const lastLoadedAgentRef = useRef<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoadState('loading')
    setError(null)
    try {
      const text = await readSoul(agentId)
      lastLoadedAgentRef.current = agentId
      setValue(text)
      dirtyRef.current = false
      setLoadState('ready')
    } catch (err) {
      if (err instanceof UnwiredError) {
        lastLoadedAgentRef.current = agentId
        setValue('')
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
    async (text: string): Promise<void> => {
      if (loadState === 'unwired') return
      // Guard against races: if the agent switched mid-debounce, drop the
      // write — a fresh load for the new agent is already running.
      if (lastLoadedAgentRef.current !== agentId) return
      try {
        await writeSoul(agentId, text)
        dirtyRef.current = false
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
    (text: string): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        void save(text)
      }, AUTOSAVE_DEBOUNCE_MS)
    },
    [save]
  )

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value
    setValue(next)
    dirtyRef.current = true
    scheduleSave(next)
  }

  const onBlur = (): void => {
    // Blur forces the pending save to fire immediately; a user who clicks
    // away expects their changes on disk, not a 500ms wait for the debounce.
    if (!dirtyRef.current) return
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    void save(value)
  }

  // Fade the "saved" pip after SAVED_PIP_MS without blocking re-saves.
  useEffect(() => {
    if (savedAt === null) return
    const t = setTimeout(() => setSavedAt(null), SAVED_PIP_MS)
    return () => clearTimeout(t)
  }, [savedAt])

  const openInEditor = (): void => {
    // Stubbed — will call an external-editor IPC in phase 6.
    // eslint-disable-next-line no-console
    console.log('[orchestra] open soul.md in editor', { agentId })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="df-label">soul.md</span>
          {loadState === 'ready' && savedAt !== null ? (
            <span className="font-mono text-[10px] text-accent-400">saved</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={openInEditor}
          className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-2 py-1 text-[11px] text-text-3 hover:border-border-mid hover:text-text-1"
        >
          <ExternalLink size={11} strokeWidth={1.75} />
          <span>Open in editor</span>
        </button>
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
            <span>Failed to load soul.md: {error ?? 'unknown error'}</span>
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

      <div className="relative flex-1 overflow-hidden">
        {loadState === 'loading' ? (
          <div className="flex h-full items-center justify-center gap-2 text-[11px] text-text-3">
            <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
            <span>loading…</span>
          </div>
        ) : (
          <textarea
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            readOnly={loadState === 'unwired'}
            spellCheck={false}
            placeholder={
              loadState === 'unwired'
                ? 'soul.md will be editable once file I/O is wired.'
                : 'Describe the agent’s role, voice, priorities…'
            }
            className="df-mono-surface h-full w-full resize-none bg-bg-0 p-3 font-mono text-[12px] leading-relaxed text-text-1 placeholder:text-text-4 focus:outline-none"
          />
        )}
      </div>
    </div>
  )
}
