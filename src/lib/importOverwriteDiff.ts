import type { PlanState } from '../types/planTypes'
import type { CriblEnvironmentSnapshot } from './criblEnvironmentTypes'
import { computeEnvironmentImportDiff, type EnvironmentImportDiff } from './environmentImportDiff'
import { computePlanImportDiff, type PlanImportDiff } from './planImportDiff'

export type ImportOverwriteKind = 'xlsx' | 'diag' | 'tenant'

export type ImportOverwriteDiff = {
  importKind: ImportOverwriteKind
  plan: PlanImportDiff
  environment: EnvironmentImportDiff
  harvestWarnings?: string[]
}

export function buildImportOverwriteDiff(args: {
  importKind: ImportOverwriteKind
  currentPlan: PlanState
  nextPlan: PlanState
  currentEnvironment: CriblEnvironmentSnapshot | null
  nextEnvironment: CriblEnvironmentSnapshot | null
  harvestWarnings?: string[]
}): ImportOverwriteDiff {
  const activationWillReset = args.importKind === 'diag' || args.importKind === 'tenant'
  const importClearsEnvironment = args.importKind === 'xlsx'

  const plan = computePlanImportDiff(args.currentPlan, args.nextPlan, { activationWillReset })
  const environment = computeEnvironmentImportDiff(args.currentEnvironment, args.nextEnvironment, {
    importClearsEnvironment,
  })

  return {
    importKind: args.importKind,
    plan,
    environment,
    harvestWarnings: args.harvestWarnings,
  }
}
