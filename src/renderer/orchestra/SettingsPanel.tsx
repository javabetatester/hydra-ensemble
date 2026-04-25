import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Settings, Key, Shield, X, AlertTriangle, Check, Loader2,
  ChevronDown, ChevronRight, Plus, RotateCcw, Trash2
} from 'lucide-react'
import type { SafeMode, SecretStorage, Team } from '../../shared/orchestra'
import { useOrchestra } from './state/orchestra'

interface Props { open: boolean; onClose: () => void }
type KeyStatus = 'unknown' | 'testing' | 'present' | 'absent' | 'invalid'
type KeySaveStatus = 'idle' | 'saving' | 'ok' | 'rejected' | 'network'

const DELETE_PHRASE = 'DELETE ORCHESTRA'
const SAFEMODE_ORDER: SafeMode[] = ['strict', 'prompt', 'yolo']
const SAFEMODE_STYLES: Record<SafeMode, string> = {
  strict: 'bg-bg-3 text-text-2 border-border-soft',
  prompt: 'bg-accent-500/15 text-accent-400 border-accent-500/40',
  yolo: 'bg-status-error/15 text-status-error border-status-error/40'
}

// `noUncheckedIndexedAccess` widens the read; modulo guarantees validity.
function nextSafeMode(current: SafeMode): SafeMode {
  const idx = SAFEMODE_ORDER.indexOf(current)
  return SAFEMODE_ORDER[(idx + 1) % SAFEMODE_ORDER.length] ?? 'strict'
}

