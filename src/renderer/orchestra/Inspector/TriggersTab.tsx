import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import yaml from 'js-yaml'
import type { Trigger, TriggerKind } from '../../../shared/orchestra'

async function readTriggers(agentId: string): Promise<Trigger[]> {
  const fn = window.api?.orchestra?.agent?.readTriggers
  if (!fn) throw new Error('triggers IO not wired')
  const res = await fn(agentId)
  if (!res.ok) throw new Error(res.error)
  return Array.isArray(res.value) ? res.value : []
}
async function writeTriggers(agentId: string, triggers: Trigger[]): Promise<void> {
  const fn = window.api?.orchestra?.agent?.writeTriggers
  if (!fn) throw new Error('triggers IO not wired')
  const res = await fn(agentId, triggers)
  if (!res.ok) throw new Error(res.error)
}

interface Props { agentId: string }

const KINDS: TriggerKind[] = ['manual', 'tag', 'path', 'event', 'schedule']
const SHAPE_ONLY: readonly TriggerKind[] = ['event', 'schedule']
const PLACEHOLDERS: Record<TriggerKind, string> = {
  manual: '',
  tag: 'review',
  path: '**/*.go',
  event: 'pr.opened',
  schedule: '0 9 * * 1-5'
}
const WARN_PIP =
  'inline-flex items-center gap-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300'
const ERR_PIP =
  'inline-flex items-center gap-1 rounded-sm border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300'

const genId = (): string =>
  't_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
const newTrigger = (): Trigger => ({
  id: genId(), kind: 'manual', pattern: '', priority: 0, enabled: true
})
const pathLooksBroken = (p: string): boolean =>
  !p || (!p.includes('*') && !p.includes('/'))
const canSave = (list: Trigger[]): boolean =>
  !list.some((t) => SHAPE_ONLY.includes(t.kind) && t.pattern.trim() === '')

