import { sourceLabel, type PlanState, type SourceSummaryRow, type SourceVolumeRow, type WorkerGroupRow } from '../types/planTypes'

/**
 * v0.9.1 schema: completeness score is computed over every per-WG / per-Fleet
 * sheet column. v2.0 only stops counting the two columns the gold template
 * actually dropped (Display name and Additional notes); the value-lever
 * fields (Operational / Risk Reduction / Strategic / Onboarding Effort /
 * Politics) are still part of the gold sheet and still count.
 */
const SOURCE_ROW_KEYS: (keyof SourceSummaryRow)[] = [
  'source',
  'physicalLocations',
  'currentCollection',
  'securityOrObs',
  'streamOrEdge',
  'sourceTile',
  'pipelineUsecase',
  'destinations',
  'retention',
  'avgDailyGb',
  'dataCriticality',
  'stakeholders',
  'isCurrent',
  'complianceRelated',
  'targetOnboardStart',
  'targetOnboardEnd',
  'onboardingCompletedOn',
  'blockers',
  'growth',
  'dataOptPct',
  'dataOptGb',
  'initiativeCase',
  'technicalUsecase',
  'financial',
  'operational',
  'riskReduction',
  'strategic',
  'onboardingEffort',
  'politics',
]

function isFilledString(v: unknown, key: keyof SourceSummaryRow, row: SourceSummaryRow): boolean {
  if (key === 'isCurrent' || key === 'complianceRelated') {
    return row[key] === true
  }
  if (typeof v !== 'string') {
    return false
  }
  return v.trim() !== ''
}

export function sourceRowProgress(row: SourceSummaryRow): { filled: number; total: number; pct: number } {
  let filled = 0
  for (const key of SOURCE_ROW_KEYS) {
    if (isFilledString(row[key], key, row)) {
      filled += 1
    }
  }
  const total = SOURCE_ROW_KEYS.length
  const pct = total === 0 ? 0 : Math.round((filled / total) * 100)
  return { filled, total, pct }
}

function volumeRowLine(r: SourceVolumeRow): string {
  const a = r.source?.trim() || 'Unnamed'
  const vol = r.dailyVolumeGb?.trim()
  return vol ? `${a} · ${vol} GB/d` : a
}

function wgLine(w: WorkerGroupRow): string {
  return w.wg?.trim() || 'Unnamed worker group'
}

export function buildDashboardSnapshot(plan: PlanState) {
  const sourceRows = plan.sourceSummary.map((r, i) => ({
    id: r.id,
    name: sourceLabel(r, i),
    label: r.source?.trim() || '—',
    volGb: r.avgDailyGb?.trim() || '—',
    ...sourceRowProgress(r),
  }))

  const vLines = plan.sourceVolume.map(volumeRowLine)
  const wgRowPreview = plan.workerGroups.map((w) => ({
    id: w.id,
    name: wgLine(w),
  }))

  const volStarted = plan.sourceVolume.some((r) => r.source?.trim() || r.dailyVolumeGb?.trim())
  const wgStarted = plan.workerGroups.some((w) => w.wg?.trim() || w.ingestGbd?.trim())

  return {
    sourceRows,
    volumePreview: vLines.slice(0, 4),
    volumeRest: Math.max(0, vLines.length - 4),
    wgRowPreview: wgRowPreview.slice(0, 4),
    wgRest: Math.max(0, plan.workerGroups.length - 4),
    cseHasNotes: plan.cseNotes.trim() !== '',
    volStarted,
    wgStarted,
  }
}

export type DashboardSnapshot = ReturnType<typeof buildDashboardSnapshot>
