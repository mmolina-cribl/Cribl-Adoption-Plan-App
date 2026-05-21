import {
  newId,
  type Activation,
  type ActivationBaseScopeRow,
  type ActivationUseCase,
  type ActivationUseCaseOverviewRow,
  type ActivationWorksheetRow,
  type PlanState,
  type SourceSummaryRow,
  type SourceVolumeRow,
  type WorkerGroupKind,
  type WorkerGroupRow,
} from '../types/planTypes'
import {
  PS_BASE_SCOPE_ITEMS,
  PS_BASE_SCOPE_WORKSHEET_LABELS,
  PS_DEFAULT_STATUS,
  PS_PARAMETERS_PER_USE_CASE,
  PS_USE_CASE_COUNT,
} from './psUseCaseLayout'

function defaultSourceRow(_sourceIndex0: number, workerGroupId: string): SourceSummaryRow {
  return {
    id: newId(),
    workerGroupId,
    source: '',
    securityOrObs: '',
    streamOrEdge: '',
    type: '',
    physicalLocations: '',
    sourceTile: '',
    pipelineUsecase: '',
    destinations: '',
    retention: '',
    avgDailyGb: '',
    complianceRelated: false,
    dataCriticality: '',
    stakeholders: '',
    currentCollection: '',
    isCurrent: false,
    targetOnboardStart: '',
    targetOnboardEnd: '',
    onboardingCompletedOn: '',
    blockers: '',
    growth: '',
    dataOptPct: '',
    dataOptGb: '',
    initiativeCase: '',
    technicalUsecase: '',
    financial: '',
    operational: '',
    riskReduction: '',
    strategic: '',
    onboardingEffort: '',
    politics: '',
    additionalNotes: '',
  }
}

function defaultVolumeRow(workerGroupId: string): SourceVolumeRow {
  return {
    id: newId(),
    workerGroupId,
    source: '',
    dailyVolumeGb: '',
    type: '',
    region: '',
    currentCollection: '',
    criblCollection: '',
    wg: '',
    useCases: '',
    destinations: '',
    notes: '',
  }
}

function defaultWorkerGroupRow(kind: WorkerGroupKind = 'stream'): WorkerGroupRow {
  return {
    id: newId(),
    kind,
    wg: '',
    ingestGbd: '',
    egressGbd: '',
    throughputGbd: '',
    workerHosting: '',
    workerCount: '',
    workerDetail: '',
    diskOneDayGb: '',
    parentFleetId: '',
  }
}

/**
 * Default value for a single editable Activation worksheet cell trio.
 * Used by `defaultActivation()` and by importer fallbacks when a row
 * cell is missing or unparseable.
 */
function defaultWorksheetRow(): ActivationWorksheetRow {
  return { parameters: '', status: PS_DEFAULT_STATUS, notes: '' }
}

function defaultBaseScopeRow(): ActivationBaseScopeRow {
  return { status: PS_DEFAULT_STATUS, notes: '' }
}

function defaultUseCaseOverviewRow(): ActivationUseCaseOverviewRow {
  return { kind: '' }
}

function defaultUseCase(): ActivationUseCase {
  return {
    parameters: Array.from({ length: PS_PARAMETERS_PER_USE_CASE }, defaultWorksheetRow),
  }
}

/**
 * Empty `Activation` object matching the gold's pre-shipped shape:
 * 5 base-scope rows (all "Not Started"), 5 use-case-overview slots
 * (all empty kind), 3 base-scope worksheet rows (all "Not Started"
 * with empty Parameters/Notes), and 5 use cases × 5 parameter rows
 * each (all "Not Started" with empty Parameters/Notes). `tier` is
 * `null` so the picker modal triggers on the user's first visit to
 * the Activation page.
 */
export function defaultActivation(): Activation {
  return {
    tier: null,
    baseScope: PS_BASE_SCOPE_ITEMS.map(defaultBaseScopeRow),
    useCaseOverview: Array.from({ length: PS_USE_CASE_COUNT }, defaultUseCaseOverviewRow),
    baseScopeWorksheet: PS_BASE_SCOPE_WORKSHEET_LABELS.map(defaultWorksheetRow),
    useCases: Array.from({ length: PS_USE_CASE_COUNT }, defaultUseCase),
  }
}

export function createEmptyPlan(): PlanState {
  return {
    version: 1,
    customerName: '',
    cseNotes: '',
    sourceSummary: [],
    sourceVolume: [],
    workerGroups: [],
    activation: defaultActivation(),
  }
}

export { defaultSourceRow, defaultVolumeRow, defaultWorkerGroupRow }
