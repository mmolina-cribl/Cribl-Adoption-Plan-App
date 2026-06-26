import type {
  CriblEnvironmentGroup,
  CriblEnvironmentRoute,
  CriblEnvironmentScope,
} from './criblEnvironmentTypes'
import { productScopeIdForGroup } from './criblEnvironmentTypes'

export type PackEntryReference = {
  fromScopeId: 'cribl' | 'edge'
  routeId: string
  routeName?: string
  pipeline?: string
}

export function knownPackIdsForGroup(group: CriblEnvironmentGroup): Set<string> {
  return new Set(group.scopes.filter((s) => s.kind === 'pack').map((s) => s.id))
}

function packIdFromRouteConfig(route: CriblEnvironmentRoute): string | null {
  const cfg = route.config
  if (!cfg || typeof cfg !== 'object') {
    return null
  }
  const pack = cfg.pack ?? cfg.packId
  if (typeof pack === 'string' && pack.trim()) {
    return pack.trim()
  }
  if (typeof cfg.context === 'string' && cfg.context.trim().toLowerCase() === 'pack') {
    if (typeof pack === 'string' && pack.trim()) {
      return pack.trim()
    }
  }
  return null
}

function packIdFromPipelineField(pipeline: string, knownPackIds: Set<string>): string | null {
  for (const sep of ['/', '.'] as const) {
    const idx = pipeline.indexOf(sep)
    if (idx > 0) {
      const prefix = pipeline.slice(0, idx)
      if (knownPackIds.has(prefix)) {
        return prefix
      }
    }
  }
  if (knownPackIds.has(pipeline)) {
    return pipeline
  }
  return null
}

function routeDestinationRaw(route: CriblEnvironmentRoute): string | undefined {
  const output = route.output?.trim()
  if (output) {
    return output
  }
  const cfg = route.config
  if (cfg && typeof cfg === 'object') {
    const dest = cfg.destination ?? cfg.dest
    if (typeof dest === 'string' && dest.trim()) {
      return dest.trim()
    }
  }
  return undefined
}

function packIdFromPackColonPipeline(pipeline: string, knownPackIds: Set<string>): string | null {
  const trimmed = pipeline.trim()
  if (!trimmed.toLowerCase().startsWith('pack:')) {
    return null
  }
  const rest = trimmed.slice(trimmed.indexOf(':') + 1).trim()
  if (!rest) {
    return null
  }
  const packId = rest.split(/[:/.]/)[0]?.trim()
  return packId && knownPackIds.has(packId) ? packId : null
}

function packIdFromColonPipelineField(pipeline: string, knownPackIds: Set<string>): string | null {
  if (!pipeline.includes(':') || pipeline.includes('/')) {
    return null
  }
  const colon = pipeline.indexOf(':')
  const prefix = pipeline.slice(0, colon).trim()
  const suffix = pipeline.slice(colon + 1).trim()
  if (prefix && suffix && knownPackIds.has(prefix)) {
    return prefix
  }
  return null
}

function isPackSentinelPipeline(pipeline: string): boolean {
  return pipeline.trim().toLowerCase() === 'pack'
}

function packIdFromOutputField(route: CriblEnvironmentRoute, knownPackIds: Set<string>): string | null {
  const dest = routeDestinationRaw(route)
  if (dest && knownPackIds.has(dest)) {
    return dest
  }
  return null
}

/** Best-effort: pack id when the route uses the pack in the Pipeline field (processing pack). */
export function resolveRoutePackPipelineTarget(
  route: CriblEnvironmentRoute,
  knownPackIds: Set<string>,
): string | null {
  const fromConfig = packIdFromRouteConfig(route)
  if (fromConfig && knownPackIds.has(fromConfig)) {
    return fromConfig
  }
  const pipeline = route.pipeline?.trim()
  if (!pipeline) {
    return null
  }
  const fromPackColon = packIdFromPackColonPipeline(pipeline, knownPackIds)
  if (fromPackColon) {
    return fromPackColon
  }
  const fromPipeline = packIdFromPipelineField(pipeline, knownPackIds)
  if (fromPipeline) {
    return fromPipeline
  }
  const fromColon = packIdFromColonPipelineField(pipeline, knownPackIds)
  if (fromColon) {
    return fromColon
  }
  return null
}

/** Best-effort: which pack (if any) a worker-group route sends traffic into. */
export function resolveRoutePackTarget(
  route: CriblEnvironmentRoute,
  knownPackIds: Set<string>,
): string | null {
  const fromPipeline = resolveRoutePackPipelineTarget(route, knownPackIds)
  if (fromPipeline) {
    return fromPipeline
  }
  const pipeline = route.pipeline?.trim()
  if (pipeline) {
    if (isPackSentinelPipeline(pipeline)) {
      const fromOutput = packIdFromOutputField(route, knownPackIds)
      if (fromOutput) {
        return fromOutput
      }
    }
    return null
  }
  const fromOutputOnly = packIdFromOutputField(route, knownPackIds)
  if (fromOutputOnly) {
    return fromOutputOnly
  }
  return null
}

