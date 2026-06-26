import type { CriblEnvironmentSnapshot } from './criblEnvironmentTypes'
import type { PlanProvenance } from '../types/planTypes'

/** True when plan provenance and environment snapshot likely came from different imports. */
export function environmentPlanOutOfSync(
  snapshot: CriblEnvironmentSnapshot,
  provenance?: PlanProvenance,
): boolean {
  if (!provenance) {
    return false
  }
  if (provenance.kind === 'scratch' || provenance.kind === 'xlsx') {
    return true
  }
  if (provenance.kind !== snapshot.source) {
    return true
  }
  if (provenance.capturedAt && provenance.capturedAt !== snapshot.capturedAt) {
    return true
  }
  return false
}

export function environmentEmptyHint(provenance?: PlanProvenance): string {
  if (provenance?.kind === 'xlsx') {
    return 'Excel import does not include routing — use Diagnostic bundle or Live tenant on Import.'
  }
  if (provenance?.kind === 'diag' || provenance?.kind === 'tenant') {
    return 'Re-import from Import to refresh routing for your current plan.'
  }
  return 'Import a diagnostic bundle or live tenant topology to get started.'
}
