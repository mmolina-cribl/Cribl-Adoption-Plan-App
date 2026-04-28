import * as XLSX from 'xlsx'
import { getInputDataRows, TEMPLATE_INSTRUCTIONS } from '../data/referenceData'
import type { PlanState, SourceSummaryRow } from '../types/planTypes'
import { effectiveIngestEgressGbdForWg } from './workerGroupRollup'
import {
  SHEET_COPY_SOURCES_WG,
  SHEET_INPUT_DATA,
  SHEET_INSTRUCTIONS,
  SHEET_SOURCE_SUMMARY,
  SOURCE_GROUP_LABELS,
  SOURCE_HEADERS,
  SOURCES_WG_SOURCE_HEADERS,
  WORKER_HEADERS,
} from './planWorkbookLayout'
export {
  SOURCE_HEADERS,
  SHEET_COPY_SOURCES_WG,
  SHEET_SOURCE_SUMMARY,
  SOURCES_WG_SOURCE_HEADERS,
  WORKER_HEADERS,
} from './planWorkbookLayout'

/** Workbook `Props.Title` for all export paths. */
export function titleForAdoptionPlanExport(plan: PlanState): string {
  const n = plan.customerName.trim()
  return n ? `${n} Adoption Plan` : 'Adoption Plan'
}

function toExcelDate(iso: string): Date | string {
  if (!iso.trim()) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d
}

function toNumberOrString(s: string): number | string {
  if (!s.trim()) return ''
  const n = Number(s)
  if (Number.isFinite(n)) return n
  return s
}

/**
 * Cribl / Excel “Percentage” number format: raw cell value 0.8 shows as 80%;
 * the app uses whole-number “80” for 80% in state.
 */
function dataOptimizationPercentForExcel(s: string): number | string {
  if (!s.trim()) return ''
  const n = parseFloat(s.replace(/,/g, ''))
  if (!Number.isFinite(n)) return s
  if (n > 0 && n <= 100) return n / 100
  return n
}

/** One data row; order must follow `SOURCE_HEADERS` (see planWorkbookLayout). */
function sourceSummaryRowToExportArray(s: SourceSummaryRow): (string | number | boolean | Date)[] {
  return [
    s.source,
    s.securityOrObs,
    s.streamOrEdge,
    s.sourceTile,
    s.pipelineUsecase,
    s.destinations,
    s.retention,
    toNumberOrString(s.avgDailyGb),
    s.complianceRelated,
    s.dataCriticality,
    s.stakeholders,
    s.isCurrent,
    toExcelDate(s.targetOnboardStart),
    toExcelDate(s.targetOnboardEnd),
    toExcelDate(s.onboardingCompletedOn),
    s.blockers,
    s.growth,
    dataOptimizationPercentForExcel(s.dataOptPct),
    toNumberOrString(s.dataOptGb),
    s.initiativeCase,
    s.technicalUsecase,
    s.financial,
    s.operational,
    s.riskReduction,
    s.strategic,
    s.onboardingEffort,
    s.politics,
    s.additionalNotes,
  ]
}

/** Map a Source summary column title (any layout in `ALL_SOURCE_IMPORT_HEADER_NAMES`) to a cell value. */
export function sourceSummaryValueForHeaderName(
  name: string,
  s: SourceSummaryRow,
): string | number | boolean | Date | null | undefined {
  switch (name) {
    case 'Display name':
      return s.displayName
    case 'Source':
      return s.source
    case 'Type':
      return s.type
    case 'Region(s)':
      return s.regions
    case 'Security or Observability or both data?':
      return s.securityOrObs
    case 'Stream or Edge?':
      return s.streamOrEdge
    case 'Source tile':
      return s.sourceTile
    case 'Pipeline usecase':
      return s.pipelineUsecase
    case 'Destinations':
      return s.destinations
    case 'Retention':
      return s.retention
    case 'Average Daily Volume? (GB)':
      return toNumberOrString(s.avgDailyGb)
    case 'Compliance related?':
      return s.complianceRelated
    case 'Data criticality':
      return s.dataCriticality
    case 'Stakeholder(s) (team / line of business)':
      return s.stakeholders
    case 'Current?':
      return s.isCurrent
    case 'Target Onboarding Start':
      return toExcelDate(s.targetOnboardStart)
    case 'Target Onboarding End':
      return toExcelDate(s.targetOnboardEnd)
    case 'Onboarding Completed On':
      return toExcelDate(s.onboardingCompletedOn)
    case 'Blockers':
      return s.blockers
    case 'Growth?':
      return s.growth
    case 'Data optimization %':
      return dataOptimizationPercentForExcel(s.dataOptPct)
    case 'Data optimization (GB)':
      return toNumberOrString(s.dataOptGb)
    case 'Initiative case':
      return s.initiativeCase
    case 'Technical Use Case':
      return s.technicalUsecase
    case 'Financial':
      return s.financial
    case 'Operational':
      return s.operational
    case 'Risk Reduction':
      return s.riskReduction
    case 'Strategic':
      return s.strategic
    case 'Onboarding Effort':
      return s.onboardingEffort
    case 'Politics':
      return s.politics
    case 'Additional notes':
      return s.additionalNotes
    default:
      return undefined
  }
}

