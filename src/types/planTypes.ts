export type SourceSummaryRow = {
  id: string
  /** Which worker group / fleet this source row belongs to (grouping in the plan rail / UI). */
  workerGroupId: string
  source: string
  securityOrObs: string
  streamOrEdge: string
  /** On-Prem vs Cloud/Internet (source context). */
  type: '' | 'On-Prem' | 'Cloud/Internet'
  /**
   * v0.9.1: replaces the v0.8.6 `regions` column. Free-text physical location(s)
   * (e.g. "us-east-1", "DC4 / Stockholm", "AWS + on-prem hybrid"). The Excel
   * column is now "Physical location(s)". Region(s) is still accepted on import
   * for backward compatibility with v0.8.6 workbooks.
   */
  physicalLocations: string
  sourceTile: string
  pipelineUsecase: string
  destinations: string
  retention: string
  avgDailyGb: string
  complianceRelated: boolean
  dataCriticality: string
  stakeholders: string
  /**
   * v0.9.1: pre-Cribl ingestion path (e.g. "Splunk UF", "Heavy Forwarder",
   * "syslog-ng"). Drives migration use cases and was previously only present
   * on the topology sheet, not the per-source view.
   */
  currentCollection: string
  isCurrent: boolean
  targetOnboardStart: string
  targetOnboardEnd: string
  onboardingCompletedOn: string
  blockers: string
  growth: string
  dataOptPct: string
  dataOptGb: string
  initiativeCase: string
  technicalUsecase: string
  financial: string
  operational: string
  riskReduction: string
  strategic: string
  onboardingEffort: string
  politics: string
  /**
   * v0.9.1: per-source free-text notes. Lives in column AE on every
   * `wg-<name>` / `fl-<name>` sheet (the only column that sits
   * outside any of the row-1 banner groups), and round-trips through
   * `Additional notes` on the import / export header maps.
   *
   * v0.9.0 briefly dropped this column from the gold; v0.9.1
   * reinstated it because customers used it on every onboarding for
   * out-of-band annotations (vendor contacts, ticket links, custom
   * compliance notes) that don't fit any of the more structured
   * fields. The KV migration in `migrateLoadedPlan` backfills `''`
   * for plans saved against the v0.9.0 shape.
   */
  additionalNotes: string
  /**
   * The per-source `Display name` column the v0.8.6 schema carried
   * was the one column v0.9.1 actually dropped — every other gold
   * field round-trips through this row. The `PS Use Case Worksheet`
   * (PR C) is a separate account-level tracker, not a replacement
   * for these per-source fields.
   */
}

export type SourceVolumeRow = {
  id: string
  /** Join to `WorkerGroupRow.id` (reconciled with the WG name field from Excel). */
  workerGroupId: string
  source: string
  dailyVolumeGb: string
  type: 'On-Prem' | 'Cloud/Internet' | ''
  region: string
  currentCollection: string
  criblCollection: string
  wg: string
  useCases: string
  destinations: string
  notes: string
}

export type WorkerGroupKind = 'stream' | 'edge'

export type WorkerGroupRow = {
  id: string
  /**
   * v0.9.1: a row in `workerGroups` is either a Cribl Stream worker group
   * (`'stream'`, exported as a `wg-<name>` sheet, surfaced under "Worker
   * Groups" in the left nav) or a Cribl Edge fleet (`'edge'`, exported as
   * a `fl-<name>` sheet, surfaced under "Fleets"). Sources still
   * point at one of these via `workerGroupId` regardless of kind. Plans
   * imported from a v0.8.6 workbook (or hydrated from a v1.x KV blob)
   * default every entry to `'stream'`.
   */
  kind: WorkerGroupKind
  /** Worker group / fleet name — same column as the topology sheet. */
  wg: string
  /** Ingest (GB/day) — can be set manually or from rollups. */
  ingestGbd: string
  /** Egress (GB/day) */
  egressGbd: string
  /**
   * Throughput (GB/day) — if empty, the UI / Excel use ingest + egress.
   * For future Gainsight sync or manual override.
   */
  throughputGbd: string
  workerHosting: string
  workerCount: string
  workerDetail: string
  /**
   * Disk required for 1 day storage (GB) — if empty, derived from egress ÷ 8 in UI / Excel.
   */
  diskOneDayGb: string
  /**
   * Edge only: when set, this fleet is a sub-fleet of the parent top-level fleet
   * (`kind === 'edge'` and `parentFleetId` empty). Stream rows ignore this field.
   */
  parentFleetId: string
}

