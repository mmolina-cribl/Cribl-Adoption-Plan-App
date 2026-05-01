/**
 * v0.9.1 multi-sheet exporter.
 *
 * The gold v0.9.1 shell ships a fixed sheet topology:
 *   1. INSTRUCTIONS                — static, preserved verbatim
 *   2. PS Use Case Worksheet       — static, preserved verbatim
 *   3. Stream Overview             — regenerated each save (plain-text rollup)
 *   4. wgdefault                   — Stream WG scaffold #1
 *   5. wgdefaultHybrid             — Stream WG scaffold #2
 *   6. Edge Overview               — regenerated each save (plain-text rollup)
 *   7. fldefault_fleet             — Edge fleet scaffold #1
 *   8. input_data                  — static, preserved verbatim
 *
 * A user's plan can have arbitrarily many Stream worker groups and Edge
 * fleets, so the exporter has to clone the existing scaffold sheets when
 * the plan exceeds the gold's seeded counts. The cloning is done at the
 * OOXML level (JSZip pre-pass) before ExcelJS opens the file — ExcelJS
 * has no native "duplicate worksheet" API, and going through it would
 * lose data validation and conditional formatting on the clones.
 *
 * Pipeline:
 *   1. {@link expandShellScaffolds}  — JSZip-level clone of `wg*` /
 *      `fl*_fleet` sheets so the shell has at least one scaffold per
 *      planned WG / fleet. Comments / drawings / vmlDrawings are shared
 *      between clones (they're cosmetic validation hints — same hint
 *      applies to every per-WG sheet).
 *   2. {@link fillContentInShell}    — ExcelJS opens the expanded shell,
 *      renames each scaffold to the plan's resolved sheet name, clears
 *      and rewrites the data rows on each per-WG / per-Fleet sheet,
 *      regenerates the Stream / Edge Overview rollups from scratch as
 *      static plain-text values, and drops scaffolds the plan no longer
 *      needs. Workbook Title / Subject metadata is also set here.
 *   3. {@link restoreV091Styles}     — Final JSZip pass that copies
 *      `xl/styles.xml` + `xl/theme/theme1.xml` back from the (expanded)
 *      shell, fixes overview table refs to match the new data range, and
 *      generates the output buffer.
 *
 * Stream / Edge Overview rollups are intentionally write-only — the
 * importer ignores the top "Sources" table. Every save regenerates them
 * from the per-WG sheets so the user always sees fresh data.
 */
import { Buffer } from 'buffer'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import {
  ALL_SOURCE_IMPORT_HEADER_NAMES,
  SHEET_EDGE_OVERVIEW_V091,
  SHEET_INPUT_DATA,
  SHEET_INSTRUCTIONS,
  SHEET_STREAM_OVERVIEW_V091,
  V091_FLEET_SHEET_PREFIX,
  V091_FLEET_SHEET_SUFFIX,
  V091_OVERVIEW_TABLE1_FIRST_DATA_ROW,
  V091_OVERVIEW_TABLE1_LAST_DATA_ROW,
  V091_OVERVIEW_TABLE2_FIRST_DATA_ROW,
  V091_OVERVIEW_TABLE2_HEADER_ROW,
  V091_PER_WG_DEFAULT_DATA_ROW_SLOTS,
  V091_PER_WG_FIRST_DATA_ROW,
  V091_PER_WG_HEADERS_BASE,
  V091_WG_SHEET_PREFIX,
} from './planWorkbookLayout'
import { sourceSummaryValueForHeaderName, titleForAdoptionPlanExport } from './exportWorkbook'
import { resolveAllSheetNames } from './v091SheetNames'
import { effectiveIngestEgressGbdForWg } from './workerGroupRollup'
import type { PlanState, SourceSummaryRow, WorkerGroupKind, WorkerGroupRow } from '../types/planTypes'

/**
 * The five static / overview sheet names treated as reserved when
 * resolving plan-WG sheet names. `INSTRUCTIONS`, `PS Use Case Worksheet`,
 * and `input_data` are round-tripped verbatim. `Stream Overview` /
 * `Edge Overview` survive but their data tables are regenerated each
 * save.
 */
const SHEET_PS_USE_CASE = 'PS Use Case Worksheet' as const
const RESERVED_STATIC_SHEET_NAMES: readonly string[] = [
  SHEET_INSTRUCTIONS,
  SHEET_PS_USE_CASE,
  SHEET_STREAM_OVERVIEW_V091,
  SHEET_EDGE_OVERVIEW_V091,
  SHEET_INPUT_DATA,
] as const

