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

/**
 * Customer-friendly description per base-scope deliverable, surfaced
 * under each row on the Activation → Base Scope tab so a CSE / customer
 * immediately sees what the deliverable actually involves rather than
 * having to infer it from a 2-3 word label.
 *
 * These deliverables are *not* described in the gold `PS Use Case
 * Worksheet` reference table (only the use-case kinds are), so this
 * blurb is app-only context. Keep the lead sentence short and
 * outcome-oriented; the follow-on sentence(s) call out the concrete
 * artifact the customer walks away with.
 *
 * Keys MUST match `PS_BASE_SCOPE_ITEMS[i].item` exactly so lookup is
 * O(1) by item name.
 */
export const PS_BASE_SCOPE_DELIVERABLE_DESCRIPTIONS: Record<string, string> = {
  Architecture:
    "Working sessions to design the customer's Cribl deployment — leader/worker topology, data flow, network and security boundaries, and high-availability decisions. Output is a set of architecture diagrams plus a decisions log that anchors every later phase of the engagement and gives the customer a defensible artifact for their own change-management process.",
  'Use Case Planning':
    "Collaborative scoping of the data use cases this engagement will deliver — picking from the canned kinds (Data Onboarding, Reduction, Routing, etc.) or defining custom ones. The completed worksheet (this very page) becomes the shared record of what's in and out of scope, plus the per-use-case parameters and acceptance criteria.",
  Deployment:
    "Stand-up of Cribl Stream leader / worker nodes (or Edge fleets) per the agreed architecture — installation, version pinning, leader-worker join, license activation, RBAC, and a basic health check before any production traffic flows. Sets the foundation every downstream use case is built on.",
  'Source/Destination Configuration':
    "Implement each scoped use case end-to-end — configure the source, build the pipeline, wire the destination, validate event flow with sample data, and tune routing rules so events land where they should in the right shape. This is where the Use Case Worksheet rows become real, running config in the customer's environment.",
  'Health Check':
    "Final review of the deployment as it actually exists — captured as an 'as-built' architecture document with validated data flows, performance baseline, capacity headroom, and an operations hand-off appendix the customer's team can run with after PS rolls off.",
}

/**
 * Look up the elaborated description for a base-scope item label.
 * Returns `null` for unknown labels so callers can hide the description
 * block rather than rendering a "no description" placeholder.
 *
 * Named with a `get*` prefix so `react-hooks/rules-of-hooks` doesn't
 * mistake it for a hook when called inside `.map()` callbacks during
 * render.
 */
export function getBaseScopeDeliverableDescription(item: string): string | null {
  if (!item) return null
  if (item in PS_BASE_SCOPE_DELIVERABLE_DESCRIPTIONS) {
    return PS_BASE_SCOPE_DELIVERABLE_DESCRIPTIONS[item]
  }
  return null
}

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

/**
 * Customer-friendly description per use-case kind, surfaced under the
 * Use Case Overview picker so a CSE / customer immediately sees what
 * they're committing to.
 *
 * Source of truth: the "Custom Use Case → Description" reference table
 * embedded in the gold `PS Use Case Worksheet` of the Adoption Plan
 * Excel template (v0.9.1). The lead sentence(s) of each entry are
 * preserved verbatim from that table — any wording drift here should
 * be mirrored back into the gold sheet — and the follow-on sentence
 * adds practical context (typical scope, what's involved, the outcome
 * the customer is buying) so the in-app blurb is more useful than the
 * raw spreadsheet cell.
 *
 * Keys MUST match `PS_USE_CASE_KIND_OPTIONS` exactly (case + whitespace).
 * The 'Format Conversion' and 'Other' entries are *not* in the gold
 * reference table; we keep them so the picker still surfaces something
 * if a CSE hand-picks those values.
 */
