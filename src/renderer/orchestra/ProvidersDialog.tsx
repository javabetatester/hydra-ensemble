/**
 * ProvidersDialog — multi-provider auth console for Orchestra.
 *
 * Lists every provider from /shared/providers.ts as a card. User enables
 * the ones they want, pastes API keys where applicable, and picks which
 * team scope the config applies to (scope editing lives in other UI for
 * now — this modal focuses on enablement and keys).
 *
 * The default Claude Code OAuth path needs no configuration; it reuses
 * the host's `claude` CLI login. A "Recheck" button fires a DOM event
 * (`orchestra:recheck-claude-oauth`) the main process listens for — this
 * dialog never touches the CLI directly.
 *
 * Only `anthropic-api` currently talks to a real "Test" endpoint
 * (`window.api.orchestra.apiKey.test`); other providers stub the button.
 */

import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Key,
  Link,
  Lock,
  RefreshCw,
  X
} from 'lucide-react'
import {
  PROVIDERS,
  type AuthKind,
  type ProviderConfig,
  type ProviderDef,
  type ProviderId
} from '../../shared/providers'
import { useProviders } from './state/providers'
import { useToasts } from '../state/toasts'

interface Props {
  open: boolean
  onClose: () => void
}

type TestStatus = 'idle' | 'testing' | 'ok' | 'error'