/**
 * Cheap probe for "is this buffer a v0.9.1 adoption plan shell?" Used by
 * `workbookDownload.ts` to route between the legacy v0.8.6 exporter and
 * this one. The check has to work without instantiating ExcelJS (which is
 * slow and chatty in dev tools).
 */
export async function bufferIsV091Shell(buffer: ArrayBuffer | Uint8Array): Promise<boolean> {
  try {
    const z = await JSZip.loadAsync(buffer as ArrayBuffer)
    const wbXml = await z.file('xl/workbook.xml')?.async('string')
    if (!wbXml) {
      return false
    }
    if (
      wbXml.includes(`name="${SHEET_STREAM_OVERVIEW_V091}"`) ||
      wbXml.includes(`name="${SHEET_EDGE_OVERVIEW_V091}"`)
    ) {
      return true
    }
    const sheetMatches = wbXml.match(/<sheet\s[^/]*\/>/g) ?? []
    for (const tag of sheetMatches) {
      const name = /name="([^"]+)"/.exec(tag)?.[1]
      if (!name) {
        continue
      }
      if (name.startsWith(V091_WG_SHEET_PREFIX) && !name.endsWith(V091_FLEET_SHEET_SUFFIX)) {
        return true
      }
      if (name.startsWith(V091_FLEET_SHEET_PREFIX) && name.endsWith(V091_FLEET_SHEET_SUFFIX)) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

// ─── Phase 1: JSZip clone pre-pass ───────────────────────────────────────────

interface SheetEntry {
  /** Display name as it appears in `workbook.xml`. */
  name: string
  /** Excel `sheetId` (1-based, internal id, distinct from r:id). */
  sheetId: number
  /** Relationship id (`r:id` in the `<sheet>` tag). */
  rId: string
  /** 1-based index of `xl/worksheets/sheet{N}.xml` for this sheet. */
  sheetFileIdx: number
}

function parseSheetEntries(wbXml: string, wbRelsXml: string): SheetEntry[] {
  const entries: SheetEntry[] = []
  const relTargetByRid = new Map<string, string>()
  const relRe = /<Relationship\s+Id="([^"]+)"\s+Type="[^"]*officeDocument\/2006\/relationships\/worksheet"\s+Target="([^"]+)"\s*\/>/g
  for (const rm of wbRelsXml.matchAll(relRe)) {
    relTargetByRid.set(rm[1]!, rm[2]!)
  }
  const sheetRe = /<sheet\b([^/]*)\/>/g
  for (const sm of wbXml.matchAll(sheetRe)) {
    const attrs = sm[1]!
    const name = /name="([^"]+)"/.exec(attrs)?.[1]
    const sheetIdStr = /sheetId="([^"]+)"/.exec(attrs)?.[1]
    const rId = /r:id="([^"]+)"/.exec(attrs)?.[1]
    if (name == null || sheetIdStr == null || rId == null) {
      continue
    }
    const target = relTargetByRid.get(rId)
    const sheetFileIdx = target ? Number((/sheet(\d+)\.xml$/.exec(target) ?? [])[1] ?? '0') : 0
    entries.push({
      name,
      sheetId: Number(sheetIdStr),
      rId,
      sheetFileIdx,
    })
  }
  return entries
}

function nextRId(wbRelsXml: string): number {
  const ids: number[] = []
  for (const m of wbRelsXml.matchAll(/Id="rId(\d+)"/g)) {
    ids.push(Number(m[1]))
  }
  return (ids.length ? Math.max(...ids) : 0) + 1
}

/**
 * Unique placeholder name for a clone before ExcelJS renames it. Names
 * intentionally use the `wg` / `fl…_fleet` prefix/suffix so the Phase 2
 * scaffold detector ({@link isStreamScaffoldName} /
 * {@link isEdgeScaffoldName}) matches them — they're indistinguishable
 * from real scaffolds until {@link assignKindSheets} renames each one.
 */
function placeholderCloneName(kind: WorkerGroupKind, n: number): string {
  return kind === 'edge'
    ? `${V091_FLEET_SHEET_PREFIX}_v091Clone${n}${V091_FLEET_SHEET_SUFFIX}`
    : `${V091_WG_SHEET_PREFIX}_v091Clone${n}`
}

function findFirstScaffoldOfKind(
  entries: readonly SheetEntry[],
  kind: WorkerGroupKind,
): SheetEntry | null {
  for (const e of entries) {
    if (kind === 'edge') {
      if (e.name.startsWith(V091_FLEET_SHEET_PREFIX) && e.name.endsWith(V091_FLEET_SHEET_SUFFIX)) {
        return e
      }
    } else {
      if (
        e.name.startsWith(V091_WG_SHEET_PREFIX) &&
        !(e.name.startsWith(V091_FLEET_SHEET_PREFIX) && e.name.endsWith(V091_FLEET_SHEET_SUFFIX))
      ) {
        return e
      }
    }
  }
  return null
}

