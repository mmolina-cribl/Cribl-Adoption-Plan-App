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
function overlayCellsInSheet(
  sheetXml: string,
  goldSharedStrings: string[],
  overlay: OverlayMap,
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
            return `<c r="${addr}"${sFragment} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`
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
 * Restore PS Use Case Worksheet (the gold's sheet 2). The full sheet
 * XML is replaced with gold's verbatim copy, then the cells the app
 * writes are overlaid in place.
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
  const patched = overlayCellsInSheet(goldSheetXml, goldSharedStrings, overlay)
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
 */
export async function restoreSheetsFromGold(
  zIn: JSZip,
  zOut: JSZip,
  plan: PlanState,
): Promise<void> {
  await restorePsUseCaseWorksheetSheet(zIn, zOut, plan)
}
