import { useEffect, useId, useState } from 'react'

type Props = {
  open: boolean
  sourceDisplayName: string
  onChoose: (choice: 'wizard' | 'manual', remember: boolean) => void
}

/**
 * After creating a new source, ask whether to run the guided tour or go straight to the form.
 */
export function PostAddSourceChoiceDialog({ open, sourceDisplayName, onChoose }: Props) {
  const titleId = useId()
  const rememberId = useId()
  const [remember, setRemember] = useState(false)

  useEffect(() => {
    if (open) {
      setRemember(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onChoose('manual', false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onChoose])

  if (!open) {
    return null
  }

  const name = sourceDisplayName.trim() || 'This source'

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-cribl-ink/50 p-3 sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Use form without tour"
        onClick={() => onChoose('manual', false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-md rounded-2xl border border-cribl-border bg-white p-5 shadow-[0_16px_40px_rgba(10,22,40,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="m-0 text-base font-semibold text-cribl-ink sm:text-lg">
          How do you want to get started?
        </h2>
        <p className="m-0 mt-2 text-sm leading-relaxed text-cribl-muted">
          <span className="font-medium text-cribl-ink">{name}</span> is ready. You can use{' '}
          <span className="text-cribl-ink/90">guided entry</span> to answer one question at a time, or work in the full
          page on your own.
        </p>
        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:gap-3">
          <button
            type="button"
            onClick={() => onChoose('manual', remember)}
            className="h-10 flex-1 rounded-lg border border-cribl-border bg-cribl-canvas px-3 text-sm font-medium text-cribl-ink"
          >
            Enter details myself
          </button>
          <button
            type="button"
            onClick={() => onChoose('wizard', remember)}
            className="h-10 flex-1 rounded-lg bg-cribl-primary px-3 text-sm font-semibold text-white shadow-ctrl hover:bg-cribl-primary-hover"
          >
            Start guided entry
          </button>
        </div>
        <div className="mt-4 flex items-start gap-2.5">
          <input
            id={rememberId}
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-cribl-border text-cribl-primary focus:ring-cribl-primary/30"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <label htmlFor={rememberId} className="cursor-pointer text-sm leading-snug text-cribl-ink/95">
            Remember my choice for the next new source
          </label>
        </div>
        <p className="m-0 mt-3 text-center text-xs text-cribl-muted/90">
          You can open guided entry anytime from the Source summary page.
        </p>
      </div>
    </div>
  )
}