function countScaffoldsOfKind(entries: readonly SheetEntry[], kind: WorkerGroupKind): number {
  let n = 0
  for (const e of entries) {
    if (kind === 'edge') {
      if (e.name.startsWith(V091_FLEET_SHEET_PREFIX) && e.name.endsWith(V091_FLEET_SHEET_SUFFIX)) {
        n += 1
      }
    } else {
      if (
        e.name.startsWith(V091_WG_SHEET_PREFIX) &&
        !(e.name.startsWith(V091_FLEET_SHEET_PREFIX) && e.name.endsWith(V091_FLEET_SHEET_SUFFIX))
      ) {
        n += 1
      }
    }
  }
  return n
}

/**
 * Clone scaffold worksheets in place inside `z` so the workbook has at
 * least `wantStream` `wg*` sheets and `wantEdge` `fl*_fleet` sheets.
 *
 * Each clone shares its source's per-sheet rels (comments / drawing /
 * vmlDrawing). That means clones share the same comment / validation-hint
 * resources — acceptable because those resources carry the same per-WG
 * scaffold guidance (e.g. data-validation labels) regardless of which WG
 * the sheet ends up representing.
 */
async function cloneScaffolds(
  z: JSZip,
  entries: SheetEntry[],
  wantStream: number,
  wantEdge: number,
): Promise<void> {
  const haveStream = countScaffoldsOfKind(entries, 'stream')
  const haveEdge = countScaffoldsOfKind(entries, 'edge')
  const cloneStream = Math.max(0, wantStream - haveStream)
  const cloneEdge = Math.max(0, wantEdge - haveEdge)
  if (cloneStream === 0 && cloneEdge === 0) {
    return
  }

  const streamSrc = findFirstScaffoldOfKind(entries, 'stream')
  const edgeSrc = findFirstScaffoldOfKind(entries, 'edge')
  if (cloneStream > 0 && streamSrc == null) {
    throw new Error(
      `Cannot export: shell has no Stream scaffold (a sheet named "${V091_WG_SHEET_PREFIX}<name>") to clone.`,
    )
  }
  if (cloneEdge > 0 && edgeSrc == null) {
    throw new Error(
      `Cannot export: shell has no Edge scaffold (a sheet named "${V091_FLEET_SHEET_PREFIX}<name>${V091_FLEET_SHEET_SUFFIX}") to clone.`,
    )
  }

  const wbXmlPath = 'xl/workbook.xml'
  const wbRelsPath = 'xl/_rels/workbook.xml.rels'
  const ctPath = '[Content_Types].xml'
  let wbXml = await z.file(wbXmlPath)!.async('string')
  let wbRels = await z.file(wbRelsPath)!.async('string')
  let ct = await z.file(ctPath)!.async('string')

  const allFileIdx = entries.map((e) => e.sheetFileIdx).filter((n) => n > 0)
  let nextFileIdx = (allFileIdx.length ? Math.max(...allFileIdx) : 0) + 1
  let nextSheetId =
    (entries.length ? Math.max(...entries.map((e) => e.sheetId)) : 0) + 1
  let nextRid = nextRId(wbRels)

  const cloneOne = async (
    kind: WorkerGroupKind,
    src: SheetEntry,
    counter: number,
  ): Promise<SheetEntry> => {
    const newFileIdx = nextFileIdx
    nextFileIdx += 1
    const newSheetId = nextSheetId
    nextSheetId += 1
    const newRid = `rId${nextRid}`
    nextRid += 1
    const newName = placeholderCloneName(kind, counter)

    const sheetXmlPath = `xl/worksheets/sheet${src.sheetFileIdx}.xml`
    const newSheetXmlPath = `xl/worksheets/sheet${newFileIdx}.xml`
    const sheetXml = await z.file(sheetXmlPath)!.async('string')
    z.file(newSheetXmlPath, sheetXml)

    const relsPath = `xl/worksheets/_rels/sheet${src.sheetFileIdx}.xml.rels`
    const newRelsPath = `xl/worksheets/_rels/sheet${newFileIdx}.xml.rels`
    const relsFile = z.file(relsPath)
    if (relsFile) {
      const relsXml = await relsFile.async('string')
      z.file(newRelsPath, relsXml)
    }

    wbXml = wbXml.replace(
      /(<\/sheets>)/,
      `<sheet name="${newName}" sheetId="${newSheetId}" r:id="${newRid}"/>$1`,
    )
    wbRels = wbRels.replace(
      /(<\/Relationships>)/,
      `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${newFileIdx}.xml"/>$1`,
    )
    if (!ct.includes(`PartName="/${newSheetXmlPath}"`)) {
      ct = ct.replace(
        /(<\/Types>)/,
        `<Override PartName="/${newSheetXmlPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>$1`,
      )
    }
    return {
      name: newName,
      sheetId: newSheetId,
      rId: newRid,
      sheetFileIdx: newFileIdx,
    }
  }

  for (let i = 0; i < cloneStream; i += 1) {
    entries.push(await cloneOne('stream', streamSrc!, i + 1))
  }
  for (let i = 0; i < cloneEdge; i += 1) {
    entries.push(await cloneOne('edge', edgeSrc!, i + 1))
  }

  z.file(wbXmlPath, wbXml)
  z.file(wbRelsPath, wbRels)
  z.file(ctPath, ct)
}

