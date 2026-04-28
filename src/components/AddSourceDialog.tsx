import { useEffect, useId, useRef } from 'react'

type Props = {
  /** e.g. "Source 3" — used as the input placeholder and default if the field is left blank. */
  nextLabel: string
  onCancel: () => void
  onConfirm: (displayName: string) => void
}

/**
 * Simple modal: prompt for a new data source name before it is created.
 */
export function AddSourceDialog({ nextLabel, onCancel, onConfirm }: Props) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-cribl-ink/50 p-4 sm:items-center"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close dialog"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id + '-title'}
        className="relative z-10 w-full max-w-md rounded-2xl border border-cribl-border bg-white p-5 shadow-[0_16px_40px_rgba(10,22,40,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={id + '-title'} className="m-0 text-base font-semibold text-cribl-ink">
          New data source
        </h2>
        <p className="m-0 mt-1 text-sm text-cribl-muted">Enter a name. You can change it later in the sidebar.</p>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            const v = (inputRef.current?.value ?? '').trim()
            onConfirm(v || nextLabel)
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium uppercase tracking-wide text-cribl-muted"
              htmlFor={id + 'input'}
            >
              Source name
            </label>
            <input
              ref={inputRef}
              id={id + 'input'}
              name="sourceDisplayName"
              type="text"
              className="w-full rounded-lg border-cribl-border"
              autoComplete="off"
              autoFocus
              placeholder={nextLabel}
              aria-label="Source name"
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="h-9 rounded-lg border border-cribl-border bg-cribl-canvas px-3 text-sm font-medium text-cribl-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="h-9 rounded-lg bg-cribl-primary px-3 text-sm font-semibold text-white shadow-ctrl hover:bg-cribl-primary-hover"
            >
              Add source
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
