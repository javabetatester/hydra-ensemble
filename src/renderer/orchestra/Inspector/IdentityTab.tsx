import { useEffect, useRef, useState } from 'react'
import { AlertOctagon, Cpu, ExternalLink, Palette, RotateCcw, Trash2, User } from 'lucide-react'
import type { Agent, UpdateAgentInput } from '../../../shared/orchestra'
import { useOrchestra } from '../state/orchestra'
import { AGENT_COLORS, hexAlpha } from '../../lib/agent'
import type { InspectorTabKey } from './index'

interface Props {
  agent: Agent
  onSwitchTab: (key: InspectorTabKey) => void
}

const MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'claude-opus-4-7', label: 'claude-opus-4-7' },
  { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
  { value: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5' },
  // Empty string means "inherit Team.defaultModel" per Agent.model contract.
  { value: '', label: 'inherit from team' }
]

// Small fixed palette — first 8 of the shared AGENT_COLORS constant. Keeping
// it small avoids overwhelming the narrow 360px drawer and stays consistent
// with F4.3 ("color picker — small palette of 8 choices").
const COLOR_PALETTE = AGENT_COLORS.slice(0, 8)

const DEBOUNCE_MS = 400

// Save indicator states. "idle" = no pending edits, "saving" = debounced
// write in flight, "saved" = most recent write acknowledged (shown briefly).
type SaveState = 'idle' | 'saving' | 'saved'

const SAVED_FLASH_MS = 1200

export default function IdentityTab({ agent, onSwitchTab }: Props) {
  const updateAgent = useOrchestra((s) => s.updateAgent)
  const deleteAgent = useOrchestra((s) => s.deleteAgent)

  // Local draft mirror of the fields we edit. Initialized from the current
  // agent and re-synced when the id changes (not on every agent update —
  // otherwise typing would be clobbered by the `agent.changed` echo).
  const [name, setName] = useState(agent.name)
  const [role, setRole] = useState(agent.role)
  const [description, setDescription] = useState(agent.description)
  const [model, setModel] = useState(agent.model)
  const [maxTokens, setMaxTokens] = useState(agent.maxTokens)
  const [color, setColor] = useState(agent.color ?? '')
  const [saveState, setSaveState] = useState<SaveState>('idle')

  // Reset drafts only when the inspector switches to a different agent.
  // Using agent.id as the dependency avoids resetting while the user types
  // after a round-tripped `agent.changed` event updates the agent prop.
  useEffect(() => {
    setName(agent.name)
    setRole(agent.role)
    setDescription(agent.description)
    setModel(agent.model)
    setMaxTokens(agent.maxTokens)
    setColor(agent.color ?? '')
    setSaveState('idle')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id])

  // Debounced write-through. One timer covers all fields — they share the
  // same patch endpoint so batching is free and reduces IPC chatter.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const patch: UpdateAgentInput['patch'] = {}
    if (name !== agent.name) patch.name = name
    if (role !== agent.role) patch.role = role
    if (description !== agent.description) patch.description = description
    if (model !== agent.model) patch.model = model
    if (maxTokens !== agent.maxTokens) patch.maxTokens = maxTokens
    const nextColor = color || undefined
    if (nextColor !== agent.color) patch.color = nextColor
    if (Object.keys(patch).length === 0) return

    if (timerRef.current) clearTimeout(timerRef.current)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    setSaveState('saving')
    timerRef.current = setTimeout(() => {
      void updateAgent({ id: agent.id, patch }).then(() => {
        setSaveState('saved')
        savedTimerRef.current = setTimeout(() => {
          setSaveState('idle')
        }, SAVED_FLASH_MS)
      })
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [name, role, description, model, maxTokens, color, agent, updateAgent])

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const onDelete = (): void => {
    const ok = window.confirm(
      `Delete agent "${agent.name}"? This removes the agent from the team ` +
        `and cannot be undone.`
    )
    if (!ok) return
    void deleteAgent(agent.id)
  }

  const onReset = (): void => {
    const ok = window.confirm(
      `Reset "${agent.name}" to its preset defaults? Identity fields ` +
        `(role, description, model, tokens, color) will be restored.`
    )
    if (!ok) return
    // Dispatch a DOM event for a follow-up to wire into the orchestra state.
    window.dispatchEvent(
      new CustomEvent('orchestra:reset-agent', { detail: { id: agent.id } })
    )
  }

  return (
    <div className="space-y-5 p-4">
      {/* Identity section — name, role, description. Name + role share a row
          because they're both short single-line labels; description keeps the
          full width so the textarea has room to breathe. */}
      <Section
        icon={<User size={12} strokeWidth={1.75} />}
        title="identity"
        saveState={saveState}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-sm border border-border-mid bg-bg-1 px-2.5 py-1.5 font-mono text-sm text-text-1 focus:border-accent-500 focus:outline-none"
            />
          </Field>

          <Field label="role">
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. backend reviewer"
              className="w-full rounded-sm border border-border-mid bg-bg-1 px-2.5 py-1.5 text-sm text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
            />
          </Field>
        </div>

        <Field label="description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="what this agent is responsible for"
            className="df-scroll w-full resize-none rounded-sm border border-border-mid bg-bg-1 px-2.5 py-1.5 text-sm text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
          />
        </Field>
      </Section>

      {/* Appearance section — color palette. Sits on its own row because the
          8-swatch grid already spans the full inspector width. */}
      <Section icon={<Palette size={12} strokeWidth={1.75} />} title="appearance">
        <Field label="color">
          <div className="grid grid-cols-8 gap-1.5">
            {COLOR_PALETTE.map((c) => {
              const selected = color === c
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-6 w-full rounded-sm transition ${
                    selected ? 'ring-2 ring-text-1 ring-offset-2 ring-offset-bg-2' : ''
                  }`}
                  style={{
                    backgroundColor: c,
                    boxShadow: `inset 0 0 0 1px ${hexAlpha(c, 0.6)}`
                  }}
                  aria-label={`accent ${c}`}
                  aria-pressed={selected}
                />
              )
            })}
          </div>
        </Field>
      </Section>

      {/* Runtime section — model + max tokens share a row (both short,
          configure how the agent executes), then Soul shortcut underneath. */}
      <Section icon={<Cpu size={12} strokeWidth={1.75} />} title="runtime">
        <div className="grid grid-cols-2 gap-3">
          <Field label="model">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-sm border border-border-mid bg-bg-1 px-2.5 py-1.5 font-mono text-xs text-text-1 focus:border-accent-500 focus:outline-none"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value || 'inherit'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="max tokens">
            <input
              type="number"
              min={256}
              step={256}
              value={maxTokens}
              onChange={(e) => {
                const n = Number(e.target.value)
                // Guard against NaN from an empty input — keep the previous
                // value so the debounced write doesn't send junk to main.
                if (Number.isFinite(n) && n > 0) setMaxTokens(n)
              }}
              className="w-full rounded-sm border border-border-mid bg-bg-1 px-2.5 py-1.5 font-mono text-sm text-text-1 focus:border-accent-500 focus:outline-none"
            />
          </Field>
        </div>

        <button
          type="button"
          onClick={() => onSwitchTab('soul')}
          className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-border-soft bg-bg-1 px-3 py-1.5 text-xs text-text-2 hover:border-border-mid hover:bg-bg-3 hover:text-text-1"
          // When an IPC for "open in external editor" lands, swap this for
          // window.api.orchestra.agent.openSoul(agent.id). For now we hand
          // off to the embedded Soul tab inside the drawer.
          title="open soul.md"
        >
          <ExternalLink size={12} strokeWidth={1.75} />
          open soul.md in editor
        </button>
      </Section>

      {/* Danger section — destructive actions segregated visually. Reset
          dispatches a DOM event; delete is wired directly to the store. */}
      <Section
        icon={<AlertOctagon size={12} strokeWidth={1.75} />}
        title="danger"
        tone="danger"
      >
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onReset}
            className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-border-soft bg-bg-1 px-3 py-1.5 text-xs text-text-2 hover:border-border-mid hover:bg-bg-3 hover:text-text-1"
            title="reset identity fields to preset defaults"
          >
            <RotateCcw size={12} strokeWidth={1.75} />
            reset to preset
          </button>

          <button
            type="button"
            onClick={onDelete}
            className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-status-attention/40 bg-status-attention/10 px-3 py-1.5 text-xs font-semibold text-status-attention hover:bg-status-attention/20"
          >
            <Trash2 size={12} strokeWidth={2} />
            delete agent
          </button>
        </div>
      </Section>
    </div>
  )
}

// --- local presentational helpers ------------------------------------------

interface SectionProps {
  icon: React.ReactNode
  title: string
  tone?: 'default' | 'danger'
  saveState?: SaveState
  children: React.ReactNode
}

/**
 * Section — groups related fields under an icon + heading, with an optional
 * "saving…/saved" chip pinned to the header. The danger tone tints the title
 * so destructive clusters read as distinct from normal config.
 */
function Section({ icon, title, tone = 'default', saveState, children }: SectionProps) {
  const toneClass = tone === 'danger' ? 'text-status-attention' : 'text-text-3'
  return (
    <section className="space-y-2.5">
      <header className="flex items-center justify-between">
        <div className={`flex items-center gap-1.5 ${toneClass}`}>
          {icon}
          <span className="df-label">{title}</span>
        </div>
        {saveState && saveState !== 'idle' ? <SaveChip state={saveState} /> : null}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

interface FieldProps {
  label: string
  children: React.ReactNode
}

function Field({ label, children }: FieldProps) {
  return (
    <div>
      <label className="df-label mb-1.5 block">{label}</label>
      {children}
    </div>
  )
}

/**
 * SaveChip — small pill beside the section header. Shown while the debounce
 * timer is in flight ("saving…") and briefly after a successful write
 * ("saved"). Replaces the prior invisible-by-default indicator.
 */
function SaveChip({ state }: { state: Exclude<SaveState, 'idle'> }) {
  const isSaving = state === 'saving'
  const cls = isSaving
    ? 'border-border-soft bg-bg-1 text-text-3'
    : 'border-accent-500/40 bg-accent-500/10 text-accent-400'
  const label = isSaving ? 'saving…' : 'saved'
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}
      aria-live="polite"
    >
      {label}
    </span>
  )
}