export default function ProvidersDialog(props: Props) {
  const { open, onClose } = props
  const configs = useProviders((s) => s.configs)
  const setConfig = useProviders((s) => s.setConfig)
  const toggleEnabled = useProviders((s) => s.toggleEnabled)
  const clearValue = useProviders((s) => s.clearValue)
  const pushToast = useToasts((s) => s.push)

  // Per-provider UI-local test status. Not persisted.
  const [testStatus, setTestStatus] = useState<Record<ProviderId, TestStatus>>(() => {
    const init = {} as Record<ProviderId, TestStatus>
    for (const p of PROVIDERS) init[p.id] = 'idle'
    return init
  })
  const [testError, setTestError] = useState<Record<ProviderId, string | undefined>>(
    () => ({} as Record<ProviderId, string | undefined>)
  )

  // Keep a stable ref to onClose for keydown without re-binding.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  const saveKey = (def: ProviderDef, value: string): void => {
    const trimmed = value.trim()
    const current = configs[def.id]
    const patch: ProviderConfig = {
      ...current,
      id: def.id,
      value: trimmed.length > 0 ? trimmed : undefined
    }
    setConfig(patch)
    pushToast({
      kind: 'success',
      title: `${def.name} updated`,
      body: trimmed.length > 0 ? 'Key saved locally.' : 'Key cleared.'
    })
  }

  const handleTest = async (def: ProviderDef): Promise<void> => {
    setTestStatus((s) => ({ ...s, [def.id]: 'testing' }))
    setTestError((s) => ({ ...s, [def.id]: undefined }))

    // Only anthropic-api has a real IPC round-trip today.
    if (def.id === 'anthropic-api') {
      const o = window.api?.orchestra
      if (!o) {
        setTestStatus((s) => ({ ...s, [def.id]: 'error' }))
        setTestError((s) => ({ ...s, [def.id]: 'Orchestrador IPC unavailable in this build.' }))
        return
      }
      const result = await o.apiKey.test()
      if (result.ok) {
        setTestStatus((s) => ({ ...s, [def.id]: 'ok' }))
        pushToast({ kind: 'success', title: `${def.name} reachable` })
      } else {
        setTestStatus((s) => ({ ...s, [def.id]: 'error' }))
        setTestError((s) => ({ ...s, [def.id]: result.error }))
        pushToast({ kind: 'error', title: `${def.name} test failed`, body: result.error })
      }
      return
    }

    // Stub path for every other provider. Still useful feedback: we flip
    // to `ok` so the row visually confirms the button fired.
    await new Promise((r) => setTimeout(r, 250))
    setTestStatus((s) => ({ ...s, [def.id]: 'ok' }))
    pushToast({
      kind: 'info',
      title: `${def.name} test`,
      body: 'Stub response — routing support is coming soon.'
    })
  }

  const recheckClaudeOauth = (): void => {
    window.dispatchEvent(new CustomEvent('orchestra:recheck-claude-oauth'))
    pushToast({
      kind: 'info',
      title: 'Re-checking Claude OAuth',
      body: 'Orchestrador will refresh the CLI session state.'
    })
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-bg-0/85 px-4 backdrop-blur-md df-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Orchestrador providers"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}
      >
        <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-4 py-3">
          <div className="flex items-center gap-2">
            <Key size={14} strokeWidth={1.75} className="text-accent-400" />
            <span className="df-label text-sm font-semibold text-text-1">providers</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="close"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-[11px] leading-relaxed text-text-3">
            Every Orchestrador agent picks a provider. The default is{' '}
            <span className="font-mono text-text-2">claude-oauth</span> — it reuses your{' '}
            <code className="font-mono text-[10px]">claude</code> CLI login, no setup needed.
            Enable additional providers below to use them from the agent or team settings.
          </p>

          <div className="space-y-3">
            {PROVIDERS.map((def) => {
              const cfg = configs[def.id]
              const status = testStatus[def.id] ?? 'idle'
              const err = testError[def.id]
              return (
                <ProviderCard
                  key={def.id}
                  def={def}
                  config={cfg}
                  status={status}
                  errorMessage={err}
                  onToggle={(next) => toggleEnabled(def.id, next)}
                  onSaveKey={(v) => saveKey(def, v)}
                  onClearKey={() => {
                    clearValue(def.id)
                    pushToast({ kind: 'info', title: `${def.name} key cleared` })
                  }}
                  onTest={() => void handleTest(def)}
                  onRecheckOauth={def.id === 'claude-oauth' ? recheckClaudeOauth : undefined}
                />
              )
            })}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border-soft bg-bg-1 px-4 py-3">
          <div className="font-mono text-[10px] text-text-4">
            keys persist locally · use Clear to revoke
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-border-soft px-3 py-1.5 text-[11px] text-text-2 hover:border-border-mid hover:bg-bg-3"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProviderCard — one row per provider. Stateless except for the reveal toggle.
// ---------------------------------------------------------------------------

interface CardProps {
  def: ProviderDef
  config: ProviderConfig
  status: TestStatus
  errorMessage?: string
  onToggle: (next: boolean) => void
  onSaveKey: (value: string) => void
  onClearKey: () => void
  onTest: () => void
  /** Only provided for claude-oauth. */
  onRecheckOauth?: () => void
}

function ProviderCard(props: CardProps) {
  const { def, config, status, errorMessage, onToggle, onSaveKey, onClearKey, onTest, onRecheckOauth } = props

  // Draft value lives in the card so typing doesn't thrash the store on
  // every keystroke. Commit on blur / Save button.
  const [draft, setDraft] = useState<string>(config.value ?? '')
  const [reveal, setReveal] = useState<boolean>(false)

  useEffect(() => {
    // Keep draft in sync if the stored value changed elsewhere (e.g.
    // cleared from another window / preload migration).
    setDraft(config.value ?? '')
  }, [config.value])

  const disabled = !def.supported
  const hasValue = typeof config.value === 'string' && config.value.length > 0
  const connected = def.authKind === 'apiKey' ? hasValue : config.enabled

  const keyFormatOk =
    def.keyFormat && draft.length > 0 ? def.keyFormat.test(draft.trim()) : true
  const canSave = draft.trim() !== (config.value ?? '') && keyFormatOk

  return (
    <div
      className={`rounded-sm border bg-bg-1 p-3 ${
        disabled ? 'border-border-soft opacity-70' : 'border-border-mid'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-text-1">{def.name}</span>
            <AuthKindBadge kind={def.authKind} />
            {def.supported ? (
              connected ? (
                <span className="inline-flex items-center gap-1 rounded-sm border border-accent-500/40 bg-accent-500/10 px-1.5 py-0.5 text-[10px] font-mono text-accent-400">
                  <CheckCircle2 size={10} strokeWidth={2} />
                  connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-1.5 py-0.5 text-[10px] font-mono text-text-3">
                  not set
                </span>
              )
            ) : (
              <span
                className="inline-flex items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-1.5 py-0.5 text-[10px] font-mono text-text-3"
                title="Routing support for this provider is coming soon"
              >
                coming soon
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-text-3">{def.description}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-text-4">
            {def.envVar ? (
              <span className="font-mono">env: {def.envVar}</span>
            ) : null}
            <a
              href={def.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-accent-400 hover:text-accent-200"
            >
              docs
            </a>
          </div>
        </div>

        <ToggleSwitch
          checked={config.enabled}
          disabled={disabled}
          onChange={(v) => onToggle(v)}
          ariaLabel={`enable ${def.name}`}
        />
      </div>

      {/* Active row — key input for apiKey providers, oauth recheck for
          claude-oauth, stub button for cli/openrouter. */}
      <div className="mt-3 border-t border-border-soft pt-3">
        {def.authKind === 'apiKey' ? (
          <div className="space-y-2">
            <div className="flex items-stretch gap-2">
              <input
                type={reveal ? 'text' : 'password'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => {
                  if (canSave) onSaveKey(draft)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSave) onSaveKey(draft)
                }}
                placeholder={def.id === 'anthropic-api' ? 'sk-ant-…' : 'paste key'}
                spellCheck={false}
                autoComplete="off"
                disabled={disabled}
                className="flex-1 rounded-sm border border-border-mid bg-bg-2 px-2.5 py-1.5 font-mono text-[11px] text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setReveal((r) => !r)}
                disabled={disabled}
                className="rounded-sm border border-border-mid bg-bg-2 px-2 text-[10px] text-text-3 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={reveal ? 'hide key' : 'reveal key'}
              >
                {reveal ? 'hide' : 'show'}
              </button>
            </div>
            {!keyFormatOk ? (
              <div className="flex items-center gap-1.5 text-[10px] text-status-warn">
                <AlertCircle size={10} strokeWidth={2} />
                <span>Format looks off — double-check you copied the full key.</span>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onSaveKey(draft)}
                disabled={disabled || !canSave}
                className="rounded-sm bg-accent-500 px-3 py-1 text-[11px] font-semibold text-white hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save
              </button>
              <button
                type="button"
                onClick={onTest}
                disabled={disabled || !hasValue || status === 'testing'}
                className="inline-flex items-center gap-1 rounded-sm border border-border-mid bg-bg-2 px-3 py-1 text-[11px] text-text-2 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw
                  size={10}
                  strokeWidth={2}
                  className={status === 'testing' ? 'animate-spin' : undefined}
                />
                Test
              </button>
              {hasValue ? (
                <button
                  type="button"
                  onClick={onClearKey}
                  disabled={disabled}
                  className="rounded-sm border border-border-soft px-3 py-1 text-[11px] text-text-3 hover:border-border-mid hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
              ) : null}
              <TestStatusPill status={status} errorMessage={errorMessage} />
            </div>
          </div>
        ) : def.authKind === 'oauth' ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] leading-relaxed text-text-3">
              reuses <code className="font-mono text-[10px]">~/.claude</code> login — no configuration needed
            </p>
            {onRecheckOauth ? (
              <button
                type="button"
                onClick={onRecheckOauth}
                className="inline-flex items-center gap-1 rounded-sm border border-border-mid bg-bg-2 px-3 py-1 text-[11px] text-text-2 hover:bg-bg-3 hover:text-text-1"
              >
                <RefreshCw size={10} strokeWidth={2} />
                Recheck
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] leading-relaxed text-text-3">
              relies on the <code className="font-mono text-[10px]">{def.id}</code> binary being on $PATH
            </p>
            <button
              type="button"
              onClick={onTest}
              disabled={disabled || status === 'testing'}
              className="inline-flex items-center gap-1 rounded-sm border border-border-mid bg-bg-2 px-3 py-1 text-[11px] text-text-2 hover:bg-bg-3 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw
                size={10}
                strokeWidth={2}
                className={status === 'testing' ? 'animate-spin' : undefined}
              />
              Test
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small presentational bits.
// ---------------------------------------------------------------------------

function AuthKindBadge({ kind }: { kind: AuthKind }) {
  if (kind === 'apiKey') {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-1.5 py-0.5 text-[10px] font-mono text-text-2">
        <Key size={9} strokeWidth={2} />
        apiKey
      </span>
    )
  }
  if (kind === 'oauth') {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-1.5 py-0.5 text-[10px] font-mono text-text-2">
        <Lock size={9} strokeWidth={2} />
        oauth
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-sm border border-border-soft bg-bg-2 px-1.5 py-0.5 text-[10px] font-mono text-text-2">
      <Link size={9} strokeWidth={2} />
      cli
    </span>
  )
}

function TestStatusPill({ status, errorMessage }: { status: TestStatus; errorMessage?: string }) {
  if (status === 'idle') return null
  if (status === 'testing') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-text-3">
        <RefreshCw size={10} strokeWidth={2} className="animate-spin" />
        testing…
      </span>
    )
  }
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-accent-400">
        <CheckCircle2 size={10} strokeWidth={2} />
        ok
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-status-error"
      title={errorMessage}
    >
      <AlertCircle size={10} strokeWidth={2} />
      failed
    </span>
  )
}

interface ToggleSwitchProps {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  ariaLabel: string
}

function ToggleSwitch(props: ToggleSwitchProps) {
  const { checked, disabled, onChange, ariaLabel } = props
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
        checked
          ? 'border-accent-500 bg-accent-500/40'
          : 'border-border-mid bg-bg-2'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-text-1 transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  )
}
