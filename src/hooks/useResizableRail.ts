import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { kvGet, kvSet } from '../lib/kvStore'

const W_KEY = 'prefs/rail/px'
const C_KEY = 'prefs/rail/collapsed'

/** Desktop plan rail width (px). Default matches the prior max; max is 30% wider than default. */
const DEFAULT_W = 465
const MIN_W = 194
const MAX_W = Math.round(DEFAULT_W * 1.3)

function clampW(n: number) {
  return Math.min(MAX_W, Math.max(MIN_W, Math.round(n)))
}

export function useResizableRail() {
  const [width, setWidth] = useState(DEFAULT_W)
  const [collapsed, setCollapsed] = useState(false)
  // Gate writes until the initial KV read completes. Without this, the write
  // effects below would fire on first render with the default values, racing
  // (and potentially overwriting) the read of the persisted value.
  const [hasHydrated, setHasHydrated] = useState(false)

  useEffect(() => {
    void (async () => {
      const [w, c] = await Promise.all([
        kvGet<number>(W_KEY, DEFAULT_W),
        kvGet<boolean>(C_KEY, false),
      ])
      setWidth(clampW(typeof w === 'number' ? w : DEFAULT_W))
      setCollapsed(Boolean(c))
      setHasHydrated(true)
    })()
  }, [])

  useEffect(() => {
    if (!hasHydrated) {
      return
    }
    void kvSet(W_KEY, width)
  }, [width, hasHydrated])

  useEffect(() => {
    if (!hasHydrated) {
      return
    }
    void kvSet(C_KEY, collapsed)
  }, [collapsed, hasHydrated])

  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => !c)
  }, [])

  const setWidthClamped = useCallback((n: number) => {
    setWidth(clampW(n))
  }, [])

  /** Drag the right edge of the rail. No-op when collapsed. */
  const beginResize = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (collapsed) {
        return
      }
      e.preventDefault()
      const startX = e.clientX
      const startW = width
      const move = (ev: PointerEvent) => {
        setWidth(clampW(startW + (ev.clientX - startX)))
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
    [collapsed, width, setWidth],
  )

  return {
    width,
    setWidth: setWidthClamped,
    collapsed,
    setCollapsed,
    toggleCollapse,
    minW: MIN_W,
    maxW: MAX_W,
    beginResize,
  }
}