export default function SettingsPanel({ open, onClose }: Props) {
  const settings = useOrchestra((s) => s.settings)
  const teams = useOrchestra((s) => s.teams)
  const setSettings = useOrchestra((s) => s.setSettings)
  const setSafeMode = useOrchestra((s) => s.setSafeMode)
  const deleteTeam = useOrchestra((s) => s.deleteTeam)

  const enabled = settings.enabled
  const [keyStatus, setKeyStatus] = useState<KeyStatus>('unknown')
  const [keyExpanded, setKeyExpanded] = useState(false)
  const [keyExpanderMode, setKeyExpanderMode] = useState<'add' | 'rotate'>('add')
  const [togglingFlag, setTogglingFlag] = useState(false)

  const testKey = async (): Promise<void> => {
    const o = window.api?.orchestra
    if (!o) { setKeyStatus('absent'); return }
    setKeyStatus('testing')
    const res = await o.apiKey.test()
    if (res.ok) { setKeyStatus('present'); return }
    const err = res.error.toLowerCase()
    // "not found"/"no key" => absent; other errors (401/network) => invalid.
    const looksAbsent = err.includes('not found') || err.includes('no key') || err.includes('missing')
    setKeyStatus(looksAbsent ? 'absent' : 'invalid')
  }

  useEffect(() => { if (open) void testKey() }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const onToggleFlag = async (): Promise<void> => {
    setTogglingFlag(true)
    try { await setSettings({ enabled: !enabled }) } finally { setTogglingFlag(false) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-bg-0/85 px-4 backdrop-blur-md df-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}>
        <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Settings size={14} strokeWidth={1.75} className="text-accent-400" />
            <span className="df-label">orchestra settings</span>
          </div>
          <button type="button" onClick={onClose} aria-label="close"
            className="rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1">
            <X size={14} strokeWidth={1.75} />
          </button>
        </header>
        <div className="df-scroll flex-1 space-y-6 overflow-y-auto p-4">
          <FeatureFlagSection enabled={enabled} pending={togglingFlag}
            onToggle={() => void onToggleFlag()} onReadPrd={onClose} />
          <DisabledWrap disabled={!enabled}>
            <ApiKeySection status={keyStatus} expanded={keyExpanded} expanderMode={keyExpanderMode}
              provider={settings.apiKeyProvider}
              onAdd={() => { setKeyExpanderMode('add'); setKeyExpanded(true) }}
              onRotate={() => { setKeyExpanderMode('rotate'); setKeyExpanded(true) }}
              onRemove={async () => {
                const o = window.api?.orchestra; if (!o) return
                await o.apiKey.clear(); setKeyExpanded(false); await testKey()
              }}
              onCloseExpander={() => setKeyExpanded(false)}
              onSaved={async () => { setKeyExpanded(false); await testKey() }} />
          </DisabledWrap>
          <DisabledWrap disabled={!enabled}>
            <SafeModeSection teams={teams}
              onCycle={(team) => setSafeMode(team.id, nextSafeMode(team.safeMode))} />
          </DisabledWrap>
          <DisabledWrap disabled={!enabled}>
            <DangerZoneSection teamCount={teams.length} onWipeConfirmed={async () => {
              for (const t of teams) await deleteTeam(t.id)
              await window.api?.orchestra?.apiKey.clear()
              onClose()
            }} />
          </DisabledWrap>
        </div>
      </div>
    </div>
  )
}

// Section A — Feature flag -----------------------------------------------
function FeatureFlagSection({
  enabled, pending, onToggle, onReadPrd
}: { enabled: boolean; pending: boolean; onToggle: () => void; onReadPrd: () => void }) {
  return (
    <section>
      <h3 className="df-label mb-2">feature flag</h3>
      <div className="rounded-sm border border-border-soft bg-bg-1 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-text-1">Enable Orchestrador mode (experimental)</div>
            <p className="mt-1 text-[11px] leading-relaxed text-text-3">
              Orchestrador runs headless claude agents on tasks you submit.{' '}
              <button type="button" onClick={onReadPrd} className="text-accent-400 hover:text-accent-200">Read the PRD</button>.
            </p>
          </div>
          <Switch checked={enabled} onChange={onToggle} disabled={pending} />
        </div>
        {!enabled ? (
          <div className="mt-2 flex items-start gap-1.5 rounded-sm border border-border-soft bg-bg-2 px-2.5 py-1.5 text-[11px] text-text-3">
            <AlertTriangle size={11} strokeWidth={2} className="mt-0.5 shrink-0 text-status-warn" />
            <span>Existing teams and tasks are preserved — they&apos;ll reappear when you re-enable.</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}

// Section B — API key ----------------------------------------------------
interface ApiKeySectionProps {
  status: KeyStatus; expanded: boolean; expanderMode: 'add' | 'rotate'; provider: SecretStorage
  onAdd: () => void; onRotate: () => void; onRemove: () => void | Promise<void>
  onCloseExpander: () => void; onSaved: () => void | Promise<void>
}
function ApiKeySection(p: ApiKeySectionProps) {
  const present = p.status === 'present', absent = p.status === 'absent'
  const invalid = p.status === 'invalid', testing = p.status === 'testing' || p.status === 'unknown'
  return (
    <section>
      <h3 className="df-label mb-2 flex items-center gap-1.5">
        <Key size={11} strokeWidth={2} /> anthropic api key
      </h3>
      <div className="rounded-sm border border-border-soft bg-bg-1 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {testing ? (
              <div className="flex items-center gap-1.5 text-[11px] text-text-3">
                <Loader2 size={11} strokeWidth={2} className="animate-spin" /> Checking keychain…
              </div>
            ) : present ? (
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-text-1">{'●'.repeat(12)}</span>
                <span className="text-[11px] text-text-4">· stored in keychain</span>
              </div>
            ) : invalid ? (
              <div className="flex items-center gap-1.5 text-[11px] text-status-error">
                <AlertTriangle size={11} strokeWidth={2} /> Stored key was rejected. Rotate to fix.
              </div>
            ) : (
              <div className="text-[11px] text-text-3">No API key configured</div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {present ? (<>
              <button type="button" onClick={p.onRotate}
                className="flex items-center gap-1 rounded-sm border border-border-soft px-2 py-1 text-[11px] text-text-2 hover:border-border-mid hover:bg-bg-3">
                <RotateCcw size={10} strokeWidth={2} /> Rotate
              </button>
              <button type="button" onClick={() => void p.onRemove()}
                className="flex items-center gap-1 rounded-sm border border-status-error/40 px-2 py-1 text-[11px] text-status-error hover:bg-status-error/10">
                <Trash2 size={10} strokeWidth={2} /> Remove
              </button>
            </>) : invalid ? (
              <button type="button" onClick={p.onRotate}
                className="flex items-center gap-1 rounded-sm bg-accent-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-accent-600">
                <RotateCcw size={10} strokeWidth={2} /> Rotate key
              </button>
            ) : absent ? (
              <button type="button" onClick={p.onAdd}
                className="flex items-center gap-1 rounded-sm bg-accent-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-accent-600">
                <Plus size={10} strokeWidth={2} /> Add key
              </button>
            ) : null}
          </div>
        </div>
        {p.expanded ? (
          <KeyExpander defaultKeychain={p.provider !== 'safeStorage'} mode={p.expanderMode}
            onCancel={p.onCloseExpander} onSuccess={() => void p.onSaved()} />
        ) : null}
        {/* PRD §14 "Why two auths?" — kept verbatim. */}
        <p className="mt-3 border-t border-border-soft pt-2.5 text-[11px] leading-relaxed text-text-3">
          Hydra already works with the <code className="font-mono text-[10px]">claude</code> CLI
          using OAuth. Those sessions talk to Claude via the interactive CLI and share the
          host&apos;s <code className="font-mono text-[10px]">~/.claude</code> credentials.
          Orchestrador agents run <strong className="text-text-2">headless</strong> — no interactive
          prompt, no OAuth flow — via the Claude Agent SDK, which needs an Anthropic API key from{' '}
          <span className="font-mono text-text-2">console.anthropic.com</span>. They&apos;re
          additive, not replacements.
        </p>
      </div>
    </section>
  )
}

function KeyExpander({ defaultKeychain, mode, onCancel, onSuccess }: {
  defaultKeychain: boolean; mode: 'add' | 'rotate'; onCancel: () => void; onSuccess: () => void
}) {
  const [value, setValue] = useState('')
  const [keychain, setKeychain] = useState(defaultKeychain)
  const [status, setStatus] = useState<KeySaveStatus>('idle')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValue(''); setStatus('idle')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [mode])

  const validate = async (): Promise<void> => {
    const trimmed = value.trim()
    if (!trimmed) return
    const o = window.api?.orchestra
    if (!o) { setStatus('network'); return }
    setStatus('saving')
    const prefer: SecretStorage = keychain ? 'keychain' : 'safeStorage'
    const setRes = await o.apiKey.set(trimmed, prefer)
    if (!setRes.ok) { setStatus('network'); return }
    const test = await o.apiKey.test()
    if (test.ok) { setStatus('ok'); setTimeout(onSuccess, 500); return }
    const err = test.error.toLowerCase()
    setStatus(err.includes('401') || err.includes('unauthor') ? 'rejected' : 'network')
  }

  const canSubmit = value.trim().length > 0 && status !== 'saving'

  return (
    <div className="mt-3 rounded-sm border border-accent-500/30 bg-bg-2 p-3">
      <div className="df-label mb-2">{mode === 'rotate' ? 'rotate key' : 'add key'}</div>
      <input ref={inputRef} type="password" value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSubmit) void validate()
          if (e.key === 'Escape') onCancel()
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text').trim()
          if (pasted) { e.preventDefault(); setValue(pasted) }
        }}
        placeholder="sk-ant-…" autoComplete="off" spellCheck={false}
        className="w-full rounded-sm border border-border-mid bg-bg-1 px-2 py-1.5 font-mono text-sm text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none" />
      <label className="mt-2 flex items-start gap-2 text-[11px] text-text-2">
        <input type="checkbox" checked={keychain} onChange={(e) => setKeychain(e.target.checked)}
          className="mt-0.5 h-3 w-3 accent-accent-500" />
        <span className="leading-relaxed">Store in OS keychain <span className="text-text-4">(recommended)</span></span>
      </label>
      <KeyExpanderStatus status={status} />
      <div className="mt-2 flex items-center justify-end gap-1.5">
        <button type="button" onClick={onCancel} disabled={status === 'saving'}
          className="rounded-sm border border-border-soft px-2 py-1 text-[11px] text-text-2 hover:border-border-mid hover:bg-bg-3 disabled:opacity-40">Cancel</button>
        <button type="button" onClick={() => void validate()} disabled={!canSubmit}
          className="flex items-center gap-1.5 rounded-sm bg-accent-500 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-accent-600 disabled:opacity-40">
          {status === 'saving'
            ? <><Loader2 size={11} strokeWidth={2} className="animate-spin" /> Validating…</>
            : 'Validate & Save'}
        </button>
      </div>
    </div>
  )
}

