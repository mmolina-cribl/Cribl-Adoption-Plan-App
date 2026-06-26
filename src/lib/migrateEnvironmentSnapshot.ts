import {
  ENVIRONMENT_SNAPSHOT_VERSION,
  emptyEnvironmentSnapshot,
  productScopeIdForGroup,
  productScopeLabel,
  type CriblEnvironmentGroup,
  type CriblEnvironmentInput,
  type CriblEnvironmentOutput,
  type CriblEnvironmentPipeline,
  type CriblEnvironmentRoute,
  type CriblEnvironmentScope,
  type CriblEnvironmentSnapshot,
} from './criblEnvironmentTypes'

type LegacyFlatGroup = {
  id: string
  label: string
  kind: 'stream' | 'edge'
  scopes?: CriblEnvironmentScope[]
  inputs?: CriblEnvironmentInput[]
  routes?: CriblEnvironmentRoute[]
  pipelines?: CriblEnvironmentPipeline[]
  outputs?: CriblEnvironmentOutput[]
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function migrateGroup(group: LegacyFlatGroup): CriblEnvironmentGroup {
  if (Array.isArray(group.scopes) && group.scopes.length > 0) {
    return {
      id: group.id,
      label: group.label,
      kind: group.kind,
      scopes: group.scopes,
    }
  }

  const productId = productScopeIdForGroup(group.kind)
  const scope: CriblEnvironmentScope = {
    id: productId,
    label: productScopeLabel(group.kind),
    kind: productId,
    inputs: group.inputs ?? [],
    routes: group.routes ?? [],
    pipelines: group.pipelines ?? [],
    outputs: group.outputs ?? [],
  }

  return {
    id: group.id,
    label: group.label,
    kind: group.kind,
    scopes: [scope],
  }
}

/** Normalize KV / import payloads; upgrade legacy flat groups to scoped shape. */
export function migrateEnvironmentSnapshot(raw: unknown): CriblEnvironmentSnapshot {
  if (!isRecord(raw)) {
    return emptyEnvironmentSnapshot()
  }

  const groupsRaw = raw.groups
  if (!Array.isArray(groupsRaw)) {
    return emptyEnvironmentSnapshot()
  }

  const groups: CriblEnvironmentGroup[] = []
  for (const row of groupsRaw) {
    if (!isRecord(row)) {
      continue
    }
    const id = typeof row.id === 'string' ? row.id : ''
    if (!id) {
      continue
    }
    const kind = row.kind === 'edge' ? 'edge' : 'stream'
    const label = typeof row.label === 'string' ? row.label : id
    groups.push(
      migrateGroup({
        id,
        label,
        kind,
        scopes: row.scopes as CriblEnvironmentScope[] | undefined,
        inputs: row.inputs as CriblEnvironmentInput[] | undefined,
        routes: row.routes as CriblEnvironmentRoute[] | undefined,
        pipelines: row.pipelines as CriblEnvironmentPipeline[] | undefined,
        outputs: row.outputs as CriblEnvironmentOutput[] | undefined,
      }),
    )
  }

  return {
    snapshotVersion:
      typeof raw.snapshotVersion === 'number' ? raw.snapshotVersion : ENVIRONMENT_SNAPSHOT_VERSION,
    capturedAt: typeof raw.capturedAt === 'string' ? raw.capturedAt : new Date().toISOString(),
    source: raw.source === 'tenant' ? 'tenant' : 'diag',
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
    groups,
  }
}
