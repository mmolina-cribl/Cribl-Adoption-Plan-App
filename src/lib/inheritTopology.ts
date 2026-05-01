import type { PlanState } from '../types/planTypes'

export type SourceLinkOption = {
  id: string
  label: string
  source: string
  avgDailyGb: string
}

/** List data sources (from the Source summary form) for "copy into volume row" actions. */
export function sourceLinkOptionsFromPlan(plan: PlanState): SourceLinkOption[] {
  return plan.sourceSummary.map((r, i) => ({
    id: r.id,
    label: r.source?.trim() || `Source ${i + 1}`,
    source: r.source?.trim() ?? '',
    avgDailyGb: r.avgDailyGb?.trim() ?? '',
  }))
}

/**
 * Sums `Daily volume` from the volume table for rows whose `WG` matches `wg` (case-insensitive trim).
 * Used to suggest an ingest value for a worker group from summed volume rows that share the same WG name.
 */
export function sumDailyVolumeForWorkerGroup(
  plan: PlanState,
  wg: string,
): { sum: number; count: number } {
  const key = wg.trim().toLowerCase()
  if (!key) {
    return { sum: 0, count: 0 }
  }
  let sum = 0
  let count = 0
  for (const v of plan.sourceVolume) {
    if ((v.wg || '').trim().toLowerCase() !== key) {
      continue
    }
    const n = parseFloat((v.dailyVolumeGb || '').replace(/,/g, ''))
    if (Number.isFinite(n)) {
      sum += n
    }
    count += 1
  }
  return { sum, count }
}

