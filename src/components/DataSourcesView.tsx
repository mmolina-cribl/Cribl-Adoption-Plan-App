import { useCallback, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { sourceLabel, type PlanState, type SourceSummaryRow } from '../types/planTypes'
import { isSourceRowAttachmentDisabled } from '../lib/sourceAttachmentDisabled'
import { SourceSummaryStack } from './sourceForm/SourceFormPanels'

type Props = {
  plan: PlanState
  setPlan: Dispatch<SetStateAction<PlanState>>
  row: SourceSummaryRow
  sourceIndex: number
  showDisabledSourcesInLists: boolean
  onShowDisabledSourcesInListsChange: (show: boolean) => void
  onOpenGuidedTour?: () => void
  /** When true, the full form is hidden so the guided dialog is the only place editing field IDs. */
  guidedEntryOpen?: boolean
  onExitGuidedEntry?: () => void
}

export function DataSourcesView({
  plan,
  setPlan,
  row,
  sourceIndex,
  showDisabledSourcesInLists,
  onShowDisabledSourcesInListsChange,
  onOpenGuidedTour,
  guidedEntryOpen,
  onExitGuidedEntry,
}: Props) {
  const hasAnyDisabledSource = useMemo(
    () => plan.sourceSummary.some((r) => isSourceRowAttachmentDisabled(r)),
    [plan.sourceSummary],
  )
  const patch = useCallback(
    (id: string) => (k: keyof SourceSummaryRow, v: string | boolean) => {
      setPlan((p) => {
        const cur = p.sourceSummary.find((r) => r.id === id)
        if (!cur) {
          return p
        }
        return {
          ...p,
          sourceSummary: p.sourceSummary.map((r) =>
            r.id === id ? { ...r, [k]: v } : r,
          ),
        }
      })
    },
    [setPlan],
  )

  const s = patch(row.id)
  const displayLabel = sourceLabel(row, sourceIndex)

  return (
    <div className="min-w-0">
      {!guidedEntryOpen && hasAnyDisabledSource ? (
        <label className="mb-4 flex max-w-2xl cursor-pointer select-none items-center gap-2 rounded-xl border border-cribl-border/80 bg-cribl-card-body px-3 py-2.5 text-sm text-cribl-ink">
          <input
            type="checkbox"
            checked={showDisabledSourcesInLists}
            onChange={(e) => onShowDisabledSourcesInListsChange(e.target.checked)}
          />
          <span className="text-cribl-muted">
            Show <span className="font-medium text-cribl-ink">disabled</span> sources in the Sources index and
            sidebar
          </span>
        </label>
      ) : null}
      {guidedEntryOpen && (
        <div className="mb-5 rounded-2xl border border-cribl-border/80 bg-cribl-primary-soft/30 p-4 sm:p-5">
          <p className="m-0 text-[11px] font-semibold text-cribl-primary uppercase">Source summary</p>
          <h2 className="m-0 mt-0.5 text-lg font-semibold text-cribl-ink">{displayLabel}</h2>
          <p className="m-0 mt-2 max-w-2xl text-sm leading-relaxed text-cribl-muted">
            Use the <span className="font-medium text-cribl-ink/90">guided entry</span> window to type into each section.
            You can return to the full form below at any time.
          </p>
          {onExitGuidedEntry && (
            <button
              type="button"
              onClick={onExitGuidedEntry}
              className="mt-3 h-9 rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-ink shadow-sm hover:bg-cribl-elevate"
            >
              Exit to full form
            </button>
          )}
        </div>
      )}
      {!guidedEntryOpen && (
        <SourceSummaryStack
          plan={plan}
          row={row}
          s={s}
          sourceIndex={sourceIndex}
          onOpenGuidedTour={onOpenGuidedTour}
        />
      )}
    </div>
  )
}
