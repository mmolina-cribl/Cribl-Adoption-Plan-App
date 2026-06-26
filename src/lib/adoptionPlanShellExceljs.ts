/**
 * Fills a shell `.xlsx` in-place with ExcelJS so **styles, themes, and merges** from the
 * template (import or empty v0.8.6) survive. The community `xlsx` package does not.
 */
import { Buffer } from 'buffer'
import ExcelJS from 'exceljs'
import {
  ALL_SOURCE_IMPORT_HEADER_NAMES,
  SHEET_COPY_SOURCES_WG,
  SHEET_COPY_SOURCES_WG_LEGACY,
  SHEET_COPY_SOURCES_WG_TRUNCATED_LEGACY,
  SHEET_SOURCE_SUMMARY,
  COPY_SOURCES_WG_TEMPLATE_WG_DATA_ROW_SLOTS,
  SOURCES_WG_SOURCE_HEADERS,
  WORKER_HEADERS,
} from './planWorkbookLayout'
import type { PlanState, SourceVolumeRow, WorkerGroupRow } from '../types/planTypes'
import { buildTopologyColumnMap, buildWorkerColumnMap } from './topologyWorkbookMap'
import { scanCopySourcesWgFromAoa } from './topologySheetLayout'
import { sourceSummaryValueForHeaderName, titleForAdoptionPlanExport } from './exportWorkbook'
import {
  sourceNameForAdoptionPlanExport,
  sourceNameForAdoptionPlanExportFromLabel,
} from './sourceAttachmentDisabled'
import { buildSourceSummaryColumnMap } from './sourceSummaryColumnMap'
import { mergeOoxmlStylePartsFromOriginal } from './shellOoxmlStyleMerge'
import {
  effectiveDiskOneDayGbForWg,
  effectiveIngestEgressGbdForWg,
  effectiveThroughputGbdForWg,
} from './workerGroupRollup'

function sourcesForTopology(plan: PlanState): SourceVolumeRow[] {
  const explicit = (plan.sourceVolume ?? []).filter((s) => String(s.source ?? '').trim() !== '')
  const seen = new Set(explicit.map((s) => String(s.source ?? '').trim().toLowerCase()))
  const implied = (plan.sourceSummary ?? [])
    .map((r) => ({ r, label: String(r.source ?? '').trim() }))
    .filter(({ label }) => label !== '')
    .filter(({ label }) => !seen.has(label.toLowerCase()))
    .map(({ r }) => {
      const wgName = plan.workerGroups.find((w) => w.id === r.workerGroupId)?.wg ?? ''
      return {
        id: '',
        workerGroupId: r.workerGroupId ?? '',
        source: sourceNameForAdoptionPlanExport(r),
        dailyVolumeGb: String(r.avgDailyGb ?? '').trim(),
        type: r.type ?? '',
        region: String(r.physicalLocations ?? '').trim(),
        currentCollection: String(r.currentCollection ?? '').trim(),
        criblCollection: '',
        wg: wgName,
        useCases: '',
        destinations: String(r.destinations ?? '').trim(),
        notes: '',
      } satisfies SourceVolumeRow
    })
  return [...explicit, ...implied]
}

// NOTE: We intentionally avoid setting fonts in ExcelJS here.
// The export pipeline merges `styles.xml` back from the shell after ExcelJS writes, which would
// invalidate any new style indices ExcelJS created for per-cell fonts.

function getCellValueForAoa(cell: ExcelJS.Cell): unknown {
  const v = cell.value
  if (v == null) {
    return null
  }
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return v
  }
  if (v instanceof Date) {
    return v
  }
  if (typeof v === 'object' && v !== null) {
    const f = (v as { result?: unknown }).result
    if (f != null) {
      return f
    }
  }
  return (cell as { text?: string }).text ?? String(v)
}

/**
 * 0-based row0 = aoa[0] = Excel R1, maxCols ~10, maxRows 120.
 */
function worksheetToAoa(ws: ExcelJS.Worksheet, maxRows: number, maxC: number): unknown[][] {
  const aoa: unknown[][] = []
  for (let r1 = 1; r1 <= maxRows; r1 += 1) {
    const row = ws.getRow(r1)
    const arr: unknown[] = []
    for (let c = 1; c <= maxC; c += 1) {
      const cell = row.getCell(c)
      if (cell.value == null) {
        arr.push('')
      } else {
        const v = getCellValueForAoa(cell)
        if (v == null || (typeof v === 'string' && v.trim() === '')) {
          arr.push('')
        } else {
          arr.push(v)
        }
      }
    }
    aoa.push(arr)
  }
  return aoa
}

