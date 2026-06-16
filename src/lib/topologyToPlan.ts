import { newId, type PlanState, type SourceSummaryRow, type WorkerGroupRow } from '../types/planTypes'
import { defaultActivation } from './defaultState'
import type { LeaderInputItem, MasterGroupItem, TenantHarvestResult } from './tenantHarvest'
import { assignWorkerGroupIds } from './workerGroupIds'
import { inferSourceTileFromLeaderInput } from './leaderInputToSourceTile'
import { leaderWorkerGroupDetailFromMetrics, leaderWorkerHostingFromCloud } from './leaderWorkerGroupMetrics'
import { DISABLED_SOURCE_NAME_SUFFIX } from './sourceAttachmentDisabled'

/** Serializable snapshot of the last successful “Import from live tenant” run (for support / QA). */
export type TenantImportDebugPayload = {
  capturedAt: string
  totals: {
    workerGroupsInPlan: number
    syntheticSourcesInPlan: number
    leaderInputsFetchedAcrossGroups: number
    harvestWarningCount: number
  }
  /** One row per Leader group after Search filtering. */
  perGroup: Array<{
    criblGroupId: string
    displayLabel: string
    kind: 'stream' | 'edge'
    leaderInputsFetched: number
    /** Plan source rows created from Leader inputs (after optional omit-stock / skip-disabled filters). */
    sourceRowsImported: number
  }>
  /** Raw Leader harvest (group metadata + inputs + warnings). */
  harvest: TenantHarvestResult
  /** One row per plan source after import. */
  syntheticSourceDetails: Array<{
    criblGroupId?: string
    workerGroupLabel: string
    workerGroupKind: string
    source: string
    collectorType: string
    sourceTile: string
    pipelineUsecase: string
    destinations: string
    streamOrEdge: string
    additionalNotes?: string
  }>
}

/**
 * Build a JSON-friendly snapshot of what the Leader returned and how it mapped
 * into the plan model after `topologyHarvestToPlanState` + `assignWorkerGroupIds`.
 */
export function buildTenantImportDebugPayload(
  capturedAt: string,
  harvest: TenantHarvestResult,
  planAfterImport: PlanState,
): TenantImportDebugPayload {
  const internalWgToCribl = new Map<string, string>()
  for (let i = 0; i < harvest.groups.length; i++) {
    const g = harvest.groups[i]
    const wg = planAfterImport.workerGroups[i]
    if (g && wg) {
      internalWgToCribl.set(wg.id, g.id)
    }
  }

  const collectorTypes = leaderCollectorTypesInHarvestOrder(harvest)
  const syntheticSourceDetails = planAfterImport.sourceSummary.map((row, i) => {
    const wg = planAfterImport.workerGroups.find((w) => w.id === row.workerGroupId)
    return {
      criblGroupId: internalWgToCribl.get(row.workerGroupId),
      workerGroupLabel: wg?.wg ?? '',
      workerGroupKind: wg?.kind ?? '',
      source: row.source,
      collectorType: collectorTypes[i] ?? '',
      sourceTile: row.sourceTile ?? '',
      pipelineUsecase: row.pipelineUsecase,
      destinations: row.destinations,
      streamOrEdge: row.streamOrEdge,
      additionalNotes: row.additionalNotes?.trim() ? row.additionalNotes : undefined,
    }
  })

  const perGroup = harvest.groups.map((g) => {
    const inputs = harvest.inputsByGroup[g.id] ?? []
    const displayLabel = (g.description ?? '').trim() || g.id
    const kind = leaderWorkerGroupKind(g)
    return {
      criblGroupId: g.id,
      displayLabel,
      kind,
      leaderInputsFetched: inputs.length,
      sourceRowsImported: inputs.length,
    }
  })
  const leaderInputsFetchedAcrossGroups = perGroup.reduce((s, row) => s + row.leaderInputsFetched, 0)
  return {
    capturedAt,
    totals: {
      workerGroupsInPlan: planAfterImport.workerGroups.length,
      syntheticSourcesInPlan: planAfterImport.sourceSummary.length,
      leaderInputsFetchedAcrossGroups,
      harvestWarningCount: harvest.warnings.length,
    },
    perGroup,
    syntheticSourceDetails,
    harvest,
  }
}

/** Map Leader group metadata to adoption plan worker-group kind (Stream vs Edge). */
export function leaderWorkerGroupKind(g: MasterGroupItem): 'stream' | 'edge' {
  const t = typeof g.type === 'string' ? g.type.trim().toLowerCase() : ''
  if (g.isFleet === true || t === 'edge' || t === 'outpost') {
    return 'edge'
  }
  return 'stream'
}

/** Max length for plan **Source** when built from Leader input `id` / `type`. */
const MAX_SOURCE_NAME_CHARS = 200

/** Adoption plan **Source** label from a Leader input: always input **`id`**, else **`type`**. */
function leaderInputSourceLabel(inp: LeaderInputItem): string {
  const id = inp.id?.trim() ?? ''
  if (id) {
    return id.slice(0, MAX_SOURCE_NAME_CHARS)
  }
  const typ = inp.type?.trim() ?? ''
  return typ.slice(0, MAX_SOURCE_NAME_CHARS)
}

