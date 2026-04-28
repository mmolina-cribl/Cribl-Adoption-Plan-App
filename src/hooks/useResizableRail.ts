import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'

const W_KEY = 'cribl-adoption-rail-px'
const C_KEY = 'cribl-adoption-rail-collapsed'

const DEFAULT_W = 224
const MIN_W = 200
const MAX_W = 480

function clampW(n: number) {
  return Math.min(MAX_W, Math.max(MIN_W, Math.round(n)))
}

export function useResizableRail() {
  const [width, setWidth] = useState(DEFAULT_W)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      const w = localStorage.getItem(W_KEY)
      if (w) {
        setWidth(clampW(parseInt(w, 10) || DEFAULT_W))
      }
      if (localStorage.getItem(C_KEY) === '1') {
        setCollapsed(true)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(W_KEY, String(width))
    } catch {
      // ignore
    }
  }, [width])

  useEffect(() => {
    try {
      localStorage.setItem(C_KEY, collapsed ? '1' : '0')
    } catch {
      // ignore
    }
  }, [collapsed])

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