function parseNumberLoose(s: string | undefined): number | null {
  if (!s) return null
  const t = s.trim()
  if (!t) return null
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function sourceVolumeValueForHeaderName(name: string, s: SourceVolumeRow): string | number {
  switch (name) {
    case 'Source':
      return sourceNameForAdoptionPlanExportFromLabel(s.source)
    case 'Daily Volume (GB/day)':
      return parseNumberLoose(s.dailyVolumeGb) ?? ''
    case 'Type':
      return s.type
    case 'Region(s)':
      return s.region
    case 'Current Collection':
      return s.currentCollection
    case 'Cribl Collection':
      return s.criblCollection
    case 'WG':
      return s.wg
    case 'Use Case(s)':
      return s.useCases
    case 'Destination(s)':
      return s.destinations
    case 'Notes':
      return s.notes
    default:
      return ''
  }
}

function workerGroupValueForHeaderName(name: string, plan: PlanState, w: WorkerGroupRow): string | number {
  const throughput = effectiveThroughputGbdForWg(plan, w) ?? ''
  const diskOneDay = effectiveDiskOneDayGbForWg(plan, w) ?? ''
  const cap = effectiveIngestEgressGbdForWg(plan, w)
  switch (name) {
    case 'WG':
      return w.wg
    case 'Ingest (GB/day)':
      return (cap?.ingestGb ?? parseNumberLoose(w.ingestGbd)) ?? ''
    case 'Egress (GB/Day)':
      return (cap?.egressGb ?? parseNumberLoose(w.egressGbd)) ?? ''
    case 'Throughput (GB/Day)':
      return throughput
    case 'Worker Hosting':
      return w.workerHosting
    case 'Worker Count':
      return w.workerCount
    case 'Worker Detail':
      return w.workerDetail
    case "Disk Req'd For 1 Day Storage":
      return diskOneDay
    default:
      return ''
  }
}

/** D–J in row 0-based `row0` of the topology aoa (Cribl: merged title in column D). */
function sectionTitleTextFromAoaD(aoa: unknown[][], row0: number): string | null {
  const row = aoa[row0] as unknown[] | undefined
  const t = String(row?.[3] ?? '').trim()
  return t || null
}

/** After `unmerge`, E–J can still hold old values; clear A–J then set D1 = `title` (merges are applied after). */
function clearAndSetDthroughJtitleRow(ws: ExcelJS.Worksheet, row1Based: number, title: string) {
  const r = ws.getRow(row1Based)
  for (let c = 1; c <= 10; c += 1) {
    r.getCell(c).value = null
  }
  r.getCell(4).value = title
}

/**
 * Unmerge only the D:J title cell merges (not the full sheet) so we can fix title text. A broad
 * unmerge(1,4,200,10) can make Excel/ExcelJS round-trip look “unstyled” after re-save.
 */
function unmergeTopologyDthroughJtitleRows(ws: ExcelJS.Worksheet, workerTitleRow0: number | null) {
  const unmergeRow = (row1: number) => {
    try {
      ws.unMergeCells(row1, 4, row1, 10)
    } catch {
      /* not a merged D:J in this range */
    }
  }
  unmergeRow(1)
  if (workerTitleRow0 != null) {
    unmergeRow(1 + workerTitleRow0)
  }
}

function setTopologyMerges(ws: ExcelJS.Worksheet, newWorkerTitleRow0: number | null) {
  // Row/col 1-based; D:J = columns 4–10; row 0-based index -> Excel row = row0 + 1
  try {
    ws.mergeCells(1, 4, 1, 10)
  } catch {
    /* */
  }
  if (newWorkerTitleRow0 == null) {
    return
  }
  const r1 = 1 + newWorkerTitleRow0
  try {
    ws.mergeCells(r1, 4, r1, 10)
  } catch {
    /* */
  }
}

function setTopologyFormulas(ws: ExcelJS.Worksheet, wgd0: number, wCount: number, plan: PlanState) {
  for (let j = 0; j < wCount; j += 1) {
    const row0 = wgd0 + j
    const excelR = row0 + 1
    const w = plan.workerGroups[j]!
    const dVal = parseNumberLoose(w.throughputGbd) ?? ''
    const hVal = parseNumberLoose(w.diskOneDayGb) ?? ''
    const dCell = ws.getRow(excelR).getCell(4)
    const hCell = ws.getRow(excelR).getCell(8)
    if (dVal === '' || dVal == null || (typeof dVal === 'number' && !Number.isFinite(dVal as number))) {
      dCell.value = { formula: `B${excelR}+C${excelR}` }
    } else {
      dCell.value = Number(dVal)
    }
    if (hVal === '' || hVal == null || (typeof hVal === 'number' && !Number.isFinite(hVal as number))) {
      hCell.value = { formula: `C${excelR}/8` }
    } else {
      hCell.value = Number(hVal)
    }
  }
}

/** Row 2 (1-based): Source summary column headers as trimmed strings, one per Excel column. */
function readSourceSummaryHeaderRow1Based(ws: ExcelJS.Worksheet): string[] {
  const row = ws.getRow(2)
  const maxC = Math.max(row.cellCount, 32)
  const out: string[] = []
  for (let c = 1; c <= maxC; c += 1) {
    const cell = row.getCell(c)
    const v = cell.value
    if (v == null) {
      out.push('')
      continue
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out.push(String(v).trim())
      continue
    }
    if (v instanceof Date) {
      out.push(v.toISOString().slice(0, 10))
      continue
    }
    if (typeof v === 'object' && v !== null) {
      const f = (v as { result?: unknown }).result
      if (f != null) {
        out.push(String(f).trim())
        continue
      }
      if ('richText' in (v as object)) {
        const t = (cell as { text?: string }).text
        if (t != null) {
          out.push(t.trim())
          continue
        }
      }
    }
    out.push(String(v).trim())
  }
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop()
  }
  return out
}