export function findPackEntryReferences(
  group: CriblEnvironmentGroup,
  packId: string,
): PackEntryReference[] {
  const known = knownPackIdsForGroup(group)
  if (!known.has(packId)) {
    return []
  }
  const productScopeId = productScopeIdForGroup(group.kind)
  const refs: PackEntryReference[] = []
  for (const scope of group.scopes) {
    if (scope.kind !== 'cribl' && scope.kind !== 'edge') {
      continue
    }
    if (scope.id !== productScopeId) {
      continue
    }
    for (const route of scope.routes) {
      if (resolveRoutePackTarget(route, known) === packId) {
        refs.push({
          fromScopeId: scope.id as 'cribl' | 'edge',
          routeId: route.id,
          routeName: route.name,
          pipeline: route.pipeline,
        })
      }
    }
  }
  return refs
}

export type PackReachability =
  | { status: 'referenced'; references: PackEntryReference[] }
  | { status: 'local_inputs_only' }
  | { status: 'unreferenced' }

export function packReachability(
  group: CriblEnvironmentGroup,
  packScope: CriblEnvironmentScope,
): PackReachability {
  const references = findPackEntryReferences(group, packScope.id)
  if (references.length > 0) {
    return { status: 'referenced', references }
  }
  if (packScope.inputs.length > 0) {
    return { status: 'local_inputs_only' }
  }
  return { status: 'unreferenced' }
}

export function productScopeForGroup(group: CriblEnvironmentGroup): CriblEnvironmentScope | undefined {
  const productId = productScopeIdForGroup(group.kind)
  return group.scopes.find((s) => s.id === productId)
}

/** Scope has sources but no harvested routes (map connector lines cannot be drawn). */
export function scopeRoutesMissing(
  scope: Pick<CriblEnvironmentScope, 'inputs' | 'routes'>,
): boolean {
  return scope.inputs.length > 0 && scope.routes.length === 0
}

/** Product scope has sources but no harvested routes (map lines cannot be drawn). */
export function productScopeRoutesMissing(
  product: Pick<CriblEnvironmentScope, 'inputs' | 'routes'>,
): boolean {
  return scopeRoutesMissing(product)
}

/**
 * Heuristic: scope has routing artifacts (pipelines/destinations) but no routes file —
 * matches Cribl's implicit enabled default route that is absent from diag/Git until touched.
 */
export function likelyImplicitCriblDefaultRoute(
  scope: Pick<CriblEnvironmentScope, 'inputs' | 'routes' | 'pipelines' | 'outputs'>,
): boolean {
  if (!scopeRoutesMissing(scope)) {
    return false
  }
  return scope.pipelines.length > 0 || scope.outputs.length > 0
}

const IMPLICIT_DEFAULT_ROUTE_ACTION =
  'Toggle the default route off and back on, or add any route, then Commit & Deploy so routes appear in version control and diag exports.'

function routesMissingLabels(groupKind: 'stream' | 'edge') {
  const isFleet = groupKind === 'edge'
  return {
    groupPrefix: isFleet ? 'Fleet' : 'Worker group',
    routesNoun: isFleet ? 'fleet routes' : 'worker group routes',
    scopeFolder: isFleet ? 'edge/' : 'cribl/',
  }
}

export function groupRoutesMissingHarvestWarning(
  groupId: string,
  groupKind: 'stream' | 'edge',
  product: Pick<CriblEnvironmentScope, 'inputs' | 'routes' | 'pipelines' | 'outputs'>,
  source: 'diag' | 'tenant' = 'diag',
): string | null {
  if (!productScopeRoutesMissing(product)) {
    return null
  }
  const { groupPrefix, routesNoun, scopeFolder } = routesMissingLabels(groupKind)
  const reimport =
    source === 'diag'
      ? 'Re-export diag or use live tenant import afterward.'
      : 'Re-import from the Leader.'
  if (likelyImplicitCriblDefaultRoute(product)) {
    return `${groupPrefix} "${groupId}": no ${routesNoun} in this bundle, but sources and pipelines/destinations are present. Cribl's enabled catch-all default route often does not appear in diag or Git until the routing table is changed — ${IMPLICIT_DEFAULT_ROUTE_ACTION} ${reimport}`
  }
  const fallbackReimport = source === 'diag' ? 'Or use live tenant import.' : ''
  return `${groupPrefix} "${groupId}": ${routesNoun} are not in this bundle (no routes.yml under ${scopeFolder} in local or default). ${IMPLICIT_DEFAULT_ROUTE_ACTION} ${fallbackReimport}`.trim()
}

