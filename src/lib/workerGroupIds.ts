import type { PlanState, SourceSummaryRow, SourceVolumeRow, WorkerGroupRow } from '../types/planTypes'

/**
 * Reconcile `workerGroupId` on every source and volume row from WG names and
 * the canonical worker group list. Call after import and on legacy loads.
 */
export function assignWorkerGroupIds(plan: PlanState): PlanState {
  const wgs: WorkerGroupRow[] =
    plan.workerGroups && plan.workerGroups.length > 0 ? plan.workerGroups : []

  const byName = (name: string): string | null => {
    const k = name.trim().toLowerCase()
    if (!k) {
      return null
    }
    const row = wgs.find((w) => w.wg.trim().toLowerCase() === k)
    return row ? row.id : null
  }

  const rawVol =
    plan.sourceVolume && plan.sourceVolume.length > 0 ? plan.sourceVolume : []
  const sourceVolume: SourceVolumeRow[] = rawVol.map((v) => {
    let wgid = v.workerGroupId
    if (wgid && wgs.some((w) => w.id === wgid)) {
      return { ...v, workerGroupId: wgid }
    }
    wgid = byName(v.wg) ?? ''
    return { ...v, workerGroupId: wgid }
  })

  const sourceSummary: SourceSummaryRow[] = (plan.sourceSummary ?? []).map((s) => {
    let wgid = s.workerGroupId
    if (wgid && wgs.some((w) => w.id === wgid)) {
      return { ...s, workerGroupId: wgid }
    }
    const src = (s.source ?? '').trim()
    if (src) {
      for (const v of sourceVolume) {
        if ((v.source ?? '').trim() === src && v.workerGroupId) {
          return { ...s, workerGroupId: v.workerGroupId }
        }
      }
    }
    return { ...s, workerGroupId: '' }
  })

  return { ...plan, workerGroups: wgs, sourceSummary, sourceVolume }
}

/** Tokenize destination strings (multi-value fields) for nav aggregation. */
export function aggregateDestinations(sources: SourceSummaryRow[]): string[] {
  const set = new Set<string>()
  for (const s of sources) {
    for (const part of (s.destinations ?? '').split(/[,;\n]+/)) {
      const t = part.trim()
      if (t) {
        set.add(t)
      }
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

export function sourceSummaryForWg(
  plan: PlanState,
  workerGroup: WorkerGroupRow,
): SourceSummaryRow[] {
  return plan.sourceSummary.filter((r) => r.workerGroupId === workerGroup.id)
}

/** Sum daily volume for a worker group: match by `workerGroupId` or legacy WG name. */
export function sumDailyVolumeForWorkerGroupById(
  plan: PlanState,
  r: WorkerGroupRow,
): { sum: number; count: number } {
  const key = (r.wg || '').trim().toLowerCase()
  let sum = 0
  let count = 0
  for (const v of plan.sourceVolume) {
    const matchId = v.workerGroupId === r.id
    const matchName = key && (v.wg || '').trim().toLowerCase() === key
    if (!matchId && !matchName) {
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
