import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { isMac } from '../lib/platform'

/**
 * Compact, monochrome titlebar controls for tiling/decoration-less
 * environments (Hyprland, sway, GNOME without server-side decorations).
 *
 * Design rules:
 * - 24x24 rounded squares — read as a CLI strip, not as OS chrome
 * - default state has no background, only a muted icon colour
 * - hover applies a subtle bg-bg-4 ring on minimize / maximize and
 *   a soft tinted attention background on close (no full-red bleed)
 * - hidden on macOS where titleBarStyle: 'hiddenInset' already gives
 *   the OS traffic lights
 */
export default function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.api.window.isMaximized().then(setMaximized)
    const t = setInterval(() => {
      void window.api.window.isMaximized().then(setMaximized)
    }, 1500)
    return () => clearInterval(t)
  }, [])

  if (isMac()) return null

  const min = (): void => {
    void window.api.window.minimize()
  }
  const tog = async (): Promise<void> => {
    const next = await window.api.window.maximizeToggle()
    setMaximized(next)
  }
  const close = (): void => {
    void window.api.window.close()
  }

  // Buttons need WebkitAppRegion: 'no-drag' so clicks register instead
  // of being eaten by the drag region applied to the parent header.
  const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

  return (
    <div className="flex items-center gap-0.5" style={noDrag}>
      <CtrlBtn onClick={min} title="minimize" Icon={Minus} />
      <CtrlBtn
        onClick={() => void tog()}
        title={maximized ? 'restore' : 'maximize'}
        Icon={maximized ? Copy : Square}
      />
      <CtrlBtn onClick={close} title="close" Icon={X} danger />
    </div>
  )
}

function CtrlBtn({
  onClick,
  title,
  Icon,
  danger
}: {
  onClick: () => void
  title: string
  Icon: typeof X
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-6 w-6 items-center justify-center rounded-sm text-text-4 transition-colors ${
        danger
          ? 'hover:bg-status-attention/15 hover:text-status-attention'
          : 'hover:bg-bg-4 hover:text-text-1'
      }`}
    >
      <Icon size={11} strokeWidth={1.75} />
    </button>
  )
}
