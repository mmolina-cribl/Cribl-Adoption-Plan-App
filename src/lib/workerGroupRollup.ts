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
  const fromSources = sumAvgDailyFromSourceSummaryForWg(plan, w.id)
  const useIngestOverride = w.ingestGbd.trim() !== ''
  const autoIngestGb = fromSources.count > 0 ? fromSources.sum : null
  const ingestGb = useIngestOverride
    ? parseGb(w.ingestGbd)
    : autoIngestGb ?? Number.NaN

  const reduction = reductionGbFromSourceSummaryForWg(plan, w.id)
  const egressOverrideGb = parseGb(w.egressGbd)
  const autoEgressGb =
    Number.isFinite(ingestGb) && ingestGb > 0
      ? Math.max(0, ingestGb - (Number.isFinite(reduction) ? reduction : 0))
      : null
  const egressGb = Number.isFinite(egressOverrideGb) && egressOverrideGb >= 0
    ? egressOverrideGb
    : (autoEgressGb ?? Number.NaN)

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
