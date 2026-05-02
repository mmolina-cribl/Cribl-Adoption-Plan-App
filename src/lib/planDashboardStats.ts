import { sourceLabel, type PlanState, type SourceSummaryRow, type SourceVolumeRow, type WorkerGroupRow } from '../types/planTypes'
import { getOnboardingStatus, type OnboardingStatus } from './onboardingStatus'

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

/**
 * Normalize the free-text criticality field to a small canonical
 * vocabulary so the dashboard can color-code it consistently. The
 * gold workbook uses "High / Medium / Low" but customers sometimes
 * type variants ("HIGH", "med", etc.); fall through to "Other" if a
 * value is set but doesn't match, and `null` when blank.
 */
type CriticalityBucket = 'High' | 'Medium' | 'Low' | 'Other' | null
function normalizeCriticality(raw: string | undefined): CriticalityBucket {
  const v = (raw || '').trim()
  if (!v) return null
  if (/^high$/i.test(v)) return 'High'
  if (/^medium$/i.test(v)) return 'Medium'
  if (/^low$/i.test(v)) return 'Low'
  return 'Other'
}

/**
 * Truncate a free-text stakeholders field to a comma-joined preview
 * suitable for a dashboard row. Splits on the same separators the
 * source form accepts (commas, semicolons, newlines) so the rendered
 * string survives a round-trip through whatever the user typed.
 */
function summarizeStakeholders(raw: string | undefined): { display: string; total: number } {
  const v = (raw || '').trim()
  if (!v) return { display: '', total: 0 }
  const parts = v
    .split(/[,;\n]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
  if (parts.length === 0) return { display: '', total: 0 }
  // Show the first three; mention the overflow as " +N more" so the
  // row stays scannable when a customer lists 5+ teams.
  const head = parts.slice(0, 3).join(', ')
  return {
    display: parts.length > 3 ? `${head} +${parts.length - 3} more` : head,
    total: parts.length,
  }
}

export type DashboardSourceRow = {
  id: string
  name: string
  label: string
  volGb: string
  filled: number
  total: number
  pct: number
  /** Resolved name of the attached worker group / fleet, or `null`. */
  wgName: string | null
  /** Kind of the attached worker group (`null` for unassigned rows). */
  wgKind: 'stream' | 'edge' | null
  /** Tri-state derived onboarding lifecycle. */
  status: OnboardingStatus
  /** Bucketed criticality (`null` when the customer hasn't filled it in). */
  criticality: CriticalityBucket
  /**
   * Target onboarding end date as a raw ISO string (or whatever the
   * customer typed); empty string when unset. The UI renders this
   * verbatim so a customer's "Q3 2026" entry still shows.
   */
  targetEnd: string
  /** Stakeholder preview line + the total count for sizing the badge. */
  stakeholders: { display: string; total: number }
}

export function buildDashboardSnapshot(plan: PlanState) {
  const wgById = new Map<string, WorkerGroupRow>()
  for (const w of plan.workerGroups) {
    wgById.set(w.id, w)
  }
  const sourceRows: DashboardSourceRow[] = plan.sourceSummary.map((r, i) => {
    const wg = r.workerGroupId ? wgById.get(r.workerGroupId) ?? null : null
    return {
      id: r.id,
      name: sourceLabel(r, i),
      label: r.source?.trim() || '—',
      volGb: r.avgDailyGb?.trim() || '—',
      ...sourceRowProgress(r),
      wgName: wg ? wg.wg.trim() || 'Unnamed' : null,
      wgKind: wg ? wg.kind : null,
      status: getOnboardingStatus(r),
      criticality: normalizeCriticality(r.dataCriticality),
      targetEnd: (r.targetOnboardEnd || '').trim(),
      stakeholders: summarizeStakeholders(r.stakeholders),
    }
  })

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
