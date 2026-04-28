/**
 * “Copy of Sources and WGs” (topology) — shared row detection for import and template-aware export.
 */

import { findColumnIndexByHeader } from './sourceSummaryColumnMap'

export function isWorkerSectionTitleRow(row: unknown[] | undefined): boolean {
  const t = String(row?.[3] ?? '').trim()
  return t === 'Worker Groups & Specs' || t.toLowerCase().includes('worker group')
}

export function rowIsEffectivelyEmptyForTopo(row: unknown[] | undefined, cols: number): boolean {
  if (!row) {
    return true
  }
  return (row as unknown[]).slice(0, cols).every((c) => c == null || String(c).trim() === '')
}

/** Import uses 0-based row 1 in the sheet aoa = Excel R2 = topology “Source, Daily Volume…” */
export const TOPOLOGY_SOURCE_HEADER_ROW0 = 1
/** 0-based first data row in the Cribl layout (R3) */
export const TOPOLOGY_DEFAULT_FIRST_SOURCE_DATA_ROW0 = 2

export type ScannedCopySourcesWgLayout = {
  sourceHeaderRow0: number
  firstSourceDataRow0: number
  /** 0-based row of “Worker Groups & Specs” in column D, or `null` if not found */
  workerTitleRow0: number | null
  /** Row with WG / Ingest… headers, or `null` */
  workerHeaderRow0: number | null
  /** How many 0-based rows in [firstSource..workerTitle) are the source *slot* region */
  sourceRowSlotCount: number
}

/**
 * Scans a topology sheet aoa (same 0-based indexing as `XLSX.utils.sheet_to_json(..., { header: 1 })`).
 * Does **not** stop on blank source lines — finds the worker block even when many source rows are empty
 * (official empty template, etc.).
 */
export function scanCopySourcesWgFromAoa(aoa: unknown[][], _warnings: string[] = []): ScannedCopySourcesWgLayout | null {
  if (aoa.length < 2) {
    return null
  }
  const topHeader: string[] = (aoa[1] as unknown[] | undefined)?.map((c) => (c == null ? '' : String(c).trim())) ?? []
  if (findColumnIndexByHeader(topHeader, 'Source') < 0) {
    return null
  }
  const firstSourceDataRow0 = 2
  let workerTitleRow0: number | null = null
  for (let r = firstSourceDataRow0; r < aoa.length; r += 1) {
    if (isWorkerSectionTitleRow(aoa[r] as unknown[] | undefined)) {
      workerTitleRow0 = r
      break
    }
  }
  if (workerTitleRow0 == null) {
    return {
      sourceHeaderRow0: 1,
      firstSourceDataRow0,
      workerTitleRow0: null,
      workerHeaderRow0: null,
      sourceRowSlotCount: 0,
    }
  }
  const workerHeaderRow0 = workerTitleRow0 < aoa.length - 1 ? workerTitleRow0 + 1 : null
  const sourceRowSlotCount = Math.max(0, workerTitleRow0 - firstSourceDataRow0)
  return {
    sourceHeaderRow0: 1,
    firstSourceDataRow0,
    workerTitleRow0,
    workerHeaderRow0,
    sourceRowSlotCount,
  }
}
