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
 *   - PS Use Case Worksheet:     91%  (155 / 170 cells)
 *   - Stream Overview:          100%
 *   - wgdefault / wgdefaultHybrid:100%
 *   - Edge Overview:            100%
 *   - fldefault_fleet:          100%
 *   - input_data:               100% (and we never even modify it)
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
import type { Activation, PlanState } from '../types/planTypes'
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
 * One entry per cell address we want to overwrite. `null` means "leave
 * the cell visually empty but keep gold's styling" (renders the same
 * as the gold's pre-shipped empty Notes cells, etc.).
 */
type OverlayMap = Map<string, string | null>

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
 * Build the `<c>` element string for an overlay write. Gold-style
 * "empty styled" cells (`<c r="…" s="…"/>`) are produced when the
 * overlay value is null/empty and we have a gold style index to
 * preserve. Non-empty values are always emitted as inline strings so
 * the sheet stays decoupled from `xl/sharedStrings.xml`.
 */
function buildOverlayCellXml(
  addr: string,
  value: string | null,
  goldS: string | null,
): string {
  const sFragment = goldS != null ? ` s="${goldS}"` : ''
  if (value == null || value === '') {
    return `<c r="${addr}"${sFragment}/>`
  }
  return `<c r="${addr}"${sFragment} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
    value,
  )}</t></is></c>`
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
  missing: Array<[string, string | null]>,
): string {
  if (missing.length === 0) return sheetXml
  // Group by row so we make at most one splice per row.
  const byRow = new Map<number, Array<[string, string | null]>>()
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
  const missing: Array<[string, string | null]> = []
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
}