export default function TriggersTab({ agentId }: Props) {
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [readOnly, setReadOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [previewOpen, setPreviewOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstLoadRef = useRef(true)

  useEffect(() => {
    let cancelled = false
    firstLoadRef.current = true
    setLoading(true)
    readTriggers(agentId)
      .then((data) => {
        if (cancelled) return
        setTriggers(Array.isArray(data) ? data : [])
        setReadOnly(false)
      })
      .catch(() => {
        if (cancelled) return
        setTriggers([])
        setReadOnly(true)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        queueMicrotask(() => { firstLoadRef.current = false })
      })
    return () => {
      cancelled = true
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [agentId])

  // Save-on-change, debounced 400ms.
  useEffect(() => {
    if (readOnly || loading || firstLoadRef.current) return
    if (!canSave(triggers)) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void writeTriggers(agentId, triggers).catch(() => { /* MVP: swallow */ })
    }, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [triggers, agentId, readOnly, loading])

  const yamlPreview = useMemo(() => {
    try { return yaml.dump(triggers, { lineWidth: 100 }) }
    catch { return '# failed to serialize' }
  }, [triggers])

  const update = useCallback((id: string, patch: Partial<Trigger>) => {
    setTriggers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])
  const remove = useCallback((id: string) => {
    setTriggers((prev) => prev.filter((t) => t.id !== id))
  }, [])
  const add = useCallback(() => setTriggers((prev) => [...prev, newTrigger()]), [])
  const changeKind = useCallback((id: string, kind: TriggerKind) => {
    // Reset pattern so the kind-specific placeholder shows through.
    setTriggers((prev) => prev.map((t) => (t.id === id ? { ...t, kind, pattern: '' } : t)))
  }, [])

  if (loading) {
    return <div className="p-4 font-mono text-[11px] text-text-4">loading triggers…</div>
  }

  const saveBlocked = !canSave(triggers)

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      {readOnly && (
        <div className="flex items-start gap-2 rounded-sm border border-border-soft bg-bg-3 px-3 py-2 text-[11px] text-text-3">
          <AlertTriangle size={12} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span>Read-only: file IO not wired yet. Edits are disabled.</span>
        </div>
      )}
      {saveBlocked && !readOnly && (
        <div className="flex items-start gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
          <AlertTriangle size={12} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span>Fill in the pattern for all event/schedule triggers before changes save.</span>
        </div>
      )}

      <div className="df-scroll flex-1 space-y-2 overflow-y-auto">
        {triggers.length === 0 && (
          <div className="rounded-sm border border-dashed border-border-soft bg-bg-1 p-4 text-center font-mono text-[11px] text-text-4">
            no triggers yet — the agent will only run when @mentioned
          </div>
        )}
        {triggers.map((t) => (
          <TriggerRow
            key={t.id}
            trigger={t}
            disabled={readOnly}
            onKind={(k) => changeKind(t.id, k)}
            onPattern={(p) => update(t.id, { pattern: p })}
            onPriority={(p) => update(t.id, { priority: p })}
            onEnabled={(e) => update(t.id, { enabled: e })}
            onDelete={() => remove(t.id)}
          />
        ))}
      </div>

      <button
        type="button"
        disabled={readOnly}
        onClick={add}
        className="flex items-center justify-center gap-1.5 rounded-sm border border-dashed border-border-mid bg-bg-1 px-3 py-2 text-xs text-text-2 transition hover:border-accent-500 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={12} strokeWidth={1.75} /> Add trigger
      </button>

      <div className="rounded-sm border border-border-soft bg-bg-1">
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-text-3 hover:text-text-1"
        >
          {previewOpen ? <ChevronDown size={12} strokeWidth={1.75} /> : <ChevronRight size={12} strokeWidth={1.75} />}
          <span className="df-label">YAML preview</span>
          <span className="ml-auto font-mono text-[10px] text-text-4">
            {triggers.length} {triggers.length === 1 ? 'entry' : 'entries'}
          </span>
        </button>
        {previewOpen && (
          <pre className="df-scroll max-h-56 overflow-auto border-t border-border-soft bg-bg-0 px-3 py-2 font-mono text-[11px] leading-relaxed text-text-2">
            {yamlPreview || '# (empty)'}
          </pre>
        )}
      </div>
    </div>
  )
}

interface RowProps {
  trigger: Trigger
  disabled: boolean
  onKind: (k: TriggerKind) => void
  onPattern: (p: string) => void
  onPriority: (p: number) => void
  onEnabled: (e: boolean) => void
  onDelete: () => void
}

function TriggerRow({
  trigger, disabled, onKind, onPattern, onPriority, onEnabled, onDelete
}: RowProps) {
  const shapeOnly = SHAPE_ONLY.includes(trigger.kind)
  const pathWarn = trigger.kind === 'path' && pathLooksBroken(trigger.pattern)
  const emptyBlocks = shapeOnly && trigger.pattern.trim() === ''

  const onPriChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = Number(e.target.value)
    const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.trunc(raw))) : 0
    onPriority(clamped)
  }

  return (
    <div className="rounded-sm border border-border-soft bg-bg-2 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={trigger.kind}
          disabled={disabled}
          onChange={(e) => onKind(e.target.value as TriggerKind)}
          className="rounded-sm border border-border-mid bg-bg-1 px-1.5 py-1 font-mono text-[11px] text-text-1 focus:border-accent-500 focus:outline-none disabled:opacity-50"
        >
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>

        <input
          type="text"
          value={trigger.pattern}
          disabled={disabled || trigger.kind === 'manual'}
          onChange={(e) => onPattern(e.target.value)}
          placeholder={PLACEHOLDERS[trigger.kind]}
          className="min-w-[140px] flex-1 rounded-sm border border-border-mid bg-bg-1 px-2 py-1 font-mono text-[11px] text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none disabled:opacity-50"
        />

        <input
          type="number" min={0} max={100} step={1}
          value={trigger.priority}
          disabled={disabled}
          onChange={onPriChange}
          title="priority (0–100)"
          className="w-14 rounded-sm border border-border-mid bg-bg-1 px-1.5 py-1 text-center font-mono text-[11px] text-text-1 focus:border-accent-500 focus:outline-none disabled:opacity-50"
        />

        <label className="flex items-center gap-1 rounded-sm border border-border-soft bg-bg-1 px-1.5 py-1 text-[10px] text-text-3" title="enabled">
          <input
            type="checkbox"
            checked={trigger.enabled}
            disabled={disabled}
            onChange={(e) => onEnabled(e.target.checked)}
            className="h-3 w-3 accent-accent-500"
          />
          <span className="df-label">on</span>
        </label>

        <button
          type="button"
          disabled={disabled}
          onClick={onDelete}
          aria-label="delete trigger"
          title="delete"
          className="rounded-sm border border-border-soft bg-bg-1 p-1 text-text-3 hover:border-red-500/60 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 size={12} strokeWidth={1.75} />
        </button>
      </div>

      {(shapeOnly || pathWarn) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {shapeOnly && (
            <span className={WARN_PIP}>
              <AlertTriangle size={10} strokeWidth={2} /> MVP shape-only — won&apos;t fire
            </span>
          )}
          {emptyBlocks && <span className={ERR_PIP}>pattern required to save</span>}
          {pathWarn && (
            <span className={WARN_PIP}>
              <AlertTriangle size={10} strokeWidth={2} /> pattern needs a wildcard or slash
            </span>
          )}
        </div>
      )}
    </div>
  )
}
