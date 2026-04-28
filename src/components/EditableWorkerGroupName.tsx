import { useEffect, useId, useRef, useState } from 'react'
import { PencilIcon } from './PencilIcon'

type Props = {
  /** For React keys and labels */
  groupId: string
  value: string
  onChange: (next: string) => void
  /** When `value` is blank in display mode */
  emptyLabel?: string
  /** `section` for card titles; `body` for form body; `compact` for small lists */
  size?: 'section' | 'body' | 'compact'
  'aria-label'?: string
}

const sizeText = {
  section: 'text-base font-semibold',
  body: 'text-sm font-medium',
  compact: 'text-sm',
} as const

/**
 * Read-only name + pencil, or inline edit — same pattern as the source name in the source form.
 * Use wherever the worker group’s canonical `wg` is shown.
 */
export function EditableWorkerGroupName({
  groupId,
  value,
  onChange,
  emptyLabel = 'Unnamed worker group',
  size = 'body',
  'aria-label': ariaLabel = 'Edit worker group name',
}: Props) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const display = value?.trim() || emptyLabel
  const textClass = sizeText[size]

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
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5" onClick={(e) => e.stopPropagation()}>
      {editing ? (
        <input
          ref={inputRef}
          id={id + groupId}
          className={[
            'min-w-0 max-w-full flex-1 rounded border border-cribl-border/80 bg-white px-1.5 py-0.5 outline-none',
            'focus:ring-2 focus:ring-cribl-primary/30',
            textClass,
            size === 'section' && 'w-full min-w-[12rem]',
            size === 'body' && 'w-full min-w-[10rem] max-w-md',
            size === 'compact' && 'min-w-[6rem] max-w-[12rem]',
          ]
            .filter(Boolean)
            .join(' ')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.currentTarget.blur()
            }
          }}
          placeholder={emptyLabel}
          autoComplete="off"
          aria-label={ariaLabel}
        />
      ) : (
        <>
          <span
            className={['min-w-0 break-words text-cribl-ink', size === 'section' && 'leading-snug', textClass]
              .filter(Boolean)
              .join(' ')}
          >
            {display}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex shrink-0 self-center rounded p-0.5 text-cribl-muted hover:bg-cribl-elevate hover:text-cribl-ink"
            title="Edit name"
            aria-label={ariaLabel}
          >
            <PencilIcon
              className={['shrink-0', size === 'section' ? 'h-3.5 w-3.5' : 'h-3 w-3'].join(' ')}
            />
          </button>
        </>
      )}
    </span>
  )
}
