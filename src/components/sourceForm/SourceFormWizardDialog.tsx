import { useEffect, useId, useState } from 'react'
import type { SourceSummaryFieldPatch } from './SourceFormPanels'
import { SOURCE_WIZARD_FIELD_STEPS } from './sourceFormWizardFieldCatalog'
import { SourceWizardFieldBody } from './SourceWizardFieldBody'
import { SOURCE_SECTION_ANCHOR } from './sourceFormWizardContent'
import type { SourceSummaryRow } from '../../types/planTypes'

type Props = {
  open: boolean
  onClose: () => void
  row: SourceSummaryRow
  s: SourceSummaryFieldPatch
}

function scrollToSection(rowId: string, s: 'primary' | 'volume' | 'roadmap' | 'value') {
  const id = SOURCE_SECTION_ANCHOR[s](rowId)
  window.requestAnimationFrame(() => {
    const el = document.getElementById(id)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

export function SourceFormWizardDialog({ open, onClose, row, s }: Props) {
  const titleId = useId()
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (open) {
      setStep(0)
    }
  }, [open, row.id])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) {
    return null
  }

  const total = SOURCE_WIZARD_FIELD_STEPS.length
  const current = SOURCE_WIZARD_FIELD_STEPS[step]!
  const isFirst = step === 0
  const isLast = step === total - 1
  const progressPct = ((step + 1) / total) * 100

  const shouldSkip = (idx: number) => {
    const k = SOURCE_WIZARD_FIELD_STEPS[idx]?.kind
    return k === 'targetOnboardStart' && row.isCurrent
  }

  const nextIndex = (from: number) => {
    let i = Math.min(total - 1, from + 1)
    while (i < total - 1 && shouldSkip(i)) {
      i += 1
    }
    return i
  }

  const prevIndex = (from: number) => {
    let i = Math.max(0, from - 1)
    while (i > 0 && shouldSkip(i)) {
      i -= 1
    }
    return i
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex min-h-0 items-center justify-center overflow-y-auto bg-cribl-ink/50 p-3 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative my-4 flex w-full min-h-0 max-w-xl max-h-[min(92vh,900px)] flex-col overflow-hidden rounded-2xl border border-cribl-border bg-white shadow-[0_20px_50px_rgba(10,22,40,0.22)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-cribl-border/80 px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-primary">
                Guided entry
              </p>
              <p className="m-0 mt-0.5 text-xs font-medium text-cribl-muted">{current.section}</p>
              <h2 id={titleId} className="m-0 mt-1 text-base font-semibold leading-snug text-cribl-ink sm:text-lg">
                {current.headline}
              </h2>
              <p className="m-0 mt-1.5 text-sm text-cribl-muted">
                Step {step + 1} of {total}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-8 shrink-0 rounded-lg border border-cribl-border/80 bg-cribl-canvas px-2.5 text-xs font-medium text-cribl-muted hover:text-cribl-ink"
            >
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          <div className="rounded-xl border border-cribl-border/70 bg-cribl-elevate/20 p-4 sm:p-5">
            <p className="m-0 text-sm leading-relaxed text-cribl-ink">{current.lede}</p>
            <SourceWizardFieldBody kind={current.kind} row={row} s={s} />
          </div>
        </div>

        <div className="shrink-0 space-y-3 border-t border-cribl-border/80 px-4 py-3 sm:px-5">
          <div
            className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-cribl-border/60"
            title={`Progress: step ${step + 1} of ${total}`}
            role="progressbar"
            aria-valuenow={step + 1}
            aria-valuemin={1}
            aria-valuemax={total}
          >
            <div
              className="h-full rounded-full bg-cribl-blue transition-[width] duration-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between sm:gap-3">
            <div className="flex gap-2 sm:justify-start">
              <button
                type="button"
                disabled={isFirst}
                onClick={() => setStep((x) => prevIndex(x))}
                className="h-9 rounded-lg border border-cribl-border bg-cribl-canvas px-3 text-sm font-medium text-cribl-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                Back
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              {!isLast && (
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 rounded-lg border border-transparent px-1 text-sm font-medium text-cribl-muted hover:text-cribl-ink sm:px-3"
                >
                  Exit to full form
                </button>
              )}
              {isLast ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    requestAnimationFrame(() => scrollToSection(row.id, 'primary'))
                  }}
                  className="h-9 rounded-lg bg-cribl-primary px-4 text-sm font-semibold text-white shadow-ctrl hover:bg-cribl-primary-hover"
                >
                  View full form
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setStep((x) => nextIndex(x))}
                  className="h-9 rounded-lg bg-cribl-primary px-4 text-sm font-semibold text-white shadow-ctrl hover:bg-cribl-primary-hover"
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
