/**
 * Tiny helpers shared by the v0.9.1 export pipeline phases. Lives in
 * its own module so the JSZip post-pass restorers in
 * `v091ExportSheetRestore.ts` can use them without circular-importing
 * `v091ExportWorkbook.ts`.
 *
 * Everything here operates on raw OOXML strings (no ExcelJS), so it's
 * cheap, side-effect-free, and safe to call from any phase.
 */
import type JSZip from 'jszip'

/**
 * One worksheet entry pulled from `xl/workbook.xml`. The triple
 * (name, sheetId, rId) is the "real" identity of a worksheet in
 * OOXML; `sheetFileIdx` is just a convenience cache of the underlying
 * `xl/worksheets/sheet{N}.xml` path.
 */
export interface SheetEntry {
  /** Display name as it appears in `workbook.xml`. */
  name: string
  /** Excel `sheetId` (1-based, internal id, distinct from r:id). */
  sheetId: number
  /** Relationship id (`r:id` in the `<sheet>` tag). */
  rId: string
  /** 1-based index of `xl/worksheets/sheet{N}.xml` for this sheet. */
  sheetFileIdx: number
}

/**
 * Parse the `<sheet>` entries out of `xl/workbook.xml`, joining each
 * to its relationship target via `xl/_rels/workbook.xml.rels`. Returns
 * entries in `workbook.xml` order (which is the order Excel displays
 * the tabs).
 */
export function parseSheetEntries(wbXml: string, wbRelsXml: string): SheetEntry[] {
  const entries: SheetEntry[] = []
  const relTargetByRid = new Map<string, string>()
  const relRe =
    /<Relationship\s+Id="([^"]+)"\s+Type="[^"]*officeDocument\/2006\/relationships\/worksheet"\s+Target="([^"]+)"\s*\/>/g
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
    const sheetFileIdx = target
      ? Number((/sheet(\d+)\.xml$/.exec(target) ?? [])[1] ?? '0')
      : 0
    entries.push({
      name,
      sheetId: Number(sheetIdStr),
      rId,
      sheetFileIdx,
    })
  }
  return entries
}

/**
 * Build a name → `xl/worksheets/sheet{N}.xml` path map for the
 * workbook in `z`. Used by post-pass fixers that operate on sheets by
 * name (the sheet-file index is unreliable after ExcelJS reshuffles
 * relationship ids).
 */
export async function buildSheetNamePathMap(z: JSZip): Promise<Map<string, string>> {
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
