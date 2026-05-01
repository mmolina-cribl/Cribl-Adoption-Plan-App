import { useEffect, useId, useRef, useState } from 'react'
import { PencilIcon } from './PencilIcon'

type Props = {
  value: string
  onChange: (value: string) => void
  className?: string
}

const PLACEHOLDER_HINT = 'e.g. Cribl'

/**
 * Customer name shown in the top-right of the app header.
 *
 * Displayed as a large, prominent line (the customer's brand is one of the
 * first things they read) with a pencil button hugging the right edge that
 * flips into an inline edit field. We deliberately drop the small
 * "Customer" label that used to sit above the input — the placeholder
 * `e.g. Cribl` plus the pencil icon is enough to communicate "this is your
 * editable name", and the bigger value pulls more visual weight in the
 * header bar. The note in Plan ("Edit it in the field at the top right.")
 * provides the explicit affordance for first-time visitors.
 */
export function HeaderCustomerName({ value, onChange, className = '' }: Props) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const trimmed = value.trim()

  useEffect(() => {
    if (!editing) {
      return
    }
    const el = inputRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [editing])

  return (
    <div
      className={[
        'flex min-w-0 items-center justify-end gap-2',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {editing ? (
        <input
          ref={inputRef}
          id={id + '-i'}
          className="m-0 min-w-0 max-w-full flex-1 rounded-md border border-cribl-primary/50 bg-white px-2 py-1 text-lg font-semibold text-cribl-ink shadow-ctrl outline-none focus:border-cribl-primary focus:ring-2 focus:ring-cribl-primary/30 sm:text-xl"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.currentTarget.blur()
            }
          }}
          placeholder={PLACEHOLDER_HINT}
          autoComplete="organization"
          aria-label="Customer name"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Edit customer name"
          aria-label={trimmed ? `Customer: ${trimmed}. Click to edit.` : 'Edit customer name'}
          className="group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-right transition hover:bg-cribl-elevate/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cribl-primary/30"
        >
          <span
            className={[
              'block min-w-0 max-w-full truncate text-lg font-semibold sm:text-xl',
              trimmed ? 'text-cribl-ink' : 'italic text-cribl-muted',
            ].join(' ')}
          >
            {trimmed || PLACEHOLDER_HINT}
          </span>
          <PencilIcon className="h-[1.05rem] w-[1.05rem] shrink-0 text-cribl-muted transition group-hover:text-cribl-primary" />
        </button>
      )}
    </div>
  )
}
