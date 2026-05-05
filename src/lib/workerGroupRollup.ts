import type { PlanState, WorkerGroupRow } from '../types/planTypes'

function parseGb(s: string | undefined): number {
  if (!s || !s.trim()) {
    return Number.NaN
  }
  return parseFloat(s.replace(/,/g, ''))
}


/** Ingest+egress when no explicit throughput override. */
export function autoThroughputGb(w: WorkerGroupRow): number | null {
  const t = w.throughputGbd?.trim()
  if (t) {
    const n = parseGb(t)
    if (Number.isFinite(n)) {
      return n
    }
  }
  const a = parseGb(w.ingestGbd)
  const b = parseGb(w.egressGbd)
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return a + b
  }
  if (Number.isFinite(a)) {
    return a
  }
  if (Number.isFinite(b)) {
    return b
  }
  return null
}

/** Egress/8 when no explicit disk override. */
export function autoDiskOneDayGb(w: WorkerGroupRow): number | null {
  const t = w.diskOneDayGb?.trim()
  if (t) {
    const n = parseGb(t)
    if (Number.isFinite(n)) {
      return n
    }
  }
  const eg = parseGb(w.egressGbd)
  if (Number.isFinite(eg)) {
    return eg / 8
  }
  return null
}

/**
 * Sums "Average daily volume" from Source summary rows assigned to this worker group
 * (by `workerGroupId`).
 */
export function sumAvgDailyFromSourceSummaryForWg(
  plan: PlanState,
  workerGroupId: string,
): { sum: number; count: number } {
  let sum = 0
  let count = 0
  for (const s of plan.sourceSummary) {
    if (s.workerGroupId !== workerGroupId) {
      continue
    }
    const n = parseGb(s.avgDailyGb)
    if (Number.isFinite(n) && n >= 0) {
      sum += n
      count += 1
    }
  }
  return { sum, count }
}

/**
 * Legacy v0.8.6 imports carry the old topology table in `sourceVolume`. Prefer
 * `sourceSummary` for normal v2.0 edits, but fall back to this table when a
 * legacy import did not reconcile Source summary rows back to a WG/Fleet id.
 */
function sumDailyVolumeFromLegacyTopologyForWg(
  plan: PlanState,
  w: WorkerGroupRow,
): { sum: number; count: number } {
  const key = w.wg.trim().toLowerCase()
  let sum = 0
  let count = 0
  const sourceNames = new Set<string>()
  for (const v of plan.sourceVolume ?? []) {
    const matchId = v.workerGroupId === w.id
    const matchName = key !== '' && (v.wg ?? '').trim().toLowerCase() === key
    if (!matchId && !matchName) {
      continue
    }
    const sourceName = (v.source ?? '').trim().toLowerCase()
    if (sourceName) {
      sourceNames.add(sourceName)
    }
    const n = parseGb(v.dailyVolumeGb)
    if (Number.isFinite(n) && n >= 0) {
      sum += n
      count += 1
    }
  }
  if (count > 0 || sourceNames.size === 0) {
    return { sum, count }
  }
  for (const s of plan.sourceSummary ?? []) {
    const sourceName = (s.source ?? '').trim().toLowerCase()
    if (!sourceName || !sourceNames.has(sourceName)) {
      continue
    }
    const n = parseGb(s.avgDailyGb)
    if (Number.isFinite(n) && n >= 0) {
      sum += n
      count += 1
    }
  }
  return { sum, count }
}

function effectiveIngestSourceTotalForWg(
  plan: PlanState,
  w: WorkerGroupRow,
): { sum: number; count: number } {
  const fromSummary = sumAvgDailyFromSourceSummaryForWg(plan, w.id)
  if (fromSummary.count > 0) {
    return fromSummary
  }
  return sumDailyVolumeFromLegacyTopologyForWg(plan, w)
}

/**
 * Data-reduction (GB/d) from Source summary — same as `WorkerGroupEditor` (auto egress input).
 */
