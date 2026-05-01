/** Shared with export + import: sheet names, headers, and row layout. */

export const SHEET_INSTRUCTIONS = 'INSTRUCTIONS' as const
/**
 * v0.8.6 single per-plan source sheet. Replaced by per-WG sheets in v0.9.1
 * (`wg<name>` for Stream, `fl<name>_fleet` for Edge). Kept as a constant so
 * the v0.8.6 import path can still find it on legacy workbooks until PR B
 * (multi-sheet rewrite) lands.
 */
export const SHEET_SOURCE_SUMMARY = 'Source summary' as const
export const SHEET_INPUT_DATA = 'input_data' as const
/**
 * Gold template: `Copy of Adoption plan - v0.8.6.xlsx` (topology tab).
 * Older app builds used shorter/variant names; import tries those as fallbacks.
 * v0.9.1 splits this into `Stream Overview` + `Edge Overview`; PR B handles
 * those names.
 */
export const SHEET_COPY_SOURCES_WG = 'Copy of Sources and WGs' as const
export const SHEET_COPY_SOURCES_WG_LEGACY = 'Copy: Sources & Worker Groups' as const
export const SHEET_COPY_SOURCES_WG_TRUNCATED_LEGACY = 'Copy of Sources and Worker Grou' as const

/**
 * Row 1 of Source summary (0-based: Excel row 1) — same merge layout as `adoption-plan-empty.xlsx`.
 * A1 is intentionally blank; group labels start in column B.
 */
export const SOURCE_GROUP_LABELS: (string | null)[] = (() => {
  const r = new Array(28).fill(null) as (string | null)[]
  r[1] = 'PRIMARY DATA POINTS'
  r[7] = 'VOLUME & PRIORITY'
  r[11] = 'PHASE & ROADMAP'
  r[19] = 'INITIATIVE, USE CASES, VALUE LEVERS'
  return r
})()

/**
 * Row 2 of the Source summary sheet: official Cribl v0.8.6 28-column order
 * (Source in column A). The v0.8.6 export path still emits this exact column
 * set for shell fidelity. v2.0 only stops carrying two of these columns
 * (`Display name` was an optional 31-col extra that's been dropped, and
 * `Additional notes` is the one column the gold v0.9.1 actually removed).
 * PR B switches the export pipeline to the v0.9.1 multi-sheet layout
 * (`wg<name>` / `fl<name>_fleet`).
 */
export const SOURCE_HEADERS: string[] = [
  'Source',
  'Security or Observability or both data?',
  'Stream or Edge?',
  'Source tile',
  'Pipeline usecase',
  'Destinations',
  'Retention',
  'Average Daily Volume? (GB)',
  'Compliance related?',
  'Data criticality',
  'Stakeholder(s) (team / line of business)',
  'Current?',
  'Target Onboarding Start',
  'Target Onboarding End',
  'Onboarding Completed On',
  'Blockers',
  'Growth?',
  'Data optimization %',
  'Data optimization (GB)',
  'Initiative case',
  'Technical Use Case',
  'Financial',
  'Operational',
  'Risk Reduction',
  'Strategic',
  'Onboarding Effort',
  'Politics',
  'Additional notes',
]

/**
 * Superset of row-2 column titles the importer recognizes. Includes:
 *   - v0.8.6 columns (Display name, Type, Region(s), Operational, Risk
 *     Reduction, Strategic, Onboarding Effort, Politics, Additional notes)
 *     so legacy workbooks still import. Values for fields the v2.0 data model
 *     no longer carries are read and discarded with a single warning.
 *   - v0.9.1 columns (Physical location(s), Current Collection, Worker Group)
 *     so v0.9.1 workbooks import cleanly when PR B's multi-sheet path
 *     resolves to a per-WG sheet. (PR B adds the multi-sheet enumeration; this
 *     constant is the canonical column-name table both passes share.)
 */
export const ALL_SOURCE_IMPORT_HEADER_NAMES: string[] = [
  'Display name',
  'Source',
  'Physical location(s)',
  'Current Collection',
  'Worker Group',
  'Security or Observability or both data?',
  'Stream or Edge?',
  'Type',
  'Region(s)',
  'Source tile',
  'Pipeline usecase',
  'Destinations',
  'Retention',
  'Average Daily Volume? (GB)',
  'Compliance related?',
  'Data criticality',
  'Stakeholder(s) (team / line of business)',
  'Current?',
  'Target Onboarding Start',
  'Target Onboarding End',
  'Onboarding Completed On',
  'Blockers',
  'Growth?',
  'Data optimization %',
  'Data optimization (GB)',
  'Initiative case',
  'Technical Use Case',
  'Financial',
  'Operational',
  'Risk Reduction',
  'Strategic',
  'Onboarding Effort',
  'Politics',
  'Additional notes',
]

export const SOURCES_WG_SOURCE_HEADERS: string[] = [
  'Source',
  'Daily Volume (GB/day)',
  'Type',
  'Region(s)',
  'Current Collection',
  'Cribl Collection',
  'WG',
  'Use Case(s)',
  'Destination(s)',
  'Notes',
]

export const WORKER_HEADERS: string[] = [
  'WG',
  'Ingest (GB/day)',
  'Egress (GB/Day)',
  'Throughput (GB/Day)',
  'Worker Hosting',
  'Worker Count',
  'Worker Detail',
  "Disk Req'd For 1 Day Storage",
]

/**
 * Cribl v0.8.6 `Copy of Sources and WGs`: eight worker *data* slot rows in the table (e.g. Excel R17–R24
 * when the block is in the default position). The template uses **shared** D/H formulas; we must clear
 * unused rows before assigning new per-row formulas or ExcelJS throws on write.
 */
export const COPY_SOURCES_WG_TEMPLATE_WG_DATA_ROW_SLOTS = 8
