import { useEffect, useRef, useState } from 'react'
import { Check, PlayCircle, RotateCcw, Sparkles } from 'lucide-react'
import { useTour } from './store'

/**
 * TourLauncher — header button + dropdown listing every registered
 * tour with a ✓ pip for completed ones and a subtle pulse on the
 * trigger when the user has tours they haven't taken yet. Replaces the
 * earlier launcher that was a horizontal strip of raw buttons
 * (intentional — the user called that one a "lixo"). This version is
 * one tidy trigger, a menu with clear labels, and a "reset all" action
 * at the bottom for replaying onboarding.
 */
export default function TourLauncher() {
  const tours = useTour((s) => s.tours)
  const completedIds = useTour((s) => s.completedIds)
  const start = useTour((s) => s.start)
  const reset = useTour((s) => s.reset)
  const resetAll = useTour((s) => s.resetAll)

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (!rootRef.current) return
      if (e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const tourList = Object.values(tours)
  const hasUnseen = tourList.some((t) => !completedIds[t.id])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`group flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition ${
          open
            ? 'border-accent-500/40 bg-accent-500/10 text-accent-200'
            : 'border-transparent text-text-3 hover:border-border-soft hover:bg-bg-3 hover:text-text-1'
        }`}
        title="Guided tours"
        data-tour-id="header-tour"
      >
        <span className="relative">
          <Sparkles size={13} strokeWidth={1.75} />
          {hasUnseen && !open ? (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent-500 df-pulse" />
          ) : null}
        </span>
        <span className="font-mono">tour</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="df-fade-in absolute right-0 top-full z-[80] mt-1 w-80 overflow-hidden rounded-md border border-border-mid bg-bg-1 shadow-pop"
        >
          <div className="border-b border-border-soft bg-bg-2 px-3 py-2">
            <div className="df-label text-accent-400">guided tours</div>
            <p className="mt-0.5 text-[10px] leading-snug text-text-4">
              Click any tour to start. Keyboard: → next · ← back · Esc exit.
            </p>
          </div>
          <ul className="flex flex-col">
            {tourList.length === 0 ? (
              <li className="px-3 py-3 text-[11px] text-text-4">
                No tours registered yet.
              </li>
            ) : (
              tourList.map((t) => {
                const done = !!completedIds[t.id]
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        start(t.id)
                      }}
                      className="group flex w-full items-start gap-2.5 border-b border-border-soft px-3 py-2 text-left transition-colors hover:bg-bg-3"
                    >
                      <span
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm ${
                          done
                            ? 'bg-accent-500/15 text-accent-400'
                            : 'bg-bg-3 text-text-3 group-hover:bg-bg-4'
                        }`}
                      >
                        {done ? (
                          <Check size={11} strokeWidth={2} />
                        ) : (
                          <PlayCircle size={11} strokeWidth={1.75} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-[12px] font-semibold text-text-1">
                            {t.label}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-text-4">
                            {t.steps.length} step{t.steps.length === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-text-3">
                          {t.description}
                        </span>
                      </span>
                      {done ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            reset(t.id)
                          }}
                          className="mt-0.5 shrink-0 rounded-sm p-1 text-text-4 opacity-0 hover:bg-bg-4 hover:text-text-1 group-hover:opacity-100"
                          title="Mark as not completed"
                          aria-label={`Reset ${t.label}`}
                        >
                          <RotateCcw size={10} strokeWidth={1.75} />
                        </button>
                      ) : null}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
          {tourList.some((t) => completedIds[t.id]) ? (
            <div className="flex items-center justify-between gap-2 bg-bg-2 px-3 py-2">
              <span className="font-mono text-[10px] text-text-4">
                {Object.keys(completedIds).length} completed
              </span>
              <button
                type="button"
                onClick={() => {
                  resetAll()
                }}
                className="rounded-sm border border-border-soft bg-bg-1 px-2 py-0.5 font-mono text-[10px] text-text-3 hover:border-border-mid hover:text-text-1"
              >
                reset all
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
