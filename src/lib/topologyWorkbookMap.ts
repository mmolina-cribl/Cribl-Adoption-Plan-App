import {
  SOURCES_WG_SOURCE_HEADERS,
  WORKER_HEADERS,
} from './planWorkbookLayout'
import { findColumnIndexByHeader } from './sourceSummaryColumnMap'

const TOPO_HEADER_EXTRAS: Partial<Record<string, string[]>> = {
  'Region(s)': ['Region', 'Regions'],
  /** Gold template & older exports use “Worker group”. */
  WG: ['Worker group', 'Worker Group'],
}

const WORKER_HEADER_EXTRAS: Partial<Record<string, string[]>> = {
  WG: ['Worker group', 'Worker Group'],
}

export function buildTopologyColumnMap(headerRow: string[], warnings: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const can of SOURCES_WG_SOURCE_HEADERS) {
    const ex = TOPO_HEADER_EXTRAS[can]
    m.set(can, findColumnIndexByHeader(headerRow, can, ...(ex ?? [])))
  }
  if (findColumnIndexByHeader(headerRow, 'Source') < 0) {
    warnings.push('Topology sheet: missing “Source” in row 2; no volume rows were imported from this sheet.')
  } else {
    const srcI = m.get('Source') ?? -1
    if (srcI > 0) {
      warnings.push(
        'Topology sheet: “Source” is not in column A; values were read by column title (legacy or reordered sheets).',
      )
    }
  }
  return m
}

export function buildWorkerColumnMap(headerRow: string[], warnings: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const can of WORKER_HEADERS) {
    const ex = WORKER_HEADER_EXTRAS[can]
    m.set(can, findColumnIndexByHeader(headerRow, can, ...(ex ?? [])))
  }
  if (findColumnIndexByHeader(headerRow, 'WG', 'Worker group', 'Worker Group') < 0) {
    warnings.push('Could not find the WG / Worker group column in the worker header row; worker group rows not imported.')
  }
  return m
}
