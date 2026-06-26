import { criblApiBase } from './leaderApi'
import type {
  CriblEnvironmentGroup,
  CriblEnvironmentInput,
  CriblEnvironmentOutput,
  CriblEnvironmentPipeline,
  CriblEnvironmentPipelineFunction,
  CriblEnvironmentRoute,
  CriblEnvironmentScope,
  CriblEnvironmentSnapshot,
} from './criblEnvironmentTypes'
import {
  ENVIRONMENT_SNAPSHOT_VERSION,
  productScopeIdForGroup,
  productScopeLabel,
} from './criblEnvironmentTypes'
import { configFromRecord, redactEnvironmentConfig } from './environmentConfigRedact'
import {
  collectPackRoutesMissingHarvestWarnings,
  groupRoutesMissingHarvestWarning,
} from './environmentPackEntry'
import { flattenLeaderRoutesBody } from './environmentRouteHarvest'
import { isLeaderOutpostGroup, isLeaderSearchGroup, isStockLeaderWorkerGroup } from './leaderStockGroups'
import { leaderWorkerGroupKind } from './topologyToPlan'
import type { MasterGroupItem, TenantHarvestOptions } from './tenantHarvest'
import { normalizeLeaderInputsResponse } from './tenantHarvest'

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

const LEADER_PATH_ABSENT_SS = 'cribl-adoption-leader-404-paths'

function readLeaderPathAbsentCache(): Set<string> {
  try {
    const raw = sessionStorage.getItem(LEADER_PATH_ABSENT_SS)
    if (raw) {
      return new Set(JSON.parse(raw) as string[])
    }
  } catch {
    /* ignore */
  }
  return new Set()
}

const leaderPathsAbsent = readLeaderPathAbsentCache()

function normalizeLeaderPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function markLeaderPathAbsent(path: string): void {
  const norm = normalizeLeaderPath(path)
  leaderPathsAbsent.add(norm)
  try {
    sessionStorage.setItem(LEADER_PATH_ABSENT_SS, JSON.stringify([...leaderPathsAbsent]))
  } catch {
    /* ignore */
  }
}

function leaderJsonObjectList(body: unknown): unknown[] {
  if (body == null) {
    return []
  }
  if (Array.isArray(body)) {
    return body
  }
  if (isRecord(body)) {
    if (Array.isArray(body.items)) {
      return body.items as unknown[]
    }
    if (Array.isArray(body.routes)) {
      return body.routes as unknown[]
    }
    if (Array.isArray(body.pipelines)) {
      return body.pipelines as unknown[]
    }
    if (Array.isArray(body.outputs)) {
      return body.outputs as unknown[]
    }
  }
  return []
}

async function fetchLeaderJsonFirst(paths: string[]): Promise<unknown> {
  const base = criblApiBase()
  if (!base) {
    return null
  }
  const toTry = paths.filter((p) => !leaderPathsAbsent.has(normalizeLeaderPath(p)))
  if (toTry.length === 0) {
    return null
  }
  for (const path of toTry) {
    const norm = normalizeLeaderPath(path)
    const url = `${base}${norm}`
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } })
      if (r.status === 404) {
        markLeaderPathAbsent(norm)
        continue
      }
      if (!r.ok) {
        continue
      }
      return (await r.json()) as unknown
    } catch {
      continue
    }
  }
  return null
}

function parseInputs(body: unknown): CriblEnvironmentInput[] {
  const rows = leaderJsonObjectList(body)
  if (rows.length === 0 && isRecord(body)) {
    const map = body.inputs ?? body.sources
    if (isRecord(map)) {
      return Object.entries(map).map(([id, cfg]) => {
        const row: CriblEnvironmentInput = { id }
        if (isRecord(cfg)) {
          if (typeof cfg.type === 'string') {
            row.type = cfg.type
          }
          if (cfg.disabled === true) {
            row.disabled = true
          }
          if (typeof cfg.description === 'string') {
            row.description = cfg.description
          }
          row.config = configFromRecord(cfg)
        }
        return row
      })
    }
  }
  const out: CriblEnvironmentInput[] = []
  for (const row of rows) {
    if (!isRecord(row)) {
      continue
    }
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (!id) {
      continue
    }
    out.push({
      id,
      type: typeof row.type === 'string' ? row.type : undefined,
      disabled: row.disabled === true,
      description: typeof row.description === 'string' ? row.description : undefined,
      config: configFromRecord(row),
    })
  }
  if (out.length === 0) {
    return normalizeLeaderInputsResponse(body).map((i) => ({
      id: i.id,
      type: i.type,
      disabled: i.disabled,
      description: i.description,
    }))
  }
  return out
}

