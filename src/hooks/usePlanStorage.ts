import { useEffect, useRef, useState } from 'react'
import { createEmptyPlan } from '../lib/defaultState'
import { backfillActivation } from '../lib/activationNormalize'
import { clearImportShell } from '../lib/importShellStore'
import { kvGet, kvSet } from '../lib/kvStore'
import { assignWorkerGroupIds } from '../lib/workerGroupIds'
import type {
  Activation,
  PlanState,
  SourceSummaryRow,
  SourceVolumeRow,
  WorkerGroupRow,
} from '../types/planTypes'

const KEY = 'plan'

/**
 * Normalize a raw value (typically the JSON-parsed body from KV) into a valid
 * PlanState. Handles legacy/missing fields the same way the old localStorage
 * loader did, so saved plans from older versions still open.
 */
function normalizePlan(raw: unknown): PlanState {
  if (raw === null || typeof raw !== 'object') {
    return createEmptyPlan()
  }
  const p = raw as PlanState
  if (p?.version !== 1 || !Array.isArray(p.sourceSummary)) {
    return createEmptyPlan()
  }
  const merged: PlanState = {
    ...p,
    cseNotes: p.cseNotes ?? '',
    sourceSummary: p.sourceSummary.map((r) => {
      const row = r as Partial<SourceSummaryRow> & {
        id: string
        // v1.x legacy field names — accepted on hydrate so old saved plans don't lose data:
        regions?: string
      }
      return {
        ...r,
        type: row.type ?? ('' as SourceSummaryRow['type']),
        // v0.9.1: `regions` field was renamed to `physicalLocations`. Carry old
        // value across so a v1.3 -> v2.0 KV hydrate doesn't lose location data.
        physicalLocations:
          (row.physicalLocations ?? row.regions ?? '').toString(),
        currentCollection: row.currentCollection ?? '',
        // v0.9.1 reinstated `Additional notes` (column AE) after v0.9.0
        // briefly dropped it. KV blobs saved against the v0.9.0 shape
        // won't have this field — backfill `''` so a hydrate doesn't
        // produce `undefined` cells in source forms or exports.
        additionalNotes: row.additionalNotes ?? '',
      } as SourceSummaryRow
    }),
    workerGroups: (p.workerGroups ?? []).map((w) => {
      const x = w as Partial<WorkerGroupRow>
      return {
        ...w,
        // v2.0: every WG row is now either 'stream' or 'edge'. Plans saved
        // before v2.0 default to 'stream' (the only kind that existed).
        kind: x.kind === 'edge' ? 'edge' : 'stream',
        throughputGbd: x.throughputGbd ?? '',
        diskOneDayGb: x.diskOneDayGb ?? '',
      } as WorkerGroupRow
    }),
    // v2.0 PR C: every PlanState now carries an `activation` block
    // mirroring the gold's PS Use Case Worksheet sheet. Older saved
    // plans (v1.x KV blobs and v0.8.6 imports) didn't have it, so we
    // backfill defaults here. `backfillActivation` is shape-tolerant
    // and fills in any missing sub-arrays / rows / fields without
    // dropping data the user has already entered.
    activation: backfillActivation((p as Partial<PlanState>).activation as Activation | undefined),
  }
  return assignWorkerGroupIds(backfillSourceSummaryTypePhysicalLocation(merged))
}

function normalizeSummaryType(s: string): '' | 'On-Prem' | 'Cloud/Internet' {
  const t = s.trim()
  if (!t) {
    return ''
  }
  const l = t.toLowerCase()
  if (l.includes('cloud') || l.includes('internet')) {
    return 'Cloud/Internet'
  }
  if (l.includes('on') && l.includes('prem')) {
    return 'On-Prem'
  }
  if (t === 'On-Prem' || t === 'Cloud/Internet') {
    return t
  }
  return ''
}

/**
 * If older sessions don't have Type/Physical location(s) on Source summary, copy from a matching
 * topology (SourceVolume) row when the source name matches and fields are still empty.
 */
function backfillSourceSummaryTypePhysicalLocation(plan: PlanState): PlanState {
  if (!plan.sourceVolume || plan.sourceVolume.length === 0) {
    return plan
  }
  const bySource = new Map<string, SourceVolumeRow[]>()
  for (const v of plan.sourceVolume) {
    const k = (v.source || '').trim().toLowerCase()
    if (!k) continue
    const arr = bySource.get(k) ?? []
    arr.push(v)
    bySource.set(k, arr)
  }
  return {
    ...plan,
    sourceSummary: plan.sourceSummary.map((r) => {
      const needsType = !(r.type || '').trim()
      const needsPhysical = !(r.physicalLocations || '').trim()
      if (!needsType && !needsPhysical) {
        return r
      }
      const k = (r.source || '').trim().toLowerCase()
      if (!k) {
        return r
      }
      const candidates = bySource.get(k)
      if (!candidates || candidates.length === 0) {
        return r
      }
      const v =
        candidates.find((x) => (x.workerGroupId && x.workerGroupId === r.workerGroupId) || (!x.workerGroupId && !r.workerGroupId)) ??
        candidates[0]
      const nextType = needsType ? normalizeSummaryType(String(v.type ?? '')) : r.type
      const nextPhysical = needsPhysical ? String(v.region ?? '').trim() : r.physicalLocations
      return { ...r, type: nextType, physicalLocations: nextPhysical }
    }),
  }
}

/**
 * The plan is the app's main data. Per CRIBL_DEV_NOTES.md "Decision 1", we
 * gate the entire UI on this hydration completing — flashing an empty plan
 * to a populated one is jarring (vs. a 50ms blip on a sidebar width). The
 * `plan === null` return value is the loading sentinel; App.tsx renders a
 * loading screen until it becomes non-null.
 *
 * Echo-write suppression: when hydration finishes we set state to the just-
 * loaded plan. The write effect would normally fire on that change and PUT
 * the value we just GET'd. `lastSavedRef` short-circuits that one echo so
 * we don't waste a round-trip (and, critically, so that on a brand-new
 * tenant where KV had no `plan` key, we don't silently create one with the
 * empty plan on first ever app open).
 */
export function usePlanStorage() {
  const [plan, setPlan] = useState<PlanState | null>(null)
  const lastSavedRef = useRef<PlanState | null>(null)

  useEffect(() => {
    void (async () => {
      const raw = await kvGet<unknown>(KEY, null)
      const loaded = raw === null ? createEmptyPlan() : normalizePlan(raw)
      lastSavedRef.current = loaded
      setPlan(loaded)
    })()
  }, [])

  useEffect(() => {
    if (plan === null) {
      return
    }
    if (lastSavedRef.current === plan) {
      return
    }
    lastSavedRef.current = plan
    void kvSet(KEY, plan)
  }, [plan])

  const reset = () => {
    clearImportShell()
    setPlan(createEmptyPlan())
  }

  return { plan, setPlan, reset }
}
