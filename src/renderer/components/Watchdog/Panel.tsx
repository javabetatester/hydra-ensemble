import { useEffect, useState } from 'react'
import {
  Bell,
  Edit3,
  Info,
  Plus,
  Square,
  Terminal,
  Trash2,
  X,
  Zap
} from 'lucide-react'
import { useWatchdog } from '../../state/watchdog'
import RuleDialog from './RuleDialog'
import type { WatchdogRule } from '../../../shared/types'

interface Props {
  open: boolean
  onClose: () => void
  mode?: 'inline' | 'overlay'
}

function ActionIcon({ action }: { action: WatchdogRule['action'] }) {
  if (action === 'sendInput') return <Terminal size={11} strokeWidth={1.75} />
  if (action === 'kill') return <Square size={11} strokeWidth={1.75} />
  return <Bell size={11} strokeWidth={1.75} />
}

export default function WatchdogPanel({ open, onClose, mode = 'inline' }: Props) {
  const rules = useWatchdog((s) => s.rules)
  const log = useWatchdog((s) => s.log)
  const init = useWatchdog((s) => s.init)
  const toggle = useWatchdog((s) => s.toggle)
  const remove = useWatchdog((s) => s.remove)
  const startEdit = useWatchdog((s) => s.startEdit)
  const [showExplainer, setShowExplainer] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const body = (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-bg-2">
      <header className="flex shrink-0 items-center justify-between border-b border-border-soft bg-bg-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Zap size={14} strokeWidth={1.75} className="text-accent-400" />
          <span className="font-semibold text-text-1">watchdogs</span>
          <span className="font-mono text-[10px] text-text-4">
            · {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowExplainer((v) => !v)}
            className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-[10px] text-text-4 hover:bg-bg-3 hover:text-text-1"
            title="what are watchdogs?"
          >
            <Info size={11} strokeWidth={1.75} />
            what are these?
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1.5 text-text-3 hover:bg-bg-3 hover:text-text-1"
            aria-label="close"
            title="Esc"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {showExplainer ? (
        <div className="border-b border-border-soft bg-bg-1 px-4 py-3 text-[11px] leading-relaxed text-text-3">
          <p className="mb-1.5">
            <strong className="text-text-2">Watchdogs</strong> — rules that continuously read the
            agent's terminal output (every character claude and the shell print) and fire an
            action when a pattern matches. Let agents run unattended for long tasks.
          </p>
          <p className="mb-1.5">
            <strong className="text-text-2">Examples:</strong>
          </p>
          <ul className="mb-1.5 ml-4 list-disc space-y-0.5">
            <li>
              Claude asks <em>&quot;Do you want to proceed?&quot;</em> → rule fires{' '}
              <code className="rounded-sm bg-bg-3 px-1 font-mono">sendInput: y\n</code>{' '}
              automatically.
            </li>
            <li>
              Claude prints <em>&quot;Error:&quot;</em> → rule fires a{' '}
              <code className="rounded-sm bg-bg-3 px-1 font-mono">notify</code> toast.
            </li>
            <li>
              Build hangs in an infinite loop → rule fires{' '}
              <code className="rounded-sm bg-bg-3 px-1 font-mono">kill</code> to end the session.
            </li>
          </ul>
          <p>
            Each rule has a <strong>name</strong>, a <strong>regex</strong> (pattern to match
            against recent output), an <strong>action</strong> (sendInput / notify / kill) and a{' '}
            <strong>cooldown</strong> (ms between fires so it doesn't spam).
          </p>
        </div>
      ) : null}

      <div className="df-scroll min-h-0 flex-1 overflow-y-auto">
        {rules.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
            <Zap size={32} strokeWidth={1.25} className="text-text-4" />
            <div className="text-sm text-text-2">no watchdog rules</div>
            <div className="max-w-xs text-xs text-text-4">
              create a rule to react to the agent's terminal output automatically.
            </div>
            <button
              type="button"
              onClick={() => startEdit('new')}
              className="mt-2 flex items-center gap-1.5 rounded-sm bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600"
            >
              <Plus size={13} strokeWidth={2} />
              new rule
            </button>
          </div>
        )}
        <div className="flex flex-col gap-1.5 p-3">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onToggle={() => void toggle(rule.id)}
              onEdit={() => startEdit(rule.id)}
              onRemove={() => void remove(rule.id)}
            />
          ))}
        </div>
        {log.length > 0 && (
          <div className="border-t border-border-soft p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-text-4">
              <Bell size={10} strokeWidth={1.75} />
              recent fires
            </div>
            <ul className="df-scroll max-h-40 space-y-1 overflow-y-auto pr-1 text-xs">
              {log.slice(0, 30).map((entry, idx) => (
                <li
                  key={`${entry.ruleId}-${entry.at}-${idx}`}
                  className="flex items-start gap-2 rounded-md px-2 py-1 text-text-2 hover:bg-bg-3"
                >
                  <span className="font-mono text-[10px] text-text-4">
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                  <span className="font-medium text-status-generating">{entry.ruleName}</span>
                  <span className="truncate text-text-3">→ {entry.matched}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {rules.length > 0 && (
        <footer className="shrink-0 border-t border-border-soft p-3">
          <button
            type="button"
            onClick={() => startEdit('new')}
            className="flex w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-border-mid bg-bg-2 px-3 py-1.5 text-xs text-text-3 hover:border-border-hard hover:bg-bg-3 hover:text-text-1"
          >
            <Plus size={13} strokeWidth={2} />
            new rule
          </button>
        </footer>
      )}

    </div>
  )

  return body
}

interface RowProps {
  rule: WatchdogRule
  onToggle: () => void
  onEdit: () => void
  onRemove: () => void
}

function actionStyles(action: WatchdogRule['action']): string {
  if (action === 'sendInput') return 'bg-status-input/15 text-status-input'
  if (action === 'kill') return 'bg-status-attention/15 text-status-attention'
  return 'bg-bg-4 text-text-2'
}

function RuleRow({ rule, onToggle, onEdit, onRemove }: RowProps) {
  return (
    <div className="df-lift group flex items-center gap-3 rounded-md border border-border-soft bg-bg-3 px-3 py-2.5 hover:border-border-mid hover:bg-bg-4">
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={onToggle}
          className="peer sr-only"
          aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
        />
        <span className="block h-4 w-7 rounded-full bg-bg-5 transition peer-checked:bg-accent-500" />
        <span className="absolute left-0.5 top-0.5 block h-3 w-3 rounded-full bg-text-1 transition peer-checked:translate-x-3" />
      </label>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm text-text-1">{rule.name}</div>
          <span
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${actionStyles(
              rule.action
            )}`}
          >
            <ActionIcon action={rule.action} />
            {rule.action}
          </span>
        </div>
        <div
          className="mt-0.5 truncate font-mono text-xs text-text-3"
          title={rule.triggerPattern}
        >
          /{rule.triggerPattern}/
          {rule.action === 'sendInput' && rule.payload ? (
            <span className="text-text-4"> → &quot;{rule.payload}&quot;</span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md p-1.5 text-text-3 hover:bg-bg-3 hover:text-text-1"
          title="Edit"
          aria-label="Edit rule"
        >
          <Edit3 size={13} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md p-1.5 text-text-3 hover:bg-bg-3 hover:text-status-attention"
          title="Delete"
          aria-label="Delete rule"
        >
          <Trash2 size={13} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
