import type { SourceSummaryRow } from '../types/planTypes'

/** Lifecycle state for a Source's onboarding into the customer's plan. */
export type OnboardingStatus = 'complete' | 'current' | 'planned'

/**
 * Tri-state derivation that reuses the existing data fields — no schema /
 * Excel template changes required:
 *
 *  - `complete` ← `onboardingCompletedOn` is set (a real completion date).
 *    Wins regardless of `isCurrent`, since a recorded completion date is the
 *    strongest signal that the source has been onboarded.
 *  - `current`  ← `isCurrent` is `true` (and not yet complete).
 *  - `planned`  ← everything else (the default for fresh rows).
 */
export function getOnboardingStatus(row: SourceSummaryRow): OnboardingStatus {
  if ((row.onboardingCompletedOn || '').trim() !== '') {
    return 'complete'
  }
  if (row.isCurrent) {
    return 'current'
  }
  return 'planned'
}

export type OnboardingStatusCounts = {
  complete: number
  current: number
  planned: number
  total: number
}

/** Roll the tri-state up across an arbitrary list of source rows. */
export function getOnboardingStatusCounts(rows: SourceSummaryRow[]): OnboardingStatusCounts {
  const counts: OnboardingStatusCounts = { complete: 0, current: 0, planned: 0, total: rows.length }
  for (const r of rows) {
    counts[getOnboardingStatus(r)] += 1
  }
  return counts
}

/**
 * Slice colors used by the donut charts. Co-locate them so both the
 * dashboard and the per-WG view stay in sync. Aligned with the
 * Completeness card palette (`#4ade80` = green-400 = success).
 */
export const ONBOARDING_STATUS_COLORS: Record<OnboardingStatus, string> = {
  complete: '#4ade80',
  current: '#00CCCC',
  planned: '#94a3b8',
}
