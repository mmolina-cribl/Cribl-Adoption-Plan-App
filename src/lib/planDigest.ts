import type { PlanState } from '../types/planTypes'
import { sourceLabel } from '../types/planTypes'
import {
  activationTierScopeSummary,
  PS_USE_CASE_COUNT,
  unlockedUseCaseCountForTier,
} from './psUseCaseLayout'

function sliceStr(s: string | undefined, max: number): string | undefined {
  const t = (s ?? '').trim()
  if (!t) {
    return undefined
  }
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/**
 * Compact JSON-safe summary of the plan for LLM context (no full workbook dump).
 * Includes enough adoption-plan shape for the assistant to reason about topology,
 * Stream vs Edge mix, collection context, and PS activation — without inventing
 * tenant facts not captured in the workbook. `activationSummary` includes PS tier,
 * unlocked use-case slot counts, and `tierScopeSummaryInApp` when a tier is set.
 */
export function buildPlanDigestJson(plan: PlanState): string {
  const prov = plan.planProvenance ?? { kind: 'scratch' as const }
  const wgById = new Map(plan.workerGroups.map((w) => [w.id, w]))

  const workerGroupStreamCount = plan.workerGroups.filter((w) => w.kind === 'stream').length
  const workerGroupEdgeCount = plan.workerGroups.filter((w) => w.kind === 'edge').length

  let sourcesOnStream = 0
  let sourcesOnEdge = 0
  for (const r of plan.sourceSummary) {
    const k = wgById.get(r.workerGroupId)?.kind
    if (k === 'stream') {
      sourcesOnStream++
    } else if (k === 'edge') {
      sourcesOnEdge++
    }
  }

  let ingestGbApprox = 0
  for (const r of plan.sourceSummary) {
    const v = parseFloat(String(r.avgDailyGb ?? '').replace(/,/g, ''))
    if (!Number.isNaN(v) && v > 0) {
      ingestGbApprox += v
    }
  }
  const roundedIngest =
    ingestGbApprox > 0 ? Math.round(ingestGbApprox * 10) / 10 : undefined

  const act = plan.activation
  const unlockedSlots = unlockedUseCaseCountForTier(act.tier)
  const activationSummary = {
    tier: act.tier,
    unlockedUseCaseSlotsInScope: unlockedSlots,
    totalPsWorksheetUseCaseSlots: PS_USE_CASE_COUNT,
    tierScopeSummaryInApp: act.tier ? activationTierScopeSummary(act.tier) : null,
    tierUnsetShowsAllSlotsInUi: act.tier === null,
    baseScopeComplete: act.baseScope.filter((r) => r.status === 'Complete').length,
    baseScopeTotal: act.baseScope.length,
  }

  const sources = plan.sourceSummary.slice(0, 35).map((r, i) => {
    const wg = wgById.get(r.workerGroupId)
    const row: Record<string, unknown> = {
      name: sourceLabel(r, i),
      wgId: r.workerGroupId,
      workerGroupKind: wg?.kind ?? 'unknown',
    }
    const wn = sliceStr(wg?.wg, 64)
    if (wn) {
      row.workerGroupName = wn
    }
    const tile = sliceStr(r.sourceTile, 120)
    if (tile) {
      row.tile = tile
    }
    const dest = sliceStr(r.destinations, 140)
    if (dest) {
      row.destinations = dest
    }
    const gb = sliceStr(r.avgDailyGb, 24)
    if (gb) {
      row.avgDailyGb = gb
    }
    const blk = sliceStr(r.blockers, 200)
    if (blk) {
      row.blockers = blk
    }
    const so = sliceStr(r.streamOrEdge, 40)
    if (so) {
      row.streamOrEdgeColumn = so
    }
    const loc = sliceStr(r.physicalLocations, 100)
    if (loc) {
      row.physicalLocations = loc
    }
    const cc = sliceStr(r.currentCollection, 120)
    if (cc) {
      row.currentCollectionPath = cc
    }
    const sec = sliceStr(r.securityOrObs, 48)
    if (sec) {
      row.securityOrObservability = sec
    }
    const pu = sliceStr(r.pipelineUsecase, 100)
    if (pu) {
      row.pipelineUsecase = pu
    }
    const typ = sliceStr(r.type, 24)
    if (typ) {
      row.onPremVsCloud = typ
    }
    const notes = sliceStr(r.additionalNotes, 160)
    if (notes) {
      row.additionalNotes = notes
    }
    return row
  })

  const volumeSample = plan.sourceVolume
    .slice(0, 10)
    .map((v) => {
      const row: Record<string, unknown> = {}
      const s = sliceStr(v.source, 48)
      if (s) {
        row.source = s
      }
      const g = sliceStr(v.dailyVolumeGb, 20)
      if (g) {
        row.dailyVolumeGb = g
      }
      const w = sliceStr(v.wg, 40)
      if (w) {
        row.workerGroupName = w
      }
      const d = sliceStr(v.destinations, 120)
      if (d) {
        row.destinations = d
      }
      return row
    })
    .filter((o) => Object.keys(o).length > 0)

  const payload: Record<string, unknown> = {
    customerName: (plan.customerName ?? '').trim(),
    planProvenance: prov,
    /** What this JSON includes / omits so the assistant can calibrate answers. */
    digestCoverage:
      'Truncated snapshot for chat context — not a full cell-by-cell workbook. Activation: tier, slot-scope summary, base-scope completion counts (not each deliverable line). Sources: up to 35 rows with trimmed fields. Worker groups: summary fields only.',
    activationSummary,
    workerGroupMix: {
      streamWorkerGroups: workerGroupStreamCount,
      edgeFleets: workerGroupEdgeCount,
      totalWorkerGroups: plan.workerGroups.length,
    },
    sourceRowsByWorkerKind: {
      attachedToStream: sourcesOnStream,
      attachedToEdge: sourcesOnEdge,
      totalSources: plan.sourceSummary.length,
    },
    ingestFootprintGbPerDayApprox: roundedIngest,
    workerGroups: plan.workerGroups.map((w) => ({
      id: w.id,
      name: (w.wg ?? '').trim() || w.id,
      kind: w.kind,
      ingestGbd: sliceStr(w.ingestGbd, 24),
      egressGbd: sliceStr(w.egressGbd, 24),
      workerCount: sliceStr(w.workerCount, 24),
      workerHosting: sliceStr(w.workerHosting, 48),
    })),
    sources,
    sourceVolumeSample: volumeSample.some((o) => Object.keys(o).length > 0) ? volumeSample : undefined,
    cseNotesSnippet: sliceStr(plan.cseNotes, 450),
    cseNotesPresent: Boolean((plan.cseNotes ?? '').trim()),
  }

  return JSON.stringify(payload, null, 0)
}