/** Leader API paths for product-scope pipelines (`/m/{group}/pipelines` per OpenAPI). */
export function leaderProductPipelineApiPaths(groupId: string): string[] {
  const enc = encodeURIComponent(groupId)
  return [`/m/${enc}/pipelines`, `/m/${enc}/system/pipelines`]
}

/** Leader API paths for pack-scoped sources (WG context). Product scope uses `/system/inputs`; packs use `/p/{pack}/system/inputs`. */
export function leaderPackInputApiPaths(groupId: string, packId: string): string[] {
  const enc = encodeURIComponent(groupId)
  const penc = encodeURIComponent(packId)
  return [
    `/m/${enc}/p/${penc}/system/inputs`,
    `/m/${enc}/packs/${penc}/system/inputs`,
    `/m/${enc}/p/${penc}/system/sources`,
    `/m/${enc}/p/${penc}/inputs`,
    `/m/${enc}/packs/${penc}/inputs`,
    `/m/${enc}/p/${penc}/sources`,
  ]
}

/** Pack routes/pipelines on Leader use bare `/p/{pack}/routes` and `/p/{pack}/pipelines` (not `system/`). */
export function leaderPackRouteApiPaths(groupId: string, packId: string): string[] {
  const enc = encodeURIComponent(groupId)
  const penc = encodeURIComponent(packId)
  return [
    `/m/${enc}/p/${penc}/routes`,
    `/m/${enc}/p/${penc}/routes/default`,
    `/m/${enc}/p/${penc}/system/routes`,
  ]
}

export function leaderPackPipelineApiPaths(groupId: string, packId: string): string[] {
  const enc = encodeURIComponent(groupId)
  const penc = encodeURIComponent(packId)
  return [`/m/${enc}/p/${penc}/pipelines`, `/m/${enc}/p/${penc}/system/pipelines`]
}

/** Leader tenant API does not expose pack output lists — derive ids from pack routes instead. */
export function inferPackOutputsFromRoutes(routes: CriblEnvironmentRoute[]): CriblEnvironmentOutput[] {
  const ids = new Set<string>()
  for (const route of routes) {
    const outputId = route.output?.trim()
    if (outputId) {
      ids.add(outputId)
    }
  }
  return [...ids].sort().map((id) => ({
    id,
    type: id === 'default' ? 'default' : undefined,
  }))
}

function parsePipelineFunctions(row: Record<string, unknown>): CriblEnvironmentPipelineFunction[] | undefined {
  const block = row.functions
  if (!Array.isArray(block)) {
    return undefined
  }
  const fns: CriblEnvironmentPipelineFunction[] = []
  for (const item of block) {
    if (typeof item === 'string' && item.trim()) {
      fns.push({ id: item.trim() })
      continue
    }
    if (!isRecord(item)) {
      continue
    }
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id) {
      continue
    }
    fns.push({
      id,
      disabled: item.disabled === true,
      filter: typeof item.filter === 'string' ? item.filter : undefined,
      conf: configFromRecord(item),
    })
  }
  return fns.length > 0 ? fns : undefined
}

function parseRouteRow(row: Record<string, unknown>): CriblEnvironmentRoute | null {
  const id =
    (typeof row.id === 'string' ? row.id.trim() : '') ||
    (typeof row.name === 'string' ? row.name.trim() : '')
  if (!id) {
    return null
  }
  return {
    id,
    name: typeof row.name === 'string' ? row.name : undefined,
    filter:
      typeof row.filter === 'string' ? row.filter : row.filter === true ? 'true' : undefined,
    pipeline: typeof row.pipeline === 'string' ? row.pipeline.trim() : undefined,
    output:
      typeof row.output === 'string'
        ? row.output.trim()
        : typeof row.destination === 'string'
          ? row.destination.trim()
          : undefined,
    disabled: row.disabled === true,
    config: redactEnvironmentConfig({ ...row }),
  }
}

function parseRoutes(body: unknown): CriblEnvironmentRoute[] {
  const out: CriblEnvironmentRoute[] = []
  for (const row of flattenLeaderRoutesBody(body)) {
    if (!isRecord(row)) {
      continue
    }
    const route = parseRouteRow(row)
    if (route) {
      out.push(route)
    }
  }
  return out
}

function splitRoutesByPack(body: unknown): {
  product: CriblEnvironmentRoute[]
  byPack: Map<string, CriblEnvironmentRoute[]>
} {
  const product: CriblEnvironmentRoute[] = []
  const byPack = new Map<string, CriblEnvironmentRoute[]>()
  for (const row of flattenLeaderRoutesBody(body)) {
    if (!isRecord(row)) {
      continue
    }
    const route = parseRouteRow(row)
    if (!route) {
      continue
    }
    const packId = routePackContext(row)
    if (packId) {
      if (!byPack.has(packId)) {
        byPack.set(packId, [])
      }
      byPack.get(packId)!.push(route)
    } else {
      product.push(route)
    }
  }
  return { product, byPack }
}