async function expandShellScaffolds(
  shellBuf: ArrayBuffer,
  plan: PlanState,
): Promise<ArrayBuffer> {
  const wantStream = plan.workerGroups.filter((w) => w.kind !== 'edge').length
  const wantEdge = plan.workerGroups.filter((w) => w.kind === 'edge').length

  const z = await JSZip.loadAsync(shellBuf)
  const wbXml = await z.file('xl/workbook.xml')!.async('string')
  const wbRels = await z.file('xl/_rels/workbook.xml.rels')!.async('string')
  const entries = parseSheetEntries(wbXml, wbRels)

  await cloneScaffolds(z, entries, wantStream, wantEdge)
  const out = await z.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
  return out as ArrayBuffer
}

// ─── Phase 2: ExcelJS fill ───────────────────────────────────────────────────

function isStreamScaffoldName(name: string): boolean {
  if (!name.startsWith(V091_WG_SHEET_PREFIX)) {
    return false
  }
  if (name.startsWith(V091_FLEET_SHEET_PREFIX) && name.endsWith(V091_FLEET_SHEET_SUFFIX)) {
    return false
  }
  return true
}

function isEdgeScaffoldName(name: string): boolean {
  return name.startsWith(V091_FLEET_SHEET_PREFIX) && name.endsWith(V091_FLEET_SHEET_SUFFIX)
}

function readPerWgHeaderRow(ws: ExcelJS.Worksheet): string[] {
  const row = ws.getRow(2)
  const out: string[] = []
  const maxC = Math.max(row.cellCount, V091_PER_WG_HEADERS_BASE.length)
  for (let c = 1; c <= maxC; c += 1) {
    const v = row.getCell(c).value
    out.push(v == null ? '' : String((v as { result?: unknown }).result ?? v).trim())
  }
  return out
}

function clearDataRows(ws: ExcelJS.Worksheet, firstRow1Based: number, lastRow1Based: number, maxCol: number) {
  for (let r = firstRow1Based; r <= lastRow1Based; r += 1) {
    const row = ws.getRow(r)
    for (let c = 1; c <= maxCol; c += 1) {
      row.getCell(c).value = null
    }
  }
}

function setCellSafe(cell: ExcelJS.Cell, value: unknown): void {
  if (value === undefined) {
    return
  }
  if (value === null || value === '') {
    cell.value = null
    return
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  ) {
    cell.value = value as ExcelJS.CellValue
    return
  }
  cell.value = String(value)
}

/**
 * Fill the data rows of a per-WG / per-Fleet sheet for `wg`. Header row
 * (row 2) is left untouched — the gold has it pre-styled with merged
 * group banners on row 1 and column titles on row 2; we only write data
 * rows starting at row 3.
 *
 * Sources for `wg` are filtered from `plan.sourceSummary` by
 * `workerGroupId`. Existing scaffold rows beyond the new source count are
 * blanked through to {@link V091_PER_WG_DEFAULT_DATA_ROW_SLOTS} so a
 * shrink doesn't leave stale rows.
 */
function fillPerWgSheet(
  ws: ExcelJS.Worksheet,
  wg: WorkerGroupRow,
  plan: PlanState,
): void {
  const sources: SourceSummaryRow[] = plan.sourceSummary.filter(
    (s) => s.workerGroupId === wg.id,
  )
  const header = readPerWgHeaderRow(ws)
  const headerToCol = new Map<string, number>()
  for (let i = 0; i < header.length; i += 1) {
    const h = header[i]
    if (h) {
      headerToCol.set(h, i + 1)
    }
  }
  const lastDataRow = Math.max(
    V091_PER_WG_FIRST_DATA_ROW + sources.length - 1,
    V091_PER_WG_FIRST_DATA_ROW + V091_PER_WG_DEFAULT_DATA_ROW_SLOTS - 1,
  )
  const colCount = Math.max(header.length, V091_PER_WG_HEADERS_BASE.length, 31)
  clearDataRows(ws, V091_PER_WG_FIRST_DATA_ROW, lastDataRow, colCount)

  for (let i = 0; i < sources.length; i += 1) {
    const src = sources[i]!
    const row = ws.getRow(V091_PER_WG_FIRST_DATA_ROW + i)
    for (const headerName of ALL_SOURCE_IMPORT_HEADER_NAMES) {
      const col = headerToCol.get(headerName)
      if (col == null) {
        continue
      }
      const value = sourceSummaryValueForHeaderName(headerName, src, { plan })
      setCellSafe(row.getCell(col), value)
    }
  }
}

