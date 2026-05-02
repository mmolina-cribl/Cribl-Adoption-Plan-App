import { useEffect, useId } from 'react'
import type { ActivationTier } from '../types/planTypes'
import { PS_TIER_OPTIONS, TIER_PALETTE } from '../lib/psUseCaseLayout'

type Props = {
  /**
   * Currently selected tier, if any. The matching tier card highlights
   * so a re-open shows the user what they previously picked.
   */
  current: ActivationTier | null
  onSelect: (tier: ActivationTier) => void
  /**
   * Dismiss without picking. Per design, this is intentionally
   * available so a customer flipping through the app isn't forced to
   * commit to a tier before reading the rest. State stays `null` and
   * the page renders all 5 use-case cards at full opacity (no soft
   * gating). The user can re-open the modal any time via the sticky
   * tier chip in the page header.
   */
  onSkip: () => void
}

/**
 * Per-tier copy for the picker cards. The three lines mirror how Cribl
 * PS engagements are sized in practice: Silver = 2 use cases, Gold = 3,
 * Platinum = 5. Wording is intentionally customer-friendly because this
 * dialog is shown to BOTH the CSE and the customer directly.
 */
const TIER_COPY: Record<ActivationTier, { headline: string; useCaseCount: string; blurb: string }> = {
  Silver: {
    headline: 'Silver',
    useCaseCount: '2 use cases in scope',
    blurb:
      'Foundational engagement. Architecture, deployment, and the first two use cases — get the team productive on Cribl quickly.',
  },
  Gold: {
    headline: 'Gold',
    useCaseCount: '3 use cases in scope',
    blurb:
      'Mid-tier engagement. Everything in Silver plus a third use case — typically the highest-value workload after the first two.',
  },
  Platinum: {
    headline: 'Platinum',
    useCaseCount: 'All 5 use cases in scope',
    blurb:
      'Full activation engagement. All 5 use case slots are available, plus the same architecture and health-check deliverables Silver and Gold customers receive.',
  },
}

/**
 * Modal-first PS tier picker. Shown automatically when the user opens
 * the Activation page with `plan.activation.tier === null`, and again
 * any time they click the sticky `PS Tier: <tier> ▾` chip in the page
 * header. See `CRIBL_DEV_NOTES.md` → "PR C — feat/v2.0-ps-use-cases"
 * for the full UX rationale (modal-first, dismissible, soft-gating).
 */
export function TierPickerDialog({ current, onSelect, onSkip }: Props) {
  const id = useId()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onSkip()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onSkip])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-cribl-ink/50 p-4 sm:items-center"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Dismiss tier picker"
        onClick={onSkip}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id + '-title'}
        className="relative z-10 w-full max-w-2xl rounded-2xl border border-cribl-border bg-white p-5 shadow-[0_16px_40px_rgba(10,22,40,0.18)] sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={id + '-title'} className="m-0 text-base font-semibold text-cribl-ink sm:text-lg">
          Which Cribl Professional Services tier is this engagement?
        </h2>
        <p className="m-0 mt-1.5 text-sm text-cribl-muted">
          Picking a tier helps the activation page show what's in scope for this customer. Use cases
          beyond the tier stay editable — they just look faded so it's clear what was contracted.
          You can change this any time from the page header.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {PS_TIER_OPTIONS.map((tier) => {
            const copy = TIER_COPY[tier]
            const isCurrent = current === tier
            const palette = TIER_PALETTE[tier]
            return (
              <button
                key={tier}
                type="button"
                onClick={() => onSelect(tier)}
                className={[
                  'group flex min-w-0 flex-col items-stretch gap-1.5 rounded-xl border bg-white p-3.5 text-left shadow-ctrl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cribl-primary/50 sm:p-4',
                  isCurrent
                    ? palette.cardActive
                    : ['border-cribl-border', palette.cardHover].join(' '),
                ].join(' ')}
                aria-pressed={isCurrent}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-cribl-ink">
                    <span
                      aria-hidden
                      className={[
                        'inline-block h-2.5 w-2.5 rounded-full ring-2 ring-white',
                        palette.dot,
                      ].join(' ')}
                    />
                    {copy.headline}
                  </span>
                  {isCurrent ? (
                    <span
                      className={[
                        'rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                        palette.badge,
                      ].join(' ')}
                    >
                      Current
                    </span>
                  ) : null}
                </div>
                <span
                  className={[
                    'text-[11px] font-medium uppercase tracking-wider',
                    palette.accentText,
                  ].join(' ')}
                >
                  {copy.useCaseCount}
                </span>
                <p className="m-0 text-xs leading-relaxed text-cribl-muted">{copy.blurb}</p>
              </button>
            )
          })}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 text-[11px] text-cribl-muted">
            Not sure yet? You can skip and pick later — nothing on the page locks based on tier.
          </p>
          <button
            type="button"
            onClick={onSkip}
            className="h-9 rounded-lg border border-cribl-border bg-cribl-canvas px-3 text-sm font-medium text-cribl-ink"
          >
            I'll pick later
          </button>
        </div>
      </div>
    </div>
  )
}
