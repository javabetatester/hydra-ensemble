import { useEffect, useRef, useState } from 'react'
import { Key, Info, ExternalLink, Loader2, Check, AlertCircle } from 'lucide-react'
import type { SecretStorage } from '../../../shared/orchestra'
import Modal from '../../ui/Modal'

interface Props {
  open: boolean
  /** Only callable after a successful set; the close button is blocked while
   *  the modal has no key yet (see `blocking`). */
  onClose: () => void
  /** When true the modal cannot be dismissed without entering a valid key. */
  blocking?: boolean
}

type Status = 'idle' | 'validating' | 'ok' | 'rejected' | 'network'

const KEYS_URL = 'https://console.anthropic.com/settings/keys'

/**
 * Modal the user sees the first time they open Orchestra (or when the stored
 * key is rejected). Stores the Anthropic API key in the OS keychain (or
 * Electron safeStorage as a fallback) and pings `/v1/messages` to validate.
 * The explainer copy is kept verbatim with PRD §14 "Why two auths?".
 */
export default function ApiKeyModal({ open, onClose, blocking = false }: Props) {
  const [value, setValue] = useState('')
  const [keychain, setKeychain] = useState(true)
  const [showExplainer, setShowExplainer] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const inputRef = useRef<HTMLInputElement>(null)
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    setValue('')
    setStatus('idle')
    setShowExplainer(false)
    requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      if (autoCloseRef.current) {
        clearTimeout(autoCloseRef.current)
        autoCloseRef.current = null
      }
    }
  }, [open])

  // Esc handling is owned by the Modal primitive now; when `blocking` is
  // true we pass `closeOnBackdrop={false}` and intercept onClose to no-op.

  if (!open) return null

  const canSubmit = value.trim().length > 0 && status !== 'validating'

  const validate = async (): Promise<void> => {
    const trimmed = value.trim()
    if (!trimmed) return
    // Orchestra preload namespace is optional while the feature flag is off —
    // bail out loudly so this never masquerades as a key problem.
    const o = window.api?.orchestra
    if (!o) {
      setStatus('network')
      return
    }
    const prefer: SecretStorage = keychain ? 'keychain' : 'safeStorage'
    setStatus('validating')
    const setResult = await o.apiKey.set(trimmed, prefer)
    if (!setResult.ok) {
      // `set` itself failed (e.g. keychain unavailable). Treat as network-class
      // so the user sees a Retry button.
      setStatus('network')
      return
    }
    const testResult = await o.apiKey.test()
    if (testResult.ok) {
      setStatus('ok')
      autoCloseRef.current = setTimeout(() => {
        autoCloseRef.current = null
        onClose()
      }, 600)
      return
    }
    const err = testResult.error.toLowerCase()
    const rejected = err.includes('401') || err.includes('unauthor') || err.includes('invalid')
    setStatus(rejected ? 'rejected' : 'network')
  }

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>): void => {
    // Strip whitespace/newlines pasted from the Anthropic console.
    const pasted = e.clipboardData.getData('text').trim()
    if (pasted) {
      e.preventDefault()
      setValue(pasted)
    }
  }

  // When the modal is blocking, Esc + backdrop-click are suppressed by
  // wrapping onClose in a guard. That plus closeOnBackdrop={false} gives
  // us the same "no exit until a valid key" behavior the old custom
  // overlay had.
  const handleClose = (): void => {
    if (blocking) return
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Anthropic API key for Orchestrador"
      titleIcon={<Key size={14} strokeWidth={1.75} className="text-accent-400" />}
      maxWidth="max-w-md"
      closeOnBackdrop={!blocking}
      footer={
        <>
          <button
            type="button" onClick={onClose}
            disabled={blocking || status === 'validating'}
            className="rounded-sm border border-border-soft px-3 py-1.5 text-xs text-text-2 hover:border-border-mid hover:bg-bg-3 disabled:cursor-not-allowed disabled:opacity-40"
          >Cancel</button>
          <button
            type="button" onClick={() => void validate()} disabled={!canSubmit}
            className="flex items-center gap-1.5 rounded-sm bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600 disabled:opacity-40"
          >
            {status === 'validating' ? (
              <><Loader2 size={12} strokeWidth={2} className="animate-spin" />Validating…</>
            ) : 'Validate & Save'}
          </button>
        </>
      }
    >
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-text-1">Anthropic API key for Orchestrador</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-text-3">
              Separate from your <code className="font-mono text-[10px]">claude</code> CLI login.{' '}
              <button
                type="button" onClick={() => setShowExplainer((v) => !v)}
                className="inline-flex items-center gap-0.5 text-accent-400 hover:text-accent-200"
              ><Info size={10} strokeWidth={1.75} />Why?</button>
            </p>
            {showExplainer ? (
              <div className="mt-2 rounded-sm border border-border-soft bg-bg-1 p-3 text-[11px] leading-relaxed text-text-3">
                Hydra already works with the <code className="font-mono text-[10px]">claude</code>{' '}
                CLI using OAuth. Those sessions talk to Claude via the interactive CLI and share
                the host&apos;s <code className="font-mono text-[10px]">~/.claude</code>{' '}
                credentials. Orchestrador agents run <strong>headless</strong> — no interactive
                prompt, no OAuth flow — via the Claude Agent SDK, which needs an Anthropic API
                key from{' '}
                <a href={KEYS_URL} target="_blank" rel="noreferrer" className="text-accent-400 hover:text-accent-200">console.anthropic.com</a>
                . They&apos;re additive, not replacements.
              </div>
            ) : null}
          </div>

          <div>
            <label className="df-label mb-1.5 block">api key</label>
            <input
              ref={inputRef} type="password" value={value} onPaste={onPaste}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) void validate() }}
              placeholder="sk-ant-…" autoComplete="off" spellCheck={false}
              className="w-full rounded-sm border border-border-mid bg-bg-1 px-2.5 py-1.5 font-mono text-sm text-text-1 placeholder:text-text-4 focus:border-accent-500 focus:outline-none"
            />
            <StatusLine status={status} onRetry={() => void validate()} />
          </div>

          <label className="flex items-start gap-2 text-[11px] text-text-2">
            <input
              type="checkbox" checked={keychain}
              onChange={(e) => setKeychain(e.target.checked)}
              className="mt-0.5 h-3 w-3 accent-accent-500"
            />
            <span className="leading-relaxed">
              Store in OS keychain <span className="text-text-4">(recommended)</span>
              <span className="mt-0.5 block text-text-4">
                falls back to encrypted file under{' '}
                <code className="font-mono text-[10px]">~/.hydra-ensemble/secrets</code>
                {' '}if the keychain is unavailable.
              </span>
            </span>
          </label>

          <a
            href={KEYS_URL} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-accent-400 hover:text-accent-200"
          >
            Get a key <ExternalLink size={10} strokeWidth={1.75} />
            <span className="font-mono text-text-4"> console.anthropic.com/settings/keys</span>
          </a>
        </div>
    </Modal>
  )
}

function StatusLine({ status, onRetry }: { status: Status; onRetry: () => void }) {
  if (status === 'idle') return null
  if (status === 'validating') {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-3">
        <Loader2 size={11} strokeWidth={2} className="animate-spin" />Validating…
      </div>
    )
  }
  if (status === 'ok') {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent-400">
        <Check size={11} strokeWidth={2} />Validated. Closing…
      </div>
    )
  }
  if (status === 'rejected') {
    return (
      <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-status-error">
        <AlertCircle size={11} strokeWidth={2} className="mt-0.5 shrink-0" />
        <span>
          That key was rejected. Check it&apos;s from{' '}
          <span className="font-mono">console.anthropic.com/settings/keys</span>.
        </span>
      </div>
    )
  }
  return (
    <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-status-warn">
      <AlertCircle size={11} strokeWidth={2} className="mt-0.5 shrink-0" />
      <span className="flex-1">
        Couldn&apos;t reach Anthropic. Check your network and try again.
      </span>
      <button
        type="button" onClick={onRetry}
        className="rounded-sm border border-border-soft px-1.5 py-0.5 text-[10px] text-text-2 hover:border-border-mid hover:bg-bg-3"
      >Retry</button>
    </div>
  )
}