function planScopedSources(plan: PlanState, kind: WorkerGroupKind): SourceSummaryRow[] {
  const wgIds = new Set(
    plan.workerGroups.filter((w) => (kind === 'edge' ? w.kind === 'edge' : w.kind !== 'edge')).map((w) => w.id),
  )
  return plan.sourceSummary.filter((s) => wgIds.has(s.workerGroupId))
}

function planScopedWorkerGroups(plan: PlanState, kind: WorkerGroupKind): WorkerGroupRow[] {
  return plan.workerGroups.filter((w) => (kind === 'edge' ? w.kind === 'edge' : w.kind !== 'edge'))
}

function parseNumber(s: string | undefined): number | '' {
  if (!s) {
    return ''
  }
  const t = s.trim()
  if (!t) {
    return ''
  }
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : ''
}

/**
 * Regenerate the rolled-up Sources, Volume, Region table on rows 3..14
 * and the Worker Groups & Specs / Fleets & Specs table on rows 17.. with
 * static plain-text values. The gold's headers on rows 2 and 16 are left
 * intact so banner / table-style references survive.
 *
 * Column F on the top table holds the WG / Fleet display name as plain
 * text (no internal hyperlink), per the v0.9.1 design decision. Column A
 * on the bottom table is similarly plain text.
 */
function fillOverviewSheet(
  ws: ExcelJS.Worksheet,
  kind: WorkerGroupKind,
  plan: PlanState,
  sheetNameByWgId: Map<string, string>,
): void {
  const sources = planScopedSources(plan, kind)
  const wgs = planScopedWorkerGroups(plan, kind)

  // Top table: rows 3..14 in the gold (12 slots). We blank every gold-
  // shipped row first so a shrink doesn't leave phantoms; if the plan
  // has more than 12 sources the extras spill to rows 15+ and the table
  // ref is widened in the post-pass.
  const topMaxKnown = V091_OVERVIEW_TABLE1_LAST_DATA_ROW
  const topLast = Math.max(topMaxKnown, V091_OVERVIEW_TABLE1_FIRST_DATA_ROW + sources.length - 1)
  clearDataRows(ws, V091_OVERVIEW_TABLE1_FIRST_DATA_ROW, topLast, 9)
  for (let i = 0; i < sources.length; i += 1) {
    const s = sources[i]!
    const row = ws.getRow(V091_OVERVIEW_TABLE1_FIRST_DATA_ROW + i)
    const wgName = sheetNameByWgId.get(s.workerGroupId)
      ? plan.workerGroups.find((w) => w.id === s.workerGroupId)?.wg ?? ''
      : ''
    row.getCell(1).value = s.source
    const avg = parseNumber(s.avgDailyGb)
    row.getCell(2).value = avg === '' ? null : avg
    row.getCell(3).value = s.physicalLocations
    row.getCell(4).value = s.currentCollection
    row.getCell(5).value = ''
    row.getCell(6).value = wgName
    row.getCell(7).value = ''
    row.getCell(8).value = s.destinations
    row.getCell(9).value = ''
  }

  const specsFirstData = V091_OVERVIEW_TABLE2_FIRST_DATA_ROW
  // Gold ships 8 spec slots (rows 17..24); blank to that bottom edge so
  // a shrink doesn't leave phantoms.
  const specsLast = Math.max(specsFirstData + wgs.length - 1, specsFirstData + 8 - 1)
  clearDataRows(ws, specsFirstData, specsLast, 8)
  for (let j = 0; j < wgs.length; j += 1) {
    const wg = wgs[j]!
    const row = ws.getRow(specsFirstData + j)
    const cap = effectiveIngestEgressGbdForWg(plan, wg)
    const ingest =
      cap?.ingestGb != null && Number.isFinite(cap.ingestGb)
        ? cap.ingestGb
        : parseNumber(wg.ingestGbd)
    const egress =
      cap?.egressGb != null && Number.isFinite(cap.egressGb)
        ? cap.egressGb
        : parseNumber(wg.egressGbd)
    const throughput = parseNumber(wg.throughputGbd)
    const disk = parseNumber(wg.diskOneDayGb)
    row.getCell(1).value = wg.wg
    row.getCell(2).value = ingest === '' ? null : ingest
    row.getCell(3).value = egress === '' ? null : egress
    row.getCell(4).value = throughput === '' ? null : throughput
    row.getCell(5).value = wg.workerHosting
    row.getCell(6).value = wg.workerCount
    row.getCell(7).value = wg.workerDetail
    row.getCell(8).value = disk === '' ? null : disk
  }
  // Header rows (row 2 / row 16) are left as-is — the gold pre-styled
  // them with merged title cells and column headers, and the cells we
  // just wrote pick up the surrounding table style via styles.xml in
  // the post-pass.
}

