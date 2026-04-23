import {
  contextWindowFor,
  contextUsageTone,
  formatTokenCount
} from '../lib/modelContext'

interface Props {
  /** Current context footprint in tokens (jsonl `session.contextTokens`). */
  used: number | undefined
  /** Raw model name from the session; drives the context window size. */
  model: string | undefined
  /** Compact variant used inside session cards — no percent word, tighter
   *  spacing. Default is the verbose inline variant. */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Tiny context-window usage indicator. Renders `USED/WINDOW` + a thin
 * bar whose color shifts amber/red as the ratio climbs. Hidden entirely
 * when we have no model or no usage yet — no point showing 0% when the
 * agent hasn't produced a turn.
 *
 * Intent: let the user see "this agent is burning its context" at a
 * glance across the sessions panel without having to hover for a
 * tooltip.
 */
export default function ContextMeter({ used, model, size = 'sm', className }: Props) {
  if (!used || used <= 0) return null
  const windowSize = contextWindowFor(model)
  const ratio = Math.min(1, used / windowSize)
  const pct = Math.round(ratio * 100)
  const tone = contextUsageTone(ratio)
  const tall = size === 'md'

  return (
    <div
      className={`flex items-center gap-1 font-mono tabular-nums ${tall ? 'text-[11px]' : 'text-[10px]'} ${tone} ${className ?? ''}`}
      title={`Current context: ${used.toLocaleString()} / ${windowSize.toLocaleString()} tokens (${pct}%)`}
    >
      <span className={`inline-block h-1 w-10 overflow-hidden rounded-sm bg-bg-4`}>
        <span
          className="block h-full rounded-sm bg-current transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span>
        {formatTokenCount(used)}
        <span className="text-text-4">/{formatTokenCount(windowSize)}</span>
      </span>
    </div>
  )
}
