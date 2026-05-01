import * as XLSX from 'xlsx'
import { defaultSourceRow } from './defaultState'
import {
  SHEET_COPY_SOURCES_WG,
  SHEET_COPY_SOURCES_WG_LEGACY,
  SHEET_COPY_SOURCES_WG_TRUNCATED_LEGACY,
  SHEET_SOURCE_SUMMARY,
} from './planWorkbookLayout'
import { newId, type PlanState, type SourceSummaryRow, type SourceVolumeRow, type WorkerGroupRow } from '../types/planTypes'
import { assignWorkerGroupIds } from './workerGroupIds'
import { buildSourceSummaryColumnMap, findColumnIndexByHeader } from './sourceSummaryColumnMap'
import { isWorkerSectionTitleRow, rowIsEffectivelyEmptyForTopo } from './topologySheetLayout'
import { buildTopologyColumnMap, buildWorkerColumnMap } from './topologyWorkbookMap'

export type ImportWorkbookResult =
  | { ok: true; plan: PlanState; warnings: string[] }
  | { ok: false; error: string }

function toBool(v: unknown): boolean {
  if (v === true || v === 1) {
    return true
  }
  if (v === false || v === 0) {
    return false
  }
  const t = String(v).trim().toLowerCase()
  return t === 'true' || t === 'yes' || t === 'y' || t === '1'
}

function excelSerialToIso(n: number): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (XLSX as any).SSF?.parse_date_code?.(n) as
    | { y: number; m: number; d: number; H?: number; M?: number; S?: number }
    | undefined
  if (!d) {
    return ''
  }
  const y = d.y
  const mo = String(d.m).padStart(2, '0')
  const day = String(d.d).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

function cellToString(v: unknown): string {
  if (v == null || v === '') {
    return ''
  }
  if (typeof v === 'number' && v > 20000 && v < 60000) {
    return excelSerialToIso(v)
  }
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10)
  }
  return String(v).trim()
}

function cellToNumStr(v: unknown): string {
  if (v == null || v === '') {
    return ''
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return String(v)
  }
  return String(v).trim()
}

/**
 * “Data optimization %” in Excel: percentage-formatted cells use raw 0.8 = 80%.
 * The app stores whole-number strings like "80" for 80%; normalize to match.
 */
function importPercentToAppString(v: unknown): string {
  if (v == null || v === '') {
    return ''
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 0 && v <= 1) {
      return String(Math.round(v * 100 * 100) / 100)
    }
    if (v > 1) {
      return String(v)
    }
    return v === 0 ? '0' : ''
  }
  const t = String(v).trim()
  if (!t) {
    return ''
  }
  const n = parseFloat(t.replace(/,/g, ''))
  if (Number.isFinite(n) && n > 0 && n <= 1) {
    return String(Math.round(n * 100 * 100) / 100)
  }
  return t
}

function normalizeVolumeType(t: string): '' | 'On-Prem' | 'Cloud/Internet' {
  const s = t.trim()
  if (!s) {
    return ''
  }
  const l = s.toLowerCase()
  if (l.includes('cloud') || l.includes('internet')) {
    return 'Cloud/Internet'
  }
  if (l.includes('on') && l.includes('prem')) {
    return 'On-Prem'
  }
  if (s === 'On-Prem' || s === 'Cloud/Internet') {
    return s
  }
  return ''
}

function parseHeaderRowFull(aoa: unknown[][], rowIndex: number): string[] {
  const raw = (aoa[rowIndex] as unknown[] | undefined) ?? []
  return raw.map((c) => (c == null ? '' : String(c).trim()))
}

function cellAt(row: unknown[] | undefined, i: number): unknown {
  if (i < 0 || !row) {
    return undefined
  }
  return row[i]
}

/** Text fields: trim only. (parse dates with `cellToString` in specific columns.) */
function strCell(row: unknown[] | undefined, i: number): string {
  if (i < 0 || !row) {
    return ''
  }
  const v = row[i]
  if (v == null) {
    return ''
  }
  return String(v).trim()
}