async function fillContentInShell(plan: PlanState, expandedShell: ArrayBuffer): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  // exceljs's narrow types don't accept Buffer; runtime is fine.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(Buffer.from(new Uint8Array(expandedShell)) as any)

  wb.title = titleForAdoptionPlanExport(plan)
  wb.subject = plan.customerName.trim() || ''

  const finalSheetNames = resolveAllSheetNames(plan.workerGroups, RESERVED_STATIC_SHEET_NAMES)

  const streamScaffolds: ExcelJS.Worksheet[] = []
  const edgeScaffolds: ExcelJS.Worksheet[] = []
  for (const ws of wb.worksheets) {
    if (isStreamScaffoldName(ws.name)) {
      streamScaffolds.push(ws)
    } else if (isEdgeScaffoldName(ws.name)) {
      edgeScaffolds.push(ws)
    }
  }

  const planStream = planScopedWorkerGroups(plan, 'stream')
  const planEdge = planScopedWorkerGroups(plan, 'edge')

  if (streamScaffolds.length < planStream.length) {
    throw new Error(
      `Internal error: shell expansion produced ${streamScaffolds.length} Stream scaffolds but plan needs ${planStream.length}.`,
    )
  }
  if (edgeScaffolds.length < planEdge.length) {
    throw new Error(
      `Internal error: shell expansion produced ${edgeScaffolds.length} Edge scaffolds but plan needs ${planEdge.length}.`,
    )
  }

  const consumedScaffoldIds = new Set<number>()
  const assignKindSheets = (
    rows: readonly WorkerGroupRow[],
    scaffolds: readonly ExcelJS.Worksheet[],
  ) => {
    for (let i = 0; i < rows.length; i += 1) {
      const wg = rows[i]!
      const ws = scaffolds[i]!
      const finalName = finalSheetNames.get(wg.id)
      if (finalName == null) {
        throw new Error(`Could not resolve sheet name for worker group "${wg.wg}".`)
      }
      consumedScaffoldIds.add(ws.id)
      if (ws.name !== finalName) {
        ws.name = finalName
      }
      fillPerWgSheet(ws, wg, plan)
    }
  }

  assignKindSheets(planStream, streamScaffolds)
  assignKindSheets(planEdge, edgeScaffolds)

  for (const ws of [...streamScaffolds, ...edgeScaffolds]) {
    if (!consumedScaffoldIds.has(ws.id)) {
      wb.removeWorksheet(ws.id)
    }
  }

  const streamOverview = wb.getWorksheet(SHEET_STREAM_OVERVIEW_V091)
  if (streamOverview) {
    fillOverviewSheet(streamOverview, 'stream', plan, finalSheetNames)
  }
  const edgeOverview = wb.getWorksheet(SHEET_EDGE_OVERVIEW_V091)
  if (edgeOverview) {
    fillOverviewSheet(edgeOverview, 'edge', plan, finalSheetNames)
  }

  const out = await wb.xlsx.writeBuffer()
  return out instanceof ArrayBuffer ? out : (new Uint8Array(out as Uint8Array).buffer as ArrayBuffer)
}

// ─── Phase 3: OOXML style restore + table-ref fixes ─────────────────────────

const STYLE_PARTS_TO_RESTORE: readonly string[] = [
  'xl/styles.xml',
  'xl/theme/theme1.xml',
] as const

/**
 * Update the `ref="A2:I14"` / `ref="A16:H24"` ranges on the overview
 * tables (`SourcesVolumeCollection`, `WGs`, `FLs`, etc.) to cover the
 * data we actually wrote.
 *
 * The gold ships these as ListObject tables whose `ref` is a fixed
 * range; if the plan exceeds those ranges the extra rows still write
 * fine but lose the table's striping. Widening the `ref` re-adopts them.
 */