const INSTRUCTIONS_NUM_COLS = 12
const B = 1

function nullRow12(): (string | null)[] {
  return Array.from({ length: INSTRUCTIONS_NUM_COLS }, () => null)
}

/**
 * INSTRUCTIONS tab — static copy of `Copy of Adoption plan - v0.8.6.xlsx` (column B, merges on gold).
 * No `PlanState` content is written here.
 */
function instructionsSheet() {
  const rows: (string | null)[][] = []
  rows.push(nullRow12()) // R0: blank row
  const title = nullRow12()
  title[B] = 'INSTRUCTIONS'
  rows.push(title)
  rows.push(nullRow12()) // R2: bottom of B2:F3 title block
  rows.push(nullRow12()) // R3: blank
  for (const line of TEMPLATE_INSTRUCTIONS) {
    const r = nullRow12()
    r[B] = line
    rows.push(r)
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!merges'] = [
    { s: { r: 1, c: 1 }, e: { r: 2, c: 5 } },
    { s: { r: 4, c: 1 }, e: { r: 4, c: 11 } },
    { s: { r: 5, c: 1 }, e: { r: 5, c: 11 } },
    { s: { r: 6, c: 1 }, e: { r: 6, c: 11 } },
    { s: { r: 7, c: 1 }, e: { r: 7, c: 11 } },
  ]
  return sheet
}

/** Matrix (header rows + one row per source) for Source summary: programmatic export and official template fill. */
export function getSourceSummaryMatrixForExport(plan: PlanState) {
  const rows: (string | number | boolean | Date)[][] = []
  rows.push(SOURCE_GROUP_LABELS as unknown as (string | number | boolean)[])
  rows.push(SOURCE_HEADERS)
  for (const s of plan.sourceSummary) {
    const row = sourceSummaryRowToExportArray(s)
    if (row.length !== SOURCE_HEADERS.length) {
      throw new Error(
        `sourceSummaryRowToExportArray length ${row.length} does not match SOURCE_HEADERS (${SOURCE_HEADERS.length})`,
      )
    }
    rows.push(row)
  }
  return rows
}

function buildSourceSummary(plan: PlanState) {
  const rows = getSourceSummaryMatrixForExport(plan)
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!merges'] = [
    { s: { r: 0, c: 1 }, e: { r: 0, c: 6 } },
    { s: { r: 0, c: 7 }, e: { r: 0, c: 10 } },
    { s: { r: 0, c: 11 }, e: { r: 0, c: 18 } },
    { s: { r: 0, c: 19 }, e: { r: 0, c: 23 } },
  ]
  const WCH28 = [
    10, 22, 10, 14, 14, 18, 10, 12, 8, 10, 20, 8, 12, 12, 12, 14, 8, 10, 10, 24, 18, 20, 20, 20, 20,
    20, 10, 20,
  ] as const
  sheet['!cols'] = SOURCE_HEADERS.map((_, i) => ({ wch: WCH28[i] ?? 12 }))
  return sheet
}

/** `input_data` is static reference data for validation in Excel, not a dump of the live plan. */
function buildInputData() {
  const aoa = getInputDataRows()
  const sheet = XLSX.utils.aoa_to_sheet(aoa)
  sheet['!cols'] = Array(11)
    .fill(0)
    .map((_, i) => ({ wch: [12, 14, 10, 10, 10, 20, 18, 20, 20, 20, 20][i] ?? 14 }))
  return sheet
}

export function withWorkerFormulas(
  sCount: number,
  wCount: number,
  base: (string | null | number)[][]
) {
  const sheet = XLSX.utils.aoa_to_sheet(base)
  // First 0-based row of a WG data row: section title and WG header are two rows after last source
  const wgDataStart0 = 2 + sCount + 2
  for (let j = 0; j < wCount; j += 1) {
    // Excel 1-based row: aoa index 0 = row 1
    const excelR = 1 + wgDataStart0 + j
    const aD = `D${excelR}` as const
    const aH = `H${excelR}` as const
    const row0 = wgDataStart0 + j
    const dVal = base[row0]?.[3]
    const hVal = base[row0]?.[7]
    // Excel expects formulas without a leading =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sh = sheet as any
    if (dVal === '' || dVal == null || (typeof dVal === 'number' && !Number.isFinite(dVal))) {
      sh[aD] = { f: `B${excelR}+C${excelR}` }
    } else {
      sh[aD] = { t: 'n', v: Number(dVal) }
    }
    if (hVal === '' || hVal == null || (typeof hVal === 'number' && !Number.isFinite(hVal))) {
      sh[aH] = { f: `C${excelR}/8` }
    } else {
      sh[aH] = { t: 'n', v: Number(hVal) }
    }
  }
  sheet['!merges'] = [
    { s: { r: 0, c: 3 }, e: { r: 0, c: 9 } },
    { s: { r: 2 + sCount, c: 3 }, e: { r: 2 + sCount, c: 9 } },
  ]
  sheet['!cols'] = Array(10)
    .fill(0)
    .map((_, i) => ({ wch: [20, 14, 10, 14, 20, 16, 12, 20, 18, 20][i] ?? 12 }))
  return sheet
}