/**
 * Status value for any row of the gold's `PS Use Case Worksheet` sheet
 * (blocks 1 and 3). Restricted to the 4-value list the gold's data
 * validation enforces. Used by every editable Status cell on the
 * Activation page.
 */
export type ActivationStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Pending Review'
  | 'Complete'

/**
 * Cribl PS engagement tier the customer purchased. Drives soft-gating
 * of use case slots in the Activation page (Silver = first 2 slots in
 * scope, Gold = first 3, Platinum = all 5). Stored in PlanState but
 * does NOT round-trip through the .xlsx — the gold has no cell for it.
 * `null` when the user hasn't picked yet (initial state, or explicit
 * "I'll pick later" dismiss).
 */
export type ActivationTier = 'Silver' | 'Gold' | 'Platinum'

/**
 * One row of the `PS Use Case Worksheet` block 1 (Activation Base
 * Scope, rows 3–7). Item / Deliverable column-A and column-C labels
 * are static (sourced from `psUseCaseLayout.PS_BASE_SCOPE_ITEMS`); we
 * only persist the customer-edited fields.
 */
export type ActivationBaseScopeRow = {
  status: ActivationStatus
  notes: string
}

/**
 * One row of the `PS Use Case Worksheet` block 2 (Activation Use Case
 * Overview, rows 11–15). The customer picks a kind from a 12-value
 * dropdown; an empty string means "no pick yet" (renders as blank).
 */
export type ActivationUseCaseOverviewRow = {
  kind: string
}

/**
 * One row of the `PS Use Case Worksheet` block 3 (Activation Use Case
 * Worksheet) — the row layout shared by the 3 base-scope sub-rows
 * (rows 19–21) and every use-case parameter row (rows 22–46). Column
 * A / B labels are static and live in `psUseCaseLayout.ts`; we only
 * persist the customer-edited fields.
 */
export type ActivationWorksheetRow = {
  parameters: string
  status: ActivationStatus
  notes: string
}

/**
 * One use-case slot on the worksheet (block 3, rows 22–46). Each slot
 * owns 5 parameter rows. Tier of the slot is derived by index from
 * `psUseCaseLayout.PS_USE_CASE_TIERS` and is not stored here.
 */
export type ActivationUseCase = {
  parameters: ActivationWorksheetRow[]
}

/**
 * Top-level activation tracker — a 1-to-1 model of the gold's
 * `PS Use Case Worksheet` sheet plus a soft tier picker. See
 * `CRIBL_DEV_NOTES.md` → "PR C — feat/v2.0-ps-use-cases" for the
 * full design and `psUseCaseLayout.ts` for the static labels.
 */
export type Activation = {
  /** PS engagement tier; `null` until the picker modal is answered. */
  tier: ActivationTier | null
  /** 5 base-scope deliverables (rows 3–7). */
  baseScope: ActivationBaseScopeRow[]
  /** 5 use-case overview slots (rows 11–15). */
  useCaseOverview: ActivationUseCaseOverviewRow[]
  /** 3 base-scope worksheet rows (rows 19–21). */
  baseScopeWorksheet: ActivationWorksheetRow[]
  /** 5 use cases × 5 parameter rows each (rows 22–46). */
  useCases: ActivationUseCase[]
}

export type PlanState = {
  version: 1
  customerName: string
  cseNotes: string
  sourceSummary: SourceSummaryRow[]
  sourceVolume: SourceVolumeRow[]
  workerGroups: WorkerGroupRow[]
  /**
   * Activation tracker for the `PS Use Case Worksheet` sheet (PR C,
   * v2.0.0). Plans imported from older v0.8.6 / v0.9.1 workbooks (or
   * hydrated from pre-PR-C KV blobs) backfill this with default empty
   * values via `defaultActivation()` — the field is non-optional so
   * the rest of the app can rely on its shape.
   */
  activation: Activation
}

export function newId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  return `id-${Math.random().toString(16).slice(2)}`
}

/**
 * Display label for a source row in lists / nav / cards.
 *
 * v0.9.1 dropped the dedicated `Display name` column, so we fall back to the
 * Source field, then to a positional placeholder. Centralized so every list
 * uses the same label and a future rename is one edit.
 */
export function sourceLabel(row: Pick<SourceSummaryRow, 'source'>, index0: number): string {
  return row.source?.trim() || `Source ${index0 + 1}`
}
