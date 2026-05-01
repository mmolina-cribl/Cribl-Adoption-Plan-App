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

// ─── Gold v0.9.1 layout ────────────────────────────────────────────────────
// The v0.9.1 schema replaces the single per-plan `Source summary` + `Copy of
// Sources and WGs` pair with:
//   1. `Stream Overview` — rolled-up sources + Stream worker-group capacity
//      (hyperlinks to per-WG sheets in column A of the WG-spec table)
//   2. `Edge Overview`   — same shape, scoped to Edge fleets
//   3. one `wg<name>` sheet per Stream worker group (full per-source data)
//   4. one `fl<name>_fleet` sheet per Edge fleet
//   5. `INSTRUCTIONS`, `PS Use Case Worksheet`, `input_data` — static
//
// Per-WG / per-Fleet sheets share the same 30-column row-2 header set; only
// column D's title differs (`Worker Group` vs `Fleet`) and the prefix /
// suffix on the sheet name. The header set is captured once below and the
// kind-aware D-column title is patched at write time.

/** Stream-side overview sheet. Generated on export from every `wg*` sub-sheet. */
export const SHEET_STREAM_OVERVIEW_V091 = 'Stream Overview' as const
/** Edge-side overview sheet. Generated on export from every `fl*_fleet` sub-sheet. */
export const SHEET_EDGE_OVERVIEW_V091 = 'Edge Overview' as const

/**
 * v0.9.1 per-WG sheets are prefixed `wg`; per-Fleet sheets are prefixed `fl`
 * and suffixed `_fleet`. Both prefixes / the suffix are case-sensitive — the
 * gold uses lowercase. Detection at import time uses these.
 */
export const V091_WG_SHEET_PREFIX = 'wg' as const
export const V091_FLEET_SHEET_PREFIX = 'fl' as const
export const V091_FLEET_SHEET_SUFFIX = '_fleet' as const

/**
 * Row 1 group-label merges on a per-WG / per-Fleet sheet (gold v0.9.1).
 * Column A is intentionally blank; the five group banners cover B:D, E:J,
 * K:N, O:V, W:AA. Unmerged cells AB:AE within the W1 banner are left blank
 * — they belong to the same merge in the gold.
 */
export const V091_PER_WG_GROUP_LABELS: (string | null)[] = (() => {
  const r = new Array(31).fill(null) as (string | null)[]
  r[1] = 'SOURCE ONBOARDING' // B1:D1
  r[4] = 'PRIMARY DATA POINTS' // E1:J1
  r[10] = 'VOLUME & PRIORITY' // K1:N1
  r[14] = 'PHASE & ROADMAP' // O1:V1
  r[22] = 'INITIATIVE, USE CASES, VALUE LEVERS' // W1:AA1 (gold merges this far)
  return r
})()

/**
 * Row 2 of a v0.9.1 per-WG / per-Fleet sheet, in column order A through AD
 * (30 columns). Column D's title flips between `Worker Group` (Stream) and
 * `Fleet` (Edge) — pass the kind to {@link perWgRow2Headers} to get the
 * resolved array. AE is blank in the gold (the row 1 merge ends at AA;
 * column AE is unused but counted toward `dims=A1:AE21`).
 */
export const V091_PER_WG_HEADERS_BASE: string[] = [
  'Source',                                          // A
  'Physical location(s)',                            // B
  'Current Collection',                              // C
  'Worker Group',                                    // D — overridden per kind
  'Security or Observability or both data?',         // E
  'Stream or Edge?',                                 // F
  'Source tile',                                     // G
  'Pipeline usecase',                                // H
  'Destinations',                                    // I
  'Retention',                                       // J
  'Average Daily Volume? (GB)',                      // K
  'Compliance related?',                             // L
  'Data criticality',                                // M
  'Stakeholder(s) (team / line of business)',        // N
  'Current?',                                        // O
  'Target Onboarding Start',                         // P
  'Target Onboarding End',                           // Q
  'Onboarding Completed On',                         // R
  'Blockers',                                        // S
  'Growth?',                                         // T
  'Data optimization %',                             // U
  'Data optimization (GB)',                          // V
  'Initiative case',                                 // W
  'Technical Use Case',                              // X
  'Financial',                                       // Y
  'Operational',                                     // Z
  'Risk Reduction',                                  // AA
  'Strategic',                                       // AB
  'Onboarding Effort',                               // AC
  'Politics',                                        // AD
]