function KeyExpanderStatus({ status }: { status: KeySaveStatus }) {
  if (status === 'idle' || status === 'saving') return null
  if (status === 'ok') return (
    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-accent-400">
      <Check size={11} strokeWidth={2} /> Validated. Closing…
    </div>
  )
  if (status === 'rejected') return (
    <div className="mt-2 flex items-start gap-1.5 text-[11px] text-status-error">
      <AlertTriangle size={11} strokeWidth={2} className="mt-0.5" />
      That key was rejected. Check it&apos;s from console.anthropic.com/settings/keys.
    </div>
  )
  return (
    <div className="mt-2 flex items-start gap-1.5 text-[11px] text-status-warn">
      <AlertTriangle size={11} strokeWidth={2} className="mt-0.5" />
      Couldn&apos;t reach Anthropic. Check your network and try again.
    </div>
  )
}

// Section C — Per-team safeMode ------------------------------------------
function SafeModeSection({
  teams, onCycle
}: { teams: Team[]; onCycle: (team: Team) => void | Promise<void> }) {
  // Only one row asks for yolo confirmation at a time.
  const [confirmingYoloFor, setConfirmingYoloFor] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const doCycle = async (team: Team): Promise<void> => {
    if (nextSafeMode(team.safeMode) === 'yolo') { setConfirmingYoloFor(team.id); return }
    setPendingId(team.id)
    try { await onCycle(team) } finally { setPendingId(null) }
  }
  const confirmYolo = async (team: Team): Promise<void> => {
    setPendingId(team.id)
    try { await onCycle(team); setConfirmingYoloFor(null) }
    finally { setPendingId(null) }
  }

  return (
    <section>
      <h3 className="df-label mb-2 flex items-center gap-1.5">
        <Shield size={11} strokeWidth={2} /> per-team safe mode
      </h3>
      {teams.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border-soft bg-bg-1 px-3 py-6 text-center text-[11px] text-text-4">
          No teams yet — create one to configure safe-mode.
        </div>
      ) : (
        <div className="flex flex-col gap-1 rounded-sm border border-border-soft bg-bg-1 p-1">
          {teams.map((team) => {
            const isConfirming = confirmingYoloFor === team.id
            const busy = pendingId === team.id
            return (
              <div key={team.id} className="flex flex-col gap-1.5 rounded-sm px-2 py-1.5 hover:bg-bg-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-text-1">{team.name}</div>
                    <div className="font-mono text-[10px] text-text-4">default: {team.defaultModel}</div>
                  </div>
                  <button type="button" onClick={() => void doCycle(team)}
                    disabled={busy || isConfirming}
                    title="click to cycle: strict → prompt → yolo"
                    className={`rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition disabled:opacity-40 ${SAFEMODE_STYLES[team.safeMode]}`}>
                    {team.safeMode}
                  </button>
                </div>
                {isConfirming ? (
                  <div className="flex items-center justify-between gap-2 rounded-sm border border-status-error/40 bg-status-error/10 px-2 py-1.5 text-[11px] text-status-error">
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle size={11} strokeWidth={2} /> No approval prompts. Proceed?
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => setConfirmingYoloFor(null)} disabled={busy}
                        className="rounded-sm border border-border-soft bg-bg-1 px-2 py-0.5 text-[10px] text-text-2 hover:bg-bg-3 disabled:opacity-40">Cancel</button>
                      <button type="button" onClick={() => void confirmYolo(team)} disabled={busy}
                        className="rounded-sm bg-status-error px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-status-error/90 disabled:opacity-40">
                        {busy ? 'Switching…' : 'Confirm'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// Section D — Danger zone ------------------------------------------------
function DangerZoneSection({
  teamCount, onWipeConfirmed
}: { teamCount: number; onWipeConfirmed: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canWipe = confirm === DELETE_PHRASE && !submitting

  const onWipe = async (): Promise<void> => {
    setSubmitting(true)
    try { await onWipeConfirmed() } finally { setSubmitting(false) }
  }

  return (
    <section>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="df-label flex items-center gap-1.5 text-status-error hover:text-status-error/80">
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} danger zone
      </button>
      {open ? (
        <div className="mt-2 rounded-sm border border-status-error/40 bg-status-error/5 p-3">
          <div className="text-sm font-semibold text-text-1">Delete all Orchestrador data (teams, agents, message logs)</div>
          <p className="mt-1 text-[11px] leading-relaxed text-text-3">
            This will remove {teamCount} team{teamCount === 1 ? '' : 's'}, every agent inside
            them, and clear the stored Anthropic API key. This cannot be undone.
          </p>
          <label className="df-label mt-3 block">
            type <span className="font-mono normal-case tracking-normal">{DELETE_PHRASE}</span> to confirm
          </label>
          <input type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off" spellCheck={false}
            className="mt-1 w-full rounded-sm border border-border-mid bg-bg-1 px-2 py-1.5 font-mono text-sm text-text-1 focus:border-status-error focus:outline-none" />
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <button type="button" onClick={() => { setConfirm(''); setOpen(false) }} disabled={submitting}
              className="rounded-sm border border-border-soft px-2.5 py-1 text-[11px] text-text-2 hover:border-border-mid hover:bg-bg-3 disabled:opacity-40">Cancel</button>
            <button type="button" onClick={() => void onWipe()} disabled={!canWipe}
              className="rounded-sm bg-status-error px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-status-error/90 disabled:opacity-40">
              {submitting ? 'Deleting…' : 'Delete everything'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

// Shared primitives ------------------------------------------------------
function Switch({
  checked, onChange, disabled
}: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={onChange} disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition disabled:opacity-40 ${
        checked ? 'border-accent-500/60 bg-accent-500' : 'border-border-mid bg-bg-3'
      }`}>
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition ${
        checked ? 'translate-x-4' : 'translate-x-1'
      }`} />
    </button>
  )
}

/** Greys out children when `disabled` and exposes a tooltip — used so every
 *  section except the feature-flag switch is inert while the flag is off. */
function DisabledWrap({ disabled, children }: { disabled: boolean; children: React.ReactNode }) {
  const tooltip = useMemo(() => (disabled ? 'Turn on Orchestrador to configure' : undefined), [disabled])
  return (
    <div className={disabled ? 'pointer-events-none select-none opacity-50' : ''}
      title={tooltip} aria-disabled={disabled}>
      {children}
    </div>
  )
}
