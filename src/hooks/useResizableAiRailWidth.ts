import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { kvGet, kvSet } from '../lib/kvStore'

const W_KEY = 'prefs/aiRail/px'

/** Default matches the prior fixed `20rem` rail. */
const DEFAULT_W = 320
const MIN_W = 260
const MAX_W = 520

function clampW(n: number) {
  return Math.min(MAX_W, Math.max(MIN_W, Math.round(n)))
}

/**
 * Persisted width (px) for the desktop **AI ASSISTANT** right rail, with drag-to-resize
 * on the rail’s **left** edge (same interaction model as the plan sidebar’s right edge).
 */
export function useResizableAiRailWidth() {
  const [width, setWidth] = useState(DEFAULT_W)
  const [hasHydrated, setHasHydrated] = useState(false)

  useEffect(() => {
    void (async () => {
      const w = await kvGet<number>(W_KEY, DEFAULT_W)
      setWidth(clampW(typeof w === 'number' ? w : DEFAULT_W))
      setHasHydrated(true)
    })()
  }, [])

  useEffect(() => {
    if (!hasHydrated) {
      return
    }
    void kvSet(W_KEY, width)
  }, [width, hasHydrated])

  const setWidthClamped = useCallback((n: number) => {
    setWidth(clampW(n))
  }, [])

  /** Drag the **left** edge of the rail toward the viewport center to widen. */
  const beginResize = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = width
      const move = (ev: PointerEvent) => {
        setWidth(clampW(startW - (ev.clientX - startX)))
      }
      const up = () => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        document.removeEventListener('pointercancel', up)
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
      document.addEventListener('pointercancel', up)
    },
    [width],
  )

  return {
    width,
    setWidth: setWidthClamped,
    minW: MIN_W,
    maxW: MAX_W,
    beginResize,
  }
}