export function reductionGbFromSourceSummaryForWg(plan: PlanState, workerGroupId: string): number {
  let sum = 0
  for (const src of plan.sourceSummary) {
    if (src.workerGroupId !== workerGroupId) {
      continue
    }
    const avg = parseGb(src.avgDailyGb)
    if (!Number.isFinite(avg) || avg <= 0) {
      continue
    }
    const optGb = parseGb(src.dataOptGb)
    const optPct = parseGb(src.dataOptPct)
    let reducible = 0
    if (Number.isFinite(optGb) && optGb > 0) {
      reducible = optGb
    } else if (Number.isFinite(optPct) && optPct > 0) {
      reducible = (avg * optPct) / 100
    }
    if (!Number.isFinite(reducible) || reducible <= 0) {
      continue
    }
    sum += Math.max(0, Math.min(avg, reducible))
  }
  return sum
}

/**
 * Effective ingest / egress (GB/d) — same rules as Worker Group “Capacity” (auto vs override).
 * Raw `ingestGbd` / `egressGbd` are often empty when using auto from source summaries.
 */
export function effectiveIngestEgressGbdForWg(
  plan: PlanState,
  w: WorkerGroupRow,
): { ingestGb: number | null; egressGb: number | null } | null {
  const fromSources = effectiveIngestSourceTotalForWg(plan, w)
  const useIngestOverride = w.ingestGbd.trim() !== ''
  const sourceIngestGb = fromSources.count > 0 ? fromSources.sum : null
  const ingestFromOverrideOrSources = useIngestOverride
    ? parseGb(w.ingestGbd)
    : sourceIngestGb ?? Number.NaN

  const reduction = reductionGbFromSourceSummaryForWg(plan, w.id)
  const egressOverrideGb = parseGb(w.egressGbd)
  const autoEgressGb =
    Number.isFinite(ingestFromOverrideOrSources) && ingestFromOverrideOrSources > 0
      ? Math.max(0, ingestFromOverrideOrSources - (Number.isFinite(reduction) ? reduction : 0))
      : null
  const egressGb = Number.isFinite(egressOverrideGb) && egressOverrideGb >= 0
    ? egressOverrideGb
    : (autoEgressGb ?? Number.NaN)
  const inferredIngestFromEgress =
    !Number.isFinite(ingestFromOverrideOrSources) &&
    Number.isFinite(egressGb) &&
    egressGb >= 0
      ? egressGb + (Number.isFinite(reduction) ? reduction : 0)
      : Number.NaN
  const ingestGb = Number.isFinite(ingestFromOverrideOrSources)
    ? ingestFromOverrideOrSources
    : inferredIngestFromEgress

  const inOk = Number.isFinite(ingestGb)
  const outOk = Number.isFinite(egressGb)
  if (!inOk && !outOk) {
    return null
  }
  return {
    ingestGb: inOk ? ingestGb : null,
    egressGb: outOk ? egressGb : null,
  }
}

export function effectiveThroughputGbdForWg(plan: PlanState, w: WorkerGroupRow): number | null {
  const override = parseGb(w.throughputGbd)
  if (Number.isFinite(override) && override >= 0) {
    return override
  }
  const cap = effectiveIngestEgressGbdForWg(plan, w)
  const ingest = cap?.ingestGb
  const egress = cap?.egressGb
  const ingestOk = typeof ingest === 'number' && Number.isFinite(ingest)
  const egressOk = typeof egress === 'number' && Number.isFinite(egress)
  if (ingestOk && egressOk) {
    return ingest + egress
  }
  if (ingestOk) {
    return ingest
  }
  if (egressOk) {
    return egress
  }
  return null
}

export function effectiveDiskOneDayGbForWg(plan: PlanState, w: WorkerGroupRow): number | null {
  const override = parseGb(w.diskOneDayGb)
  if (Number.isFinite(override) && override >= 0) {
    return override
  }
  const egress = effectiveIngestEgressGbdForWg(plan, w)?.egressGb
  return typeof egress === 'number' && Number.isFinite(egress) ? egress / 8 : null
}
