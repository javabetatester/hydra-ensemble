import { useEffect, useState } from 'react'
import { Star, X } from 'lucide-react'

// Inline GitHub mark — lucide-react in this repo doesn't export
// `Github`, so we ship the official octocat path directly. Small
// enough that a dedicated import would be more boilerplate than gain.
function GithubMark({ size = 14 }: { size?: number }): React.ReactElement {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

const STORAGE_KEY = 'hydra.star.dismissed'
const REPO_URL = 'https://github.com/javabetatester/hydra-ensemble'
/** Delay before the modal materialises so the welcome screen has a
 *  beat to settle — popping the CTA the instant the app mounts feels
 *  desperate. 1.6s reads as "the user is here, we can ask now." */
const SHOW_DELAY_MS = 1600

/**
 * One-time "star us on GitHub" CTA shown the first time the app is
 * opened. Persists a dismissal flag in localStorage so this is a
 * single ask — no nag loop. Falls back to never showing if the
 * storage write fails (private mode, tmpfs, etc).
 */
export default function StarOnGithub(): React.ReactElement | null {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let dismissed = false
    try {
      dismissed = localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      // Treat unreadable storage as already-dismissed; we'd rather
      // be silent than show the modal on every launch.
      dismissed = true
    }
    if (dismissed) return
    const t = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [])

  const dismiss = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* noop */
    }
    setOpen(false)
  }

  // Esc to close — same affordance the rest of the app's modals use.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div
      className="df-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-bg-0/80 px-4 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss()
      }}
    >
      <div
        className="relative flex w-full max-w-md flex-col overflow-hidden border border-border-mid bg-bg-2 shadow-pop"
        style={{ borderRadius: 'var(--radius-lg)' }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-2 top-2 z-10 rounded-sm p-1 text-text-3 hover:bg-bg-3 hover:text-text-1"
          aria-label="dismiss"
        >
          <X size={14} strokeWidth={1.75} />
        </button>

        {/* Hero — accent gradient strip with a pulsing star */}
        <div
          className="relative flex h-32 items-center justify-center overflow-hidden border-b border-border-soft"
          style={{
            background:
              'radial-gradient(ellipse at 50% 60%, rgba(255,107,77,0.25) 0%, rgba(255,107,77,0.05) 60%, transparent 100%)'
          }}
        >
          {/* Soft pulsing halo behind the star */}
          <span
            aria-hidden
            className="absolute h-24 w-24 animate-ping rounded-full bg-accent-500/15"
            style={{ animationDuration: '2.4s' }}
          />
          <span
            aria-hidden
            className="absolute h-16 w-16 rounded-full bg-accent-500/20 df-pulse"
          />
          <Star
            size={44}
            strokeWidth={1.75}
            className="relative text-accent-300"
            fill="currentColor"
          />
        </div>

        <div className="px-5 pt-5 pb-4 text-center">
          <h2 className="mb-1.5 text-lg font-semibold text-text-1">
            Help Hydra grow.
          </h2>
          <p className="text-[13px] leading-relaxed text-text-3">
            Hydra is open source &mdash; MIT licensed, no telemetry, no
            paywall. A GitHub star is the cheapest way to tell us
            you&apos;re using it, and it helps the next person find the
            project.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 border-t border-border-soft bg-bg-1 px-5 py-4">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={dismiss}
            className="group flex items-center justify-center gap-2 rounded-sm bg-gradient-to-br from-accent-400 to-accent-600 px-4 py-2.5 font-mono text-[13px] font-semibold text-white shadow-pop transition hover:from-accent-300 hover:to-accent-500"
          >
            <GithubMark size={14} />
            <span>Star on GitHub</span>
            <Star
              size={12}
              strokeWidth={1.75}
              fill="currentColor"
              className="transition-transform group-hover:rotate-12"
            />
          </a>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-sm px-4 py-1.5 font-mono text-[11px] text-text-4 transition hover:text-text-2"
          >
            maybe later
          </button>
        </div>
      </div>
    </div>
  )
}