async function fixOverviewTableRefs(zOut: JSZip, plan: PlanState): Promise<void> {
  const tableFiles = Object.keys(zOut.files).filter((p) => /^xl\/tables\/table\d+\.xml$/.test(p))
  const streamSrcCount = planScopedSources(plan, 'stream').length
  const edgeSrcCount = planScopedSources(plan, 'edge').length
  const streamWgCount = planScopedWorkerGroups(plan, 'stream').length
  const edgeWgCount = planScopedWorkerGroups(plan, 'edge').length

  for (const path of tableFiles) {
    const xml = await zOut.file(path)!.async('string')
    const nameMatch = /\bname="([^"]+)"/.exec(xml)
    const refMatch = /\bref="([^"]+)"/.exec(xml)
    if (!nameMatch || !refMatch) {
      continue
    }
    const tableName = nameMatch[1]!
    const oldRef = refMatch[1]!
    let newRef: string | null = null
    if (/^SourcesVolumeCollection(_\d+)?$/.test(tableName)) {
      const isEdge = tableName.endsWith('_2')
      const count = isEdge ? edgeSrcCount : streamSrcCount
      const lastRow = Math.max(
        V091_OVERVIEW_TABLE1_FIRST_DATA_ROW + count - 1,
        V091_OVERVIEW_TABLE1_LAST_DATA_ROW,
      )
      newRef = `A2:I${lastRow}`
    } else if (tableName === 'WGs') {
      const lastRow = Math.max(
        V091_OVERVIEW_TABLE2_FIRST_DATA_ROW + streamWgCount - 1,
        V091_OVERVIEW_TABLE2_HEADER_ROW + 8,
      )
      newRef = `A${V091_OVERVIEW_TABLE2_HEADER_ROW}:H${lastRow}`
    } else if (tableName === 'FLs') {
      const lastRow = Math.max(
        V091_OVERVIEW_TABLE2_FIRST_DATA_ROW + edgeWgCount - 1,
        V091_OVERVIEW_TABLE2_HEADER_ROW + 8,
      )
      newRef = `A${V091_OVERVIEW_TABLE2_HEADER_ROW}:H${lastRow}`
    }
    if (newRef && newRef !== oldRef) {
      const rebuilt = xml.replace(/(<table\b[^>]*?\bref=")[^"]+(")/, `$1${newRef}$2`)
      zOut.file(path, rebuilt)
    }
  }
}

/**
 * Build a name → `xl/worksheets/sheetN.xml` path map for the workbook in
 * `z`. Used by post-pass fixers that operate on sheets by name (the
 * sheet-file index is unreliable after ExcelJS reshuffles).
 */
