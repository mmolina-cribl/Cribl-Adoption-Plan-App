import type { PlanState, SourceSummaryRow, SourceVolumeRow, WorkerGroupRow } from '../types/planTypes'

/**
 * Authoritative "Stream" / "Edge" / "" derivation for a source row, based
 * on the kind of the worker group it's currently attached to. v2.0 dropped
 * the user-editable `streamOrEdge` wizard step in favor of auto-deriving
 * this from the WG attachment — the field is kept on `SourceSummaryRow`
 * solely so the v0.9.1 Excel column round-trips, but the customer no
 * longer chooses it directly.
 *
 *   - WG kind === 'edge'   → "Edge"
 *   - WG kind === 'stream' → "Stream"
 *   - unattached / missing → ""
 *
 * The exporter writes whatever this function returned at attach time; the
 * importer (and `assignWorkerGroupIds` below) re-derive on every load so
 * any drift in the on-disk workbook is silently corrected to match the
 * actual WG attachment.
 */
export function deriveStreamOrEdge(
  workerGroupId: string,
  workerGroups: WorkerGroupRow[],
): string {
  if (!workerGroupId) {
    return ''
  }
  const wg = workerGroups.find((w) => w.id === workerGroupId)
  if (!wg) {
    return ''
  }
  return wg.kind === 'edge' ? 'Edge' : 'Stream'
}

/**
 * Return a copy of `row` with `streamOrEdge` re-derived from its current
 * `workerGroupId`. Returns the same reference when nothing changed so
 * callers can short-circuit.
 */
export function syncSourceStreamOrEdge(
  row: SourceSummaryRow,
  workerGroups: WorkerGroupRow[],
): SourceSummaryRow {
  const next = deriveStreamOrEdge(row.workerGroupId, workerGroups)
  return row.streamOrEdge === next ? row : { ...row, streamOrEdge: next }
}

/**
 * Re-derive `streamOrEdge` on every source row in a plan. Cheap (one
 * `Array.prototype.map`) and idempotent — safe to call after any
 * mutation that could touch a source's `workerGroupId` or a WG's `kind`.
 */
export function syncAllSourcesStreamOrEdge(plan: PlanState): PlanState {
  let changed = false
  const next = plan.sourceSummary.map((r) => {
    const updated = syncSourceStreamOrEdge(r, plan.workerGroups)
    if (updated !== r) {
      changed = true
    }
    return updated
  })
  return changed ? { ...plan, sourceSummary: next } : plan
}

/**
 * Reconcile `workerGroupId` on every source and volume row from WG names and
 * the canonical worker group list. Call after import and on legacy loads.
 *
 * Also re-derives `streamOrEdge` on every source row from its (now
 * reconciled) WG attachment, since v2.0 makes that field a denormalized
 * cache rather than user-editable.
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
    if (!wgid || !wgs.some((w) => w.id === wgid)) {
      const src = (s.source ?? '').trim()
      if (src) {
        for (const v of sourceVolume) {
          if ((v.source ?? '').trim() === src && v.workerGroupId) {
            wgid = v.workerGroupId
            break
          }
        }
      }
      if (!wgid || !wgs.some((w) => w.id === wgid)) {
        wgid = ''
      }
    }
    const streamOrEdge = deriveStreamOrEdge(wgid, wgs)
    if (s.workerGroupId === wgid && s.streamOrEdge === streamOrEdge) {
      return s
    }
    return { ...s, workerGroupId: wgid, streamOrEdge }
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
