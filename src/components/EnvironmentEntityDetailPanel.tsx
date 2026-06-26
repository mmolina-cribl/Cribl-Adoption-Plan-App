import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react'
import type { CriblEnvironmentSnapshot } from '../lib/criblEnvironmentTypes'
import {
  clampPanelPosition,
  panelPositionFromPixels,
  panelPositionToPixels,
  readEnvironmentDetailPanelPosition,
  writeEnvironmentDetailPanelPosition,
} from '../lib/environmentDetailPanelPosition'
import type { EnvironmentFlowNodeData } from '../lib/environmentFlowGraph'
import { EnvironmentEntityDetail } from './EnvironmentEntityDetail'

type Props = {
  snapshot: CriblEnvironmentSnapshot
  node: EnvironmentFlowNodeData
  containerRef: RefObject<HTMLElement | null>
  onClose: () => void
}

type DragState = {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
}

export function EnvironmentEntityDetailPanel({ snapshot, node, containerRef, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const syncPosition = useCallback(() => {
    const container = containerRef.current
    const panel = panelRef.current
    if (!container || !panel) {
      return
    }
    const stored = readEnvironmentDetailPanelPosition()
    const px = panelPositionToPixels(stored, container.clientWidth, container.clientHeight)
    const clamped = clampPanelPosition(
      px.x,
      px.y,
      panel.offsetWidth,
      panel.offsetHeight,
      container.clientWidth,
      container.clientHeight,
    )
    setPosition(clamped)
  }, [containerRef])

  useLayoutEffect(() => {
    syncPosition()
  }, [syncPosition, node])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const ro = new ResizeObserver(() => {
      syncPosition()
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [containerRef, syncPosition])

  const persistPosition = useCallback(
    (x: number, y: number) => {
      const container = containerRef.current
      if (!container) {
        return
      }
      writeEnvironmentDetailPanelPosition(
        panelPositionFromPixels(x, y, container.clientWidth, container.clientHeight),
      )
    },
    [containerRef],
  )

  const onHeaderPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !position) {
      return
    }
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: position.x,
      originY: position.y,
    }
    setDragging(true)
  }

  const onHeaderPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const container = containerRef.current
    const panel = panelRef.current
    if (!drag || drag.pointerId !== e.pointerId || !container || !panel) {
      return
    }
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    const next = clampPanelPosition(
      drag.originX + dx,
      drag.originY + dy,
      panel.offsetWidth,
      panel.offsetHeight,
      container.clientWidth,
      container.clientHeight,
    )
    setPosition(next)
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) {
      return
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    dragRef.current = null
    setDragging(false)

    const container = containerRef.current
    const panel = panelRef.current
    if (!container || !panel) {
      return
    }
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    const next = clampPanelPosition(
      drag.originX + dx,
      drag.originY + dy,
      panel.offsetWidth,
      panel.offsetHeight,
      container.clientWidth,
      container.clientHeight,
    )
    setPosition(next)
    persistPosition(next.x, next.y)
  }

  const panelStyle =
    position == null
      ? { visibility: 'hidden' as const }
      : {
          left: position.x,
          top: position.y,
          width: `min(32rem, calc(100% - ${position.x}px - 12px))`,
          maxWidth: '42vw',
          maxHeight: `calc(100% - ${position.y}px - 12px)`,
          height: `min(28rem, calc(100% - ${position.y}px - 12px))`,
        }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label="Entity details"
      className="pointer-events-auto absolute z-20 flex flex-col overflow-hidden rounded-lg border border-cribl-border/80 bg-white shadow-ctrl"
      style={panelStyle}
    >
      <div
        className={[
          'relative shrink-0 border-b border-cribl-border/60 px-3 py-2.5 pr-10 select-none touch-none',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        ].join(' ')}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title="Drag to move"
      >
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-cribl-muted">Details</p>
        <button
          type="button"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-cribl-muted transition hover:bg-cribl-canvas hover:text-cribl-ink focus:outline-none focus:ring-2 focus:ring-cribl-primary/35"
          aria-label="Close details"
          title="Close"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
            <path
              d="M3 3 L13 13 M13 3 L3 13"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-xs">
        <EnvironmentEntityDetail snapshot={snapshot} node={node} />
      </div>
      <div className="shrink-0 border-t border-cribl-border/60 bg-cribl-canvas/30 px-3 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-cribl-border bg-white px-4 text-sm font-semibold text-cribl-ink transition hover:bg-cribl-canvas/60"
        >
          Close
        </button>
      </div>
    </div>
  )
}
