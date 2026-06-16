import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

function ChevronDownIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-3 w-3 ${className}`} aria-hidden="true">
      <path d="M3 5l5 6 5-6H3z" fill="currentColor" />
    </svg>
  )
}

type PopoverButtonProps = {
  label: string
  badge?: string | number
  open: boolean
  onToggle: () => void
  panelClassName?: string
  triggerClassName?: string
  panelAlign?: 'left' | 'right'
  children: ReactNode
}

const PANEL_REM = 24
const VIEW_MARGIN = 8
const PANEL_Z = 100

function readRemPx(): number {
  const fs = parseFloat(getComputedStyle(document.documentElement).fontSize || '16')
  return Number.isFinite(fs) ? fs : 16
}

/**
 * Compact dropdown trigger + popover panel with click-outside-to-close.
 *
 * The panel is rendered in a **portal** with `position: fixed` so it is not
 * clipped by `overflow: hidden` / scroll regions on the main layout (Sources
 * Filter, Sort, Bulk, Worker Groups index).
 *
 * Panel width is capped at `24rem` (and viewport). Position updates on
 * scroll/resize while open.
 */
export function PopoverButton({
  label,
  badge,
  open,
  onToggle,
  panelClassName = '',
  triggerClassName = '',
  panelAlign = 'right',
  children,
}: PopoverButtonProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({})

  useLayoutEffect(() => {
    if (!open) {
      return
    }
    const update = () => {
      const btn = buttonRef.current
      if (!btn) {
        return
      }
      const rect = btn.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const rem = readRemPx()
      const panelW = Math.min(PANEL_REM * rem, vw - VIEW_MARGIN * 2)
      let left = panelAlign === 'right' ? rect.right - panelW : rect.left
      left = Math.max(VIEW_MARGIN, Math.min(left, vw - VIEW_MARGIN - panelW))
      const top = rect.bottom + VIEW_MARGIN
      const spaceBelow = vh - top - VIEW_MARGIN
      const maxH = Math.min(vh * 0.72, Math.max(VIEW_MARGIN, spaceBelow))
      setPanelStyle({
        position: 'fixed',
        top,
        left,
        width: panelW,
        maxHeight: maxH,
        zIndex: PANEL_Z,
        overflowY: 'auto',
        overflowX: 'visible',
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, panelAlign])

  useEffect(() => {
    if (!open) {
      return
    }
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) {
        return
      }
      if (panelRef.current?.contains(t)) {
        return
      }
      onToggle()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onToggle])

  const panel = open ? (
    <div
      ref={panelRef}
      role="menu"
      style={panelStyle}
      className={[
        'rounded-xl border border-cribl-border bg-white p-3 shadow-card-float overscroll-contain',
        panelClassName,
      ].join(' ')}
    >
      {children}
    </div>
  ) : null

  return (
    <div ref={wrapRef} className="relative inline-block shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
        className={[
          'inline-flex h-9 items-center gap-1.5 rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-ink shadow-ctrl hover:bg-cribl-elevate',
          open ? 'border-cribl-primary/50 ring-1 ring-cribl-primary/30' : '',
          triggerClassName,
        ].join(' ')}
      >
        <span>{label}</span>
        {badge != null && badge !== '' && Number(badge) !== 0 ? (
          <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-md bg-cribl-primary-soft px-1.5 text-[11px] font-semibold text-cribl-primary-ink">
            {badge}
          </span>
        ) : null}
        <ChevronDownIcon className={open ? 'rotate-180' : ''} />
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </div>
  )
}
