import { useEffect, useId } from 'react'

type Props = {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmClearDialog({ open, onCancel, onConfirm }: Props) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-cribl-ink/50 p-3 sm:items-center sm:p-4"
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
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-md rounded-2xl border border-cribl-border bg-white p-5 shadow-[0_16px_40px_rgba(10,22,40,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="m-0 text-base font-semibold text-cribl-ink sm:text-lg">
          Reset this plan?
        </h2>
        <p className="m-0 mt-2 text-sm leading-relaxed text-cribl-muted">
          This will remove all sources, worker groups, volume rows, notes, and the Environment routing snapshot from
          this browser.
        </p>
        <p className="m-0 mt-2 text-sm leading-relaxed text-cribl-muted">
          You can always re-import an existing adoption plan <span className="font-medium text-cribl-ink/90">.xlsx</span>{' '}
          file from <span className="font-medium text-cribl-ink/90">File → Import</span> to start over.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 flex-1 rounded-lg border border-cribl-border bg-cribl-canvas px-3 text-sm font-medium text-cribl-ink sm:flex-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-10 flex-1 rounded-lg border border-rose-200 bg-rose-600 px-3 text-sm font-semibold text-white shadow-ctrl hover:bg-rose-700 sm:flex-none"
          >
            Reset plan
          </button>
        </div>
      </div>
    </div>
  )
}

