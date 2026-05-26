/**
 * JSON context for the Executive (Summary) tab optional AI call.
 * Purpose-built payload (not the rail digest): full WG list + capped source rows + explicit omit counts.
 */
import type { PlanState } from '../types/planTypes'
import type { ExecutiveSnapshot } from './executiveSnapshot'
import {
  activationTierScopeSummary,
  PS_USE_CASE_COUNT,
  unlockedUseCaseCountForTier,
} from './psUseCaseLayout'

const MAX_SOURCE_ROWS_INITIAL = 80
/** Hard cap on serialized JSON length sent with the executive-summary user message. */
const MAX_CONTEXT_JSON_CHARS = 14_000

function sliceStr(s: string | undefined, max: number): string {
  const t = (s ?? '').trim()
  if (!t) {
    return ''
  }
  return t.length > max ? `${t.slice(0, max)}…` : t
}

export type ExecutiveSummaryAiContext = {
  purpose: string
  digestCoverage: string
  customerName: string
  asOf: string
  planProvenance: PlanState['planProvenance']
  atAGlance: {
    streamWorkerGroups: number
    edgeFleets: number
    sourceRowsInPlan: number
    psActivationTier: string | null
  }
  workerGroups: Array<{ name: string; kind: 'stream' | 'edge' }>
  sourceInventorySample: Array<{
    name: string
    avgDailyGb: string
    workerGroup: string
    streamOrEdge: string
    sourceTile: string
    blockers: string
  }>
  omittedSourcesCount: number
  sourceProvenanceLabel: string
  sourceProvenanceDetail: string
  activationSummary: {
    tier: string | null
    unlockedUseCaseSlotsInScope: number
    totalPsWorksheetUseCaseSlots: number
    tierScopeSummaryInApp: string | null
    baseScopeComplete: number
    baseScopeTotal: number
  }
  /** Truncated free-text notes from the plan (same values as the workbook / dashboard notes field). */
  planNotesSnippet: string
}

function buildPayload(plan: PlanState, snap: ExecutiveSnapshot, maxSourceRows: number): ExecutiveSummaryAiContext {
  const act = plan.activation
  const totalSources = snap.sources.length
  const sourceRows = snap.sources.slice(0, maxSourceRows).map((s) => ({
    name: sliceStr(s.name, 120),
    avgDailyGb: sliceStr(s.vol, 24),
    workerGroup: sliceStr(s.wg, 64),
    streamOrEdge: sliceStr(s.streamOrEdge, 40),
    sourceTile: sliceStr(s.sourceTile, 80),
    blockers: sliceStr(s.blockers, 160),
  }))
  const omitted = Math.max(0, totalSources - sourceRows.length)

  const digestCoverage =
    omitted > 0
      ? `Worker groups: full list (${snap.workerGroups.length}). Sources in JSON are ordered by average daily GB (largest first). The array lists the first ${sourceRows.length} of ${totalSources} rows (${omitted} lower-volume or unparsed rows omitted from JSON only); **atAGlance.sourceRowsInPlan** is the full plan count — do not claim fewer sources than that number.`
      : `Worker groups: full list (${snap.workerGroups.length}). Sources: all ${totalSources} rows included (trimmed fields), ordered by average daily GB largest first.`

  return {
    purpose:
      'Generate stakeholder-facing talking points for a Cribl Stream/Edge adoption plan summary. Use only facts present in this JSON. Do not invent tenant topology, volumes, or product version details.',
    digestCoverage,
    customerName: sliceStr(snap.customerName, 200),
    asOf: snap.asOfLabel,
    planProvenance: plan.planProvenance ?? { kind: 'scratch' },
    atAGlance: {
      streamWorkerGroups: snap.wgStreamCount,
      edgeFleets: snap.wgEdgeCount,
      sourceRowsInPlan: snap.sourceCount,
      psActivationTier: snap.activationTier,
    },
    workerGroups: snap.workerGroups.map((w) => ({
      name: sliceStr(w.name, 120),
      kind: w.kind,
    })),
    sourceInventorySample: sourceRows,
    omittedSourcesCount: omitted,
    sourceProvenanceLabel: snap.provenanceLabel,
    sourceProvenanceDetail: sliceStr(snap.provenanceDetail, 400),
    activationSummary: {
      tier: act.tier,
      unlockedUseCaseSlotsInScope: unlockedUseCaseCountForTier(act.tier),
      totalPsWorksheetUseCaseSlots: PS_USE_CASE_COUNT,
      tierScopeSummaryInApp: act.tier ? activationTierScopeSummary(act.tier) : null,
      baseScopeComplete: act.baseScope.filter((r) => r.status === 'Complete').length,
      baseScopeTotal: act.baseScope.length,
    },
    planNotesSnippet: sliceStr(plan.cseNotes, 500),
  }
}

/**
 * Compact JSON for the executive-summary AI call. Shrinks source row count if the
 * payload exceeds {@link MAX_CONTEXT_JSON_CHARS}.
 */
export function buildExecutiveSummaryAiContextJson(plan: PlanState, snap: ExecutiveSnapshot): string {
  let maxRows = MAX_SOURCE_ROWS_INITIAL
  for (let attempt = 0; attempt < 12; attempt++) {
    const payload = buildPayload(plan, snap, maxRows)
    const json = JSON.stringify(payload)
    if (json.length <= MAX_CONTEXT_JSON_CHARS) {
      return json
    }
    maxRows = Math.max(10, Math.floor(maxRows * 0.65))
  }
  const payload = buildPayload(plan, snap, 10)
  return JSON.stringify(payload).slice(0, MAX_CONTEXT_JSON_CHARS)
}
