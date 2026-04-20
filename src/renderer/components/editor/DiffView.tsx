import { useMemo, useState } from 'react'

interface Props {
  diff: string
  /** When true, fills the parent container instead of capping height. */
  fill?: boolean
  emptyLabel?: string
}

/** Hard ceiling on rendered lines per pass. A single huge diff (think
 *  package-lock.json) with 20k+ lines turns into 20k DOM nodes otherwise
 *  and locks up the renderer. Users can opt in to seeing the rest. */
const LINE_BUDGET = 2000

function classFor(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-status-generating'
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-status-attention'
  if (line.startsWith('@@')) return 'text-status-input'
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'text-accent-400'
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-text-3'
  return 'text-text-2'
}

/**
 * Colorised unified-diff renderer. Lightweight on purpose — just ANSI-style
 * line tinting with no syntax highlighting. For the git changes panel we
 * want load speed and scroll performance over pretty rendering; users who
 * want full IDE-style diffs can still open the file in the editor itself.
 */
export default function DiffView({ diff, fill = false, emptyLabel = 'no changes' }: Props) {
  const lines = useMemo(() => diff.split('\n'), [diff])
  const [showAll, setShowAll] = useState(false)

  if (diff.trim().length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-text-4">
        {emptyLabel}
      </div>
    )
  }

  const truncated = !showAll && lines.length > LINE_BUDGET
  const visible = truncated ? lines.slice(0, LINE_BUDGET) : lines

  return (
    <div
      className={`flex ${fill ? 'h-full' : ''} flex-col overflow-hidden rounded-md border border-border-soft bg-bg-1`}
    >
      <pre
        className={`df-scroll m-0 flex-1 overflow-auto p-3 font-mono text-[12px] leading-snug ${
          fill ? '' : 'max-h-80'
        }`}
      >
        {visible.map((line, i) => (
          <div key={i} className={classFor(line)}>
            {line || ' '}
          </div>
        ))}
      </pre>
      {truncated ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="shrink-0 border-t border-border-soft bg-bg-2 px-3 py-1.5 text-left font-mono text-[10.5px] text-text-3 hover:bg-bg-3 hover:text-text-1"
          title="Show the remaining lines"
        >
          {lines.length - LINE_BUDGET} more line{lines.length - LINE_BUDGET === 1 ? '' : 's'} hidden — click to expand
        </button>
      ) : null}
    </div>
  )
}