export const PS_USE_CASE_KIND_DESCRIPTIONS: Record<UseCaseKind, string> = {
  'Data Onboarding':
    'Onboarding data and routing to one destination and Cribl Lake. Convert data formats to match destination system requirements. Covers source configuration, format normalization (JSON, syslog, CSV), and the routing rules that land the data in your SIEM, observability tool, or Cribl Lake in the shape downstream consumers expect.',
  'Advanced Data Onboarding':
    'Onboarding data sources that require custom rest collectors or advanced configurations. Use this when the source needs bespoke REST polling, OAuth or token-refresh flows, multi-page pagination, or non-standard transport — anything beyond a stock TCP / HTTP / file collector.',
  'Data Archiving':
    'Configuration and testing of non-Cribl Lake data archive settings, including S3 partitioning strategy, Log Replay configuration, and validation. Includes sizing the archive bucket, defining partition keys (date / source / sourcetype), wiring Replay collectors, and validating round-trip integrity so archived data can be rehydrated for investigations or compliance.',
  'Data Reduction':
    'Building pipelines to reduce data volume or event size going to a destination system. Requires the customer to onboard the data source or a Data Onboarding Use Case. Typical tactics include dropping low-value fields, deduplicating events, sampling chatty sources, and aggregating into rollups — usually the fastest path to cutting SIEM and observability ingest cost.',
  'Logs to Metrics':
    'Building pipelines to convert event log data to metrics. Extracts numerical signals (counts, latencies, error rates) from high-volume logs and emits them as time-series so dashboards and alerts keep working without paying to ingest the underlying log line.',
  'Edge Deployment':
    'Plan and configure the deployment of Edge nodes for data collection. Covers fleet design, host / container / Kubernetes rollout, leader-worker connectivity, and the host-level enrichment that becomes available once collection moves closer to the data source.',
  'Data Enrichment':
    'Building pipelines for the enrichment of data sources. Adds context to events before routing — lookup tables, GeoIP, threat-intel feeds, asset / CMDB metadata — so downstream tools can correlate, search, and alert against richer fields instead of opaque IDs.',
  'Format Conversion':
    'Translate events between formats (JSON, XML, syslog, CSV, Parquet) so a single source can fan out to destinations that each expect a different shape. Avoids duplicate collection when downstream tools disagree on schema.',
  'Data Routing':
    'Delivery of raw or unformatted data or a subset of data to two or more destinations. Fans one source out to multiple destinations with different filters, transformations, or fidelity per route — e.g. full data to cold storage, sampled to the SIEM, only error events to a paging tool.',
  'Cribl Search':
    'Implementing and adopting use cases with Cribl Search, featuring practical training sessions using your data sets. Covers DataSet Provider / DataSet setup, dashboard and saved-search authoring, and hands-on enablement so analysts can investigate in-flight Stream data and archived data in object storage without rehydrating it into a SIEM.',
  'Container Deployment':
    'Assist in deploying Stream within a containerized environment. This will extend support to include previously excluded container deployments. Covers Docker / Kubernetes / OpenShift rollouts, Helm chart configuration, persistent volume strategy, leader HA, and worker autoscaling for production-grade containerized Stream.',
  Other:
    'Custom or non-standard use case not covered by the canned list. Use the Notes column on each parameter row to describe what the customer is solving, the expected outcomes, and any non-standard collectors, pipelines, or destinations involved so the engagement still has a paper trail.',
}

/**
 * Look up the description for a kind value. Returns `null` for empty
 * picks (no kind chosen yet) or strings that aren't in the canonical
 * vocabulary — callers should hide the description block in that case
 * rather than showing a "no description" placeholder.
 *
 * Named with a `get*` prefix (rather than `useCaseKindDescription`) so
 * `react-hooks/rules-of-hooks` doesn't mistake it for a hook when
 * called inside `.map()` callbacks during render.
 */
export function getUseCaseKindDescription(kind: string): string | null {
  if (!kind) return null
  if (kind in PS_USE_CASE_KIND_DESCRIPTIONS) {
    return PS_USE_CASE_KIND_DESCRIPTIONS[kind as UseCaseKind]
  }
  return null
}

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
// Tier color palette
// ────────────────────────────────────────────────────────────────────