/**
 * **Source** column for a synthetic import row. When `disabled` is true, the suffix
 * {@link DISABLED_SOURCE_NAME_SUFFIX} is always applied (truncating the base id/type first
 * so the full string stays within {@link MAX_SOURCE_NAME_CHARS}).
 */
function leaderInputSourceNameForPlan(inp: LeaderInputItem): string {
  const base = leaderInputSourceLabel(inp).trimEnd()
  if (!inp.disabled) {
    return base.slice(0, MAX_SOURCE_NAME_CHARS)
  }
  const maxBase = Math.max(0, MAX_SOURCE_NAME_CHARS - DISABLED_SOURCE_NAME_SUFFIX.length)
  return `${base.slice(0, maxBase)}${DISABLED_SOURCE_NAME_SUFFIX}`
}

function syntheticSourceFromLeaderInput(workerGroupId: string, inp: LeaderInputItem): SourceSummaryRow {
  const notes: string[] = []
  const leaderDesc = inp.description?.trim()
  if (leaderDesc) {
    notes.push(`Leader input description: ${leaderDesc}`)
  }
  return {
    id: newId(),
    workerGroupId,
    source: leaderInputSourceNameForPlan(inp),
    securityOrObs: '',
    streamOrEdge: '',
    type: '',
    physicalLocations: '',
    sourceTile: inferSourceTileFromLeaderInput(inp.type, inp.id),
    pipelineUsecase: '',
    destinations: '',
    retention: '',
    avgDailyGb: '',
    complianceRelated: false,
    dataCriticality: '',
    stakeholders: '',
    currentCollection: '',
    isCurrent: false,
    targetOnboardStart: '',
    targetOnboardEnd: '',
    onboardingCompletedOn: '',
    blockers: '',
    growth: '',
    dataOptPct: '',
    dataOptGb: '',
    initiativeCase: '',
    technicalUsecase: '',
    financial: '',
    operational: '',
    riskReduction: '',
    strategic: '',
    onboardingEffort: '',
    politics: '',
    additionalNotes: notes.join(' · '),
    leaderImportedDisabled: Boolean(inp.disabled),
  }
}

function workerGroupRowFromGroup(g: MasterGroupItem): WorkerGroupRow {
  const name = (g.description ?? '').trim() || g.id
  const kind = leaderWorkerGroupKind(g)
  const workerDetail = leaderWorkerGroupDetailFromMetrics({
    estimatedIngestRate: g.estimatedIngestRate,
  })
  const workerHosting = leaderWorkerHostingFromCloud(g.onPrem, g.cloud)
  return {
    id: newId(),
    kind,
    wg: name,
    ingestGbd: '',
    egressGbd: '',
    throughputGbd: '',
    workerHosting,
    workerCount: '',
    workerDetail,
    diskOneDayGb: '',
    parentFleetId: '',
  }
}

/**
 * Leader collector `type` strings in the same order `topologyHarvestToPlanState` appends sources
 * (for debug payloads only — not written to `SourceSummaryRow.currentCollection`).
 */
export function leaderCollectorTypesInHarvestOrder(harvest: TenantHarvestResult): string[] {
  const workerGroups = harvest.groups.map(workerGroupRowFromGroup)
  const wgByCriblId = new Map<string, string>()
  for (let i = 0; i < harvest.groups.length; i++) {
    wgByCriblId.set(harvest.groups[i]!.id, workerGroups[i]!.id)
  }
  const types: string[] = []
  for (const g of harvest.groups) {
    const internalWgId = wgByCriblId.get(g.id)
    if (!internalWgId) {
      continue
    }
    for (const inp of harvest.inputsByGroup[g.id] ?? []) {
      types.push(inp.type?.trim() ?? '')
    }
  }
  return types
}

/**
 * Turn a tenant harvest into a fresh PlanState (replaces workbook-derived rows).
 * Sources are built from Leader **configured inputs** (`/m/{group}/system/inputs`), not routes.
 * Caller sets `customerName`, `planProvenance`, and may merge instead of replace.
 */
export function topologyHarvestToPlanState(h: TenantHarvestResult): PlanState {
  const workerGroups = h.groups.map(workerGroupRowFromGroup)
  const wgByCriblId = new Map<string, string>()
  for (let i = 0; i < h.groups.length; i++) {
    wgByCriblId.set(h.groups[i]!.id, workerGroups[i]!.id)
  }

  const sourceSummary: SourceSummaryRow[] = []
  for (const g of h.groups) {
    const internalWgId = wgByCriblId.get(g.id)
    if (!internalWgId) {
      continue
    }
    const inputs = h.inputsByGroup[g.id] ?? []
    for (const inp of inputs) {
      sourceSummary.push(syntheticSourceFromLeaderInput(internalWgId, inp))
    }
  }

  let plan: PlanState = {
    version: 1,
    customerName: '',
    cseNotes: '',
    sourceSummary,
    sourceVolume: [],
    workerGroups,
    activation: defaultActivation(),
  }
  plan = assignWorkerGroupIds(plan)
  return plan
}
