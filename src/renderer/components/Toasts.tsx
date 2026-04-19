import { useEffect } from 'react'
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, X } from 'lucide-react'
import { useToasts, type Toast, type ToastKind } from '../state/toasts'
import { useSessions } from '../state/sessions'

const KIND_STYLE: Record<
  ToastKind,
  { ring: string; bar: string; icon: React.ReactNode }
> = {
  info: {
    ring: 'border-border-mid',
    bar: 'bg-text-3',
    icon: <Bell size={14} strokeWidth={1.75} className="text-text-2" />
  },
  attention: {
    ring: 'border-status-attention/40',
    bar: 'bg-status-attention',
    icon: (
      <AlertTriangle size={14} strokeWidth={1.75} className="text-status-attention df-pulse" />
    )
  },
  success: {
    ring: 'border-status-generating/40',
    bar: 'bg-status-generating',
    icon: <CheckCircle2 size={14} strokeWidth={1.75} className="text-status-generating" />
  },
  error: {
    ring: 'border-status-attention/50',
    bar: 'bg-status-attention',
    icon: <AlertCircle size={14} strokeWidth={1.75} className="text-status-attention" />
  }
}

export default function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  const setActive = useSessions((s) => s.setActive)

  useEffect(() => {
    // Wire backend-side watchdog and notify events into the toast stream.
    const offWd = window.api.watchdog.onFire((evt) => {
      useToasts.getState().push({
        kind: 'attention',
        title: `watchdog ${evt.ruleId}`,
        body: evt.matched ? `matched: ${evt.matched.slice(0, 80)}` : undefined,
        sessionId: evt.sessionId
      })
    })
    return () => {
      offWd()
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-12 right-4 z-[60] flex w-80 flex-col-reverse gap-2">
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          toast={t}
          onDismiss={() => dismiss(t.id)}
          onFocus={() => {
            if (t.sessionId) setActive(t.sessionId)
            dismiss(t.id)
          }}
        />
      ))}
    </div>
  )
}

function ToastItem({
  toast,
  onDismiss,
  onFocus
}: {
  toast: Toast
  onDismiss: () => void
  onFocus: () => void
}) {
  const style = KIND_STYLE[toast.kind]
  return (
    <div
      role="status"
      className={`pointer-events-auto df-slide-in flex overflow-hidden border bg-bg-2 shadow-pop ${style.ring}`}
      style={{ borderRadius: 'var(--radius-md)' }}
    >
      <div className={`w-1 shrink-0 ${style.bar}`} aria-hidden />
      <button
        type="button"
        onClick={toast.sessionId ? onFocus : undefined}
        className="flex flex-1 items-start gap-2.5 px-3 py-2.5 text-left"
      >
        <span className="mt-0.5 shrink-0">{style.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text-1">{toast.title}</div>
          {toast.body ? (
            <div className="mt-0.5 line-clamp-2 font-mono text-[11px] text-text-3">
              {toast.body}
            </div>
          ) : null}
        </div>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 px-2 text-text-4 hover:text-text-1"
        title="dismiss"
        aria-label="dismiss"
      >
        <X size={12} strokeWidth={1.75} />
      </button>
    </div>
  )
}