/**
 * Per-tier Tailwind palette. Single source of truth for any UI surface
 * that needs to read the tier at a glance — sticky tier chip in the
 * Activation page header, "Activation · Silver" pill in the left nav,
 * tier picker cards, per-use-case tier badges. Mapping:
 *
 *   - Silver   → slate (cool neutral, evokes silver/steel)
 *   - Gold     → amber (warm gold)
 *   - Platinum → violet (premium, distinct from Silver's neutral grey)
 *
 * IMPORTANT: every class string must appear verbatim in source so
 * Tailwind's content scanner picks them up — never build them by
 * concatenation. If you add a new key here, add it to all three tiers
 * so consumers don't need to handle missing entries.
 */
export const TIER_PALETTE: Record<
  ActivationTier,
  {
    /** Border + bg + text. Used by the small TierBadge pill on each use-case card. */
    badge: string
    /** Border + bg + text. Used by the larger sticky chip + nav pill. */
    chip: string
    /**
     * Border + ring used to highlight the picker card matching the
     * currently-selected tier. Replaces the generic cribl-primary
     * ring so the picker visually echoes the tier's own color.
     */
    cardActive: string
    /**
     * Border + ring on hover for non-current picker cards. Subtle,
     * just enough to hint at the tier without screaming.
     */
    cardHover: string
    /** Solid bg utility for a small colored swatch / dot. */
    dot: string
    /** Accent text color for eyebrows / "·" separators. */
    accentText: string
  }
> = {
  Silver: {
    badge: 'border-slate-200 bg-slate-50 text-slate-700',
    chip: 'border-slate-300 bg-slate-50 text-slate-700',
    cardActive: 'border-slate-500 ring-2 ring-slate-300/60',
    cardHover: 'hover:border-slate-400 hover:ring-2 hover:ring-slate-200/60',
    dot: 'bg-slate-400',
    accentText: 'text-slate-600',
  },
  Gold: {
    badge: 'border-amber-200 bg-amber-50 text-amber-800',
    chip: 'border-amber-300 bg-amber-50 text-amber-800',
    cardActive: 'border-amber-500 ring-2 ring-amber-300/60',
    cardHover: 'hover:border-amber-400 hover:ring-2 hover:ring-amber-200/60',
    dot: 'bg-amber-400',
    accentText: 'text-amber-700',
  },
  Platinum: {
    badge: 'border-violet-200 bg-violet-50 text-violet-700',
    chip: 'border-violet-300 bg-violet-50 text-violet-700',
    cardActive: 'border-violet-500 ring-2 ring-violet-300/60',
    cardHover: 'hover:border-violet-400 hover:ring-2 hover:ring-violet-200/60',
    dot: 'bg-violet-400',
    accentText: 'text-violet-700',
  },
}

/**
 * Lookup helper that returns `null` for an unset tier. Lets callers
 * guard with `if (palette) { ... }` and fall back to neutral cribl
 * styling when the customer hasn't picked yet.
 */
export function tierPalette(tier: ActivationTier | null) {
  if (!tier) return null
  return TIER_PALETTE[tier]
}

// ────────────────────────────────────────────────────────────────────
// Column letters (1-based) for cell addressing
// ────────────────────────────────────────────────────────────────────

/** A=1, B=2, C=3, D=4, E=5. Used by both blocks. */
export const PS_COL_ITEM_OR_USECASE = 1 // Block 1: Item; Block 3: Use Case label
export const PS_COL_USECASE_NUMBER = 2 // Block 2: kind picker; Block 3: parameter #
export const PS_COL_DELIVERABLE_OR_PARAMS = 3 // Block 1: Deliverable; Block 3: Parameters
export const PS_COL_STATUS = 4
export const PS_COL_NOTES = 5
