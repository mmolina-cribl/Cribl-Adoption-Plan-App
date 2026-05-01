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
   * v0.9.1 only dropped two per-source columns from the v0.8.6 schema:
   * `Display name` and `Additional notes`. The "value lever" fields
   * (Operational / Risk Reduction / Strategic / Onboarding Effort / Politics)
   * stay on every per-WG and per-Fleet sheet and are still tracked here. The
   * `PS Use Case Worksheet` (PR C) is a separate account-level tracker, not
   * a replacement for these per-source fields.
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
   * (`'stream'`, exported as a `wg<name>` sheet, surfaced under "Worker
   * Groups" in the left nav) or a Cribl Edge fleet (`'edge'`, exported as
   * a `fl<name>_fleet` sheet, surfaced under "Fleets"). Sources still
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
}

export type PlanState = {
  version: 1
  customerName: string
  cseNotes: string
  sourceSummary: SourceSummaryRow[]
  sourceVolume: SourceVolumeRow[]
  workerGroups: WorkerGroupRow[]
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
