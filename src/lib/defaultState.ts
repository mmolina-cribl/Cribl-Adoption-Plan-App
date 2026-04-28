import { newId, type PlanState, type SourceSummaryRow, type SourceVolumeRow, type WorkerGroupRow } from '../types/planTypes'

function defaultSourceRow(sourceIndex0: number, workerGroupId: string): SourceSummaryRow {
  return {
    id: newId(),
    workerGroupId,
    displayName: `Source ${sourceIndex0 + 1}`,
    source: '',
    securityOrObs: '',
    streamOrEdge: '',
    type: '',
    regions: '',
    sourceTile: '',
    pipelineUsecase: '',
    destinations: '',
    retention: '',
    avgDailyGb: '',
    complianceRelated: false,
    dataCriticality: '',
    stakeholders: '',
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

function defaultWorkerGroupRow(): WorkerGroupRow {
  return {
    id: newId(),
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
