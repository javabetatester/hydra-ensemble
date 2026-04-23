/**
 * Model → context-window size map (in tokens).
 *
 * The JSONL watcher emits `shortModelName(rawModel)` — typically
 * 'sonnet' | 'opus' | 'haiku' — plus sometimes a beta variant in the
 * raw model id. We match on the short name first and special-case the
 * 1M-context Opus when the raw id carries the `1m` marker.
 *
 * Values come from Anthropic's published limits; bumping them when
 * Anthropic ships a new window size is a one-line change here, no
 * ripple through the renderer.
 */

const DEFAULT_WINDOW = 200_000

const WINDOWS: Record<string, number> = {
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
}

/** Resolve the context window size in tokens for a model name. */
export function contextWindowFor(model: string | undefined | null): number {
  if (!model) return DEFAULT_WINDOW
  const lower = model.toLowerCase()
  // 1M beta window on Opus 4.6 / 4.7 — recognised via the `1m` marker
  // that the CLI sometimes appends to the model id.
  if (lower.includes('opus') && lower.includes('1m')) return 1_000_000
  for (const key of Object.keys(WINDOWS)) {
    if (lower.includes(key)) return WINDOWS[key]!
  }
  return DEFAULT_WINDOW
}

/** Format a token count as a compact label ('42.1K', '1.2M'). */
export function formatTokenCount(n: number | undefined | null): string {
  if (!Number.isFinite(n) || n == null || n <= 0) return '0'
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
}

/** Tailwind text class for the context-usage pill based on fill ratio. */
export function contextUsageTone(ratio: number): string {
  if (ratio >= 0.9) return 'text-status-attention'
  if (ratio >= 0.75) return 'text-status-running'
  if (ratio >= 0.5) return 'text-status-thinking'
  return 'text-text-3'
}
