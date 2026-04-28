export type SourceSummaryRow = {
  id: string
  /** Which worker group this source row belongs to (grouping in the plan rail / UI). */
  workerGroupId: string
  /** Shown in the left nav and page header; defaults to "Source 1", "Source 2", … */
  displayName: string
  source: string
  securityOrObs: string
  streamOrEdge: string
  /** On-Prem vs Cloud/Internet (source context). */
  type: '' | 'On-Prem' | 'Cloud/Internet'
  /** One or more regions (comma-separated string for Excel compatibility). */
  regions: string
  sourceTile: string
  pipelineUsecase: string
  destinations: string
  retention: string
  avgDailyGb: string
  complianceRelated: boolean
  dataCriticality: string
  stakeholders: string
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
  additionalNotes: string
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

export type WorkerGroupRow = {
  id: string
  /** Worker group name/role — same column as the topology sheet. */
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
