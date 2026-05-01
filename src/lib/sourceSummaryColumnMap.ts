import { ALL_SOURCE_IMPORT_HEADER_NAMES } from './planWorkbookLayout'

/**
 * Resolves a column index by header label (exact trim, then case-insensitive) across
 * the candidate names.
 */
export function findColumnIndexByHeader(headerRow: string[], ...candidates: string[]): number {
  for (const cand of candidates) {
    const t = cand.trim()
    for (let i = 0; i < headerRow.length; i += 1) {
      if ((headerRow[i] ?? '').trim() === t) {
        return i
      }
    }
    const tl = t.toLowerCase()
    for (let i = 0; i < headerRow.length; i += 1) {
      if ((headerRow[i] ?? '').trim().toLowerCase() === tl) {
        return i
      }
    }
  }
  return -1
}

/**
 * Optional extra title rows for a canonical Source summary header.
 *
 * `Physical location(s)` (v0.9.1) treats `Region(s)` / `Region` / `Regions`
 * (v0.8.6) as fallback aliases so a v0.8.6 workbook imports cleanly into the
 * `physicalLocations` field. The legacy `Region(s)` entry remains so the
 * import column map still resolves it on workbooks that have a literal
 * `Region(s)` header — value lands in the same `physicalLocations` field via
 * the import path.
 */
const SOURCE_HEADER_EXTRA_CANDIDATES: Partial<Record<string, string[]>> = {
  'Display name': ['Name', 'Source name', 'Source display name'],
  'Physical location(s)': ['Physical location', 'Physical Locations', 'Region(s)', 'Region', 'Regions'],
  'Region(s)': ['Region', 'Regions'],
  'Worker Group': ['WG', 'Worker group'],
  'Pipeline usecase': ['Pipeline use case'],
  'Data optimization %': ['Data optimization%', 'Data Optimization %', 'Data optimization  %'],
  'Current Collection': ['Current collection'],
}

/**
 * For each name in `ALL_SOURCE_IMPORT_HEADER_NAMES`, the column index in this file, or -1.
 * Use the superset so 28- and 31-column shells both resolve.
 */
export function buildSourceSummaryColumnMap(headerRow: string[], warnings: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const can of ALL_SOURCE_IMPORT_HEADER_NAMES) {
    const extra = SOURCE_HEADER_EXTRA_CANDIDATES[can]
    m.set(can, findColumnIndexByHeader(headerRow, can, ...(extra ?? [])))
  }
  if (findColumnIndexByHeader(headerRow, 'Source') < 0) {
    warnings.push('Source summary: missing “Source” in row 2 — cannot import.')
  } else {
    const a = (headerRow[0] || '').trim()
    const b = (headerRow[1] || '').trim()
    const isNew = a === 'Display name' && b === 'Source'
    const isLegacy30 = a === 'Source' && /security or observability/i.test(b)
    if (!isNew && !isLegacy30) {
      warnings.push(
        'Source summary: row-2 column titles are matched by name (so legacy files without Type/Region, Display name, or reordered columns, still import correctly).',
      )
    }
  }
  return m
}