export function buildSourcesAoaFirst(plan: PlanState) {
  const explicit = (plan.sourceVolume ?? []).filter((s) => String(s.source ?? '').trim() !== '')
  const seen = new Set(explicit.map((s) => String(s.source ?? '').trim().toLowerCase()))
  const implied = (plan.sourceSummary ?? [])
    .map((r) => {
      const label = String(r.source ?? '').trim() || String(r.displayName ?? '').trim()
      return { r, label }
    })
    .filter(({ label }) => label !== '')
    .filter(({ label }) => !seen.has(label.toLowerCase()))
    .map(({ r, label }) => ({
      source: label,
      dailyVolumeGb: String(r.avgDailyGb ?? '').trim(),
      type: r.type ?? '',
      region: String(r.regions ?? '').trim(),
      currentCollection: '',
      criblCollection: '',
      wg: plan.workerGroups.find((w) => w.id === r.workerGroupId)?.wg ?? '',
      useCases: '',
      destinations: String(r.destinations ?? '').trim(),
      notes: '',
    }))
  const sources = [...explicit, ...implied]
  const sCount = sources.length
  const wCount = plan.workerGroups.length
  const aoa: (string | null | number)[][] = []
  aoa[0] = [null, null, null, 'Sources, Volume, Region', null, null, null, null, null, null]
  aoa[1] = [...SOURCES_WG_SOURCE_HEADERS]
  for (let i = 0; i < sCount; i += 1) {
    const s = sources[i]!
    aoa[2 + i] = [
      s.source,
      s.dailyVolumeGb ? Number(s.dailyVolumeGb) : '',
      s.type,
      s.region,
      s.currentCollection,
      s.criblCollection,
      s.wg,
      s.useCases,
      s.destinations,
      s.notes,
    ] as (string | number | null)[]
  }
  const secTitle = 2 + sCount
  aoa[secTitle] = [null, null, null, 'Worker Groups & Specs', null, null, null, null, null, null]
  const wgH = secTitle + 1
  aoa[wgH] = [...WORKER_HEADERS]
  for (let j = 0; j < wCount; j += 1) {
    const w = plan.workerGroups[j]!
    const cap = effectiveIngestEgressGbdForWg(plan, w)
    const tNum = w.throughputGbd?.trim() ? Number(w.throughputGbd) : Number.NaN
    const dNum = w.diskOneDayGb?.trim() ? Number(w.diskOneDayGb) : Number.NaN
    const tOverride = Number.isFinite(tNum) ? tNum : ''
    const dOverride = Number.isFinite(dNum) ? dNum : ''
    aoa[wgH + 1 + j] = [
      w.wg,
      cap?.ingestGb ?? (w.ingestGbd ? Number(w.ingestGbd) : ''),
      cap?.egressGb ?? (w.egressGbd ? Number(w.egressGbd) : ''),
      tOverride,
      w.workerHosting,
      w.workerCount,
      w.workerDetail,
      dOverride,
    ] as (string | number | null)[]
  }
  return { aoa, sCount, wCount }
}

export function buildWorkbookForPlan(plan: PlanState) {
  const { aoa, sCount, wCount } = buildSourcesAoaFirst(plan)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, instructionsSheet(), SHEET_INSTRUCTIONS)
  XLSX.utils.book_append_sheet(wb, buildSourceSummary(plan), SHEET_SOURCE_SUMMARY)
  XLSX.utils.book_append_sheet(wb, buildInputData(), SHEET_INPUT_DATA)
  XLSX.utils.book_append_sheet(
    wb,
    withWorkerFormulas(sCount, wCount, aoa),
    SHEET_COPY_SOURCES_WG,
  )
  // Meta
  if (!wb.Props) wb.Props = {}
  wb.Props.Title = titleForAdoptionPlanExport(plan)
  if (plan.customerName.trim()) {
    wb.Props.Subject = plan.customerName.trim()
  }
  return wb
}

export { planToBlobAsync, downloadXlsxForPlan, ExportShellUnavailableError } from './workbookDownload'
