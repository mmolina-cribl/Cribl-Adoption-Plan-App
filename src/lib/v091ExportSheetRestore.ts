/**
 * Per-sheet style fidelity restore for the v0.9.1 export.
 *
 * Why this module exists
 * ──────────────────────
 * ExcelJS, when round-tripping the gold workbook, normalizes and
 * deduplicates the styles archive (`xl/styles.xml`'s `cellXfs`
 * collection). After it re-saves, every cell `<c r="…" s="N">`
 * references a different row in `cellXfs` than the gold did — and the
 * ExcelJS-produced row may merge styles the gold kept distinct (e.g.
 * the "Item" header and "_" separator-column header on the PS Use
 * Case Worksheet end up with the same style index even though the
 * gold styled them differently). The companion {@link restoreV091Styles}
 * pass swaps `xl/styles.xml` and `xl/theme/theme1.xml` back to the
 * gold's, but the cells inside each worksheet now reference the wrong
 * rows in the restored gold table — so the fonts, fills, borders, and
 * alignment all drift.
 *
 * Empirically, on the gold v0.9.1 shell the drift is:
 *   - INSTRUCTIONS:               0% (lucky — every cell shares s=10)
 *   - PS Use Case Worksheet:     91%  (155 / 170 cells)            [restored]
 *   - Stream Overview:          100%                                [restored]
 *   - wg-default / wg-defaultHybrid:100%                            [restored]
 *   - Edge Overview:            100%                                [restored]
 *   - fl-default:               100%                                [restored]
 *   - input_data:               100% (and we never even modify it)  [restored]
 *
 * Strategy
 * ────────
 * For sheets where the app modifies a tightly-bounded set of cells
 * (e.g. the Activation Notes / Status / Parameters columns on the PS
 * Use Case Worksheet), we replace the output's worksheet XML with the
 * gold's verbatim XML, then **overlay only the cells we wrote** — keeping
 * the gold's `s=` index for every cell. Static gold cells survive byte-
 * exact, including their `s=` indices, so the restored
 * `xl/styles.xml` resolves them correctly.
 *
 * For static lookup sheets that the app never writes to (e.g.
 * `input_data`, the data-validation source for per-WG dropdowns) we
 * skip the overlay entirely — restoring gold's worksheet XML and
 * inline-stringifying its `t="s"` cells is enough to bring the
 * styling back to gold.
 *
 * To sidestep ExcelJS's rewritten `xl/sharedStrings.xml`, every
 * `t="s"` cell on the restored sheet is converted to an inline string
 * (`t="inlineStr"` + `<is><t>…</t></is>`) at restore time, with the
 * text resolved from the **gold's** `sharedStrings.xml`. After this
 * conversion the sheet has no shared-string dependency at all, so it
 * stays correct regardless of what the rest of the export does to
 * `sharedStrings.xml`.
 *
 * We add per-sheet restorers one at a time. The orchestrator
 * {@link restoreSheetsFromGold} fans out to whichever restorers are
 * implemented; sheets without an entry here fall through unchanged
 * (they still have the same drift they had before).
 */
import type JSZip from 'jszip'
import type {
  Activation,
  PlanState,
  WorkerGroupKind,
  WorkerGroupRow,
} from '../types/planTypes'
import { sourceSummaryValueForHeaderName } from './exportWorkbook'
import {
  ALL_SOURCE_IMPORT_HEADER_NAMES,
  V091_OVERVIEW_TABLE2_FIRST_DATA_ROW,
  V091_OVERVIEW_TABLE2_HEADER_ROW,
  V091_PER_WG_FIRST_DATA_ROW,
} from './planWorkbookLayout'
import { resolveAllSheetNames } from './v091SheetNames'
import {
  PS_BASE_SCOPE_ITEMS,
  PS_BASE_SCOPE_WORKSHEET_FIRST_ROW,
  PS_BASE_SCOPE_WORKSHEET_LABELS,
  PS_BLOCK1_FIRST_DATA_ROW,
  PS_BLOCK2_FIRST_DATA_ROW,
  PS_PARAMETERS_PER_USE_CASE,
  PS_USE_CASE_COUNT,
  PS_USE_CASE_WORKSHEET_FIRST_ROW,
  SHEET_PS_USE_CASE_WORKSHEET,
} from './psUseCaseLayout'
import { buildSheetNamePathMap } from './v091ZipUtils'
import {
  effectiveDiskOneDayGbForWg,
  effectiveIngestEgressGbdForWg,
  effectiveThroughputGbdForWg,
} from './workerGroupRollup'

// ─── Tiny XML helpers ──────────────────────────────────────────────────────

/**
 * XML-escape a JS string before embedding it in OOXML. Gold-derived
 * strings parsed out of `sharedStrings.xml` are kept escaped (we read
 * the inner-`<t>` content verbatim) so they pass through this layer
 * untouched. Only values originating from `PlanState` need escaping.
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Parse `xl/sharedStrings.xml` into an array indexed exactly the way
 * `<v>N</v>` lookups expect. `<si>` elements that contain rich-text
 * runs (`<r><t>…</t></r>`) are flattened by concatenating every
 * `<t>` child in document order — matches Excel's own resolution.
 *
 * Returned strings are kept **XML-escaped** (i.e. as they appear
 * inside the `<t>` element). When emitting them back into a worksheet
 * we do not re-escape, so e.g. `Architecture Meetings &amp;
 * Diagrams` survives a round-trip without becoming
 * `&amp;amp;`.
 */
export function parseSharedStrings(xml: string): string[] {
  if (!xml) return []
  const out: string[] = []
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let m: RegExpExecArray | null
  while ((m = siRegex.exec(xml)) !== null) {
    const inner = m[1] ?? ''
    const tMatches = inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)
    let combined = ''
    for (const t of tMatches) {
      combined += t[1] ?? ''
    }
    out.push(combined)
  }
  return out
}

/**
 * Pull a single attribute value out of an attribute-list substring.
 * `attrs` is the chunk between `<c` and `>` (or `/>`). Returns `null`
 * if the attribute is absent. Matches simple `name="value"` pairs;
 * OOXML never uses single-quoted or unquoted attributes here.
 */
function attr(attrs: string, name: string): string | null {
  const re = new RegExp(`\\b${name}="([^"]*)"`)
  const m = attrs.match(re)
  return m ? m[1]! : null
}

// ─── Cell overlay rewriting ────────────────────────────────────────────────

/**
 * One value an overlay can hold for a single cell:
 *   - `string` → emitted as an inline string (`t="inlineStr"`) with
 *     the value escaped + run-level formatting if applicable.
 *   - `number` → emitted as a numeric cell (`<c …><v>N</v></c>`)
 *     preserving its native type so Excel formulas / number formats
 *     keep working. Used for GB/day, ingest, egress, etc. on the
 *     Stream / Edge overview tables.
 *   - `boolean` → emitted as a typed boolean cell
 *     (`<c t="b" …><v>1</v></c>` for true, `0` for false). Mirrors
 *     what `ExcelJS` writes for `cell.value = true|false` so the
 *     v0.9.1 importer's boolean-cell parser keeps round-tripping
 *     `Compliance related?` / `Current?` etc. correctly.
 *   - `Date` → emitted as a numeric serial number relative to
 *     Excel's 1899-12-30 epoch (`<c …><v>SERIAL</v></c>`), again
 *     mirroring ExcelJS. The cell's gold-supplied number format
 *     renders it as a localized date.
 *   - `null` → renders an empty styled cell (`<c r="…" s="…"/>`),
 *     same shape gold uses for its pre-shipped empty Notes cells.
 */
type OverlayValue = string | number | boolean | Date | null

/**
 * One entry per cell address we want to overwrite. See
 * {@link OverlayValue} for the per-cell value semantics.
 */
type OverlayMap = Map<string, OverlayValue>

/**
 * Split a cell address like `"E22"` into its column-letter prefix
 * and 1-based row number. Used to locate the parent `<row>` block
 * and find the right alphabetical insertion point inside it.
 */
function splitAddr(addr: string): { col: string; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(addr)
  if (!m) return null
  return { col: m[1]!, row: Number(m[2]) }
}

/**
 * Compare two column letters by Excel's "AA after Z" ordering.
 * Returns negative/zero/positive — the standard `Array#sort` shape.
 */
function colCmp(a: string, b: string): number {
  return a.length === b.length ? a.localeCompare(b) : a.length - b.length
}

/**
 * Build the `<c>` element string for an overlay write.
 *
 * - Null / empty-string values produce an empty styled cell
 *   (`<c r="…" s="…"/>`) — same shape gold uses for its pre-shipped
 *   empty Notes cells. Preserving `s=` keeps the cell border /
 *   alignment intact even though it's visually empty.
 * - Numeric values produce an untyped numeric cell
 *   (`<c r="…" s="…"><v>N</v></c>`). No `t=` attribute means OOXML's
 *   default numeric type, so the value is selectable / formula-able
 *   and the cell's number format (gold-supplied via `s=`) applies.
 * - String values produce an inline string cell so the worksheet
 *   stays decoupled from `xl/sharedStrings.xml` (which ExcelJS
 *   rewrites with new indices).
 */
function buildOverlayCellXml(
  addr: string,
  value: OverlayValue,
  goldS: string | null,
): string {
  const sFragment = goldS != null ? ` s="${goldS}"` : ''
  if (value == null || value === '') {
    return `<c r="${addr}"${sFragment}/>`
  }
  if (typeof value === 'boolean') {
    return `<c r="${addr}"${sFragment} t="b"><v>${value ? 1 : 0}</v></c>`
  }
  if (value instanceof Date) {
    return `<c r="${addr}"${sFragment}><v>${dateToExcelSerial(value)}</v></c>`
  }
  if (typeof value === 'number') {
    return `<c r="${addr}"${sFragment}><v>${value}</v></c>`
  }
  return `<c r="${addr}"${sFragment} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
    value,
  )}</t></is></c>`
}

/**
 * Convert a JS `Date` to an Excel serial number (days since
 * 1899-12-30). Mirrors what ExcelJS writes for `cell.value = new
 * Date(...)`: an integer-or-fractional days count whose cell
 * number-format then renders as a localized date / datetime. Excel
 * intentionally treats 1900 as a leap year (Lotus 1-2-3 bug carry-
 * over); using `1899-12-30` as the epoch produces the same serial
 * Excel uses for any post-1900-03-01 date, which covers every date
 * the app cares about (target onboarding / completion dates).
 *
 * `getTime()` returns UTC milliseconds, so the math is timezone-
 * agnostic — the Date is interpreted as the same instant Excel /
 * Google Sheets expect.
 */
function dateToExcelSerial(d: Date): number {
  return (d.getTime() - Date.UTC(1899, 11, 30)) / 86400000
}

