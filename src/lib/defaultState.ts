import {
  newId,
  type PlanState,
  type SourceSummaryRow,
  type SourceVolumeRow,
  type WorkerGroupKind,
  type WorkerGroupRow,
} from '../types/planTypes'

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
  }
}

export { defaultSourceRow, defaultVolumeRow, defaultWorkerGroupRow }
