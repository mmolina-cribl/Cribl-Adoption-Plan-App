import type { PlanState } from '../types/planTypes'

/** True when the session already has user-entered or imported plan content. */
export function hasExistingPlanData(plan: PlanState): boolean {
  return (
    plan.customerName.trim() !== '' ||
    plan.cseNotes.trim() !== '' ||
    plan.sourceSummary.length > 0 ||
    plan.sourceVolume.length > 0 ||
    plan.workerGroups.length > 0
  )
}
