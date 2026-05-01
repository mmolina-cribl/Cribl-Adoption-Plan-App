/**
 * Static layout of the gold v0.9.1 `PS Use Case Worksheet` sheet.
 *
 * The sheet is 5 columns wide (A–E) and 46 data rows tall, organized
 * into three banner-separated blocks. Almost every cell in this sheet
 * is either a static label baked into the gold, or a small piece of
 * customer-editable data. This module enumerates every static cell so
 * the UI, importer, and exporter all read from one source of truth and
 * never drift out of sync.
 *
 * See `CRIBL_DEV_NOTES.md` → "PR C — feat/v2.0-ps-use-cases" for the
 * full design doc (cell-by-cell map, tier semantics, UX decisions).
 */

import type { ActivationStatus, ActivationTier } from '../types/planTypes'

/** Sheet name as it appears in the gold workbook. */
export const SHEET_PS_USE_CASE_WORKSHEET = 'PS Use Case Worksheet' as const

// ────────────────────────────────────────────────────────────────────
// Block 1 — Activation Base Scope (rows 1–7)
// ────────────────────────────────────────────────────────────────────

/** Row 1 banner cell, merged across A1:E1. */
export const PS_BLOCK1_BANNER_ROW = 1
export const PS_BLOCK1_BANNER_TEXT = 'Activation Base Scope' as const

/** Row 2 column headers (A–E). */
export const PS_BLOCK1_HEADER_ROW = 2
export const PS_BLOCK1_HEADERS = [
  'Item',
  '_',
  'Deliverable',
  'Status',
  'Notes',
] as const

/** First and last data rows for the 5 base-scope deliverables. */
export const PS_BLOCK1_FIRST_DATA_ROW = 3
export const PS_BLOCK1_LAST_DATA_ROW = 7

/**
 * The 5 base-scope deliverables, in order. Column A is "Item", column
 * C is "Deliverable", column B is the literal "_" separator the gold
 * uses to keep the merge geometry clean. The exporter writes these
 * verbatim on every export; the importer ignores them at parse time
 * (we only read the customer-edited Status / Notes columns).
 */
export const PS_BASE_SCOPE_ITEMS: ReadonlyArray<{
  item: string
  deliverable: string
}> = [
  { item: 'Architecture', deliverable: 'Architecture Meetings & Diagrams' },
  { item: 'Use Case Planning', deliverable: 'Use Case Worksheet' },
  { item: 'Deployment', deliverable: 'Leader and Workers Deployed' },
  { item: 'Source/Destination Configuration', deliverable: 'Use Cases Configured' },
  { item: 'Health Check', deliverable: 'As-Built Architecture Document' },
]

// ────────────────────────────────────────────────────────────────────
// Block 2 — Activation Use Case Overview (rows 9–15)
// ────────────────────────────────────────────────────────────────────

/** Row 9 banner cell, merged across A9:E9. */
export const PS_BLOCK2_BANNER_ROW = 9
export const PS_BLOCK2_BANNER_TEXT = 'Activation Use Case Overview' as const

/** Row 10 column headers (only A and B carry text; C–E are blank). */
export const PS_BLOCK2_HEADER_ROW = 10
export const PS_BLOCK2_HEADERS = ['Use Case #', 'Use Case'] as const

/** First and last data rows for the 5 use-case overview slots. */
export const PS_BLOCK2_FIRST_DATA_ROW = 11
export const PS_BLOCK2_LAST_DATA_ROW = 15

/**
 * Use Case # labels for column A of rows 11–15. These are static —
 * the gold writes them out as the strings `'1.0'`, `'2.0'`, etc. so
 * the exporter does the same.
 */
export const PS_USE_CASE_OVERVIEW_NUMBERS = ['1.0', '2.0', '3.0', '4.0', '5.0'] as const

/**
 * The 12-value dropdown the gold enforces on column B of rows 11–15.
 * The customer picks one entry per use-case slot; an empty/unset
 * value is also valid and renders as a blank cell.
 */
export const PS_USE_CASE_KIND_OPTIONS = [
  'Data Onboarding',
  'Advanced Data Onboarding',
  'Data Archiving',
  'Data Reduction',
  'Logs to Metrics',
  'Edge Deployment',
  'Data Enrichment',
  'Format Conversion',
  'Data Routing',
  'Cribl Search',
  'Container Deployment',
  'Other',
] as const

export type UseCaseKind = (typeof PS_USE_CASE_KIND_OPTIONS)[number]

// ────────────────────────────────────────────────────────────────────
// Block 3 — Activation Use Case Worksheet (rows 17–46)
// ────────────────────────────────────────────────────────────────────

/** Row 17 banner cell, merged across A17:E17. */
export const PS_BLOCK3_BANNER_ROW = 17
export const PS_BLOCK3_BANNER_TEXT = 'Activation Use Case Worksheet' as const

/** Row 18 column headers (A–E). */
export const PS_BLOCK3_HEADER_ROW = 18
export const PS_BLOCK3_HEADERS = [
  'Use Case',
  '#',
  'Parameters (Specific Logs/Tasks)',
  'Status',
  'Notes',
] as const

/** First data row of block 3 (the "Base Scope - Primary Source" row). */
export const PS_BLOCK3_FIRST_DATA_ROW = 19
/** Last data row of block 3 (Use Case #5 parameter 5). */
export const PS_BLOCK3_LAST_DATA_ROW = 46

