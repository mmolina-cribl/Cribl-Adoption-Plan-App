import type { CriblEnvironmentSnapshot } from './criblEnvironmentTypes'
import { harvestDiagFromFiles } from './diagHarvest'
import { extractTarGzArchive } from './diagTarGz'
import { harvestDiagEnvironmentFromFiles } from './harvestDiagEnvironment'
import { harvestTenantEnvironment } from './harvestTenantEnvironment'
import { harvestTenantTopology, type TenantHarvestOptions, type TenantHarvestResult } from './tenantHarvest'

export type TopologyImportResult = {
  capturedAt: string
  harvest: TenantHarvestResult
  environment: CriblEnvironmentSnapshot
}

function alignEnvironmentSnapshot(
  environment: CriblEnvironmentSnapshot,
  capturedAt: string,
  source: 'diag' | 'tenant',
): CriblEnvironmentSnapshot {
  return { ...environment, capturedAt, source }
}

/** Extract diag bundle once; harvest plan topology and environment routing snapshot together. */
export async function importDiagTopology(
  archiveBytes: Uint8Array,
  options?: TenantHarvestOptions,
): Promise<TopologyImportResult> {
  const files = await extractTarGzArchive(archiveBytes)
  return importDiagTopologyFromFiles(files, options)
}

/** Parse extracted diag files into plan harvest + environment snapshot (test seam). */
export function importDiagTopologyFromFiles(
  files: Map<string, Uint8Array>,
  options?: TenantHarvestOptions,
): TopologyImportResult {
  const capturedAt = new Date().toISOString()
  const harvest = harvestDiagFromFiles(files, options)
  const environment = alignEnvironmentSnapshot(
    harvestDiagEnvironmentFromFiles(files, options),
    capturedAt,
    'diag',
  )
  return { capturedAt, harvest, environment }
}

/** Harvest live tenant topology and environment routing snapshot with aligned capture time. */
export async function importTenantTopology(
  options?: TenantHarvestOptions,
): Promise<TopologyImportResult> {
  const capturedAt = new Date().toISOString()
  const harvest = await harvestTenantTopology(undefined, options)
  const environment = alignEnvironmentSnapshot(
    await harvestTenantEnvironment(options),
    capturedAt,
    'tenant',
  )
  return { capturedAt, harvest, environment }
}