function parseOutputs(body: unknown): CriblEnvironmentOutput[] {
  const out: CriblEnvironmentOutput[] = []
  const rows = leaderJsonObjectList(body)
  if (rows.length === 0 && isRecord(body)) {
    const map = body.outputs
    if (isRecord(map)) {
      for (const [id, cfg] of Object.entries(map)) {
        const row: CriblEnvironmentOutput = { id }
        if (isRecord(cfg)) {
          if (typeof cfg.type === 'string') {
            row.type = cfg.type
          }
          if (cfg.disabled === true) {
            row.disabled = true
          }
          row.config = configFromRecord(cfg)
        }
        out.push(row)
      }
      return out
    }
  }
  for (const row of rows) {
    if (!isRecord(row)) {
      continue
    }
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (!id) {
      continue
    }
    out.push({
      id,
      type: typeof row.type === 'string' ? row.type : undefined,
      disabled: row.disabled === true,
      config: configFromRecord(row),
    })
  }
  return out
}

function parsePipelines(body: unknown): CriblEnvironmentPipeline[] {
  const out: CriblEnvironmentPipeline[] = []
  for (const row of leaderJsonObjectList(body)) {
    if (!isRecord(row)) {
      continue
    }
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (!id) {
      continue
    }
    out.push({
      id,
      disabled: row.disabled === true,
      description: typeof row.description === 'string' ? row.description : undefined,
      config: configFromRecord(row),
      functions: parsePipelineFunctions(row),
    })
  }
  return out
}

function parsePackIds(body: unknown): string[] {
  const ids: string[] = []
  for (const row of leaderJsonObjectList(body)) {
    if (!isRecord(row)) {
      continue
    }
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    if (id) {
      ids.push(id)
    }
  }
  if (ids.length === 0 && isRecord(body)) {
    const items = body.items
    if (Array.isArray(items)) {
      for (const row of items) {
        if (isRecord(row) && typeof row.id === 'string' && row.id.trim()) {
          ids.push(row.id.trim())
        }
      }
    }
  }
  return [...new Set(ids)].sort()
}

function routePackContext(row: Record<string, unknown>): string | null {
  const ctx = row.context
  if (typeof ctx === 'string' && ctx.trim().toLowerCase() === 'pack') {
    const pack = row.pack ?? row.packId
    if (typeof pack === 'string' && pack.trim()) {
      return pack.trim()
    }
  }
  if (typeof row.pack === 'string' && row.pack.trim()) {
    return row.pack.trim()
  }
  return null
}

async function harvestProductScope(
  g: MasterGroupItem,
  omitDisabled: boolean,
  productRoutes: CriblEnvironmentRoute[],
): Promise<CriblEnvironmentScope> {
  const enc = encodeURIComponent(g.id)
  const kind = leaderWorkerGroupKind(g)
  const scopeId = productScopeIdForGroup(kind)

  const inputsRaw = await fetchLeaderJsonFirst([`/m/${enc}/system/inputs`, `/m/${enc}/inputs`])
  let inputs = parseInputs(inputsRaw)
  if (omitDisabled) {
    inputs = inputs.filter((i) => !i.disabled)
  }

  const outputsRaw = await fetchLeaderJsonFirst([`/m/${enc}/system/outputs`, `/m/${enc}/outputs`])
  const pipelinesRaw = await fetchLeaderJsonFirst(leaderProductPipelineApiPaths(g.id))

  return {
    id: scopeId,
    label: productScopeLabel(kind),
    kind: scopeId,
    inputs,
    routes: productRoutes,
    outputs: parseOutputs(outputsRaw),
    pipelines: parsePipelines(pipelinesRaw),
  }
}

async function harvestPackScope(
  g: MasterGroupItem,
  packId: string,
  omitDisabled: boolean,
): Promise<CriblEnvironmentScope | null> {
  const inputsRaw = await fetchLeaderJsonFirst(leaderPackInputApiPaths(g.id, packId))
  let inputs = parseInputs(inputsRaw)
  if (omitDisabled) {
    inputs = inputs.filter((i) => !i.disabled)
  }

  const routesRaw = await fetchLeaderJsonFirst(leaderPackRouteApiPaths(g.id, packId))
  const pipelinesRaw = await fetchLeaderJsonFirst(leaderPackPipelineApiPaths(g.id, packId))
  const routes = parseRoutes(routesRaw)

  const scope: CriblEnvironmentScope = {
    id: packId,
    label: packId,
    kind: 'pack',
    inputs,
    routes,
    outputs: inferPackOutputsFromRoutes(routes),
    pipelines: parsePipelines(pipelinesRaw),
  }

  const hasContent =
    scope.inputs.length > 0 ||
    scope.routes.length > 0 ||
    scope.pipelines.length > 0 ||
    scope.outputs.length > 0
  return hasContent ? scope : null
}