/**
 * Resolve {@link V091_PER_WG_HEADERS_BASE} for the given worker-group kind.
 * Returns a copy with column D set to `Fleet` for Edge fleets and
 * `Worker Group` for Stream worker groups.
 */
export function perWgRow2Headers(kind: 'stream' | 'edge'): string[] {
  const out = V091_PER_WG_HEADERS_BASE.slice()
  out[3] = kind === 'edge' ? 'Fleet' : 'Worker Group'
  return out
}

/**
 * v0.9.1 Stream Overview / Edge Overview both stack two tables:
 *   - Top table (row 2 header, data rows 3–14): rolled-up sources across the
 *     overview's kind. WG / Fleet name in column F links back via per-row
 *     hyperlink to the source's per-WG sheet.
 *   - Bottom table (row 16 header, data rows 17+): per-WG / per-Fleet
 *     capacity. Column A is the WG / Fleet name as a HYPERLINK to the
 *     `wg<name>` / `fl<name>_fleet` sheet.
 *
 * The header titles below match the gold verbatim. Column F differs by kind:
 * `WG` on Stream Overview, `FL` on Edge Overview.
 */
export const V091_OVERVIEW_TABLE1_TITLE = 'Sources, Volume, Region' as const
export const V091_OVERVIEW_TABLE1_HEADERS_BASE: string[] = [
  'Source',                  // A
  'Daily Volume (GB/day)',   // B
  'Physical location(s)',    // C
  'Current Collection',      // D
  'Cribl Collection',        // E
  'WG',                      // F — overridden per kind
  'Use Case(s)',             // G
  'Destination(s)',          // H
  'Notes',                   // I
]

export function overviewSourcesRow2Headers(kind: 'stream' | 'edge'): string[] {
  const out = V091_OVERVIEW_TABLE1_HEADERS_BASE.slice()
  out[5] = kind === 'edge' ? 'FL' : 'WG'
  return out
}

export const V091_OVERVIEW_TABLE2_TITLE_STREAM = 'Worker Groups & Specs' as const
export const V091_OVERVIEW_TABLE2_TITLE_EDGE = 'Fleets & Specs' as const
export const V091_OVERVIEW_TABLE2_HEADERS_BASE: string[] = [
  'WG',                            // A — overridden per kind ("WG" / "FL")
  'Ingest (GB/day)',               // B
  'Egress (GB/Day)',               // C
  'Throughput (GB/Day)',           // D — formula: =B+C
  'Worker Hosting',                // E
  'Worker Count',                  // F
  'Worker Detail',                 // G
  "Disk Req'd For 1 Day Storage",  // H — formula: =C/8
]

export function overviewSpecsRow16Headers(kind: 'stream' | 'edge'): string[] {
  const out = V091_OVERVIEW_TABLE2_HEADERS_BASE.slice()
  out[0] = kind === 'edge' ? 'FL' : 'WG'
  return out
}

/** Gold-template row coordinates for the overview tables (1-based, Excel rows). */
export const V091_OVERVIEW_TABLE1_TITLE_ROW = 1 // D1 holds the merged title
export const V091_OVERVIEW_TABLE1_HEADER_ROW = 2
export const V091_OVERVIEW_TABLE1_FIRST_DATA_ROW = 3
export const V091_OVERVIEW_TABLE1_LAST_DATA_ROW = 14

export const V091_OVERVIEW_TABLE2_TITLE_ROW = 15 // D15 holds the merged title
export const V091_OVERVIEW_TABLE2_HEADER_ROW = 16
export const V091_OVERVIEW_TABLE2_FIRST_DATA_ROW = 17

/** Per-WG / per-Fleet sheet header row + first data row (1-based). */
export const V091_PER_WG_HEADER_ROW = 2
export const V091_PER_WG_FIRST_DATA_ROW = 3
/** Gold seeds the per-WG sheet with 19 blank rows (rows 3–21). */
export const V091_PER_WG_DEFAULT_DATA_ROW_SLOTS = 19
