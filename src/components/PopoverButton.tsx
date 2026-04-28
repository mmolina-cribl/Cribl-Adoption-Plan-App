import { useEffect, useRef, type ReactNode } from 'react'

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

/**
 * Compact dropdown trigger + popover panel with click-outside-to-close.
 *
 * Used by the Filter and Bulk Actions buttons on the Sources and
 * Worker Groups index pages. Click-outside is wired with a single
 * `mousedown` listener (mirrors the `AttachSourceCombobox` pattern)
 * to avoid pulling in a popover library.
 *
 * The badge slot suppresses itself when the count is missing, empty,
 * or zero — so an unselected popover shows just `Filter ▾`, not
 * `Filter (0) ▾`.
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

  useEffect(() => {
    if (!open) {
      return
    }
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onToggle()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onToggle])

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
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
      {open ? (
        <div
          role="menu"
          className={[
            'absolute z-30 mt-2 min-w-[18rem] rounded-xl border border-cribl-border bg-white p-3 shadow-card-float',
            panelAlign === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          ].join(' ')}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