function strAtMap(row: unknown[] | undefined, col: Map<string, number>, name: string): string {
  const i = col.get(name) ?? -1
  return strCell(row, i)
}

function parseSourceSummarySheet(
  aoa: unknown[][],
  warnings: string[],
  defaultWorkerGroupId: string,
): SourceSummaryRow[] {
  if (aoa.length < 2) {
    warnings.push('Source summary: sheet is nearly empty; no source rows imported.')
    return []
  }
  const headerRow = 1
  const dataStart = 2
  const header = parseHeaderRowFull(aoa, headerRow)
  if (header.length < 1 || (header[0] === '' && !header.some((h) => h.length > 0))) {
    warnings.push('Source summary: header row (row 2) is empty; no source rows imported.')
    return []
  }
  const col = buildSourceSummaryColumnMap(header, warnings)
  if (findColumnIndexByHeader(header, 'Source') < 0) {
    return []
  }
  const out: SourceSummaryRow[] = []
  for (let r = dataStart; r < aoa.length; r += 1) {
    const row = aoa[r] as unknown[] | undefined
    if (!row) {
      break
    }
    const scanLen = Math.max(32, row.length, header.length)
    const allEmpty = row
      .slice(0, scanLen)
      .every((c) => c == null || String(c).trim() === '')
    if (allEmpty) {
      break
    }
    const base = defaultSourceRow(out.length, defaultWorkerGroupId)
    const typeIdx = col.get('Type') ?? -1
    const tRaw = strCell(row, typeIdx)
    // Physical location(s) [v0.9.1] takes precedence over Region(s) [v0.8.6];
    // both alias the same `physicalLocations` field on the import column map,
    // so this single read picks up whichever header the workbook uses.
    const physical = strAtMap(row, col, 'Physical location(s)') || strAtMap(row, col, 'Region(s)')
    out.push({
      ...base,
      id: newId(),
      workerGroupId: defaultWorkerGroupId,
      source: strAtMap(row, col, 'Source'),
      securityOrObs: strAtMap(row, col, 'Security or Observability or both data?'),
      streamOrEdge: strAtMap(row, col, 'Stream or Edge?'),
      type: normalizeVolumeType(tRaw) as SourceSummaryRow['type'],
      physicalLocations: physical,
      sourceTile: strAtMap(row, col, 'Source tile'),
      pipelineUsecase: strAtMap(row, col, 'Pipeline usecase'),
      destinations: strAtMap(row, col, 'Destinations'),
      retention: strAtMap(row, col, 'Retention'),
      avgDailyGb: cellToNumStr(cellAt(row, col.get('Average Daily Volume? (GB)') ?? -1)),
      complianceRelated: toBool(cellAt(row, col.get('Compliance related?') ?? -1)),
      dataCriticality: strAtMap(row, col, 'Data criticality'),
      stakeholders: strAtMap(row, col, 'Stakeholder(s) (team / line of business)'),
      currentCollection: strAtMap(row, col, 'Current Collection'),
      isCurrent: toBool(cellAt(row, col.get('Current?') ?? -1)),
      targetOnboardStart: cellToString(cellAt(row, col.get('Target Onboarding Start') ?? -1)),
      targetOnboardEnd: cellToString(cellAt(row, col.get('Target Onboarding End') ?? -1)),
      onboardingCompletedOn: cellToString(cellAt(row, col.get('Onboarding Completed On') ?? -1)),
      blockers: strAtMap(row, col, 'Blockers'),
      growth: strAtMap(row, col, 'Growth?'),
      dataOptPct: importPercentToAppString(cellAt(row, col.get('Data optimization %') ?? -1)),
      dataOptGb: cellToNumStr(cellAt(row, col.get('Data optimization (GB)') ?? -1)),
      initiativeCase: strAtMap(row, col, 'Initiative case'),
      technicalUsecase: strAtMap(row, col, 'Technical Use Case'),
      financial: strAtMap(row, col, 'Financial'),
      operational: strAtMap(row, col, 'Operational'),
      riskReduction: strAtMap(row, col, 'Risk Reduction'),
      strategic: strAtMap(row, col, 'Strategic'),
      onboardingEffort: strAtMap(row, col, 'Onboarding Effort'),
      politics: strAtMap(row, col, 'Politics'),
      // v0.9.1 only dropped two per-source columns from the gold template:
      // Display name and Additional notes. Both are read and discarded here
      // so v0.8.6 workbooks still import without losing the rest of the row.
    })
  }
  return out
}

