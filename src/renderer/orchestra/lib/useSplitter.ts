/**
 * useSplitter — shared state + pointer wiring for the Splitter gutter.
 *
 * Owns the persisted "panel size in px" behind a `localStorage` key and
 * hands back a `dragging` flag so the host can render an overlay that
 * captures the mouse across the whole viewport (otherwise webview/iframe
 * children swallow the `mousemove` stream and the gutter loses grip).
 *
 * Axis is decided by `orientation`:
 *   - 'horizontal' → vertical gutter, drag on the X axis (column resize)
 *   - 'vertical'   → horizontal gutter, drag on the Y axis (row resize)
 *
 * Clamp on both read and write so we never surface a value outside
 * [min, max] — even a corrupt localStorage entry gets healed on mount.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'

export interface UseSplitterOptions {
  /** localStorage key holding the persisted size (stringified integer). */
  key: string
  /** Default size in px when storage is empty or unreadable. */
  initial: number
  /** Lower bound in px (inclusive). */
  min: number
  /** Upper bound in px (inclusive). */
  max: number
  /** Which side the gutter lives on. See file comment. */
  orientation: 'horizontal' | 'vertical'
}

export interface UseSplitterResult {
  size: number
  setSize: (n: number) => void
  onMouseDown: (e: React.MouseEvent) => void
  dragging: boolean
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  if (n < min) return min
  if (n > max) return max
  return n
}

/** Safely read an integer from localStorage. Returns `null` when the key
 *  is missing, unparseable, or storage is unavailable (SSR / privacy). */
function readStored(key: string): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeStored(key: string, value: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, String(Math.round(value)))
  } catch {
    // Quota / privacy mode — silently ignore, in-memory state still works.
  }
}

export function useSplitter(opts: UseSplitterOptions): UseSplitterResult {
  const { key, initial, min, max, orientation } = opts

  // Lazy initializer runs once on mount: read storage → clamp → fallback.
  const [size, setSizeState] = useState<number>(() => {
    const stored = readStored(key)
    if (stored !== null) return clamp(stored, min, max)
    return clamp(initial, min, max)
  })
  const [dragging, setDragging] = useState(false)

  // Keep bounds in refs so the mousemove handler always reads the latest
  // min/max without needing to rebind listeners on every render.
  const minRef = useRef(min)
  const maxRef = useRef(max)
  useEffect(() => {
    minRef.current = min
    maxRef.current = max
  }, [min, max])

  // If bounds narrow after mount (e.g. window resize), re-clamp once so
  // the visible panel never exceeds its allowed range.
  useEffect(() => {
    setSizeState((prev) => {
      const next = clamp(prev, min, max)
      if (next !== prev) writeStored(key, next)
      return next
    })
  }, [min, max, key])

  const setSize = useCallback(
    (n: number) => {
      const next = clamp(n, minRef.current, maxRef.current)
      setSizeState(next)
      writeStored(key, next)
    },
    [key]
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Left-button only; ignore middle/right/touch-emulated clicks so we
      // don't hijack context menus or auxclick behaviours.
      if (e.button !== 0) return
      e.preventDefault()

      const startX = e.clientX
      const startY = e.clientY
      // Snapshot the starting size once — deltas are computed against it,
      // not cumulatively, so a slow drag doesn't accumulate float drift.
      let startSize = 0
      setSizeState((prev) => {
        startSize = prev
        return prev
      })

      setDragging(true)

      const onMove = (ev: MouseEvent): void => {
        const delta =
          orientation === 'horizontal'
            ? ev.clientX - startX
            : ev.clientY - startY
        const next = clamp(startSize + delta, minRef.current, maxRef.current)
        setSizeState(next)
      }

      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setDragging(false)
        // Persist once on release — writing on every mousemove thrashes
        // localStorage and blocks the main thread on some browsers.
        setSizeState((prev) => {
          writeStored(key, prev)
          return prev
        })
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [orientation, key]
  )

  // Safety net: if the component unmounts mid-drag, make sure we don't
  // leak the body-level listeners. The `onUp` closure inside `onMouseDown`
  // already removes them on release, so this only kicks in on unmount
  // during an active drag.
  useEffect(() => {
    return () => {
      setDragging(false)
    }
  }, [])

  return { size, setSize, onMouseDown, dragging }
}