async function harvestGroupEnvironment(
  g: MasterGroupItem,
  omitDisabled: boolean,
  warnings: string[],
): Promise<CriblEnvironmentGroup> {
  const enc = encodeURIComponent(g.id)
  const kind = leaderWorkerGroupKind(g)
  const scopes: CriblEnvironmentScope[] = []

  const routesRaw = await fetchLeaderJsonFirst([
    `/m/${enc}/routes/default`,
    `/m/${enc}/routes`,
    `/m/${enc}/system/routes`,
  ])
  const { product: productRoutes, byPack: routesByPack } = splitRoutesByPack(routesRaw)

  const productScope = await harvestProductScope(g, omitDisabled, productRoutes)
  scopes.push(productScope)

  const packsRaw = await fetchLeaderJsonFirst([
    `/m/${enc}/packs`,
    `/m/${enc}/system/packs`,
    `/m/${enc}/p`,
  ])
  const packIdsFromLeader = parsePackIds(packsRaw)
  const packIdSet = new Set<string>(packIdsFromLeader)
  for (const packId of routesByPack.keys()) {
    packIdSet.add(packId)
  }

  let packsHarvested = 0

  for (const packId of [...packIdSet].sort()) {
    const fromFlat = routesByPack.get(packId) ?? []
    const packScope = await harvestPackScope(g, packId, omitDisabled)
    if (packScope) {
      if (fromFlat.length > 0 && packScope.routes.length === 0) {
        packScope.routes = fromFlat
      }
      packScope.outputs = inferPackOutputsFromRoutes(packScope.routes)
      scopes.push(packScope)
      packsHarvested++
    } else if (fromFlat.length > 0) {
      scopes.push({
        id: packId,
        label: packId,
        kind: 'pack',
        inputs: [],
        routes: fromFlat,
        pipelines: [],
        outputs: inferPackOutputsFromRoutes(fromFlat),
      })
      packsHarvested++
    }
  }

  if (packIdsFromLeader.length > 0 && packsHarvested === 0) {
    warnings.push(
      `Group "${g.id}": packs listed on Leader but pack routes/pipelines could not be fetched — re-import from diag for pack-level routing.`,
    )
  } else if (packIdsFromLeader.length === 0 && packsHarvested === 0 && kind === 'stream') {
    warnings.push(
      `Group "${g.id}": tenant import includes worker-group routing only — use a diagnostic bundle for per-pack scopes.`,
    )
  }

  return {
    id: g.id,
    label: g.id,
    kind,
    scopes,
  }
}

export async function harvestTenantEnvironment(
  options?: TenantHarvestOptions,
): Promise<CriblEnvironmentSnapshot> {
  const warnings: string[] = []
  const omitStock = options?.omitStockWorkerGroups === true
  const omitDisabled = options?.omitDisabledInputs !== false
  const capturedAt = new Date().toISOString()

  const base = criblApiBase()
  if (!base) {
    throw new Error('Not running inside the Cribl App Platform iframe (CRIBL_API_URL is unset).')
  }

  const groupsRes = await fetch(`${base}/master/groups`, { headers: { accept: 'application/json' } })
  if (!groupsRes.ok) {
    throw new Error(`GET /master/groups failed (${groupsRes.status})`)
  }
  const groupsData = (await groupsRes.json()) as { items?: MasterGroupItem[] }
  const rawItems = groupsData.items ?? []

  const groups: CriblEnvironmentGroup[] = []
  for (const g of rawItems) {
    if (!g?.id || isLeaderSearchGroup(g)) {
      continue
    }
    if (isLeaderOutpostGroup({ id: g.id, type: g.type })) {
      continue
    }
    if (omitStock && isStockLeaderWorkerGroup(g)) {
      continue
    }
    const harvested = await harvestGroupEnvironment(g, omitDisabled, warnings)
    const productScope = harvested.scopes.find((s) => s.kind === 'cribl' || s.kind === 'edge')
    if (productScope) {
      const routeWarn = groupRoutesMissingHarvestWarning(g.id, harvested.kind, productScope, 'tenant')
      if (routeWarn) {
        warnings.push(routeWarn)
      }
    }
    warnings.push(...collectPackRoutesMissingHarvestWarnings(g.id, harvested.scopes, 'tenant'))
    groups.push(harvested)
  }

  if (groups.length === 0) {
    warnings.push('No worker groups returned after filtering.')
  }

  return {
    snapshotVersion: ENVIRONMENT_SNAPSHOT_VERSION,
    capturedAt,
    source: 'tenant',
    warnings,
    groups,
  }
}