async function buildSheetNamePathMap(z: JSZip): Promise<Map<string, string>> {
  const wbXml = (await z.file('xl/workbook.xml')?.async('string')) ?? ''
  const wbRels = (await z.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? ''
  const entries = parseSheetEntries(wbXml, wbRels)
  const out = new Map<string, string>()
  for (const e of entries) {
    if (e.sheetFileIdx > 0) {
      out.set(e.name, `xl/worksheets/sheet${e.sheetFileIdx}.xml`)
    }
  }
  return out
}

/**
 * Extract every `<conditionalFormatting>` block from one canonical
 * per-WG sheet of the gold shell (sheet4 = `wgdefault` is the first
 * Stream scaffold; sheet7 = `fldefault_fleet` is the first Edge
 * scaffold). All per-WG / per-Fleet sheets in the gold share an
 * identical formatting set, so any one of them works as the source. We
 * pick the first one we find by sheet name to be robust against shell
 * variations.
 */
async function readGoldPerWgConditionalFormatting(zIn: JSZip): Promise<string> {
  const map = await buildSheetNamePathMap(zIn)
  for (const [name, path] of map) {
    const cls = name.startsWith(V091_WG_SHEET_PREFIX) && !name.endsWith(V091_FLEET_SHEET_SUFFIX)
    if (!cls) {
      continue
    }
    const xml = (await zIn.file(path)?.async('string')) ?? ''
    const blocks = xml.match(/<conditionalFormatting[\s\S]*?<\/conditionalFormatting>/g) ?? []
    if (blocks.length > 0) {
      return blocks.join('')
    }
  }
  return ''
}

/**
 * Splice the gold's canonical per-WG conditional-formatting blocks into
 * every per-WG / per-Fleet sheet of the output. ExcelJS round-tripping
 * shifts `dxfId` references (sometimes adding new dxfs entirely) so the
 * cfRules that survive its rewrite no longer point at the right
 * differential formats once we restore the gold's `styles.xml`. By
 * substituting the gold's verbatim cfRules — whose `dxfId` values match
 * the gold's `styles.xml` `<dxfs>` collection — the Cribl color rules
 * (Low / Medium / High / not-blank) line up correctly again.
 */
async function restoreGoldPerWgConditionalFormatting(zIn: JSZip, zOut: JSZip): Promise<void> {
  const goldBlocks = await readGoldPerWgConditionalFormatting(zIn)
  if (!goldBlocks) {
    return
  }
  const outMap = await buildSheetNamePathMap(zOut)
  for (const [name, path] of outMap) {
    const isStream = name.startsWith(V091_WG_SHEET_PREFIX) && !name.endsWith(V091_FLEET_SHEET_SUFFIX)
    const isEdge = name.startsWith(V091_FLEET_SHEET_PREFIX) && name.endsWith(V091_FLEET_SHEET_SUFFIX)
    if (!isStream && !isEdge) {
      continue
    }
    const f = zOut.file(path)
    if (!f) {
      continue
    }
    const xml = await f.async('string')
    const stripped = xml.replace(/<conditionalFormatting[\s\S]*?<\/conditionalFormatting>/g, '')
    // Splice the canonical blocks back in just before `<pageMargins`,
    // `<dataValidations`, or end-of-`<worksheet>` — wherever the
    // existing tail starts. We anchor on the closing `</sheetData>`
    // because every worksheet has that marker.
    const sheetDataEnd = stripped.indexOf('</sheetData>')
    if (sheetDataEnd < 0) {
      continue
    }
    const head = stripped.slice(0, sheetDataEnd + '</sheetData>'.length)
    const tail = stripped.slice(sheetDataEnd + '</sheetData>'.length)
    // Per OOXML spec, `<conditionalFormatting>` lives between sheetData
    // and pageMargins / printOptions. Place ours immediately after
    // sheetData so the document order stays well-formed.
    zOut.file(path, `${head}${goldBlocks}${tail}`)
  }
}

/**
 * ExcelJS emits `<cfRule type="notContainsBlanks" operator="notContainsBlanks" …>`
 * when round-tripping the gold's per-WG conditional formatting; the gold
 * (and OOXML spec) omits the attribute (the type implies the operator).
 * Excel and Google Sheets accept both, but stricter parsers (openpyxl)
 * reject the redundant attribute. Strip it for cross-tool round-trip
 * cleanliness — this also keeps a downstream importer that uses
 * openpyxl from blowing up on a workbook the app exported.
 *
 * Run *after* {@link restoreGoldPerWgConditionalFormatting} so we
 * don't have to re-emit the spliced blocks.
 */
async function fixCfRuleOperatorEcho(zOut: JSZip): Promise<void> {
  const sheets = Object.keys(zOut.files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
  for (const path of sheets) {
    const f = zOut.file(path)
    if (!f) {
      continue
    }
    const xml = await f.async('string')
    const fixed = xml.replace(
      /(<cfRule\b[^>]*\btype="(?:notContainsBlanks|containsBlanks)"[^>]*?)\s+operator="(?:notContainsBlanks|containsBlanks)"/g,
      '$1',
    )
    if (fixed !== xml) {
      zOut.file(path, fixed)
    }
  }
}

async function restoreV091Styles(
  filledBuf: ArrayBuffer | Uint8Array,
  expandedShell: ArrayBuffer,
  plan: PlanState,
): Promise<ArrayBuffer> {
  const zIn = await JSZip.loadAsync(expandedShell)
  const zOut = await JSZip.loadAsync(filledBuf as ArrayBuffer)
  for (const part of STYLE_PARTS_TO_RESTORE) {
    const f = zIn.file(part)
    if (f) {
      const raw = await f.async('uint8array')
      zOut.file(part, raw)
    }
  }
  await fixOverviewTableRefs(zOut, plan)
  await restoreGoldPerWgConditionalFormatting(zIn, zOut)
  await fixCfRuleOperatorEcho(zOut)
  const out = await zOut.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
  return out as ArrayBuffer
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Fill a v0.9.1 shell with the current plan and return the resulting
 * `.xlsx` bytes. The shell can be the bundled empty (`public/adoption-
 * plan-empty.xlsx`) or the user's last imported workbook — both share
 * the v0.9.1 topology after PR B.
 *
 * The pipeline is intentionally split into three phases (clone → fill →
 * restore) so style preservation bugs can be isolated to a single layer
 * without touching the others.
 */
export async function planToBlobV091(plan: PlanState, shellBuf: ArrayBuffer): Promise<ArrayBuffer> {
  const expanded = await expandShellScaffolds(shellBuf, plan)
  const filled = await fillContentInShell(plan, expanded)
  const final = await restoreV091Styles(filled, expanded, plan)
  return final
}