function setCellValuePlan(
  cell: ExcelJS.Cell,
  v: string | number | boolean | Date | null | undefined,
  row: number,
) {
  if (v === null || v === undefined) {
    if (row <= 1) {
      return
    }
    cell.value = null
    return
  }
  if (typeof v === 'boolean') {
    cell.value = v
    return
  }
  if (v instanceof Date) {
    cell.value = v
    return
  }
  if (v === '' && row === 0) {
    return
  }
  cell.value = v
}

function fillTopologyByTemplate(
  ws: ExcelJS.Worksheet,
  plan: PlanState,
  topoWarnings: string[],
): void {
  const aoa = worksheetToAoa(ws, 120, 10)
  const layout = scanCopySourcesWgFromAoa(aoa, topoWarnings)
  if (layout == null) {
    return
  }

  const wtr0 = layout.workerTitleRow0
  unmergeTopologyDthroughJtitleRows(ws, wtr0)
  const sources = sourcesForTopology(plan)
  const sCount = sources.length
  const wCount = plan.workerGroups.length
  if (wtr0 == null) {
    const srcHeader: string[] = aoa[1]!.map((c) => (c == null ? '' : String(c).trim()))
    const colS = buildTopologyColumnMap(srcHeader, topoWarnings)
    for (let i = 0; i < sCount; i += 1) {
      for (const name of SOURCES_WG_SOURCE_HEADERS) {
        const cIdx = colS.get(name) ?? -1
        if (cIdx < 0) {
          continue
        }
        const r0 = 2 + i
        const v = sourceVolumeValueForHeaderName(
          name,
          sources[i]!,
        ) as string | number
        const cell = ws.getRow(1 + r0).getCell(1 + cIdx)
        cell.value = (v === '' || v == null) ? null : (v as ExcelJS.CellValue)
      }
    }
    const topTitle = sectionTitleTextFromAoaD(aoa, 0) ?? 'Sources, Volume, Region'
    clearAndSetDthroughJtitleRow(ws, 1, topTitle)
    setTopologyMerges(ws, null)
    return
  }

  const sourcesBlockTitle = sectionTitleTextFromAoaD(aoa, 0) ?? 'Sources, Volume, Region'
  const workerBlockTitle = sectionTitleTextFromAoaD(aoa, wtr0) ?? 'Worker Groups & Specs'
  const firstSource0 = 2
  const slots = Math.max(0, wtr0 - firstSource0)
  const toInsert = Math.max(0, sCount - slots)
  if (toInsert > 0) {
    const pos1 = 1 + wtr0
    const newRows: string[][] = []
    for (let n = 0; n < toInsert; n += 1) {
      newRows.push(new Array(10).fill(''))
    }
    // Copy the style of the row above the insertion point (template blank source rows)
    // so inserted rows keep borders, data validation visuals, etc.
    ws.insertRows(pos1, newRows, 'i+')
  }

  const newWtr0 = wtr0 + toInsert
  const wgh0 = newWtr0 + 1
  const wgd0 = wgh0 + 1
  const wCol = topoWarnings
  const srcHeader: string[] = aoa[1]!.map((c) => (c == null ? '' : String(c).trim()))
  const colS = buildTopologyColumnMap(srcHeader, wCol)
  const wgHeader1Based = 1 + wgh0
  const wgRow = ws.getRow(wgHeader1Based)
  const wgHeader: string[] = []
  for (let c = 1; c <= 10; c += 1) {
    const v = getCellValueForAoa(wgRow.getCell(c))
    wgHeader.push(v == null || v === '' ? '' : String(v).trim())
  }
  const colWgWarn: string[] = []
  const colW = buildWorkerColumnMap(wgHeader, colWgWarn)
  topoWarnings.push(...colWgWarn)
  for (let u = firstSource0 + sCount; u < newWtr0; u += 1) {
    for (let c = 1; c <= 10; c += 1) {
      ws.getRow(1 + u)
        .getCell(c)
        .value = null
    }
  }
  for (let i = 0; i < sCount; i += 1) {
    const r0 = 2 + i
    for (const name of SOURCES_WG_SOURCE_HEADERS) {
      const cIdx = colS.get(name) ?? -1
      if (cIdx < 0) {
        continue
      }
      const v = sourceVolumeValueForHeaderName(
        name,
        sources[i]!,
      ) as string | number
      const cell = ws.getRow(1 + r0).getCell(1 + cIdx)
      cell.value = (v === '' || v == null) ? null : (v as ExcelJS.CellValue)
    }
  }
  // Cribl template: worker block uses **shared** D/H formulas. ExcelJS throws on write
  // ("Shared Formula master must exist… for cell D22") if we overwrite the master while clones remain.
  // Wipe the fixed table slot rows, then re-fill the rows we use.
  for (let j = 0; j < COPY_SOURCES_WG_TEMPLATE_WG_DATA_ROW_SLOTS; j += 1) {
    const r1 = 1 + wgd0 + j
    for (let c = 1; c <= 10; c += 1) {
      ws.getRow(r1).getCell(c).value = null
    }
  }
  for (let j = 0; j < wCount; j += 1) {
    for (const name of WORKER_HEADERS) {
      if (name === 'Throughput (GB/Day)' || name === "Disk Req'd For 1 Day Storage") {
        continue
      }
      const cIdx = colW.get(name) ?? -1
      if (cIdx < 0) {
        continue
      }
      const v = workerGroupValueForHeaderName(name, plan, plan.workerGroups[j]!)
      const cell = ws.getRow(1 + wgd0 + j).getCell(1 + cIdx)
      cell.value = (v === '' || v == null) ? null : (v as ExcelJS.CellValue)
    }
  }
  setTopologyFormulas(ws, wgd0, wCount, plan)
  // Unmerge can leave E–J plus ghost content; re-establish section titles in D, then re-merge
  clearAndSetDthroughJtitleRow(ws, 1, sourcesBlockTitle)
  clearAndSetDthroughJtitleRow(ws, 1 + newWtr0, workerBlockTitle)
  setTopologyMerges(ws, newWtr0)
}

