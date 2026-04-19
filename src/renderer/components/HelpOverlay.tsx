import { useEffect, useMemo } from 'react'
import { Keyboard, RotateCcw, X, Pencil, Trash2, Check } from 'lucide-react'
import { ACTIONS, allBindings, useKeybinds } from '../state/keybinds'
import { formatCombo } from '../lib/keybind'

interface Props {
  open: boolean
  onClose: () => void
}

export default function HelpOverlay({ open, onClose }: Props) {
  const overrides = useKeybinds((s) => s.overrides)
  const recording = useKeybinds((s) => s.recording)
  const startRecording = useKeybinds((s) => s.startRecording)
  const stopRecording = useKeybinds((s) => s.stopRecording)
  const clearBind = useKeybinds((s) => s.clearBind)
  const resetBind = useKeybinds((s) => s.resetBind)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      // Don't close on Escape while recording — the keybinds dispatcher
      // handles cancel separately.
      if (e.key === 'Escape' && !useKeybinds.getState().recording) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Stop any in-flight recording when the overlay closes.
  useEffect(() => {
    if (!open && recording) stopRecording()
  }, [open, recording, stopRecording])

  const groups = useMemo(() => {
    const all = allBindings(overrides)
    const map = new Map<string, typeof all>()
    for (const it of all) {
      const arr = map.get(it.action.group) ?? []
      arr.push(it)
      map.set(it.action.group, arr)
    }
    return [...map.entries()]
  }, [overrides])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-bg-0/85 px-4 backdrop-blur-md df-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}
      >
        <header className="flex items-center justify-between border-b border-border-soft bg-bg-1 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Keyboard size={14} strokeWidth={1.75} className="text-accent-400" />
            <span className="df-label">keyboard shortcuts</span>
            <span className="font-mono text-[10px] text-text-4">
              · click a binding to remap
            </span>
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

        <div className="df-scroll max-h-[70vh] overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {groups.map(([group, items]) => (
              <div key={group}>
                <div className="df-label mb-2 text-accent-400">{group}</div>
                <div className="flex flex-col gap-1">
                  {items.map(({ action, combo }) => {
                    const isRecording = recording === action.id
                    const isOverridden =
                      action.id in overrides && overrides[action.id] !== action.default
                    return (
                      <div
                        key={action.id}
                        className="group flex items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-[11px] hover:bg-bg-3"
                      >
                        <span className="min-w-0 truncate text-text-2">{action.label}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              isRecording ? stopRecording() : startRecording(action.id)
                            }
                            className={`flex min-w-[5rem] items-center justify-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[10px] transition ${
                              isRecording
                                ? 'border-accent-500 bg-accent-500/15 text-accent-200 df-pulse'
                                : combo
                                  ? isOverridden
                                    ? 'border-accent-500/30 bg-bg-3 text-accent-200'
                                    : 'border-border-soft bg-bg-3 text-text-3'
                                  : 'border-dashed border-border-soft bg-transparent text-text-4'
                            }`}
                          >
                            {isRecording ? (
                              <>
                                <Check size={10} strokeWidth={2} />
                                press a key…
                              </>
                            ) : combo ? (
                              formatCombo(combo)
                            ) : (
                              'unbound'
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => resetBind(action.id)}
                            disabled={!isOverridden && action.id in overrides === false}
                            className="rounded-sm p-1 text-text-4 opacity-0 transition hover:bg-bg-4 hover:text-text-1 group-hover:opacity-100 disabled:opacity-0"
                            title={`reset to default (${formatCombo(action.default)})`}
                          >
                            <RotateCcw size={10} strokeWidth={1.75} />
                          </button>
                          <button
                            type="button"
                            onClick={() => clearBind(action.id)}
                            className="rounded-sm p-1 text-text-4 opacity-0 transition hover:bg-bg-4 hover:text-status-attention group-hover:opacity-100"
                            title="clear binding"
                          >
                            <Trash2 size={10} strokeWidth={1.75} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-sm border border-border-soft bg-bg-1 p-3 text-[10px] leading-relaxed text-text-4">
            <div className="mb-1.5 flex items-center gap-1 text-text-3">
              <Pencil size={10} strokeWidth={1.75} />
              tips
            </div>
            <ul className="ml-3 list-disc space-y-0.5">
              <li>
                Click a binding chip to record a new combo. Press the new combo, or{' '}
                <kbd className="rounded-sm bg-bg-3 px-1 font-mono text-text-3">Esc</kbd> to cancel.
              </li>
              <li>
                <kbd className="rounded-sm bg-bg-3 px-1 font-mono text-text-3">↻</kbd> reverts to
                the shipped default; <kbd className="rounded-sm bg-bg-3 px-1 font-mono text-text-3">🗑</kbd>{' '}
                removes the bind so the action is unavailable.
              </li>
              <li>
                <strong>mod</strong> = ⌘ on macOS, Ctrl on Linux/Windows. Bindings persist in
                browser storage.
              </li>
              <li>
                Ctrl+1..9 (jump to session N) is hardcoded — too many to expose as separate
                actions.
              </li>
            </ul>
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-border-soft bg-bg-1 px-4 py-2 font-mono text-[10px] text-text-4">
          <span>{ACTIONS.length} actions</span>
          <span>
            press <kbd className="mx-1 rounded-sm bg-bg-3 px-1 text-text-3">?</kbd> any time ·{' '}
            <kbd className="mx-1 rounded-sm bg-bg-3 px-1 text-text-3">Esc</kbd> to close
          </span>
        </footer>
      </div>
    </div>
  )
}
