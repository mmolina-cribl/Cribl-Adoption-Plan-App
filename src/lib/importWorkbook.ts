import * as XLSX from 'xlsx'
import { defaultActivation, defaultSourceRow } from './defaultState'
import {
  SHEET_COPY_SOURCES_WG,
  SHEET_COPY_SOURCES_WG_LEGACY,
  SHEET_COPY_SOURCES_WG_TRUNCATED_LEGACY,
  SHEET_EDGE_OVERVIEW_V091,
  SHEET_SOURCE_SUMMARY,
  SHEET_STREAM_OVERVIEW_V091,
  V091_OVERVIEW_TABLE2_FIRST_DATA_ROW,
  V091_OVERVIEW_TABLE2_HEADER_ROW,
} from './planWorkbookLayout'
import {
  PS_BASE_SCOPE_ITEMS,
  PS_BASE_SCOPE_WORKSHEET_FIRST_ROW,
  PS_BASE_SCOPE_WORKSHEET_LABELS,
  PS_BLOCK1_FIRST_DATA_ROW,
  PS_BLOCK2_FIRST_DATA_ROW,
  PS_COL_DELIVERABLE_OR_PARAMS,
  PS_COL_NOTES,
  PS_COL_STATUS,
  PS_COL_USECASE_NUMBER,
  PS_PARAMETERS_PER_USE_CASE,
  PS_USE_CASE_COUNT,
  PS_USE_CASE_WORKSHEET_FIRST_ROW,
  SHEET_PS_USE_CASE_WORKSHEET,
} from './psUseCaseLayout'
import { backfillActivation } from './activationNormalize'
import {
  newId,
  type Activation,
  type ActivationBaseScopeRow,
  type ActivationUseCase,
  type ActivationUseCaseOverviewRow,
  type ActivationWorksheetRow,
  type PlanState,
  type SourceSummaryRow,
  type SourceVolumeRow,
  type WorkerGroupKind,
  type WorkerGroupRow,
} from '../types/planTypes'
import { assignWorkerGroupIds } from './workerGroupIds'
import { buildSourceSummaryColumnMap, findColumnIndexByHeader } from './sourceSummaryColumnMap'
import { isWorkerSectionTitleRow, rowIsEffectivelyEmptyForTopo } from './topologySheetLayout'
import { buildTopologyColumnMap, buildWorkerColumnMap } from './topologyWorkbookMap'
import { classifyV091SheetName } from './v091SheetNames'

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
  const sourceColIdx = col.get('Source') ?? -1
  const out: SourceSummaryRow[] = []
  for (let r = dataStart; r < aoa.length; r += 1) {
    const row = aoa[r] as unknown[] | undefined
    if (!row) {
      continue
    }
    // A real source row always has a non-empty `Source` name. The gold
    // v0.9.1 empty shell ships each per-WG / per-Fleet sub-sheet with a
    // 19-row scaffold of pre-formatted-but-unfilled rows (data-validation
    // dropdowns and conditional formatting are pre-applied so the user
    // sees a usable grid before filling anything in). Those rows have
    // some cells populated by Excel's defaults (e.g. Type's dropdown
    // anchor, retention placeholder), so the previous "all-cells-empty"
    // break would not trigger and we'd import them as 19 × N phantom
    // sources. Gating on Source-non-empty also fixes the same shape on
    // v0.8.6 imports (no real source row was ever nameless).
    if (sourceColIdx < 0 || strCell(row, sourceColIdx) === '') {
      continue
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
      additionalNotes: strAtMap(row, col, 'Additional notes'),
      // The v0.8.6 schema's `Display name` column is the only one we
      // intentionally drop on import — every other gold column round-trips
      // through `SourceSummaryRow`. v0.9.1 reinstated `Additional notes`
      // (read above) after it was briefly dropped in v0.9.0.
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
      // sets `kind: 'edge'` for entries that come from `fl-<name>` sheets
      // (or legacy `fl<name>_fleet`). Until then every imported row is a
      // Stream worker group.
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

// ─── v0.9.1 multi-sheet parser ────────────────────────────────────────────

/**
 * Schema version detected on a workbook handed to {@link importAdoptionPlanXlsx}.
 *
 * The detector is intentionally biased toward v0.9.1 — if any of the new
 * sheet markers are present we treat the whole workbook as v0.9.1 even if
 * the v0.8.6 `Source summary` / `Copy of Sources and WGs` sheets are also
 * present (the gold v0.8.6 → v0.9.1 migration script left some workbooks
 * with both shapes side by side, and v0.9.1 always wins).
 */
type ImportSchemaVersion = 'v0.9.1' | 'v0.8.6' | 'unknown'

function detectSchemaVersion(sheetNames: string[]): ImportSchemaVersion {
  if (sheetNames.includes(SHEET_STREAM_OVERVIEW_V091)) {
    return 'v0.9.1'
  }
  if (sheetNames.includes(SHEET_EDGE_OVERVIEW_V091)) {
    return 'v0.9.1'
  }
  if (sheetNames.some((n) => classifyV091SheetName(n) !== null)) {
    return 'v0.9.1'
  }
  if (sheetNames.includes(SHEET_SOURCE_SUMMARY)) {
    return 'v0.8.6'
  }
  return 'unknown'
}

/**
 * Result of parsing one Stream Overview / Edge Overview spec table (the lower
 * table at row 16 onward). Keys are the lowercase, trimmed display name in
 * column A; values are the raw capacity strings ready to drop straight onto a
 * matching {@link WorkerGroupRow}. Display names are the post-prefix /
 * post-suffix body — e.g. `wg-default` (or legacy `wgdefault`) produces
 * key `default`.
 */
type OverviewSpecCapacity = {
  ingestGbd: string
  egressGbd: string
  throughputGbd: string
  workerHosting: string
  workerCount: string
  workerDetail: string
  diskOneDayGb: string
}

function parseOverviewSpecTable(
  aoa: unknown[][],
  warnings: string[],
  overviewLabel: string,
): Map<string, OverviewSpecCapacity> {
  // Both Stream Overview and Edge Overview put the spec-table header on row
  // 16 (1-based) with data starting on row 17. We tolerate the header
  // sliding ±2 rows in case a customer manually inserted a row above it.
  const headerRowIdx = (() => {
    const target = V091_OVERVIEW_TABLE2_HEADER_ROW - 1 // 0-based
    for (let i = Math.max(0, target - 2); i < Math.min(aoa.length, target + 3); i += 1) {
      const row = aoa[i] as unknown[] | undefined
      if (!row) {
        continue
      }
      const header = row.map((c) => (c == null ? '' : String(c).trim()))
      const a = header[0]?.toLowerCase()
      const b = header[1]?.toLowerCase()
      if ((a === 'wg' || a === 'fl') && b === 'ingest (gb/day)') {
        return i
      }
    }
    return -1
  })()
  const out = new Map<string, OverviewSpecCapacity>()
  if (headerRowIdx < 0) {
    warnings.push(
      `${overviewLabel}: spec table header (row 16) not found; ingest / egress / hosting capacity not imported.`,
    )
    return out
  }
  const dataStart =
    headerRowIdx + 1 + (V091_OVERVIEW_TABLE2_FIRST_DATA_ROW - V091_OVERVIEW_TABLE2_HEADER_ROW) - 1
  for (let r = dataStart; r < aoa.length; r += 1) {
    const row = aoa[r] as unknown[] | undefined
    if (rowIsEffectivelyEmptyForTopo(row, 8)) {
      continue
    }
    const name = strCell(row, 0)
    if (!name) {
      continue
    }
    const key = name.trim().toLowerCase()
    if (out.has(key)) {
      // First write wins; subsequent rows with the same display name are
      // ignored. This shouldn't happen on a well-formed file but guards
      // against the gold's old "phantom row" pattern (capacity rows without
      // a matching per-WG sheet).
      continue
    }
    out.set(key, {
      ingestGbd: cellToNumStr(cellAt(row, 1)),
      egressGbd: cellToNumStr(cellAt(row, 2)),
      throughputGbd: cellToNumStr(cellAt(row, 3)),
      workerHosting: strCell(row, 4),
      workerCount: strCell(row, 5),
      workerDetail: strCell(row, 6),
      diskOneDayGb: cellToNumStr(cellAt(row, 7)),
    })
  }
  return out
}

/**
 * Apply capacity from a parsed overview spec table onto every WG / Fleet row
 * of the matching `kind`. Display-name match is case-insensitive on the
 * sheet-name body (the importer set `wg.wg` to that body when the per-WG
 * sheet was discovered).
 *
 * Capacity fields are only written if the parsed value is non-empty so a
 * partially-filled overview table doesn't blank out per-WG data the
 * exporter put there from a previous round-trip.
 */
function applyOverviewCapacity(
  workerGroups: WorkerGroupRow[],
  capacity: Map<string, OverviewSpecCapacity>,
  kind: WorkerGroupKind,
): void {
  for (const wg of workerGroups) {
    if (wg.kind !== kind) {
      continue
    }
    const cap = capacity.get(wg.wg.trim().toLowerCase())
    if (!cap) {
      continue
    }
    if (cap.ingestGbd) wg.ingestGbd = cap.ingestGbd
    if (cap.egressGbd) wg.egressGbd = cap.egressGbd
    if (cap.throughputGbd) wg.throughputGbd = cap.throughputGbd
    if (cap.workerHosting) wg.workerHosting = cap.workerHosting
    if (cap.workerCount) wg.workerCount = cap.workerCount
    if (cap.workerDetail) wg.workerDetail = cap.workerDetail
    if (cap.diskOneDayGb) wg.diskOneDayGb = cap.diskOneDayGb
  }
}

/**
 * v0.9.1 multi-sheet importer.
 *
 * Per-WG (`wg-<name>`) and per-Fleet (`fl-<name>`) sheets are the source
 * of truth for both worker-group identity and per-source data. Pre-v2.0.0
 * legacy workbooks used `wg<name>` / `fl<name>_fleet`; the classifier in
 * {@link classifyV091SheetName} accepts both forms so older customer
 * exports still round-trip cleanly. Each sheet is parsed with the same
 * {@link parseSourceSummarySheet} the v0.8.6 path uses (the column
 * titles overlap intentionally) — the only thing the v0.9.1
 * dispatcher adds is associating every parsed source row with the right
 * `workerGroupId` from the start.
 *
 * `Stream Overview` / `Edge Overview` are read for capacity only. The top
 * table (rolled-up sources) is intentionally ignored because it's a write-
 * only artifact the exporter regenerates each save.
 */
function parseV091Workbook(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wb: any,
  sheetNames: string[],
  warnings: string[],
): { sourceSummary: SourceSummaryRow[]; workerGroups: WorkerGroupRow[] } {
  const workerGroups: WorkerGroupRow[] = []
  const sourceSummary: SourceSummaryRow[] = []

  for (const name of sheetNames) {
    const cls = classifyV091SheetName(name)
    if (!cls) {
      continue
    }
    const wgId = newId()
    workerGroups.push({
      id: wgId,
      kind: cls.kind,
      wg: cls.displayName,
      ingestGbd: '',
      egressGbd: '',
      throughputGbd: '',
      workerHosting: '',
      workerCount: '',
      workerDetail: '',
      diskOneDayGb: '',
    })
    const sheet = wb.Sheets[name]
    if (!sheet) {
      continue
    }
    const aoa = aoaFromSheet(sheet)
    // `parseSourceSummarySheet` reads the v0.9.1 row-2 header layout
    // (A=Source, B=Physical location(s), …) via the column-name map. Each
    // sheet's source rows are tagged with this WG / Fleet's id so post-pass
    // `assignWorkerGroupIds` short-circuits them through.
    const rows = parseSourceSummarySheet(aoa, warnings, wgId)
    sourceSummary.push(...rows)
  }

  if (workerGroups.length === 0) {
    warnings.push(
      'v0.9.1 workbook detected but no per-WG (`wg*`) or per-Fleet (`fl*_fleet`) sheets were found; nothing imported.',
    )
  }

  const streamSheet = sheetNames.includes(SHEET_STREAM_OVERVIEW_V091)
    ? wb.Sheets[SHEET_STREAM_OVERVIEW_V091]
    : null
  if (streamSheet) {
    const cap = parseOverviewSpecTable(
      aoaFromSheet(streamSheet, false),
      warnings,
      SHEET_STREAM_OVERVIEW_V091,
    )
    applyOverviewCapacity(workerGroups, cap, 'stream')
  }

  const edgeSheet = sheetNames.includes(SHEET_EDGE_OVERVIEW_V091)
    ? wb.Sheets[SHEET_EDGE_OVERVIEW_V091]
    : null
  if (edgeSheet) {
    const cap = parseOverviewSpecTable(
      aoaFromSheet(edgeSheet, false),
      warnings,
      SHEET_EDGE_OVERVIEW_V091,
    )
    applyOverviewCapacity(workerGroups, cap, 'edge')
  }

  return { workerGroups, sourceSummary }
}

/**
 * Read a single cell as a trimmed string. Tolerates `null`, numbers,
 * and Date values the same way the rest of the importer does.
 */
function aoaCell(aoa: unknown[][], row1Based: number, col1Based: number): string {
  const row = aoa[row1Based - 1]
  if (!row) return ''
  return cellToString(row[col1Based - 1])
}

/**
 * Parse the gold v0.9.1 `PS Use Case Worksheet` sheet into an
 * `Activation` value. Reads only the customer-editable cells (Status,
 * Notes, Parameters, Use Case kind picks); the static labels in
 * column A / B and every banner / header row are ignored at parse
 * time because the gold layout is fixed and the constants in
 * `psUseCaseLayout.ts` are the source of truth.
 *
 * Tier is intentionally NOT read from the sheet — the gold has no
 * cell for it. Imported plans land with `tier: null` and the user
 * re-picks via the modal-first tier picker on the Activation page.
 */
function parsePsUseCaseWorksheet(aoa: unknown[][]): Activation {
  const baseScope: ActivationBaseScopeRow[] = []
  for (let i = 0; i < PS_BASE_SCOPE_ITEMS.length; i += 1) {
    const r = PS_BLOCK1_FIRST_DATA_ROW + i
    baseScope.push({
      // Coerced to a valid ActivationStatus by `backfillActivation`.
      status: aoaCell(aoa, r, PS_COL_STATUS) as ActivationBaseScopeRow['status'],
      notes: aoaCell(aoa, r, PS_COL_NOTES),
    })
  }

  const useCaseOverview: ActivationUseCaseOverviewRow[] = []
  for (let i = 0; i < PS_USE_CASE_COUNT; i += 1) {
    const r = PS_BLOCK2_FIRST_DATA_ROW + i
    // Block 2 stores the kind picker in column B (PS_COL_USECASE_NUMBER).
    useCaseOverview.push({ kind: aoaCell(aoa, r, PS_COL_USECASE_NUMBER) })
  }

  const baseScopeWorksheet: ActivationWorksheetRow[] = []
  for (let i = 0; i < PS_BASE_SCOPE_WORKSHEET_LABELS.length; i += 1) {
    const r = PS_BASE_SCOPE_WORKSHEET_FIRST_ROW + i
    baseScopeWorksheet.push({
      parameters: aoaCell(aoa, r, PS_COL_DELIVERABLE_OR_PARAMS),
      status: aoaCell(aoa, r, PS_COL_STATUS) as ActivationWorksheetRow['status'],
      notes: aoaCell(aoa, r, PS_COL_NOTES),
    })
  }

  const useCases: ActivationUseCase[] = []
  for (let uc = 0; uc < PS_USE_CASE_COUNT; uc += 1) {
    const parameters: ActivationWorksheetRow[] = []
    for (let p = 0; p < PS_PARAMETERS_PER_USE_CASE; p += 1) {
      const r = PS_USE_CASE_WORKSHEET_FIRST_ROW + uc * PS_PARAMETERS_PER_USE_CASE + p
      parameters.push({
        parameters: aoaCell(aoa, r, PS_COL_DELIVERABLE_OR_PARAMS),
        status: aoaCell(aoa, r, PS_COL_STATUS) as ActivationWorksheetRow['status'],
        notes: aoaCell(aoa, r, PS_COL_NOTES),
      })
    }
    useCases.push({ parameters })
  }

  // backfillActivation sanitizes everything — invalid Status strings
  // collapse to "Not Started", unknown kinds collapse to "Other",
  // and arrays are padded/truncated to the gold's exact shape.
  return backfillActivation({
    tier: null,
    baseScope,
    useCaseOverview,
    baseScopeWorksheet,
    useCases,
  })
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
  const customerName =
    typeof wb.Props?.Subject === 'string' && wb.Props.Subject.trim()
      ? String(wb.Props.Subject).trim()
      : ''

  const schema = detectSchemaVersion(sn)

  if (schema === 'v0.9.1') {
    const v091 = parseV091Workbook(wb, sn, warnings)
    // PS Use Case Worksheet may be missing on customer-trimmed templates;
    // fall back to the default empty Activation in that case so the
    // import doesn't fail.
    const psSheet = sn.includes(SHEET_PS_USE_CASE_WORKSHEET)
      ? wb.Sheets[SHEET_PS_USE_CASE_WORKSHEET]
      : null
    const activation = psSheet
      ? parsePsUseCaseWorksheet(aoaFromSheet(psSheet, false))
      : defaultActivation()
    const plan: PlanState = assignWorkerGroupIds({
      version: 1,
      customerName,
      cseNotes: '',
      sourceSummary: v091.sourceSummary,
      // v0.9.1 workbooks don't carry the legacy `Copy of Sources and WGs`
      // topology sheet; per-WG / per-Fleet sheets cover the same ground via
      // `sourceSummary`. Volume rollup remains an empty array on import and
      // the app fills it lazily where it still consumes the legacy shape.
      sourceVolume: [],
      workerGroups: v091.workerGroups,
      activation,
    })
    return { ok: true, plan, warnings }
  }

  if (schema === 'v0.8.6') {
    const ss = wb.Sheets[SHEET_SOURCE_SUMMARY]
    const cpy =
      wb.Sheets[SHEET_COPY_SOURCES_WG] ||
      wb.Sheets[SHEET_COPY_SOURCES_WG_LEGACY] ||
      wb.Sheets[SHEET_COPY_SOURCES_WG_TRUNCATED_LEGACY]
    if (!cpy) {
      warnings.push(
        `Optional topology sheet (“${SHEET_COPY_SOURCES_WG}”, “${SHEET_COPY_SOURCES_WG_LEGACY}”, or legacy “${SHEET_COPY_SOURCES_WG_TRUNCATED_LEGACY}”) is missing; volume and worker data were not imported.`,
      )
    }

    const aoaSS = aoaFromSheet(ss)
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
      // v0.8.6 workbooks predate the PS Use Case Worksheet feature; the
      // sheet may exist (the gold ships an empty one) but it isn't read
      // here. Always default to an empty Activation; if the user later
      // re-imports a v0.9.1 workbook the activation block will be
      // hydrated from the gold sheet.
      activation: defaultActivation(),
    })
    return { ok: true, plan, warnings }
  }

  return {
    ok: false,
    error:
      'Could not identify this workbook as a supported adoption plan template. ' +
      `Expected either a v0.9.1 file (with “${SHEET_STREAM_OVERVIEW_V091}” / “${SHEET_EDGE_OVERVIEW_V091}” or per-WG sheets) ` +
      `or a v0.8.6 file (with “${SHEET_SOURCE_SUMMARY}”).`,
  }
}