/**
 * The 3 base-scope sub-rows that lead off block 3 (rows 19–21). Column
 * A holds the static label, column B is the literal "1.0" the gold
 * uses as a placeholder paragraph number. Each row carries its own
 * Parameters / Status / Notes editable trio.
 */
export const PS_BASE_SCOPE_WORKSHEET_LABELS: ReadonlyArray<string> = [
  'Base Scope - Primary Source',
  'Base Scope - Primary Destination',
  'Base Scope - Storage Location',
]

/**
 * Row indices (1-based, matching openpyxl/ExcelJS conventions) for
 * rows 19–21.
 */
export const PS_BASE_SCOPE_WORKSHEET_FIRST_ROW = 19
export const PS_BASE_SCOPE_WORKSHEET_LAST_ROW = 21

/**
 * Number of use cases in block 3. Hard-coded by the gold layout —
 * 5 use cases × 5 parameter rows each = 25 rows starting at row 22.
 */
export const PS_USE_CASE_COUNT = 5
export const PS_PARAMETERS_PER_USE_CASE = 5

/** First data row of the use-case sub-block (Use Case #1 parameter 1). */
export const PS_USE_CASE_WORKSHEET_FIRST_ROW = 22

/**
 * Tier each use-case slot is tagged with in the gold's column-A label
 * (e.g. row 22 reads `Use Case #1 (Silver)`). Indexed by use-case
 * number minus 1 (slot #1 → index 0). These are baked into the gold
 * and the exporter writes them verbatim.
 */
export const PS_USE_CASE_TIERS: ReadonlyArray<ActivationTier> = [
  'Silver',
  'Silver',
  'Gold',
  'Platinum',
  'Platinum',
]

/**
 * Customer-tier → number-of-use-cases mapping. Drives soft-gating in
 * the UI: when the customer has picked a tier, use-case slots whose
 * index is `>= unlockedCountForTier(tier)` render at reduced opacity
 * with an "Out of scope" pill.
 */
export function unlockedUseCaseCountForTier(tier: ActivationTier | null): number {
  if (tier === 'Silver') return 2
  if (tier === 'Gold') return 3
  if (tier === 'Platinum') return PS_USE_CASE_COUNT
  // Tier unset → no gating, all 5 cards full opacity.
  return PS_USE_CASE_COUNT
}

/**
 * The full column-A header label for a use-case slot, e.g.
 * `'Use Case #1 (Silver)'`. The exporter writes this verbatim into
 * the first row of each use-case's 5-row sub-block (rows 22, 27, 32,
 * 37, 42). The remaining 4 rows in each sub-block leave column A
 * blank — only the parameter number in column B varies.
 */
export function useCaseHeaderLabel(useCaseIndex0: number): string {
  const tier = PS_USE_CASE_TIERS[useCaseIndex0]
  return `Use Case #${useCaseIndex0 + 1} (${tier})`
}

/**
 * Row index (1-based) of the first parameter row for a given
 * use-case slot. Slot 0 → row 22, slot 1 → row 27, etc.
 */
export function useCaseFirstRow(useCaseIndex0: number): number {
  return PS_USE_CASE_WORKSHEET_FIRST_ROW + useCaseIndex0 * PS_PARAMETERS_PER_USE_CASE
}

/**
 * Static parameter-number label for column B of a worksheet row.
 * Uses the same `'1.0'`–`'5.0'` strings the gold uses (so the
 * exporter writes literal strings, not numeric cells, matching the
 * gold's text-typed cells).
 */
export const PS_PARAMETER_NUMBERS = ['1.0', '2.0', '3.0', '4.0', '5.0'] as const

// ────────────────────────────────────────────────────────────────────
// Shared dropdowns
// ────────────────────────────────────────────────────────────────────

/**
 * The 4-value Status dropdown the gold enforces on column D of every
 * data row in blocks 1 and 3 (rows 3–7 and rows 19–46). Used by both
 * the dropdown UI in the new Activation page and the importer's
 * value-validation pass.
 */
export const PS_STATUS_OPTIONS: ReadonlyArray<ActivationStatus> = [
  'Not Started',
  'In Progress',
  'Pending Review',
  'Complete',
]

/**
 * Default Status used for any row not explicitly filled in. Matches
 * the gold's pre-shipped default ("Not Started" appears in every D
 * cell of the empty template).
 */
export const PS_DEFAULT_STATUS: ActivationStatus = 'Not Started'

/**
 * The 3 tier values for the in-app PS-tier picker. Order is
 * smallest-to-largest scope so the segmented control reads
 * left-to-right naturally.
 */
export const PS_TIER_OPTIONS: ReadonlyArray<ActivationTier> = [
  'Silver',
  'Gold',
  'Platinum',
]

// ────────────────────────────────────────────────────────────────────
// Column letters (1-based) for cell addressing
// ────────────────────────────────────────────────────────────────────

/** A=1, B=2, C=3, D=4, E=5. Used by both blocks. */
export const PS_COL_ITEM_OR_USECASE = 1 // Block 1: Item; Block 3: Use Case label
export const PS_COL_USECASE_NUMBER = 2 // Block 2: kind picker; Block 3: parameter #
export const PS_COL_DELIVERABLE_OR_PARAMS = 3 // Block 1: Deliverable; Block 3: Parameters
export const PS_COL_STATUS = 4
export const PS_COL_NOTES = 5