export function packRoutesMissingHarvestWarning(
  groupId: string,
  packId: string,
  pack: Pick<CriblEnvironmentScope, 'inputs' | 'routes' | 'pipelines' | 'outputs'>,
  source: 'diag' | 'tenant' = 'diag',
): string | null {
  if (!scopeRoutesMissing(pack)) {
    return null
  }
  const reimport =
    source === 'diag'
      ? 'Re-export diag or use live tenant import afterward.'
      : 'Re-import from the Leader.'
  if (likelyImplicitCriblDefaultRoute(pack)) {
    return `Pack "${packId}" in worker group "${groupId}": no pack routes in this bundle, but pack sources and pipelines/destinations are present. Cribl's enabled default catch-all route and pack inputs.yml often do not appear in diag or Git until the pack routing table is changed — ${IMPLICIT_DEFAULT_ROUTE_ACTION} ${reimport}`
  }
  const fallbackReimport = source === 'diag' ? 'Or use live tenant import.' : ''
  return `Pack "${packId}" in worker group "${groupId}": pack routes are not in this bundle (no routes.yml under ${packId}/ in local or default). ${IMPLICIT_DEFAULT_ROUTE_ACTION} ${fallbackReimport}`.trim()
}

export function collectPackRoutesMissingHarvestWarnings(
  groupId: string,
  scopes: CriblEnvironmentScope[],
  source: 'diag' | 'tenant' = 'diag',
): string[] {
  const warnings: string[] = []
  for (const scope of scopes) {
    if (scope.kind !== 'pack') {
      continue
    }
    const warn = packRoutesMissingHarvestWarning(groupId, scope.id, scope, source)
    if (warn) {
      warnings.push(warn)
    }
  }
  return warnings
}

/** Banner when a group has sources but no routes were harvested (common on diag import). */
export function groupRoutesMissingBannerMessage(
  group: CriblEnvironmentGroup,
  snapshotSource: 'diag' | 'tenant',
): { tone: 'amber'; message: string } | null {
  const product = productScopeForGroup(group)
  if (!product || !productScopeRoutesMissing(product)) {
    return null
  }
  const { routesNoun } = routesMissingLabels(group.kind)
  const reimport =
    snapshotSource === 'diag'
      ? 'Re-import after a fresh diag export, or use live tenant import.'
      : 'Re-import from the Leader after committing routes.'
  if (likelyImplicitCriblDefaultRoute(product)) {
    return {
      tone: 'amber',
      message: `No routes in this snapshot — connector lines need a route row. Cribl's enabled default catch-all route often does not appear in diag or version control until you change the routing table (e.g. toggle default off and on, or add a route), then Commit & Deploy. ${reimport}`,
    }
  }
  return {
    tone: 'amber',
    message: `No ${routesNoun} in this snapshot — connector lines need at least one route. ${reimport}`,
  }
}

export function packRoutesMissingBannerMessage(
  packScope: Pick<CriblEnvironmentScope, 'inputs' | 'routes' | 'pipelines' | 'outputs'>,
  snapshotSource: 'diag' | 'tenant',
): { tone: 'amber'; message: string } | null {
  if (!scopeRoutesMissing(packScope)) {
    return null
  }
  const reimport =
    snapshotSource === 'diag'
      ? 'Re-import after a fresh diag export, or use live tenant import.'
      : 'Re-import from the Leader after committing routes.'
  if (likelyImplicitCriblDefaultRoute(packScope)) {
    return {
      tone: 'amber',
      message: `No pack routes in this snapshot — connector lines need a route row. Cribl's enabled default catch-all route and pack inputs.yml often do not appear in diag or version control until you change the pack routing table (e.g. toggle default off and on, or add a route), then Commit & Deploy. ${reimport}`,
    }
  }
  return {
    tone: 'amber',
    message: `No pack routes in this snapshot — connector lines need at least one route. ${reimport}`,
  }
}

export function packReachabilityBannerMessage(
  group: CriblEnvironmentGroup,
  packScope: CriblEnvironmentScope,
): { tone: 'amber' | 'neutral' | 'teal'; message: string } {
  const reach = packReachability(group, packScope)
  if (reach.status === 'referenced') {
    const names = reach.references
      .map((r) => r.routeName?.trim() || r.routeId)
      .join(', ')
    return {
      tone: 'teal',
      message: `Entered from worker group route(s): ${names}. Pack routes apply only to events already inside this pack.`,
    }
  }
  if (reach.status === 'local_inputs_only') {
    return {
      tone: 'neutral',
      message:
        'Pack-local sources only — no worker group route enters this pack. Internal routing shown for review.',
    }
  }
  return {
    tone: 'amber',
    message:
      'Not on the worker group path — no WG route targets this pack. Internal routing shown for review only.',
  }
}