function parseCopySourcesWg(
  aoa: unknown[][],
  warnings: string[],
): { sourceVolume: SourceVolumeRow[]; workerGroups: WorkerGroupRow[] } {
  if (aoa.length < 2) {
    warnings.push(`${SHEET_COPY_SOURCES_WG}: not enough rows; no topology or worker groups were imported.`)
    return { sourceVolume: [], workerGroups: [] }
  }
  const topHeader = parseHeaderRowFull(aoa, 1)
  const colTopo = buildTopologyColumnMap(topHeader, warnings)
  if (findColumnIndexByHeader(topHeader, 'Source') < 0) {
    return { sourceVolume: [], workerGroups: [] }
  }
  const colT = (name: string) => colTopo.get(name) ?? -1
  let r = 2
  for (; r < aoa.length; r += 1) {
    if (isWorkerSectionTitleRow(aoa[r] as unknown[] | undefined)) {
      break
    }
  }
  const vol: SourceVolumeRow[] = []
  for (let s = 2; s < r; s += 1) {
    const row = aoa[s] as unknown[] | undefined
    if (rowIsEffectivelyEmptyForTopo(row, 10)) {
      continue
    }
    const tIdx = colT('Type')
    const tRaw = tIdx >= 0 ? strCell(row, tIdx) : ''
    const dr: SourceVolumeRow = {
      id: newId(),
      workerGroupId: '',
      source: strCell(row, colT('Source')),
      dailyVolumeGb: cellToNumStr(cellAt(row, colT('Daily Volume (GB/day)'))),
      type: normalizeVolumeType(tRaw),
      region: strCell(row, colT('Region(s)')),
      currentCollection: strCell(row, colT('Current Collection')),
      criblCollection: strCell(row, colT('Cribl Collection')),
      wg: strCell(row, colT('WG')),
      useCases: strCell(row, colT('Use Case(s)')),
      destinations: strCell(row, colT('Destination(s)')),
      notes: strCell(row, colT('Notes')),
    }
    const emptyRow =
      !dr.source && !dr.dailyVolumeGb && !dr.type && !dr.region && !dr.wg && !dr.currentCollection
    if (!emptyRow) {
      vol.push(dr)
    }
  }
  if (r >= aoa.length || !isWorkerSectionTitleRow(aoa[r] as unknown[] | undefined)) {
    if (vol.length === 0) {
      return { sourceVolume: [], workerGroups: [] }
    }
    return { sourceVolume: vol, workerGroups: [] }
  }
  let wr = r + 1
  if (wr >= aoa.length) {
    return { sourceVolume: vol, workerGroups: [] }
  }
  const wh = parseHeaderRowFull(aoa, wr)
  const colWg = buildWorkerColumnMap(wh, warnings)
  if (findColumnIndexByHeader(wh, 'WG', 'Worker group', 'Worker Group') < 0) {
    return { sourceVolume: vol, workerGroups: [] }
  }
  const colW = (name: string) => colWg.get(name) ?? -1
  wr += 1
  const wgs: WorkerGroupRow[] = []
  for (; wr < aoa.length; wr += 1) {
    const row = aoa[wr] as unknown[] | undefined
    if (rowIsEffectivelyEmptyForTopo(row, 8)) {
      break
    }
    const wgName = strCell(row, colW('WG'))
    if (!wgName) {
      continue
    }
    wgs.push({
      id: newId(),
      // v0.8.6 topology only has worker groups; PR B's multi-sheet importer
      // sets `kind: 'edge'` for entries that come from `fl<name>_fleet`
      // sheets. Until then every imported row is a Stream worker group.
      kind: 'stream',
      wg: wgName,
      ingestGbd: cellToNumStr(cellAt(row, colW('Ingest (GB/day)'))),
      egressGbd: cellToNumStr(cellAt(row, colW('Egress (GB/Day)'))),
      throughputGbd: cellToNumStr(cellAt(row, colW('Throughput (GB/Day)'))),
      workerHosting: strCell(row, colW('Worker Hosting')),
      workerCount: strCell(row, colW('Worker Count')),
      workerDetail: strCell(row, colW('Worker Detail')),
      diskOneDayGb: cellToNumStr(cellAt(row, colW("Disk Req'd For 1 Day Storage"))),
    })
  }
  return {
    sourceVolume: vol,
    workerGroups: wgs,
  }
}

function aoaFromSheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheet: any,
  trimRows = true,
): unknown[][] {
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as unknown[][]
  if (!trimRows) {
    return aoa
  }
  let last = aoa.length - 1
  while (last > 0) {
    const r = aoa[last]
    if (r && r.some((c) => c != null && String(c).trim() !== '')) {
      break
    }
    last -= 1
  }
  return aoa.slice(0, last + 1)
}

/**
 * Parse an adoption plan .xlsx (same structure as our export) into a PlanState.
 * Safe to run in the browser or Node; pass an ArrayBuffer or shared Uint8Array.
 */
export function importAdoptionPlanXlsx(
  data: ArrayBuffer | Uint8Array,
): ImportWorkbookResult {
  const warnings: string[] = []
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let wb: any
  try {
    wb = XLSX.read(buf, { type: 'array', cellDates: true })
  } catch {
    return { ok: false, error: 'The file is not a valid .xlsx workbook (read failed).' }
  }
  const sn = (wb.SheetNames ?? []) as string[]
  const getSheet = (name: string) => (sn.includes(name) ? wb.Sheets[name] : null)
  const ss = getSheet(SHEET_SOURCE_SUMMARY)
  const cpy =
    getSheet(SHEET_COPY_SOURCES_WG) ||
    getSheet(SHEET_COPY_SOURCES_WG_LEGACY) ||
    getSheet(SHEET_COPY_SOURCES_WG_TRUNCATED_LEGACY)
  if (!ss) {
    return { ok: false, error: `Required sheet “${SHEET_SOURCE_SUMMARY}” is missing. Use an export from this app or the official template.` }
  }
  if (!cpy) {
    warnings.push(
      `Optional topology sheet (“${SHEET_COPY_SOURCES_WG}”, “${SHEET_COPY_SOURCES_WG_LEGACY}”, or legacy “${SHEET_COPY_SOURCES_WG_TRUNCATED_LEGACY}”) is missing; volume and worker data were not imported.`,
    )
  }

  const aoaSS = aoaFromSheet(ss)
  const customerName =
    typeof wb.Props?.Subject === 'string' && wb.Props.Subject.trim()
      ? String(wb.Props.Subject).trim()
      : ''
  const topology = cpy
    ? parseCopySourcesWg(aoaFromSheet(cpy), warnings)
    : { sourceVolume: [] as SourceVolumeRow[], workerGroups: [] as WorkerGroupRow[] }

  const sourceSummary = parseSourceSummarySheet(aoaSS, warnings, '')

  const plan: PlanState = assignWorkerGroupIds({
    version: 1,
    customerName,
    cseNotes: '',
    sourceSummary,
    sourceVolume: topology.sourceVolume,
    workerGroups: topology.workerGroups,
  })
  return { ok: true, plan, warnings }
}
