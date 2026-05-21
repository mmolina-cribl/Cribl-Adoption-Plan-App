import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { PlanState } from '../types/planTypes'

type Props = {
  plan: PlanState
  /**
   * When set and still a valid top-level fleet id, pre-selects the parent
   * dropdown (e.g. opened from a fleet detail resource map). When `null`, the
   * user must pick a parent (e.g. from the Fleets index).
   */
  initialParentFleetId: string | null
  /** Placeholder / default name if the field is left blank. */
  nextLabel: string
  onCancel: () => void
  onConfirm: (name: string, parentTopLevelFleetId: string) => void
}

/**
 * Create a Cribl Edge sub-fleet under an existing top-level fleet.
 */
export function AddSubfleetDialog({
  plan,
  initialParentFleetId,
  nextLabel,
  onCancel,
  onConfirm,
}: Props) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const topLevelParents = useMemo(
    () =>
      plan.workerGroups.filter((w) => w.kind === 'edge' && !(w.parentFleetId ?? '').trim()),
    [plan.workerGroups],
  )

  const [parentId, setParentId] = useState(() => {
    if (
      initialParentFleetId &&
      topLevelParents.some((t) => t.id === initialParentFleetId)
    ) {
      return initialParentFleetId
    }
    if (initialParentFleetId === null) {
      return ''
    }
    return topLevelParents[0]?.id ?? ''
  })

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

  const canSubmit = topLevelParents.length > 0 && Boolean(parentId)

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
          New sub-fleet
        </h2>
        <p className="m-0 mt-1 text-sm text-cribl-muted">
          Sub-fleets attach to a top-level fleet. Pick the parent fleet, then name the sub-fleet.
        </p>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!canSubmit) {
              return
            }
            const v = (inputRef.current?.value ?? '').trim()
            onConfirm(v || nextLabel, parentId)
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium uppercase tracking-wide text-cribl-muted"
              htmlFor={id + '-parent'}
            >
              Parent fleet
            </label>
            {topLevelParents.length === 0 ? (
              <p className="m-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Add a top-level fleet first (use <strong>+ Add Fleet</strong> in the left nav or{' '}
                <strong>New fleet</strong> on the Fleets page), then create a sub-fleet.
              </p>
            ) : (
              <select
                id={id + '-parent'}
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="h-10 w-full rounded-lg border border-cribl-border bg-white px-2 text-sm"
                aria-label="Parent fleet"
                required
              >
                <option value="">Select a parent fleet…</option>
                {topLevelParents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.wg.trim() || 'Untitled fleet'}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium uppercase tracking-wide text-cribl-muted"
              htmlFor={id + 'input'}
            >
              Sub-fleet name
            </label>
            <input
              ref={inputRef}
              id={id + 'input'}
              name="subfleetName"
              type="text"
              className="w-full rounded-lg border-cribl-border"
              autoComplete="off"
              autoFocus={topLevelParents.length > 0}
              placeholder={nextLabel}
              aria-label="Sub-fleet name"
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
              disabled={!canSubmit}
              className="h-9 rounded-lg bg-cribl-edge px-3 text-sm font-semibold text-white shadow-ctrl hover:bg-cribl-edge-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add sub-fleet
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