/**
 * Load shell bytes, write Source summary + topology values/formulas, preserve the rest, return
 * a new .xlsx buffer.
 */
export async function planToBlobWithShellExcelJs(plan: PlanState, buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  // Buffer type differs from exceljs’ narrow typedef; runtime is fine
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(Buffer.from(new Uint8Array(buffer)) as any)
  const title = titleForAdoptionPlanExport(plan)
  wb.title = title
  wb.subject = plan.customerName.trim() || ''

  const srcWs = wb.getWorksheet(SHEET_SOURCE_SUMMARY)
  if (!srcWs) {
    throw new Error(`Required sheet “${SHEET_SOURCE_SUMMARY}” is missing.`)
  }

  const header = readSourceSummaryHeaderRow1Based(srcWs)
  const col = buildSourceSummaryColumnMap(header, [])
  plan.sourceSummary.forEach((s, i) => {
    const excelR = 3 + i
    const matrix0BasedRow = 2 + i
    for (const name of ALL_SOURCE_IMPORT_HEADER_NAMES) {
      const cIdx = col.get(name) ?? -1
      if (cIdx < 0) {
        continue
      }
      const v = sourceSummaryValueForHeaderName(name, s, { plan })
      if (v === undefined) {
        continue
      }
      setCellValuePlan(srcWs.getRow(excelR).getCell(cIdx + 1), v, matrix0BasedRow)
    }
  })

  const name = resolveTopologySheetName(wb)
  const topo = wb.getWorksheet(name)!
  const topoWarnings: string[] = []
  fillTopologyByTemplate(topo, plan, topoWarnings)

  const out = await wb.xlsx.writeBuffer()
  const u8 = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer)
  return mergeOoxmlStylePartsFromOriginal(u8, buffer)
}

function resolveTopologySheetName(wb: ExcelJS.Workbook): string {
  for (const name of [SHEET_COPY_SOURCES_WG, SHEET_COPY_SOURCES_WG_LEGACY, SHEET_COPY_SOURCES_WG_TRUNCATED_LEGACY]) {
    if (wb.getWorksheet(name)) {
      return name
    }
  }
  throw new Error('Topology sheet not found')
}
