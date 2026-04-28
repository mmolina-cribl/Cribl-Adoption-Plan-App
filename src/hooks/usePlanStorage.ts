import { useEffect, useRef, useState } from 'react'
import { createEmptyPlan } from '../lib/defaultState'
import { clearImportShell } from '../lib/importShellStore'
import { kvGet, kvSet } from '../lib/kvStore'
import { assignWorkerGroupIds } from '../lib/workerGroupIds'
import type { PlanState, SourceSummaryRow, SourceVolumeRow, WorkerGroupRow } from '../types/planTypes'

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
    sourceSummary: p.sourceSummary.map((r, i) => {
      const row = r as Partial<SourceSummaryRow> & { id: string }
      return {
        ...r,
        displayName:
          typeof row.displayName === 'string' && row.displayName.trim() !== ''
            ? row.displayName
            : `Source ${i + 1}`,
        type: (row as Partial<SourceSummaryRow>).type ?? ('' as SourceSummaryRow['type']),
        regions: (row as Partial<SourceSummaryRow>).regions ?? '',
      } as SourceSummaryRow
    }),
    workerGroups: (p.workerGroups ?? []).map((w) => {
      const x = w as Partial<WorkerGroupRow>
      return {
        ...w,
        throughputGbd: x.throughputGbd ?? '',
        diskOneDayGb: x.diskOneDayGb ?? '',
      } as WorkerGroupRow
    }),
  }
  return assignWorkerGroupIds(backfillSourceSummaryTypeRegion(merged))
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
 * If older sessions don't have Type/Region on Source summary, copy from a matching
 * topology (SourceVolume) row when the source name matches and fields are still empty.
 */
function backfillSourceSummaryTypeRegion(plan: PlanState): PlanState {
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
      const needsRegions = !(r.regions || '').trim()
      if (!needsType && !needsRegions) {
        return r
      }
      const k = (r.source || r.displayName || '').trim().toLowerCase()
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
      const nextRegions = needsRegions ? String(v.region ?? '').trim() : r.regions
      return { ...r, type: nextType, regions: nextRegions }
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
