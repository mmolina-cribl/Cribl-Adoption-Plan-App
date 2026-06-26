import type { Dispatch, SetStateAction } from 'react'
import type { PlanState } from '../types/planTypes'
import { PLAN_STORAGE_KEY } from '../hooks/usePlanStorage'
import { ENVIRONMENT_STORAGE_KEY, type CriblEnvironmentSnapshot } from './criblEnvironmentTypes'
import { clearImportShell, setImportShellFromBytes } from './importShellStore'
import { kvDelete, kvSet } from './kvStore'
import { buildTenantImportDebugPayload } from './topologyToPlan'
import type { TenantHarvestResult } from './tenantHarvest'

export type PendingXlsxImport = {
  kind: 'xlsx'
  plan: PlanState
  warnings: string[]
  shellBytes: Uint8Array
}

export type PendingTopologyImport = {
  kind: 'topology'
  plan: PlanState
  environment: CriblEnvironmentSnapshot
  capturedAt: string
  harvest: TenantHarvestResult
  harvestWarnings: string[]
  importKind: 'diag' | 'tenant'
}

export type PendingImport = PendingXlsxImport | PendingTopologyImport

export type ApplyPendingImportResult = {
  ok: true
  warnings: string[]
  message: string
  importDebug?: ReturnType<typeof buildTenantImportDebugPayload>
}

export async function applyPendingImport(
  pending: PendingImport,
  deps: {
    setPlan: Dispatch<SetStateAction<PlanState>>
    setEnvironmentSnapshot: (s: CriblEnvironmentSnapshot | null) => void
  },
): Promise<ApplyPendingImportResult> {
  if (pending.kind === 'xlsx') {
    const capturedAt = new Date().toISOString()
    const planWithProvenance: PlanState = {
      ...pending.plan,
      planProvenance: { kind: 'xlsx', capturedAt },
    }
    deps.setPlan(planWithProvenance)
    deps.setEnvironmentSnapshot(null)
    await kvDelete(ENVIRONMENT_STORAGE_KEY)
    setImportShellFromBytes(pending.shellBytes)
    return {
      ok: true,
      warnings: pending.warnings,
      message: pending.warnings.length ? 'Plan loaded with notes above.' : 'Plan loaded.',
    }
  }

  const note =
    pending.harvestWarnings.length > 0
      ? `${pending.importKind === 'diag' ? 'Diag import' : 'Harvest'} notes: ${pending.harvestWarnings.join(' ')}`
      : undefined
  const planWithProvenance: PlanState = {
    ...pending.plan,
    planProvenance: {
      kind: pending.importKind,
      capturedAt: pending.capturedAt,
      note,
    },
  }
  deps.setPlan(planWithProvenance)
  await kvSet(PLAN_STORAGE_KEY, planWithProvenance)
  deps.setEnvironmentSnapshot(pending.environment)
  await kvSet(ENVIRONMENT_STORAGE_KEY, pending.environment)
  clearImportShell()
  const importDebug = buildTenantImportDebugPayload(pending.capturedAt, pending.harvest, planWithProvenance)
  return {
    ok: true,
    warnings: pending.harvestWarnings,
    message:
      pending.importKind === 'diag'
        ? 'Plan and routing snapshot loaded from diagnostic bundle. Review groups and sources before exporting.'
        : 'Plan and routing snapshot loaded from tenant. Review groups and sources before exporting.',
    importDebug,
  }
}
