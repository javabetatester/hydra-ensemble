import * as React from 'react'
import type { LucideIcon } from 'lucide-react'

type Tone = 'default' | 'accent' | 'danger' | 'muted'
type Size = 'xs' | 'sm' | 'md'

interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon
  /** Required for a11y when there is no visible label. */
  'aria-label': string
  tone?: Tone
  size?: Size
}

const SIZE_CLASSES: Record<Size, string> = {
  xs: 'h-6 w-6',
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
}

const ICON_SIZE: Record<Size, number> = {
  xs: 11,
  sm: 13,
  md: 15,
}

const TONE_CLASSES: Record<Tone, string> = {
  default: 'text-text-2 hover:bg-bg-3 hover:text-text-1',
  accent: 'text-accent-400 hover:bg-accent-500/10 hover:text-accent-200',
  danger: 'text-status-attention hover:bg-status-attention/10',
  muted: 'text-text-4 hover:bg-bg-3 hover:text-text-2',
}

function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * IconButton — chromeless square button hosting a single Lucide icon.
 * Replaces the inline header/toolbar icon motif used ~20x across
 * App.tsx, Inspector, OrchestraView. Requires `aria-label` so the
 * button is not invisible to screen readers.
 */
export default function IconButton(props: IconButtonProps) {
  const {
    icon: Icon,
    tone = 'default',
    size = 'sm',
    disabled,
    className,
    type,
    ...rest
  } = props
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled}
      className={cx(
        'inline-flex items-center justify-center rounded-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-500',
        SIZE_CLASSES[size],
        TONE_CLASSES[tone],
        disabled && 'opacity-40 cursor-not-allowed',
        className,
      )}
      {...rest}
    >
      <Icon size={ICON_SIZE[size]} strokeWidth={1.75} />
    </button>
  )
}
