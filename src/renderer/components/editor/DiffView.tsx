import { useMemo } from 'react'

interface Props {
  diff: string
  /** When true, fills the parent container instead of capping height. */
  fill?: boolean
  emptyLabel?: string
}

/**
 * Colorised unified-diff renderer. Lightweight on purpose — just ANSI-style
 * line tinting with no syntax highlighting. For the git changes panel we
 * want load speed and scroll performance over pretty rendering; users who
 * want full IDE-style diffs can still open the file in the editor itself.
 */
export default function DiffView({ diff, fill = false, emptyLabel = 'no changes' }: Props) {
  const lines = useMemo(() => diff.split('\n'), [diff])
  if (diff.trim().length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-text-4">
        {emptyLabel}
      </div>
    )
  }
  return (
    <pre
      className={`df-scroll font-mono text-[12px] leading-snug ${
        fill ? 'h-full overflow-auto' : 'max-h-80 overflow-auto'
      } rounded-md border border-border-soft bg-bg-1 p-3`}
    >
      {lines.map((line, i) => {
        let cls = 'text-text-2'
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'text-status-generating'
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'text-status-attention'
        else if (line.startsWith('@@')) cls = 'text-status-input'
        else if (line.startsWith('diff ') || line.startsWith('index ')) cls = 'text-accent-400'
        else if (line.startsWith('+++') || line.startsWith('---')) cls = 'text-text-3'
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}
