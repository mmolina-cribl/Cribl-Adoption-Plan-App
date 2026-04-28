/** Shared with export + import: sheet names, headers, and row layout. */

export const SHEET_INSTRUCTIONS = 'INSTRUCTIONS' as const
export const SHEET_SOURCE_SUMMARY = 'Source summary' as const
export const SHEET_INPUT_DATA = 'input_data' as const
/**
 * Gold template: `Copy of Adoption plan - v0.8.6.xlsx` (topology tab).
 * Older app builds used shorter/variant names; import tries those as fallbacks.
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
 * Row 2 of the Source summary sheet: official Cribl v0.8.6 28-column order (Source in column A).
 * Default programmatic export and `getSourceSummaryMatrix` use this order.
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
 * Superset of row-2 column titles: import matches these so optional Display name / Type / Region(s)
 * (31-column workbooks) resolve; export to a shell uses the same set for name-based cell writes.
 */
export const ALL_SOURCE_IMPORT_HEADER_NAMES: string[] = [
  'Display name',
  'Source',
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