/**
 * Insert overlay cells that don't exist in the gold sheet XML. Gold
 * frequently omits empty data cells entirely (no `<c>` element), so
 * when the customer fills in e.g. a Notes column, we have to *add*
 * the cell to its row's child list — preserving OOXML's requirement
 * that cells stay in alphabetical column order.
 *
 * `addresses` should be the list of overlay addresses that the cell-
 * rewrite pass did NOT visit (i.e. the cell was missing in gold). If
 * the row containing the address is itself missing in the sheet, we
 * skip it — the PS Use Case Worksheet always has every relevant row
 * defined, so this is defensive only.
 */
function insertMissingCells(
  sheetXml: string,
  missing: Array<[string, OverlayValue]>,
): string {
  if (missing.length === 0) return sheetXml
  // Group by row so we make at most one splice per row.
  const byRow = new Map<number, Array<[string, OverlayValue]>>()
  for (const [addr, value] of missing) {
    const a = splitAddr(addr)
    if (!a) continue
    if (!byRow.has(a.row)) byRow.set(a.row, [])
    byRow.get(a.row)!.push([addr, value])
  }
  let out = sheetXml
  for (const [rowNum, cellsForRow] of byRow) {
    // Sort overlay cells in alphabetical column order so a single
    // sequential splice produces a row that's already in the order
    // OOXML requires.
    cellsForRow.sort((x, y) => {
      const ax = splitAddr(x[0])!
      const ay = splitAddr(y[0])!
      return colCmp(ax.col, ay.col)
    })
    const rowRe = new RegExp(`<row\\s+r="${rowNum}"([^>]*)>([\\s\\S]*?)</row>`)
    const rowMatch = rowRe.exec(out)
    if (!rowMatch) continue
    const rowAttrs = rowMatch[1]!
    const rowInner = rowMatch[2]!
    // Each insertion mutates `newInner`, so we re-scan it on every
    // iteration to find the first existing cell whose column comes
    // strictly after ours. That's the splice point. End-of-row when
    // no such cell exists. Re-scanning is cheap — rows have ≤ ~30
    // cells in practice.
    let newInner = rowInner
    for (const [addr, value] of cellsForRow) {
      const sp = splitAddr(addr)!
      const cellXml = buildOverlayCellXml(addr, value, null)
      const liveRe = /<c\s+([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g
      let chosen = newInner.length
      let lcm: RegExpExecArray | null
      while ((lcm = liveRe.exec(newInner)) !== null) {
        const liveAddr = attr(lcm[1]!, 'r')
        const liveSp = liveAddr ? splitAddr(liveAddr) : null
        if (!liveSp) continue
        if (colCmp(liveSp.col, sp.col) > 0) {
          chosen = lcm.index
          break
        }
      }
      newInner = newInner.slice(0, chosen) + cellXml + newInner.slice(chosen)
    }
    out =
      out.slice(0, rowMatch.index) +
      `<row r="${rowNum}"${rowAttrs}>${newInner}</row>` +
      out.slice(rowMatch.index + rowMatch[0].length)
  }
  return out
}

/**
 * Rewrite every `<c>` cell in `sheetXml` per the rules:
 *
 *   - If the cell's address is in `overlay`:
 *     - Empty / null overlay value → emit `<c r="ADDR" s="GOLD_S"/>`
 *       (preserves gold's styling on an empty cell — same shape gold
 *       uses when it ships an empty styled cell).
 *     - Non-empty overlay value → emit
 *       `<c r="ADDR" s="GOLD_S" t="inlineStr"><is><t xml:space="preserve">VAL</t></is></c>`.
 *       The `s="GOLD_S"` attribute is sourced from the cell's existing
 *       `s=` in the gold XML, which is the whole point of this
 *       module — we never invent style indices.
 *
 *   - Else if the gold cell uses `t="s"` (shared-string reference):
 *     resolve via `goldSharedStrings` and re-emit as an inline string,
 *     dropping the dependency on the (post-ExcelJS-rewritten) shared-
 *     strings table.
 *
 *   - Else (numeric, boolean, formula, empty styled): pass through
 *     verbatim. `s=` is already gold-correct.
 *
 * After the rewrite, any overlay address that wasn't visited (gold
 * had no `<c>` element at all for it — common for empty Notes /
 * Parameters cells) is inserted into its parent `<row>` in the
 * correct alphabetical position by {@link insertMissingCells}.
 *
 * The regex tolerates both self-closed cells (`<c .../>`) and
 * full-form cells (`<c …>…</c>`). It is intentionally permissive on
 * attribute order — ExcelJS and Google Sheets each emit attributes in
 * different orders and both must round-trip cleanly.
 */
/**
 * Wrap an XML-escaped value in an inline-string body, optionally with
 * a single text run that pins the run's font color to white.
 *
 * Why white-text via `<rPr>` instead of touching `cellXfs`?
 * ───────────────────────────────────────────────────────────
 * Gold's table-header cells on rows 2 and 18 (PS Use Case Worksheet)
 * use cellXfs `s=11` / `s=12`, which carry `fillId="0"` (no direct
 * fill) and `fontId="2"` (`<color theme="1"/>` — black). Their green
 * background is painted by the `headerRow` differential format on the
 * surrounding `<table>`. Excel auto-flips text to white for contrast
 * when a cell lives in a dark-fill region; Google Sheets only applies
 * that auto-flip when the dark fill is on the cell ITSELF (`fillId !=
 * 0`). Row 10's "Use Case # / Use Case" cells use `s=17 / 18` with
 * `fillId="2"` (green) baked in, so Google flips them to white. Rows
 * 2 and 18 are left looking dark on green.
 *
 * Wrapping the inline string in `<r><rPr><color rgb="FFFFFFFF"/></rPr>
 * <t>…</t></r>` pins the rendered text to white at the run level,
 * unconditionally, without altering `cellXfs` (which is shared with
 * many other workbook regions and would be risky to mutate). All other
 * font properties — name, size, weight, family — are left to inherit
 * from the cell's underlying `fontId`, so typography continues to
 * match gold exactly. Excel applies the same run-level color override
 * (it just renders white either way), so this is a no-op in Excel and
 * a fix in Google Sheets.
 */
function inlineStrBody(escapedValue: string, white: boolean): string {
  if (white) {
    return `<is><r><rPr><color rgb="FFFFFFFF"/></rPr><t xml:space="preserve">${escapedValue}</t></r></is>`
  }
  return `<is><t xml:space="preserve">${escapedValue}</t></is>`
}

function overlayCellsInSheet(
  sheetXml: string,
  goldSharedStrings: string[],
  overlay: OverlayMap,
  whiteTextAddresses: ReadonlySet<string> = new Set(),
): string {
  const visited = new Set<string>()
  const cellRegex = /<c\s+([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g
  const rewritten = sheetXml.replace(
    cellRegex,
    (_full, attrs: string, end: string, inner: string) => {
      const addr = attr(attrs, 'r')
      if (!addr) {
        return _full
      }
      const goldS = attr(attrs, 's')
      if (overlay.has(addr)) {
        visited.add(addr)
        return buildOverlayCellXml(addr, overlay.get(addr) ?? null, goldS)
      }
      const goldT = attr(attrs, 't')
      const sFragment = goldS != null ? ` s="${goldS}"` : ''
      if (goldT === 's' && end !== '/>') {
        const idxMatch = (inner ?? '').match(/<v>(\d+)<\/v>/)
        if (idxMatch) {
          const idx = Number(idxMatch[1])
          const text = goldSharedStrings[idx]
          if (text != null) {
            const body = inlineStrBody(text, whiteTextAddresses.has(addr))
            return `<c r="${addr}"${sFragment} t="inlineStr">${body}</c>`
          }
        }
      }
      return _full
    },
  )
  const missing: Array<[string, OverlayValue]> = []
  for (const [addr, value] of overlay) {
    if (!visited.has(addr) && value != null && value !== '') {
      missing.push([addr, value])
    }
  }
  return insertMissingCells(rewritten, missing)
}

// ─── Per-sheet write maps ──────────────────────────────────────────────────

/**
 * Build the address → value overlay for the PS Use Case Worksheet
 * sheet. Mirrors the writes done by `fillPsUseCaseWorksheet` in
 * {@link ./v091ExportWorkbook} — the two are intentionally kept in
 * lockstep: any cell `fillPsUseCaseWorksheet` touches MUST appear in
 * this overlay so its `s=` is reset to gold's, and conversely no cell
 * may appear here that the filler doesn't touch (would silently blank
 * a static label).
 *
 * Empty / undefined activation rows produce no overlay entry — the
 * cell falls through to gold's verbatim content (which is the
 * pre-shipped "Not Started" / blank state).
 */
function psUseCaseWorksheetOverlay(activation: Activation): OverlayMap {
  const m: OverlayMap = new Map()
  // Block 1 — Activation Base Scope (rows 3..7): D=Status, E=Notes
  for (let i = 0; i < PS_BASE_SCOPE_ITEMS.length; i += 1) {
    const r = PS_BLOCK1_FIRST_DATA_ROW + i
    const row = activation.baseScope[i]
    if (row) {
      m.set(`D${r}`, row.status || null)
      m.set(`E${r}`, row.notes || null)
    }
  }
  // Block 2 — Activation Use Case Overview (rows 11..15): B=kind picker
  for (let i = 0; i < PS_USE_CASE_COUNT; i += 1) {
    const r = PS_BLOCK2_FIRST_DATA_ROW + i
    const slot = activation.useCaseOverview[i]
    if (slot) {
      m.set(`B${r}`, slot.kind || null)
    }
  }
  // Block 3a — Base Scope Worksheet anchors (rows 19..21): C=Parameters,
  // D=Status, E=Notes
  for (let i = 0; i < PS_BASE_SCOPE_WORKSHEET_LABELS.length; i += 1) {
    const r = PS_BASE_SCOPE_WORKSHEET_FIRST_ROW + i
    const row = activation.baseScopeWorksheet[i]
    if (row) {
      m.set(`C${r}`, row.parameters || null)
      m.set(`D${r}`, row.status || null)
      m.set(`E${r}`, row.notes || null)
    }
  }
  // Block 3b — Per-use-case parameter rows (rows 22..46)
  for (let uc = 0; uc < PS_USE_CASE_COUNT; uc += 1) {
    const useCase = activation.useCases[uc]
    if (!useCase) continue
    for (let p = 0; p < PS_PARAMETERS_PER_USE_CASE; p += 1) {
      const r =
        PS_USE_CASE_WORKSHEET_FIRST_ROW + uc * PS_PARAMETERS_PER_USE_CASE + p
      const row = useCase.parameters[p]
      if (row) {
        m.set(`C${r}`, row.parameters || null)
        m.set(`D${r}`, row.status || null)
        m.set(`E${r}`, row.notes || null)
      }
    }
  }
  return m
}

// ─── Per-sheet restorers ───────────────────────────────────────────────────

/**
 * Convert a sheet's worksheet path (`xl/worksheets/sheetN.xml`) into
 * its rels path (`xl/worksheets/_rels/sheetN.xml.rels`).
 */
function sheetRelsPathFor(sheetPath: string): string {
  return sheetPath.replace(/^(xl\/worksheets\/)(sheet\d+\.xml)$/, '$1_rels/$2.rels')
}

/**
 * Find the relationship id (`rId…`) in `relsXml` whose `Target`
 * matches `expectedTarget`, or `null` if none is found. Used to map
 * gold's tableParts (`rId5/6/7`) onto whatever rIds ExcelJS allocated
 * for the same table targets in the output.
 */
function rIdForTarget(relsXml: string, expectedTarget: string): string | null {
  const escaped = expectedTarget.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const re = new RegExp(`<Relationship\\s[^>]*?Id="([^"]+)"[^>]*?Target="${escaped}"[^>]*?/>`)
  const m = relsXml.match(re)
  if (m) return m[1]!
  // ExcelJS sometimes emits attributes in the opposite order.
  const re2 = new RegExp(`<Relationship\\s[^>]*?Target="${escaped}"[^>]*?Id="([^"]+)"[^>]*?/>`)
  const m2 = relsXml.match(re2)
  return m2 ? m2[1]! : null
}

/**
 * Replace the `<tableParts>` block in `sheetXml` with one that
 * references `rIds` in document order. Used after we copy gold's
 * sheet XML verbatim — gold's tableParts say `rId5/6/7` but the
 * matching ExcelJS-produced rels file may have allocated different
 * ids (commonly `rId2/3/4`).
 */
function rewriteTableParts(sheetXml: string, rIds: readonly string[]): string {
  if (rIds.length === 0) {
    return sheetXml
  }
  const inner = rIds.map((id) => `<tablePart r:id="${id}"/>`).join('')
  const block = `<tableParts count="${rIds.length}">${inner}</tableParts>`
  // Order matters: try the full-form (open + close tags, possibly with
  // child <tablePart/> entries) first. Only fall back to the truly
  // self-closing form (`<tableParts ... />` with no children at all)
  // when no closing tag exists. Putting the self-closing branch first
  // would let `[^…]*\/>` greedily match the `/>` of the first nested
  // `<tablePart …/>` child, leaving the rest of the block orphaned and
  // producing malformed XML that Excel will tolerate but Google Sheets
  // refuses to open.
  if (/<\/tableParts>/.test(sheetXml)) {
    return sheetXml.replace(/<tableParts\b[^>]*>[\s\S]*?<\/tableParts>/, block)
  }
  // True self-closing form: no `<` or `>` between `<tableParts` and `/>`.
  return sheetXml.replace(/<tableParts\b[^<>]*\/>/, block)
}

/**
 * Restore PS Use Case Worksheet (the gold's sheet 2). The full sheet
 * XML is replaced with gold's verbatim copy, then the cells the app
 * writes are overlaid in place.
 *
 * Beyond the cell-level overlay, this also has to repair two things
 * ExcelJS routinely breaks on tables-bearing sheets:
 *
 *   1. The gold ListObject tables (`xl/tables/table{1,2,3}.xml` —
 *      Activation Base Scope, Use Case Overview, Use Case Worksheet)
 *      are copied byte-exact from gold. ExcelJS adds
 *      `headerRowCount="0"` and an `<autoFilter>` block which
 *      silently disables the green "table header" styling that gives
 *      rows 2, 10, and 18 their banner background — even though the
 *      cells themselves carry no fill and rely on the table to paint
 *      the header.
 *
 *   2. Gold's `<tableParts>` element references `rId5/6/7`, but
 *      ExcelJS allocates `rId2/3/4` (or similar) when it rewrites the
 *      rels file. The relationships themselves are correct in the
 *      output's rels file — the rIds just don't line up. We rewrite
 *      `<tableParts>` to use whatever rIds ExcelJS allocated, sourced
 *      by matching on the `Target` paths (`../tables/table{1,2,3}.xml`).
 *
 * No-op if either workbook is missing this sheet.
 */
async function restorePsUseCaseWorksheetSheet(
  zIn: JSZip,
  zOut: JSZip,
  plan: PlanState,
): Promise<void> {
  const inMap = await buildSheetNamePathMap(zIn)
  const outMap = await buildSheetNamePathMap(zOut)
  const inPath = inMap.get(SHEET_PS_USE_CASE_WORKSHEET)
  const outPath = outMap.get(SHEET_PS_USE_CASE_WORKSHEET)
  if (!inPath || !outPath) {
    return
  }
  const goldSheetXml = await zIn.file(inPath)?.async('string')
  if (!goldSheetXml) {
    return
  }
  const goldSharedStringsXml =
    (await zIn.file('xl/sharedStrings.xml')?.async('string')) ?? ''
  const goldSharedStrings = parseSharedStrings(goldSharedStringsXml)
  const overlay = psUseCaseWorksheetOverlay(plan.activation)
  // Header-row text pin: rows 2 and 18 are the header rows of the
  // outer two `<table>` elements (Activation Base Scope; Use Case
  // Worksheet). Their cells have `fillId="0"` and rely on the
  // `headerRow` dxf for their green background — Google Sheets does
  // not auto-flip text to white in that case (vs. row 10, whose cells
  // carry `fillId="2"` directly via `s=17/18` and DO auto-flip). We
  // emit those text runs with an inline `<rPr><color rgb="FFFFFFFF"/>`
  // so the headers render white-on-green in both Excel and Google.
  const whiteTextAddresses = new Set<string>([
    'A2', 'B2', 'C2', 'D2', 'E2',
    'A18', 'B18', 'C18', 'D18', 'E18',
  ])
  let patched = overlayCellsInSheet(
    goldSheetXml,
    goldSharedStrings,
    overlay,
    whiteTextAddresses,
  )

  // Cell-level perimeter borders for tables 1 (Activation Base Scope
  // A2:E7) and 3 (Activation Use Case Worksheet A18:E46). Gold paints
  // its single outer rectangle via the `wholeTable` table-style dxf,
  // which Excel applies but Google Sheets ignores. To produce just
  // the outer perimeter — top edge across A2..E2, right edge down
  // E2..E7, bottom edge across A7..E7, left edge down A2..A7, plus
  // the same for table 3 — we:
  //
  //   1. Snapshot every existing `<c r="…" s="N">` so we know each
  //      cell's gold style index.
  //   2. Append 8 borders (T/B/L/R + 4 corners) and per-(baseS, edge)
  //      cellXf clones to `xl/styles.xml`.
  //   3. Rewrite every existing perimeter cell's `s=` to the matching
  //      border-aware clone — leaving inner content (including header
  //      cells' inline `<rPr>` white-text wrapping) untouched.
  //   4. Splice in `<c r="ADDR" s="…"/>` for every perimeter address
  //      gold dropped (E3..E7 Notes column, B7..D7 bottom row, much
  //      of table 3's C/D/E columns, etc.). Without an explicit
  //      `<c>` element there's nothing for OOXML to attach a border
  //      to, leaving the perimeter incomplete.
  //
  // Interior cells are not touched, so the body of each table keeps
  // gold's default no-border look.
  const PS_TABLES: readonly TableRect[] = [
    { topRow: 2,  bottomRow: 7,  leftCol: 'A', rightCol: 'E', cols: ['A','B','C','D','E'] },
    { topRow: 18, bottomRow: 46, leftCol: 'A', rightCol: 'E', cols: ['A','B','C','D','E'] },
  ]
  const existingCellStyles = readExistingCellStyles(patched)
  const { remap, defaultByEdge } = await patchActivationTablePerimeterCellXfs(
    zOut,
    PS_TABLES,
    existingCellStyles,
  )
  if (remap.size > 0) {
    patched = applyPerimeterToSheet(
      patched,
      PS_TABLES,
      existingCellStyles,
      remap,
      defaultByEdge,
    )
  }

  // Rewrite <tableParts> to match the rIds ExcelJS allocated in the
  // output's rels file. The 3 PS Use Case Worksheet tables live at
  // `xl/tables/table{1,2,3}.xml` in both gold and output (verified
  // by name + ref in 2026-05-04 diffing).
  const outRelsPath = sheetRelsPathFor(outPath)
  const outRelsXml = (await zOut.file(outRelsPath)?.async('string')) ?? ''
  const tableTargets: readonly string[] = [
    '../tables/table1.xml',
    '../tables/table2.xml',
    '../tables/table3.xml',
  ]
  const outRIds: string[] = []
  for (const target of tableTargets) {
    const id = rIdForTarget(outRelsXml, target)
    if (id) {
      outRIds.push(id)
    }
  }
  if (outRIds.length === tableTargets.length) {
    patched = rewriteTableParts(patched, outRIds)
  }

  zOut.file(outPath, patched)

  // Copy gold's table XML files verbatim. Drops the `headerRowCount="0"`
  // and `<autoFilter>` additions ExcelJS injects, restoring the green
  // header-row styling on the three Activation tables.
  for (const tableFile of ['table1.xml', 'table2.xml', 'table3.xml']) {
    const goldTable = await zIn.file(`xl/tables/${tableFile}`)?.async('string')
    if (goldTable) {
      zOut.file(`xl/tables/${tableFile}`, goldTable)
    }
  }
}

// ─── Stream / Edge Overview restorer ───────────────────────────────────────

/**
 * Per-kind metadata for the Stream / Edge Overview restorer. The two
 * sheets are structurally identical (same row layout, same column
 * counts, same hidden top table) — they just differ in sheet name,
 * which set of WGs to filter, and which `xl/tables/tableN.xml` files
 * back the two ListObjects.
 */
interface OverviewSheetSpec {
  /** Worksheet display name (`Stream Overview` / `Edge Overview`). */
  sheetName: string
  /**
   * `xl/tables/tableN.xml` files backing this sheet's two
   * ListObjects, in document order: `[topHidden, bottomVisible]`.
   * Stream uses table4/table5; Edge uses table6/table7. Only the
   * bottom table is user-facing — the top is left untouched as
   * gold's empty hidden region.
   */
  tableFiles: readonly [string, string]
  /**
   * `<tableParts>`-style rels Targets for the two tables. Same
   * order as {@link tableFiles}; used to look up whatever rIds
   * ExcelJS allocated in the output's rels file so we can rewrite
   * `<tableParts r:id="…"/>` to point at them.
   */
  tableTargets: readonly [string, string]
}

const STREAM_OVERVIEW_SPEC: OverviewSheetSpec = {
  sheetName: 'Stream Overview',
  tableFiles: ['table4.xml', 'table5.xml'],
  tableTargets: ['../tables/table4.xml', '../tables/table5.xml'],
}

const EDGE_OVERVIEW_SPEC: OverviewSheetSpec = {
  sheetName: 'Edge Overview',
  tableFiles: ['table6.xml', 'table7.xml'],
  tableTargets: ['../tables/table6.xml', '../tables/table7.xml'],
}

/**
 * Column footprint of the bottom Worker Groups & Specs / Fleets &
 * Specs table on Stream Overview / Edge Overview (gold's table5
 * `WGs` and table7 `FLs`). Both ship with the same 8 columns (A..H):
 * WG / Fleet, Ingest, Egress, Throughput, Worker Hosting, Worker
 * Count, Worker Detail, Disk Req'd. The top
 * "Sources, Volume, Region" tables (gold's table4 / table6) are
 * intentionally untouched — gold ships their rows as `hidden="1"`
 * and the v0.9.1 importer ignores them.
 */
const OVERVIEW_BOTTOM_COLS: readonly string[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

/**
 * Bottom row of the gold's bottom table when no plan rows exceed the
 * pre-shipped 8 specs (rows 17..24). Mirrors the `+ 8 - 1` math in
 * `fixOverviewTableRefs` for the WG / FL tables.
 */
const OVERVIEW_BOTTOM_LAST_DATA_ROW_DEFAULT = V091_OVERVIEW_TABLE2_FIRST_DATA_ROW + 8 - 1

/**
 * Parse a free-text number-like string ("12.5", "1,200", " 0 ") into
 * a finite JS number, or `null` when blank / unparseable. Mirrors the
 * `parseNumber` helper inside `v091ExportWorkbook.ts` but returns
 * `null` instead of `''` so it composes cleanly with {@link OverlayValue}
 * (where `null` is the gold-empty marker and a literal `0` is a valid
 * numeric write).
 */
function parseOverviewNum(s: string | undefined): number | null {
  if (!s) return null
  const t = s.trim()
  if (!t) return null
  const n = Number(t.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Build the address → value overlay for one Overview sheet
 * (`Stream Overview` or `Edge Overview`), filtered to the WGs of the
 * given `kind`.
 *
 * Both sheets ship **two** ListObject tables in the gold, but only
 * the bottom one is user-facing:
 *
 *   - Top table (gold's `SourcesVolumeCollection` /
 *     `SourcesVolumeCollection_2`, A2:I14) — a v0.8.6 carry-over
 *     rolled-up Sources table. Gold ships every row in this band as
 *     `hidden="1"`, and the v0.9.1 importer intentionally ignores it
 *     (per the doc-comment on `parseV091Workbook`: "the top table …
 *     is a write-only artifact"). Sources are read from per-WG /
 *     per-Fleet sheets instead. This restorer therefore writes
 *     **nothing** to the top half so it stays as gold's empty hidden
 *     region — invisible to the user.
 *
 *   - Bottom table (gold's `WGs` / `FLs`, A16:H24) — Worker Groups
 *     & Specs / Fleets & Specs. This is what the user sees and
 *     edits, and what the v0.9.1 importer parses for capacity. We
 *     mirror the corresponding-kind WG-block writes done by
 *     `fillOverviewSheet(kind)` in {@link ./v091ExportWorkbook}:
 *     rows 17..17+M-1 hold one WG / Fleet each (cols A..H), with
 *     explicit `null` entries on the leftover gold-shipped slots so
 *     a shrink doesn't leave phantom values from a previous export.
 *
 * Numeric columns (B / C / D / H on the bottom table) are written
 * as `OverlayValue` numbers so the output keeps a real numeric cell
 * (`<c><v>N</v></c>`) — Excel formulas / number formats stay live
 * and `Number.isFinite` checks on round-trip read still succeed.
 * Empty / unparseable values produce gold-empty cells.
 *
 * Returns the overlay along with the actual last data row of the
 * bottom table, used downstream to drive the perimeter-border range.
 */
function overviewBottomTableOverlay(
  plan: PlanState,
  kind: WorkerGroupKind,
): {
  overlay: OverlayMap
  bottomLastDataRow: number
} {
  const overlay: OverlayMap = new Map()
  const wgs = plan.workerGroups.filter((w) =>
    kind === 'edge' ? w.kind === 'edge' : w.kind !== 'edge',
  )

  const slots =
    OVERVIEW_BOTTOM_LAST_DATA_ROW_DEFAULT - V091_OVERVIEW_TABLE2_FIRST_DATA_ROW + 1
  const wgsCapped = wgs.slice(0, slots)
  for (let j = 0; j < wgsCapped.length; j += 1) {
    const r = V091_OVERVIEW_TABLE2_FIRST_DATA_ROW + j
    const wg = wgsCapped[j]!
    const cap = effectiveIngestEgressGbdForWg(plan, wg)
    const ingest =
      cap?.ingestGb != null && Number.isFinite(cap.ingestGb)
        ? cap.ingestGb
        : parseOverviewNum(wg.ingestGbd)
    const egress =
      cap?.egressGb != null && Number.isFinite(cap.egressGb)
        ? cap.egressGb
        : parseOverviewNum(wg.egressGbd)
    overlay.set(`A${r}`, wg.wg || null)
    overlay.set(`B${r}`, ingest)
    overlay.set(`C${r}`, egress)
    overlay.set(`D${r}`, effectiveThroughputGbdForWg(plan, wg))
    overlay.set(`E${r}`, wg.workerHosting || null)
    overlay.set(`F${r}`, wg.workerCount || null)
    overlay.set(`G${r}`, wg.workerDetail || null)
    overlay.set(`H${r}`, effectiveDiskOneDayGbForWg(plan, wg))
  }
  for (let j = wgsCapped.length; j < slots; j += 1) {
    const r = V091_OVERVIEW_TABLE2_FIRST_DATA_ROW + j
    for (const c of OVERVIEW_BOTTOM_COLS) {
      overlay.set(`${c}${r}`, null)
    }
  }

  // Effective last data row of the bottom table, used to size the
  // perimeter border rectangle. Capped to the gold default (row 24)
  // — anything past that lives outside our overlay anyway.
  const bottomLastDataRow = V091_OVERVIEW_TABLE2_FIRST_DATA_ROW + wgsCapped.length - 1
  return {
    overlay,
    bottomLastDataRow: Math.max(bottomLastDataRow, OVERVIEW_BOTTOM_LAST_DATA_ROW_DEFAULT),
  }
}

/**
 * Replace `xl/tables/${tableFile}` in `zOut` with gold's verbatim
 * copy, but preserve whatever `ref="…"` ExcelJS / `fixOverviewTableRefs`
 * has already settled on. Used for Stream / Edge overview tables whose
 * height grows with plan size:
 *
 *   - Gold's pre-shipped table4 ships `ref="A2:I14"` (12 source slots).
 *   - `fixOverviewTableRefs` widens this to e.g. `ref="A2:I20"` for
 *     plans with more sources — that wider ref must survive the
 *     restore.
 *   - ExcelJS, in turn, also injects `headerRowCount="0"` and an
 *     `<autoFilter>` block that suppresses the green table-style
 *     header band; gold's verbatim copy is the cleanest way to drop
 *     both at once.
 *
 * No-op when the gold or output file is missing (e.g. a workbook
 * shape we don't expect).
 */
async function restoreTableWithDynamicRef(
  zIn: JSZip,
  zOut: JSZip,
  tableFile: string,
): Promise<void> {
  const path = `xl/tables/${tableFile}`
  const goldXml = await zIn.file(path)?.async('string')
  const outXml = await zOut.file(path)?.async('string')
  if (!goldXml || !outXml) return
  const dynRefMatch = /\bref="([^"]+)"/.exec(outXml)
  if (!dynRefMatch) return
  const dynRef = dynRefMatch[1]!
  const restored = goldXml.replace(/(<table\b[^>]*?\bref=")[^"]+(")/, `$1${dynRef}$2`)
  zOut.file(path, restored)
}

/**
 * Restore one Overview sheet (`Stream Overview` for `kind="stream"`,
 * `Edge Overview` for `kind="edge"`). Same playbook as
 * {@link restorePsUseCaseWorksheetSheet}, scoped to the **bottom**
 * Worker Groups & Specs / Fleets & Specs table only:
 *
 *   - The gold sheet ships two ListObject tables — a top
 *     "Sources, Volume, Region" rolled-up sources table at A2:I14
 *     (every row marked `hidden="1"`) and a bottom WGs / FLs table
 *     at A16:H24. The v0.9.1 importer ignores the top table by
 *     design (sources live on per-WG / per-Fleet sheets), so we
 *     leave gold's hidden-empty top half untouched. The user only
 *     ever sees the bottom table.
 *
 *   - Replace the worksheet XML with gold's verbatim copy and
 *     overlay plan-derived WG / Fleet data on rows 17..24. Numeric
 *     columns (Ingest / Egress / Throughput / Disk) are written as
 *     native numeric cells (`<c><v>N</v></c>`) so number formatting
 *     and formula references continue to work; string columns
 *     become inline strings (decoupled from
 *     `xl/sharedStrings.xml`).
 *
 *   - Pin the bottom-table header text on row 16 (A16:H16) to white
 *     via run-level `<rPr><color rgb="FFFFFFFF"/>`. Same reason as
 *     the PS Use Case Worksheet rows 2/18 fix: those cells have
 *     `fillId="0"` and rely on the table style's `headerRow` dxf
 *     for their green band, which Google Sheets does not auto-flip
 *     text white against.
 *
 *   - Replace `xl/tables/${spec.tableFiles[0]}` and
 *     `${spec.tableFiles[1]}` from gold but keep the dynamic
 *     `ref="…"` `fixOverviewTableRefs` already wrote. This drops
 *     ExcelJS's `headerRowCount="0"` / `<autoFilter>` injections so
 *     the table style re-engages.
 *
 *   - Rewrite `<tableParts r:id=…>` to use whatever rIds ExcelJS
 *     allocated in the output's rels file. Gold says `rId4/5`; the
 *     output may have allocated `rId1/2`. Skipping this step leaves
 *     dangling references that Excel tolerates but Google Sheets
 *     refuses to open.
 *
 *   - Append cell-level perimeter borders for the bottom table over
 *     its dynamic range (A16:H{lastBottomRow}), using the same
 *     8-borders-+-cellXf-clones machinery as the PS Use Case
 *     Worksheet. The hidden top table is left without a perimeter —
 *     it's invisible anyway.
 *
 * No-op when either workbook is missing this sheet.
 */
async function restoreOverviewSheet(
  zIn: JSZip,
  zOut: JSZip,
  plan: PlanState,
  kind: WorkerGroupKind,
  spec: OverviewSheetSpec,
): Promise<void> {
  const inMap = await buildSheetNamePathMap(zIn)
  const outMap = await buildSheetNamePathMap(zOut)
  const inPath = inMap.get(spec.sheetName)
  const outPath = outMap.get(spec.sheetName)
  if (!inPath || !outPath) {
    return
  }
  const goldSheetXml = await zIn.file(inPath)?.async('string')
  if (!goldSheetXml) {
    return
  }
  const goldSharedStringsXml =
    (await zIn.file('xl/sharedStrings.xml')?.async('string')) ?? ''
  const goldSharedStrings = parseSharedStrings(goldSharedStringsXml)
  const { overlay, bottomLastDataRow } = overviewBottomTableOverlay(plan, kind)

  // Header-row text pin: only row 16 (A..H), the visible WGs / FLs
  // table. Row 2 (A..I) on the hidden top table is left alone —
  // pinning a hidden row's text white would have no visible effect,
  // and any gold-shipped shared-string ref left in those cells will
  // fall through `overlayCellsInSheet`'s standard t="s" → inlineStr
  // conversion (which preserves gold's text + s= unchanged).
  const whiteTextAddresses = new Set<string>()
  for (const c of OVERVIEW_BOTTOM_COLS) {
    whiteTextAddresses.add(`${c}${V091_OVERVIEW_TABLE2_HEADER_ROW}`)
  }

  let patched = overlayCellsInSheet(
    goldSheetXml,
    goldSharedStrings,
    overlay,
    whiteTextAddresses,
  )

  // Rewrite <tableParts> to match the rIds ExcelJS allocated in the
  // output's rels file.
  const outRelsPath = sheetRelsPathFor(outPath)
  const outRelsXml = (await zOut.file(outRelsPath)?.async('string')) ?? ''
  const outRIds: string[] = []
  for (const target of spec.tableTargets) {
    const id = rIdForTarget(outRelsXml, target)
    if (id) {
      outRIds.push(id)
    }
  }
  if (outRIds.length === spec.tableTargets.length) {
    patched = rewriteTableParts(patched, outRIds)
  }

  // Cell-level perimeter borders for the bottom table only. Top
  // table (A2:I14) lives on hidden rows so a perimeter there is
  // invisible and just bloats `cellXfs`. Same 8-borders +
  // cellXf-clone strategy as the PS Use Case Worksheet — only the
  // outer rectangle is bordered; interior cells keep gold's
  // no-border default.
  const overviewTables: readonly TableRect[] = [
    {
      topRow: V091_OVERVIEW_TABLE2_HEADER_ROW,
      bottomRow: bottomLastDataRow,
      leftCol: 'A',
      rightCol: 'H',
      cols: OVERVIEW_BOTTOM_COLS,
    },
  ]
  const existingCellStyles = readExistingCellStyles(patched)
  const { remap, defaultByEdge } = await patchActivationTablePerimeterCellXfs(
    zOut,
    overviewTables,
    existingCellStyles,
  )
  if (remap.size > 0) {
    patched = applyPerimeterToSheet(
      patched,
      overviewTables,
      existingCellStyles,
      remap,
      defaultByEdge,
    )
  }

  zOut.file(outPath, patched)

  // Restore both tables from gold — drops ExcelJS's
  // `headerRowCount="0"` / `<autoFilter>` injections — but preserves
  // the dynamic `ref="…"` already widened by `fixOverviewTableRefs`.
  // (The hidden top table's ref widening is meaningless visually but
  // OOXML-clean.)
  for (const tableFile of spec.tableFiles) {
    await restoreTableWithDynamicRef(zIn, zOut, tableFile)
  }
}

// ─── styles.xml mutation helpers ───────────────────────────────────────────

/**
 * Append a `<border>` element to `xl/styles.xml`'s `<borders>`
 * collection, bumping its `count` attribute. Returns the index of the
 * newly added border so callers can wire `cellXfs` to reference it.
 *
 * No-op on the input string when `<borders>` is missing — the styles
 * file is malformed at that point and a deeper restore will already
 * be flagging the workbook as broken.
 */
function appendBorder(stylesXml: string, borderXml: string): { xml: string; index: number } {
  const m = stylesXml.match(/<borders\s+count="(\d+)"\s*>([\s\S]*?)<\/borders>/)
  if (!m) return { xml: stylesXml, index: -1 }
  const oldCount = Number(m[1])
  const newCount = oldCount + 1
  const newBlock = `<borders count="${newCount}">${m[2]}${borderXml}</borders>`
  return { xml: stylesXml.replace(m[0], newBlock), index: oldCount }
}

/**
 * Append cellXf entries to `xl/styles.xml`'s `<cellXfs>` collection,
 * bumping its `count`. Returns the indices of the newly added entries
 * (in the same order as `xfXmls`).
 *
 * Each new cellXf is expected to be a complete `<xf …/>` (or
 * `<xf …>…</xf>`) string. Callers typically build them by cloning an
 * existing entry and tweaking `borderId` / `applyBorder`.
 */
function appendCellXfs(
  stylesXml: string,
  xfXmls: readonly string[],
): { xml: string; indices: number[] } {
  const m = stylesXml.match(/<cellXfs\s+count="(\d+)"\s*>([\s\S]*?)<\/cellXfs>/)
  if (!m) return { xml: stylesXml, indices: [] }
  const oldCount = Number(m[1])
  const newCount = oldCount + xfXmls.length
  const newBlock = `<cellXfs count="${newCount}">${m[2]}${xfXmls.join('')}</cellXfs>`
  const indices = xfXmls.map((_, i) => oldCount + i)
  return { xml: stylesXml.replace(m[0], newBlock), indices }
}

/**
 * Pull the `i`th `<xf>` element out of a `<cellXfs>` block. Used to
 * clone an existing cellXf so we can modify a single attribute
 * (typically `borderId`) on it without disturbing all the rest of its
 * font / fill / alignment wiring.
 *
 * Returns null when the index is out of range.
 */
function getCellXfAt(stylesXml: string, idx: number): string | null {
  const m = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)
  if (!m) return null
  const inner = m[1]!
  const xfs = [...inner.matchAll(/<xf\b[^>]*?\/>|<xf\b[^>]*?>[\s\S]*?<\/xf>/g)]
  if (idx < 0 || idx >= xfs.length) return null
  return xfs[idx]![0]
}

/**
 * Clone a cellXf, swap its `borderId` attribute to `newBorderId`, and
 * add `applyBorder="1"` if absent. Pure string manipulation; the
 * existing attribute order is preserved so unrelated tooling (Excel,
 * Google Sheets, openpyxl) round-trips it cleanly.
 */
function cloneXfWithBorder(xfXml: string, newBorderId: number): string {
  let out = xfXml
  if (/borderId="\d+"/.test(out)) {
    out = out.replace(/borderId="\d+"/, `borderId="${newBorderId}"`)
  } else {
    out = out.replace(/<xf\b/, `<xf borderId="${newBorderId}"`)
  }
  if (!/applyBorder="1"/.test(out)) {
    out = out.replace(/<xf\b/, '<xf applyBorder="1"')
  }
  return out
}

// ─── Cross-sheet styles.xml fixups ─────────────────────────────────────────

/**
 * Pin every ListObject table's header-row text to white.
 *
 * Gold ships `xl/styles.xml` with `dxf 1` carrying a dark-green solid
 * fill (`FF356854`) and an empty `<font/>`. Every table style on the
 * workbook references that dxf as its `headerRow` — Stream Overview,
 * Edge Overview, all three PS Use Case Worksheet tables, etc. With an
 * empty font, the rendered text color is left to the cell's underlying
 * `fontXf`; Excel and (some Google Sheets paths) auto-flip to white
 * for contrast against the dark fill, but Google Sheets does NOT
 * auto-flip when the fill arrives via the table-style override (i.e.
 * the cell's own `fillId="0"` plus a `headerRow` dxf paint), only when
 * the fill is on the cell directly. The result: row 10's
 * "Use Case # / Use Case" headers (cells with `fillId=2` baked in via
 * `s=17/18`) render white on green, but rows 2 and 18 — whose green
 * comes from the table style — render dark text on green.
 *
 * Adding `<color rgb="FFFFFFFF"/>` inside the dxf 1 font is the
 * OOXML-canonical way to pin every table's headerRow text to white,
 * removes the heuristic dependency, and renders identically in Excel.
 *
 * Idempotent: only fires when the font element is still in its empty
 * gold form. Bails out cleanly if the dxf collection's shape isn't
 * what we expect (different schema would warrant a deliberate fix
 * rather than a silent corruption).
 */
async function patchHeaderRowFontWhite(zOut: JSZip): Promise<void> {
  const stylesXml = await zOut.file('xl/styles.xml')?.async('string')
  if (!stylesXml) return
  const dxfsMatch = stylesXml.match(/<dxfs\b[^>]*>([\s\S]*?)<\/dxfs>/)
  if (!dxfsMatch) return
  const dxfsBlock = dxfsMatch[0]
  const dxfsInner = dxfsMatch[1] ?? ''
  const dxfMatches = [...dxfsInner.matchAll(/<dxf>[\s\S]*?<\/dxf>/g)]
  if (dxfMatches.length < 2) return
  const target = dxfMatches[1]![0]
  // Sanity-pin: gold dxf 1 is the green-fill headerRow dxf. If the
  // workbook's dxf 1 has a different fill, we're not looking at the
  // expected dxf collection — bail rather than guess.
  if (!/FF356854/i.test(target)) return
  if (!/<font\s*\/>/.test(target)) return
  const patchedDxf = target.replace(
    /<font\s*\/>/,
    '<font><color rgb="FFFFFFFF"/></font>',
  )
  const patchedInner = dxfsInner.replace(target, patchedDxf)
  const patchedBlock = dxfsBlock.replace(dxfsInner, patchedInner)
  const patchedXml = stylesXml.replace(dxfsBlock, patchedBlock)
  zOut.file('xl/styles.xml', patchedXml)
}

/**
 * Position of a cell relative to its enclosing rectangle. Encodes
 * which of the four sides (top / bottom / left / right) of the cell
 * sit on the outer edge of the table — i.e. need a green border.
 * Interior cells (no edge) are absent from this enum entirely; they
 * are handled by skipping perimeter rewrites for them.
 */
type EdgeKind = 'T' | 'B' | 'L' | 'R' | 'TL' | 'TR' | 'BL' | 'BR'

/**
 * One thin-green border XML per `EdgeKind`. The XML matches gold's
 * `wholeTable` dxf shape but only paints the side(s) that sit on
 * the outer edge of the table. Excel and Google Sheets both render
 * adjacent perimeter cells' borders as a continuous outer line, so
 * the four corners + four edges yield a single rectangle around the
 * table without any inner gridlines.
 */
const PERIMETER_BORDER_XML: Readonly<Record<EdgeKind, string>> = {
  T: '<border><top style="thin"><color rgb="FF356854"/></top></border>',
  B: '<border><bottom style="thin"><color rgb="FF356854"/></bottom></border>',
  L: '<border><left style="thin"><color rgb="FF356854"/></left></border>',
  R: '<border><right style="thin"><color rgb="FF356854"/></right></border>',
  TL:
    '<border>' +
    '<left style="thin"><color rgb="FF356854"/></left>' +
    '<top style="thin"><color rgb="FF356854"/></top>' +
    '</border>',
  TR:
    '<border>' +
    '<right style="thin"><color rgb="FF356854"/></right>' +
    '<top style="thin"><color rgb="FF356854"/></top>' +
    '</border>',
  BL:
    '<border>' +
    '<left style="thin"><color rgb="FF356854"/></left>' +
    '<bottom style="thin"><color rgb="FF356854"/></bottom>' +
    '</border>',
  BR:
    '<border>' +
    '<right style="thin"><color rgb="FF356854"/></right>' +
    '<bottom style="thin"><color rgb="FF356854"/></bottom>' +
    '</border>',
}

const ALL_EDGE_KINDS: readonly EdgeKind[] = [
  'T',
  'B',
  'L',
  'R',
  'TL',
  'TR',
  'BL',
  'BR',
]

/**
 * Rectangular cell-range used to describe where a perimeter border
 * should be drawn on a worksheet. Inclusive on every bound. `cols`
 * is the alphabetical sequence of columns spanned (e.g.
 * `['A', 'B', 'C', 'D', 'E']`); we pre-list it instead of expanding
 * `leftCol`..`rightCol` at runtime so callers can stay explicit
 * about which intermediate columns count as part of the table
 * footprint.
 */
interface TableRect {
  topRow: number
  bottomRow: number
  leftCol: string
  rightCol: string
  cols: readonly string[]
}

/**
 * Resolve the cell at (row, col) to an `EdgeKind`, or `null` for
 * interior cells. Pure function — used during the perimeter scan to
 * decide whether each cell needs to be remapped to a border-aware
 * cellXf clone.
 */
function classifyEdge(row: number, col: string, rect: TableRect): EdgeKind | null {
  const isTop = row === rect.topRow
  const isBottom = row === rect.bottomRow
  const isLeft = col === rect.leftCol
  const isRight = col === rect.rightCol
  if (!(isTop || isBottom || isLeft || isRight)) return null
  if (isTop && isLeft) return 'TL'
  if (isTop && isRight) return 'TR'
  if (isBottom && isLeft) return 'BL'
  if (isBottom && isRight) return 'BR'
  if (isTop) return 'T'
  if (isBottom) return 'B'
  if (isLeft) return 'L'
  return 'R'
}

/**
 * Default `s=` to use as the cell-style "base" when a perimeter
 * position is missing from gold (no `<c>` element to inherit a font
 * / alignment from). Cells inserted at these positions are always
 * empty, so the choice mainly affects whether the border line
 * inherits any compatible alignment metadata; `s=15` is gold's most
 * common borderless body cellXf on the PS Use Case Worksheet.
 */
const PERIMETER_DEFAULT_BASE_XF = 15

/**
 * Build the perimeter spec for a table: list each edge cell once,
 * paired with its classified `EdgeKind`. Interior cells are not
 * included, so callers can simply iterate the result and ignore
 * everything else inside the rect.
 */
function perimeterCellsOf(rect: TableRect): Array<{ addr: string; edge: EdgeKind }> {
  const out: Array<{ addr: string; edge: EdgeKind }> = []
  for (let r = rect.topRow; r <= rect.bottomRow; r += 1) {
    for (const c of rect.cols) {
      const edge = classifyEdge(r, c, rect)
      if (edge != null) {
        out.push({ addr: `${c}${r}`, edge })
      }
    }
  }
  return out
}

/**
 * Read every `<c r="ADDR" … s="N">` already present on `sheetXml`
 * into an `addr -> s` map. Cells without an `s=` attribute (rare on
 * this sheet but legal in OOXML) are absent from the map; callers
 * fall back to {@link PERIMETER_DEFAULT_BASE_XF} for those.
 */
function readExistingCellStyles(sheetXml: string): Map<string, number> {
  const out = new Map<string, number>()
  const re = /<c\s+([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sheetXml)) !== null) {
    const addrRaw = attr(m[1]!, 'r')
    const sRaw = attr(m[1]!, 's')
    if (addrRaw == null) continue
    if (sRaw != null) {
      out.set(addrRaw, Number(sRaw))
    }
  }
  return out
}

/**
 * Append the eight perimeter borders + every required cellXf clone
 * to `xl/styles.xml`, returning the maps the sheet rewriter needs:
 *
 *   - `remap`:         keyed by `${baseS}:${edge}`, gives the new
 *                      `s=` for any cell whose original cellXf is
 *                      `baseS` and whose perimeter classification is
 *                      `edge`.
 *   - `defaultByEdge`: gives the new `s=` for inserted (empty) cells
 *                      at each `EdgeKind`, sourced from cloning
 *                      `PERIMETER_DEFAULT_BASE_XF`.
 *
 * Strategy notes
 * ──────────────
 * - Only one cellXf clone per unique `(baseS, edge)` pair — if two
 *   cells share the same starting `s=` and edge classification, they
 *   end up referencing the same new `s=`. Keeps the cellXfs growth
 *   proportional to the number of distinct (style, edge) combos
 *   present (typically ≤ 20 for the two Activation tables) instead
 *   of one clone per cell.
 *
 * - The 8 border definitions are ALWAYS appended even if some happen
 *   to be unused, so the resulting `borderId` indices are stable
 *   (predictable for tests / debugging). Callers shouldn't depend on
 *   the specific indices, but the borders count bumps by exactly 8.
 *
 * - When a cell address from `tables` is missing in the sheet (gold
 *   drops empty cells), we fall back to {@link PERIMETER_DEFAULT_BASE_XF}
 *   as its base. We also seed `(default, edge)` for every edge so
 *   `defaultByEdge` is fully populated even if no existing gold cell
 *   happens to combine that edge with that base.
 */
async function patchActivationTablePerimeterCellXfs(
  zOut: JSZip,
  tables: readonly TableRect[],
  existingCellStyles: ReadonlyMap<string, number>,
): Promise<{
  remap: Map<string, number>
  defaultByEdge: Map<EdgeKind, number>
}> {
  const empty = {
    remap: new Map<string, number>(),
    defaultByEdge: new Map<EdgeKind, number>(),
  }
  const stylesXmlIn = await zOut.file('xl/styles.xml')?.async('string')
  if (!stylesXmlIn) return empty

  // Phase 1: append all 8 borders, recording each EdgeKind's
  // resolved borderId.
  let stylesXml = stylesXmlIn
  const borderIdByEdge = new Map<EdgeKind, number>()
  for (const edge of ALL_EDGE_KINDS) {
    const r = appendBorder(stylesXml, PERIMETER_BORDER_XML[edge])
    if (r.index < 0) return empty
    stylesXml = r.xml
    borderIdByEdge.set(edge, r.index)
  }

  // Phase 2: walk every perimeter cell, build the unique set of
  // (baseS, edge) clone requests.
  const requestKey = (baseS: number, edge: EdgeKind) => `${baseS}:${edge}`
  type CloneRequest = { baseS: number; edge: EdgeKind }
  const requests = new Map<string, CloneRequest>()
  for (const rect of tables) {
    for (const { addr, edge } of perimeterCellsOf(rect)) {
      const baseS = existingCellStyles.get(addr) ?? PERIMETER_DEFAULT_BASE_XF
      const k = requestKey(baseS, edge)
      if (!requests.has(k)) requests.set(k, { baseS, edge })
    }
  }
  // Always seed (default, edge) for every edge so inserted cells
  // have a clone to point at, even when no existing gold cell
  // happens to combine that edge with the default base.
  for (const edge of ALL_EDGE_KINDS) {
    const k = requestKey(PERIMETER_DEFAULT_BASE_XF, edge)
    if (!requests.has(k)) {
      requests.set(k, { baseS: PERIMETER_DEFAULT_BASE_XF, edge })
    }
  }

  // Phase 3: build cellXf clones for each unique request.
  const cloneXmls: string[] = []
  const cloneKeys: string[] = []
  for (const [k, { baseS, edge }] of requests) {
    const baseXf = getCellXfAt(stylesXml, baseS)
    if (baseXf == null) continue
    cloneXmls.push(cloneXfWithBorder(baseXf, borderIdByEdge.get(edge)!))
    cloneKeys.push(k)
  }
  const appendResult = appendCellXfs(stylesXml, cloneXmls)
  if (appendResult.indices.length !== cloneXmls.length) return empty
  zOut.file('xl/styles.xml', appendResult.xml)

  // Phase 4: build caller-facing maps.
  const remap = new Map<string, number>()
  const defaultByEdge = new Map<EdgeKind, number>()
  for (let i = 0; i < cloneKeys.length; i += 1) {
    const k = cloneKeys[i]!
    const newS = appendResult.indices[i]!
    remap.set(k, newS)
    const req = requests.get(k)!
    if (req.baseS === PERIMETER_DEFAULT_BASE_XF) {
      defaultByEdge.set(req.edge, newS)
    }
  }
  return { remap, defaultByEdge }
}

/**
 * Apply per-cell perimeter borders to `sheetXml`:
 *
 *   - Cells already present on the sheet whose address sits on a
 *     perimeter get their `s=` attribute swapped to the corresponding
 *     border-aware clone. Every other attribute (text, formula, rPr
 *     wrapping, etc.) is preserved.
 *
 *   - Perimeter cells absent from the sheet are inserted with
 *     `<c r="ADDR" s="N"/>` where `N` comes from `defaultByEdge[edge]`.
 *     They are inserted in alphabetical column order within the
 *     parent row, matching OOXML's required ordering.
 *
 *   - Interior cells are untouched — there are no inner gridlines.
 */
function applyPerimeterToSheet(
  sheetXml: string,
  tables: readonly TableRect[],
  existingCellStyles: ReadonlyMap<string, number>,
  remap: ReadonlyMap<string, number>,
  defaultByEdge: ReadonlyMap<EdgeKind, number>,
): string {
  const requestKey = (baseS: number, edge: EdgeKind) => `${baseS}:${edge}`

  // Decide the target s= for every perimeter cell, and queue
  // insertions for the ones that aren't yet on the sheet.
  const targetByAddr = new Map<string, number>()
  const insertions: Array<{ addr: string; s: number }> = []
  for (const rect of tables) {
    for (const { addr, edge } of perimeterCellsOf(rect)) {
      const baseS = existingCellStyles.get(addr) ?? PERIMETER_DEFAULT_BASE_XF
      const newS = remap.get(requestKey(baseS, edge))
      if (newS == null) continue
      targetByAddr.set(addr, newS)
      if (!existingCellStyles.has(addr)) {
        insertions.push({ addr, s: defaultByEdge.get(edge) ?? newS })
      }
    }
  }

  // Step A: rewrite existing cells' `s=` attribute in-place. Skip
  // any address queued for insertion below — we don't want to touch
  // a cell that doesn't actually exist yet.
  let out = sheetXml
  if (targetByAddr.size > 0) {
    const cellRegex = /<c\s+([^>]*?)(\/>|>[\s\S]*?<\/c>)/g
    out = out.replace(cellRegex, (full, attrs: string) => {
      const addrRaw = attr(attrs, 'r')
      if (!addrRaw) return full
      const newS = targetByAddr.get(addrRaw)
      if (newS == null) return full
      if (!existingCellStyles.has(addrRaw)) return full
      const rewrittenAttrs = /\bs="\d+"/.test(attrs)
        ? attrs.replace(/\bs="\d+"/, `s="${newS}"`)
        : `${attrs.replace(/\s*$/, '')} s="${newS}"`
      return full.replace(attrs, rewrittenAttrs)
    })
  }

  // Step B: splice missing cells into their parent rows. Group by
  // row, sort by column for OOXML correctness, then insert at the
  // first existing cell whose column comes strictly after.
  if (insertions.length > 0) {
    const byRow = new Map<number, Array<{ addr: string; s: number }>>()
    for (const ins of insertions) {
      const sp = splitAddr(ins.addr)
      if (!sp) continue
      if (!byRow.has(sp.row)) byRow.set(sp.row, [])
      byRow.get(sp.row)!.push(ins)
    }
    for (const [rowNum, list] of byRow) {
      list.sort((x, y) => {
        const ax = splitAddr(x.addr)!
        const ay = splitAddr(y.addr)!
        return colCmp(ax.col, ay.col)
      })
      const rowRe = new RegExp(`<row\\s+r="${rowNum}"([^>]*)>([\\s\\S]*?)</row>`)
      const rowMatch = rowRe.exec(out)
      if (!rowMatch) continue
      const rowAttrs = rowMatch[1]!
      const rowInner = rowMatch[2]!
      let newInner = rowInner
      for (const { addr, s } of list) {
        const sp = splitAddr(addr)!
        const cellXml = `<c r="${addr}" s="${s}"/>`
        const liveRe = /<c\s+([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g
        let chosen = newInner.length
        let lcm: RegExpExecArray | null
        while ((lcm = liveRe.exec(newInner)) !== null) {
          const liveAddr = attr(lcm[1]!, 'r')
          const liveSp = liveAddr ? splitAddr(liveAddr) : null
          if (!liveSp) continue
          if (colCmp(liveSp.col, sp.col) > 0) {
            chosen = lcm.index
            break
          }
        }
        newInner = newInner.slice(0, chosen) + cellXml + newInner.slice(chosen)
      }
      out =
        out.slice(0, rowMatch.index) +
        `<row r="${rowNum}"${rowAttrs}>${newInner}</row>` +
        out.slice(rowMatch.index + rowMatch[0].length)
    }
  }

  return out
}

// ─── Per-WG / per-Fleet sheet restorer ─────────────────────────────────────

/**
 * Gold-shipped scaffold sheet names. The export's `cloneScaffolds`
 * makes any extra plan WGs / fleets clone from the first scaffold of
 * the matching kind, then `assignKindSheets` renames each scaffold
 * (consumed in order) to the plan WG's resolved sheet name (e.g.
 * `wg-default` → `wg-apex`). Whichever scaffolds aren't consumed
 * survive in the output under their original name and need to be
 * restored from gold separately.
 *
 * Both Stream scaffolds (`wg-default` / `wg-defaultHybrid`) ship with
 * an identical 31-column row-2 schema in the new gold; either one is
 * a valid template for any Stream WG. We always source from
 * `wg-default` for renamed Stream WGs (the clone source) and from
 * `wg-defaultHybrid` only when restoring an unconsumed
 * `wg-defaultHybrid` sheet (so its identity is preserved 1:1 from
 * gold).
 */
const PER_WG_GOLD_SCAFFOLDS = {
  streamPrimary: 'wg-default',
  streamHybrid: 'wg-defaultHybrid',
  edgePrimary: 'fl-default',
} as const

/**
 * Header → column-letter map built from a gold per-WG / per-Fleet
 * sheet's row 2. Column D's header swaps between `Worker Group` and
 * `Fleet` depending on the scaffold; the lookup is forgiving (both
 * `Worker Group` and `Fleet` keys point at column D) so the same
 * map can power the overlay regardless of kind.
 *
 * Built once per scaffold and shared across every plan WG /
 * fleet of that kind.
 */
function buildPerWgHeaderColumnMap(
  goldSheetXml: string,
  goldSharedStrings: readonly string[],
): Map<string, string> {
  const m = goldSheetXml.match(/<row\s+r="2"[^>]*>([\s\S]*?)<\/row>/)
  if (!m) return new Map()
  const out = new Map<string, string>()
  const cellRe = /<c\s+([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g
  let cm: RegExpExecArray | null
  while ((cm = cellRe.exec(m[1]!)) !== null) {
    const attrs = cm[1]!
    const inner = cm[3] ?? ''
    const addrAttr = attr(attrs, 'r')
    if (!addrAttr) continue
    const sp = splitAddr(addrAttr)
    if (!sp) continue
    const t = attr(attrs, 't')
    let text = ''
    if (t === 's') {
      const v = inner.match(/<v>(\d+)<\/v>/)
      if (v) text = goldSharedStrings[Number(v[1])] ?? ''
    } else if (t === 'inlineStr') {
      const tm = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)
      if (tm) text = tm[1]!
    }
    const trimmed = text.trim()
    if (trimmed) out.set(trimmed, sp.col)
  }

  // D column kind alias: gold's `wg-default` ships D2 as "Worker
  // Group", `fl-default` as "Fleet". The exporter's
  // sourceSummaryValueForHeaderName accepts both names; mirror that
  // by ensuring whichever key is missing aliases to the same column
  // as the one that's present.
  const wgCol = out.get('Worker Group')
  const flCol = out.get('Fleet')
  if (wgCol && !flCol) out.set('Fleet', wgCol)
  if (flCol && !wgCol) out.set('Worker Group', flCol)

  return out
}

/**
 * Convert a JS value coming out of `sourceSummaryValueForHeaderName`
 * into the {@link OverlayValue} shape. Mirrors `setCellSafe` from
 * `v091ExportWorkbook.ts`:
 *
 *   - `undefined` (the default-case result for headers our model
 *     doesn't carry, e.g. `Display name`) is treated as `null`
 *     (gold-empty cell), so a plain export doesn't synthesize new
 *     content for those columns.
 *
 *   - Empty strings collapse to `null` for the same reason.
 *
 *   - Booleans / numbers / Dates pass through with their native
 *     types so {@link buildOverlayCellXml} emits them as `t="b"` /
 *     numeric / serial-number cells.
 */
function normalizeSourceCellValue(
  value: string | number | boolean | Date | null | undefined,
): OverlayValue {
  if (value === undefined || value === null || value === '') {
    return null
  }
  return value
}

/**
 * Build the address → value overlay for one per-WG / per-Fleet
 * sheet, scoped to the sources that belong to `wg`. Mirrors the
 * writes done by `fillPerWgSheet` in {@link ./v091ExportWorkbook}:
 * iterates every header in {@link ALL_SOURCE_IMPORT_HEADER_NAMES},
 * locates its column in the gold's row 2 via `headerColMap`, and
 * pairs each source row with `V091_PER_WG_FIRST_DATA_ROW + i`.
 *
 * Headers absent from gold's row 2 are skipped (e.g. `Display name`
 * / `Type` / `Region(s)` on a v0.9.1 sheet that doesn't ship
 * those columns) — same defensive shape as the existing
 * `headerToCol`-based exporter.
 */
function perWgSheetOverlay(
  plan: PlanState,
  wg: WorkerGroupRow,
  headerColMap: ReadonlyMap<string, string>,
): OverlayMap {
  const overlay: OverlayMap = new Map()
  const sources = plan.sourceSummary.filter((s) => s.workerGroupId === wg.id)
  for (let i = 0; i < sources.length; i += 1) {
    const r = V091_PER_WG_FIRST_DATA_ROW + i
    const src = sources[i]!
    for (const headerName of ALL_SOURCE_IMPORT_HEADER_NAMES) {
      const col = headerColMap.get(headerName)
      if (!col) continue
      const value = sourceSummaryValueForHeaderName(headerName, src, { plan })
      overlay.set(`${col}${r}`, normalizeSourceCellValue(value))
    }
  }
  return overlay
}

/**
 * Restore every per-WG / per-Fleet sheet in the output zip from
 * gold. Same playbook as the other restorers:
 *
 *   - Replace `xl/worksheets/sheetN.xml` with gold's verbatim copy
 *     of the matching scaffold (Stream WGs source from
 *     `wg-default`; Edge fleets source from `fl-default`; the
 *     leftover `wg-defaultHybrid` is restored from itself if no
 *     plan WG took its slot).
 *
 *   - Convert every `t="s"` cell to `t="inlineStr"` against gold's
 *     `sharedStrings.xml` so the sheet drops its dependency on the
 *     post-ExcelJS `xl/sharedStrings.xml`.
 *
 *   - Overlay app-derived source data via
 *     {@link perWgSheetOverlay}: rows 3..3+N-1 each hold one
 *     source's column values across A..AE, with native numeric /
 *     boolean / date types preserved so number formats and the
 *     v0.9.1 importer's typed-cell parser keep working.
 *
 * Effect: restores gold's row-1 banner fills (SOURCE ONBOARDING /
 * PRIMARY DATA POINTS / VOLUME & PRIORITY / PHASE & ROADMAP /
 * INITIATIVE…), the `#EFEFEF` AB1:AE1 grey-blend cells, and the
 * row-2 column-title styling — all of which drift on the current
 * export. Source data still round-trips because the overlay writes
 * the same field set the exporter does.
 *
 * No-op when the gold workbook is missing any expected scaffold
 * sheet.
 */
async function restorePerWgSheets(
  zIn: JSZip,
  zOut: JSZip,
  plan: PlanState,
): Promise<void> {
  const inMap = await buildSheetNamePathMap(zIn)
  const outMap = await buildSheetNamePathMap(zOut)
  const goldSharedStrings = parseSharedStrings(
    (await zIn.file('xl/sharedStrings.xml')?.async('string')) ?? '',
  )

  // Read each gold scaffold once; cache header-to-column maps so
  // the overlay builder doesn't reparse row 2 per WG.
  const goldTemplates = new Map<string, string>()
  const headerMaps = new Map<string, Map<string, string>>()
  for (const name of [
    PER_WG_GOLD_SCAFFOLDS.streamPrimary,
    PER_WG_GOLD_SCAFFOLDS.streamHybrid,
    PER_WG_GOLD_SCAFFOLDS.edgePrimary,
  ]) {
    const path = inMap.get(name)
    if (!path) continue
    const xml = await zIn.file(path)?.async('string')
    if (!xml) continue
    goldTemplates.set(name, xml)
    headerMaps.set(name, buildPerWgHeaderColumnMap(xml, goldSharedStrings))
  }

  const restoreOne = (
    outSheetName: string,
    scaffoldName: string,
    overlay: OverlayMap,
  ) => {
    const outPath = outMap.get(outSheetName)
    if (!outPath) return
    const goldXml = goldTemplates.get(scaffoldName)
    if (!goldXml) return
    const patched = overlayCellsInSheet(goldXml, goldSharedStrings, overlay)
    zOut.file(outPath, patched)
  }

  // Resolve each plan WG / fleet's expected output sheet name
  // (mirrors the exporter's `resolveAllSheetNames` call), then
  // restore that sheet from the matching scaffold. Track which
  // output sheets we've already populated so the leftover-scaffold
  // sweep below can't accidentally clobber them with an empty
  // overlay — a plan WG named `default` resolves to `wg-default`,
  // which is the same as the gold scaffold name.
  const finalNames = resolveAllSheetNames(
    plan.workerGroups,
    PER_WG_RESERVED_STATIC_SHEET_NAMES,
  )
  const restoredOutNames = new Set<string>()
  for (const wg of plan.workerGroups) {
    const sheetName = finalNames.get(wg.id)
    if (!sheetName) continue
    const scaffoldName =
      wg.kind === 'edge'
        ? PER_WG_GOLD_SCAFFOLDS.edgePrimary
        : PER_WG_GOLD_SCAFFOLDS.streamPrimary
    const overlay = perWgSheetOverlay(plan, wg, headerMaps.get(scaffoldName) ?? new Map())
    restoreOne(sheetName, scaffoldName, overlay)
    restoredOutNames.add(sheetName)
  }

  // Restore any leftover scaffold sheets the exporter didn't
  // consume (most commonly `wg-defaultHybrid` when the plan has at
  // most one Stream WG). They survive in the output under their
  // gold name and just need their styling rebuilt; no overlay.
  // Skip any scaffold name that the loop above already restored —
  // otherwise we'd overwrite that sheet's populated data with an
  // empty overlay (this hits any plan whose first WG is named
  // exactly `default` since its resolved name `wg-default` equals
  // the Stream-primary scaffold name).
  for (const scaffoldName of [
    PER_WG_GOLD_SCAFFOLDS.streamPrimary,
    PER_WG_GOLD_SCAFFOLDS.streamHybrid,
    PER_WG_GOLD_SCAFFOLDS.edgePrimary,
  ]) {
    if (!outMap.has(scaffoldName)) continue
    if (restoredOutNames.has(scaffoldName)) continue
    restoreOne(scaffoldName, scaffoldName, new Map())
  }
}

/**
 * Mirror of the static reserved-name set the exporter passes to
 * `resolveAllSheetNames`. Listed separately here (rather than
 * imported from `v091ExportWorkbook`) to avoid pulling in the
 * exporter's full dependency graph from the restore module.
 */
const PER_WG_RESERVED_STATIC_SHEET_NAMES: readonly string[] = [
  'INSTRUCTIONS',
  'PS Use Case Worksheet',
  'Stream Overview',
  'Edge Overview',
  'input_data',
] as const

// ─── input_data restorer ───────────────────────────────────────────────────

const SHEET_INPUT_DATA = 'input_data' as const

/**
 * Column footprint of the `input_data` row-1 column titles. 11
 * columns: Tech_tiles, Dest_tiles, Pipeline, Criticality,
 * StreamEdge, Initiatives, Technical use cases, Financial value,
 * Operational value, Risk reduction value, Strategic value.
 */
const INPUT_DATA_HEADER_COLS: readonly string[] = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K',
] as const

/**
 * Append (if absent) a `<xf>` to `xl/styles.xml`'s `<cellXfs>` that
 * paints a cell as a bold-black-text-on-light-grey-fill column
 * header — gold's input_data column-title look:
 *
 *   - `fontId="14"` → bold Open Sans, `<color theme="1"/>` (black).
 *     This is the bold sibling of gold's `fontId="16"` (Open Sans,
 *     not bold) which gold already uses on F1:K1 — re-using the
 *     family/size keeps row 1 typographically uniform after the
 *     restore.
 *
 *   - `fillId="5"` → light grey `#EFEFEF`. Gold's existing
 *     light-grey fill, the same one used by the `s="89"` / `s="90"`
 *     header cellXfs the gold ships for F1:K1.
 *
 *   - Other attributes mirror the gold's `s="89"` cellXf (no
 *     border, default xfId, vertical-bottom alignment) so a Google-
 *     /Excel-side row-height auto-fit doesn't differ between the
 *     11 columns.
 *
 * Idempotent: if the workbook already carries a cellXf with these
 * exact (`fontId`, `fillId`, `borderId`, `numFmtId`) settings — for
 * example because a previous export already appended it — that
 * existing index is reused. Returns the cellXf index callers should
 * write into the cell's `s=` attribute, or `-1` when `cellXfs` is
 * malformed (very unlikely, would mean an earlier restore step has
 * already broken `styles.xml`).
 */
async function ensureInputDataHeaderCellXf(zOut: JSZip): Promise<number> {
  const path = 'xl/styles.xml'
  const stylesXml = await zOut.file(path)?.async('string')
  if (!stylesXml) return -1

  const headerXf =
    `<xf borderId="0" fillId="5" fontId="14" numFmtId="0" xfId="0" applyAlignment="1" applyFill="1" applyFont="1"><alignment vertical="bottom"/></xf>`

  const m = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)
  if (!m) return -1
  const inner = m[1]!
  const existingOffset = inner.indexOf(headerXf)
  if (existingOffset >= 0) {
    return (inner.slice(0, existingOffset).match(/<xf\b/g) ?? []).length
  }

  const { xml: appended, indices } = appendCellXfs(stylesXml, [headerXf])
  zOut.file(path, appended)
  return indices[0] ?? -1
}

/**
 * Restore `input_data` (gold's sheet 8). This sheet is a static
 * lookup table backing data-validation dropdowns on the per-WG /
 * per-Fleet sheets — the app never writes to it.
 *
 * The drift on `input_data` is the most extreme of any sheet (100%
 * of cells reference the wrong cellXf row): ExcelJS collapses gold's
 * 93-entry `cellXfs` table and remaps every cell's `s=` index, so
 * after the styles.xml swap in {@link restoreV091Styles} the new `s=`
 * indices land on completely unrelated cellXf rows. Empirically the
 * remap puts most cells on a dark-green table-style cellXf, which is
 * why the exported sheet shows up as a wall of green.
 *
 * Fix:
 *   - Replace `xl/worksheets/sheet8.xml` with gold's verbatim copy.
 *     Every gold cell carries the gold `s=` index, which now
 *     resolves correctly against the restored `xl/styles.xml`.
 *
 *   - Convert every `t="s"` cell to `t="inlineStr"` against the
 *     gold `sharedStrings.xml` so the sheet has no shared-string
 *     dependency on the (post-ExcelJS-rewritten) export
 *     `sharedStrings.xml`.
 *
 *   - **Beyond gold**: gold ships A1:E1 with the plain
 *     no-fill / non-bold `s="19"` cellXf, leaving the first five
 *     column titles visually distinct from the F1:K1 grey-fill
 *     headers. Override A1:K1 to all use a single bold black-on-
 *     grey-#EFEFEF header style (built by
 *     {@link ensureInputDataHeaderCellXf}) so all 11 column titles
 *     read uniformly as headers — matching the customer-facing
 *     reference look.
 *
 *   - No table parts, no perimeter borders, no white-text overrides.
 *
 * No-op when either workbook is missing this sheet.
 */
async function restoreInputDataSheet(zIn: JSZip, zOut: JSZip): Promise<void> {
  const inMap = await buildSheetNamePathMap(zIn)
  const outMap = await buildSheetNamePathMap(zOut)
  const inPath = inMap.get(SHEET_INPUT_DATA)
  const outPath = outMap.get(SHEET_INPUT_DATA)
  if (!inPath || !outPath) {
    return
  }
  const goldSheetXml = await zIn.file(inPath)?.async('string')
  if (!goldSheetXml) {
    return
  }
  const goldSharedStringsXml =
    (await zIn.file('xl/sharedStrings.xml')?.async('string')) ?? ''
  const goldSharedStrings = parseSharedStrings(goldSharedStringsXml)

  // Empty overlay — overlayCellsInSheet still walks every <c> element
  // and converts t="s" → t="inlineStr" using gold's sharedStrings,
  // which is what we need.
  let patched = overlayCellsInSheet(goldSheetXml, goldSharedStrings, new Map())

  // Force every column title (A1:K1) onto a uniform bold-grey
  // header style. Gold ships A1:E1 plain — the customer reference
  // wants all 11 cells styled like a single header band.
  const headerS = await ensureInputDataHeaderCellXf(zOut)
  if (headerS >= 0) {
    const headerAddrs = new Set(INPUT_DATA_HEADER_COLS.map((c) => `${c}1`))
    const cellRegex = /<c\s+([^>]*?)(\/>|>[\s\S]*?<\/c>)/g
    patched = patched.replace(cellRegex, (full, attrs: string) => {
      const addrRaw = attr(attrs, 'r')
      if (!addrRaw || !headerAddrs.has(addrRaw)) return full
      const rewrittenAttrs = /\bs="\d+"/.test(attrs)
        ? attrs.replace(/\bs="\d+"/, `s="${headerS}"`)
        : `${attrs.replace(/\s*$/, '')} s="${headerS}"`
      return full.replace(attrs, rewrittenAttrs)
    })
  }

  zOut.file(outPath, patched)
}

// ─── Orchestrator ──────────────────────────────────────────────────────────

/**
 * Run every implemented per-sheet restore against the output zip.
 * Sheets without a restorer entry here are left alone — call sites
 * relying on those sheets' styling continue to see the pre-existing
 * drift until a restorer is added (one sheet per commit, by design,
 * so each restoration can be visually verified before the next is
 * tackled).
 *
 * Cross-sheet styles.xml patches that benefit every table on the
 * workbook (e.g. white headerRow text) run alongside the per-sheet
 * passes — they do not require a sheet to be restored to take effect,
 * but they do depend on `xl/styles.xml` having been swapped to gold
 * by `restoreV091Styles` first.
 */
export async function restoreSheetsFromGold(
  zIn: JSZip,
  zOut: JSZip,
  plan: PlanState,
): Promise<void> {
  await patchHeaderRowFontWhite(zOut)
  await restorePsUseCaseWorksheetSheet(zIn, zOut, plan)
  await restoreOverviewSheet(zIn, zOut, plan, 'stream', STREAM_OVERVIEW_SPEC)
  await restoreOverviewSheet(zIn, zOut, plan, 'edge', EDGE_OVERVIEW_SPEC)
  await restoreInputDataSheet(zIn, zOut)
  await restorePerWgSheets(zIn, zOut, plan)
}
