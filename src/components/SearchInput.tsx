import { type CSSProperties } from 'react'

/**
 * Standard search input used everywhere a list / grid is filtered by a
 * free-text query.
 *
 * Visual contract (matches the unassigned-sources search bar in the
 * resource maps, which the design lead picked as the reference):
 *   - Magnifier icon hugged to the left edge.
 *   - Light border, white background, soft control shadow.
 *   - Cribl-primary focus ring.
 *   - When the field is non-empty, a small "×" button appears on the
 *     right that clears the query in one click.
 *
 * `size` swaps between two heights:
 *   - `md` (default): h-9 / text-sm — used by index pages and Plan
 *     recent-activity sections.
 *   - `sm`: h-8 / text-[12px] — used by tighter sections embedded in
 *     resource maps where vertical real estate is at a premium.
 */
type Size = 'sm' | 'md'

type Props = {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  /** Screen-reader label. Falls back to placeholder. */
  ariaLabel?: string
  id?: string
  /** Wrapper class, useful for layout (e.g. `mb-3`, `w-full sm:w-72`). */
  className?: string
  size?: Size
  autoFocus?: boolean
  /** Bubble focus changes to the parent (used by AttachSourceCombobox). */
  onFocus?: () => void
  /** Bubble blur changes to the parent. */
  onBlur?: () => void
  /** Inline style passthrough for the wrapper, used rarely. */
  style?: CSSProperties
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  id,
  className,
  size = 'md',
  autoFocus,
  onFocus,
  onBlur,
  style,
}: Props) {
  const isSm = size === 'sm'
  const heightCls = isSm ? 'h-8' : 'h-9'
  const fontCls = isSm ? 'text-[12px]' : 'text-sm'
  const padCls = isSm ? 'pl-8 pr-7' : 'pl-9 pr-8'
  const iconLeftCls = isSm ? 'left-2.5' : 'left-3'
  const iconSizeCls = isSm ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const clearRightCls = isSm ? 'right-1.5' : 'right-2'

  return (
    <div className={`relative ${className ?? ''}`} style={style}>
      <span
        aria-hidden
        className={`pointer-events-none absolute ${iconLeftCls} top-1/2 flex -translate-y-1/2 items-center justify-center text-cribl-muted`}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className={iconSizeCls}>
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 1 0 3.422 9.808l3.385 3.385a.75.75 0 1 0 1.06-1.06l-3.385-3.386A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
            clipRule="evenodd"
          />
        </svg>
      </span>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        onFocus={onFocus}
        onBlur={onBlur}
        className={`${heightCls} w-full rounded-md border border-cribl-border/80 bg-white ${padCls} ${fontCls} text-cribl-ink shadow-ctrl placeholder:text-cribl-muted focus:border-cribl-primary focus:outline-none focus:ring-1 focus:ring-cribl-primary/40`}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => onChange('')}
          className={`absolute ${clearRightCls} top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-cribl-muted hover:bg-cribl-elevate hover:text-cribl-ink`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
            <path
              fillRule="evenodd"
              d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      ) : null}
    </div>
  )
}
