import { useEffect, useId } from 'react'

type Props = {
  open: boolean
  workerGroupName: string
  assignedSourcesCount: number
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmRemoveWorkerGroupDialog({
  open,
  workerGroupName,
  assignedSourcesCount,
  onCancel,
  onConfirm,
}: Props) {
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

  if (!open) return null

  const n = Math.max(0, assignedSourcesCount)

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
          Remove worker group?
        </h2>
        <p className="m-0 mt-2 text-sm leading-relaxed text-cribl-muted">
          You’re about to remove <span className="font-semibold text-cribl-ink/90">{workerGroupName || 'this group'}</span>.
        </p>
        <p className="m-0 mt-2 text-sm leading-relaxed text-cribl-muted">
          This will set <span className="font-semibold text-cribl-ink/90">{n}</span> assigned source{n === 1 ? '' : 's'} to{' '}
          <span className="font-semibold text-cribl-ink/90">Unassigned</span>. No source details will be deleted.
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
            Remove worker group
          </button>
        </div>
      </div>
    </div>
  )
}

