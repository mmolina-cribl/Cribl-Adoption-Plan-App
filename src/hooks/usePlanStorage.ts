import { useEffect, useState } from 'react'
import { createEmptyPlan } from '../lib/defaultState'
import { clearImportShell } from '../lib/importShellStore'
import { assignWorkerGroupIds } from '../lib/workerGroupIds'
import type { PlanState, SourceSummaryRow, SourceVolumeRow, WorkerGroupRow } from '../types/planTypes'

const KEY = 'cribl-adoption-web-v1'

function loadPlan(): PlanState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      return createEmptyPlan()
    }
    const p = JSON.parse(raw) as PlanState
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
  } catch {
    return createEmptyPlan()
  }
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

export function usePlanStorage() {
  const [plan, setPlan] = useState<PlanState>(loadPlan)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(plan))
    } catch {
      // Sandboxed iframe (e.g. Cribl App Platform) blocks storage access.
      // Persistence is best-effort here; KV store integration is the proper fix.
    }
  }, [plan])

  const reset = () => {
    clearImportShell()
    setPlan(createEmptyPlan())
  }

  return { plan, setPlan, reset }
}
