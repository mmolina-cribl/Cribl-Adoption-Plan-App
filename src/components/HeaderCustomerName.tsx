import { useEffect, useId, useRef, useState } from 'react'
import { PencilIcon } from './PencilIcon'

type Props = {
  value: string
  onChange: (value: string) => void
  className?: string
}

const PLACEHOLDER_HINT = 'e.g. Acme Corp'

/**
 * Customer name in the app header: same pattern as a source row in the rail
 * (label + value strip + pencil to edit in place).
 */
export function HeaderCustomerName({ value, onChange, className = '' }: Props) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const trimmed = value.trim()
  const showLabel = trimmed || null

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
    <div className={['flex min-w-0 min-[480px]:w-64 flex-col gap-1', className].filter(Boolean).join(' ')}>
      <span className="m-0 text-xs font-medium text-cribl-muted" id={id + '-l'}>
        Customer
      </span>
      <div
        className={[
          'flex min-w-0 items-stretch overflow-hidden rounded-lg border transition',
          'border-cribl-border/80 bg-white/80',
          'hover:border-cribl-border',
        ].join(' ')}
      >
        {editing ? (
          <div className="min-w-0 flex-1 py-1.5 pl-2.5 pr-1 sm:pl-3">
            <input
              ref={inputRef}
              id={id + '-i'}
              className="m-0 w-full min-w-0 max-w-full border-0 bg-transparent p-0 text-sm font-medium text-cribl-ink outline-none"
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
              aria-labelledby={id + '-l'}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-w-0 flex-1 border-0 bg-transparent px-2.5 py-2 text-left text-sm font-medium sm:pl-3"
            aria-labelledby={id + '-l'}
          >
            {showLabel ? (
              <span className="block min-w-0 max-w-full truncate text-cribl-ink">{trimmed}</span>
            ) : (
              <span className="block min-w-0 max-w-full truncate text-cribl-muted">{PLACEHOLDER_HINT}</span>
            )}
          </button>
        )}
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex w-7 shrink-0 items-center justify-center border-0 border-l border-cribl-border/60 bg-transparent text-cribl-muted hover:bg-cribl-elevate hover:text-cribl-ink"
            title="Edit customer"
            aria-label="Edit customer name"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
