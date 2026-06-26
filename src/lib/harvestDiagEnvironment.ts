import { parse as parseYaml } from 'yaml'
import type {
  CriblEnvironmentGroup,
  CriblEnvironmentInput,
  CriblEnvironmentOutput,
  CriblEnvironmentPipeline,
  CriblEnvironmentPipelineFunction,
  CriblEnvironmentRoute,
  CriblEnvironmentScope,
  CriblEnvironmentScopeKind,
  CriblEnvironmentSnapshot,
} from './criblEnvironmentTypes'
import {
  ENVIRONMENT_SNAPSHOT_VERSION,
  productScopeIdForGroup,
  productScopeLabel,
} from './criblEnvironmentTypes'
import {
  collectPackRoutesMissingHarvestWarnings,
  groupRoutesMissingHarvestWarning,
} from './environmentPackEntry'
import { configFromRecord, redactEnvironmentConfig } from './environmentConfigRedact'
import { inferDiagGroupMeta, isDiagSearchGroup, discoverDiagGroupIds } from './diagHarvest'
import { isLeaderOutpostGroup, isStockLeaderWorkerGroup } from './leaderStockGroups'
import { extractTarGzArchive } from './diagTarGz'
import type { TenantHarvestOptions } from './tenantHarvest'

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\/+/, '')
}

function textFromEntry(data: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(data)
}

function pathUnderGroup(normalizedPath: string, groupId: string): boolean {
  const needle = `groups/${groupId}/`
  return normalizedPath.includes(`/${needle}`) || normalizedPath.startsWith(needle)
}

function pathUnderScope(normalizedPath: string, groupId: string, scopePrefix: string): boolean {
  if (!pathUnderGroup(normalizedPath, groupId)) {
    return false
  }
  const re = new RegExp(`groups/${groupId}/(?:local|default)/${escapeRegExp(scopePrefix)}/`)
  return re.test(normalizedPath)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isPipelineRoutesYamlPath(normalizedPath: string): boolean {
  return /\/pipelines\/routes?\.ya?ml$/.test(normalizedPath)
}

function isScopeRoutesYamlPath(normalizedPath: string, groupId: string, scopePrefix: string): boolean {
  if (isPipelineRoutesYamlPath(normalizedPath)) {
    return true
  }
  for (const tier of ['local', 'default'] as const) {
    const base = `groups/${groupId}/${tier}/${scopePrefix}/routes`
    if (normalizedPath.endsWith(`${base}.yml`) || normalizedPath.endsWith(`${base}.yaml`)) {
      return true
    }
  }
  return false
}

function mergeYamlMaps(parts: string[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const text of parts) {
    let doc: unknown
    try {
      doc = parseYaml(text, { maxAliasCount: 100 })
    } catch {
      continue
    }
    if (!isRecord(doc)) {
      continue
    }
    for (const [k, v] of Object.entries(doc)) {
      merged[k] = v
    }
  }
  return merged
}

function collectScopeYamlHits(
  files: Map<string, Uint8Array>,
  groupId: string,
  scopePrefix: string,
  fileStem: string,
): string[] {
  const hits: { priority: number; text: string }[] = []
  for (const [path, data] of files) {
    const p = normalizePath(path)
    if (!pathUnderScope(p, groupId, scopePrefix)) {
      continue
    }
    for (const tier of ['local', 'default'] as const) {
      const base = `groups/${groupId}/${tier}/${scopePrefix}/${fileStem}`
      if (p.endsWith(`${base}.yml`) || p.endsWith(`${base}.yaml`)) {
        hits.push({ priority: tier === 'local' ? 40 : 20, text: textFromEntry(data) })
      }
    }
  }
  hits.sort((a, b) => a.priority - b.priority)
  return hits.map((h) => h.text)
}

function collectScopeInputYamlTexts(
  files: Map<string, Uint8Array>,
  groupId: string,
  scopePrefix: string,
): string[] {
  const hits: { priority: number; text: string }[] = []
  for (const [path, data] of files) {
    const p = normalizePath(path)
    if (!pathUnderScope(p, groupId, scopePrefix)) {
      continue
    }
    for (const tier of ['local', 'default'] as const) {
      const base = `groups/${groupId}/${tier}/${scopePrefix}/inputs`
      if (p.endsWith(`${base}.yml`) || p.endsWith(`${base}.yaml`)) {
        hits.push({ priority: tier === 'local' ? 40 : 20, text: textFromEntry(data) })
      } else if (p.includes(`${base}/`) && (p.endsWith('.yml') || p.endsWith('.yaml'))) {
        hits.push({ priority: tier === 'local' ? 35 : 18, text: textFromEntry(data) })
      }
    }
  }
  hits.sort((a, b) => a.priority - b.priority)
  return hits.map((h) => h.text)
}

function inputRowFromConfig(id: string, cfg: unknown): CriblEnvironmentInput {
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
}

function parseInputsWithConfig(parts: string[]): CriblEnvironmentInput[] {
  const byId = new Map<string, CriblEnvironmentInput>()
  for (const text of parts) {
    let doc: unknown
    try {
      doc = parseYaml(text, { maxAliasCount: 100 })
    } catch {
      continue
    }
    if (!isRecord(doc)) {
      continue
    }
    const pushMap = (m: Record<string, unknown>) => {
      for (const [id, cfg] of Object.entries(m)) {
        const tid = id.trim()
        if (!tid) {
          continue
        }
        byId.set(tid, inputRowFromConfig(tid, cfg))
      }
    }
    for (const key of ['sources', 'inputs'] as const) {
      const block = doc[key]
      if (Array.isArray(block)) {
        for (const row of block) {
          if (!isRecord(row)) {
            continue
          }
          const id = typeof row.id === 'string' ? row.id.trim() : ''
          if (id) {
            byId.set(id, inputRowFromConfig(id, row))
          }
        }
      } else if (isRecord(block)) {
        pushMap(block)
      }
    }
    for (const [id, cfg] of Object.entries(doc)) {
      if (id === 'version' || id === 'groups' || id === 'routes' || id === 'outputs') {
        continue
      }
      if (isRecord(cfg) && typeof cfg.type === 'string') {
        const tid = id.trim()
        if (tid) {
          byId.set(tid, inputRowFromConfig(tid, cfg))
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function parseOutputsYaml(parts: string[]): CriblEnvironmentOutput[] {
  const merged = mergeYamlMaps(parts)
  const block = merged.outputs
  if (!isRecord(block)) {
    return []
  }
  const out: CriblEnvironmentOutput[] = []
  for (const [id, cfg] of Object.entries(block)) {
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

function parseFunctionConf(text: string, sourcePath: string): CriblEnvironmentPipelineFunction | null {
  let doc: unknown
  try {
    doc = parseYaml(text, { maxAliasCount: 50 })
  } catch {
    return null
  }
  if (!isRecord(doc)) {
    return null
  }
  const id = typeof doc.id === 'string' ? doc.id.trim() : ''
  const fnId = id || sourcePath.split('/').slice(-2, -1)[0] || 'function'
  return {
    id: fnId,
    disabled: doc.disabled === true,
    filter: typeof doc.filter === 'string' ? doc.filter : undefined,
    conf: configFromRecord(doc),
    sourcePath,
  }
}

function functionOrderFromPipelineConf(doc: Record<string, unknown>): string[] {
  const block = doc.functions
  if (!Array.isArray(block)) {
    return []
  }
  const ids: string[] = []
  for (const row of block) {
    if (typeof row === 'string' && row.trim()) {
      ids.push(row.trim())
    } else if (isRecord(row)) {
      const id = typeof row.id === 'string' ? row.id.trim() : ''
      if (id) {
        ids.push(id)
      }
    }
  }
  return ids
}

function orderFunctions(
  fns: CriblEnvironmentPipelineFunction[],
  order: string[],
): CriblEnvironmentPipelineFunction[] {
  if (order.length === 0) {
    return [...fns].sort((a, b) => a.id.localeCompare(b.id))
  }
  const byId = new Map(fns.map((f) => [f.id, f]))
  const ordered: CriblEnvironmentPipelineFunction[] = []
  for (const id of order) {
    const fn = byId.get(id)
    if (fn) {
      ordered.push(fn)
      byId.delete(id)
    }
  }
  for (const fn of [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    ordered.push(fn)
  }
  return ordered
}

function parsePipelinesForScope(
  files: Map<string, Uint8Array>,
  groupId: string,
  scopePrefix: string,
): CriblEnvironmentPipeline[] {
  const byId = new Map<string, CriblEnvironmentPipeline>()
  const scopeEsc = escapeRegExp(scopePrefix)
  const pipelineConfRe = new RegExp(
    `groups/[^/]+/(?:local|default)/${scopeEsc}/pipelines/([^/]+)/conf\\.ya?ml$`,
  )
  const pipelineFnRe = new RegExp(
    `groups/[^/]+/(?:local|default)/${scopeEsc}/pipelines/([^/]+)/functions/([^/]+)/conf\\.ya?ml$`,
  )
  const groupFnRe = new RegExp(
    `groups/[^/]+/(?:local|default)/${scopeEsc}/functions/([^/]+)/conf\\.ya?ml$`,
  )

  const functionsByPipeline = new Map<string, Map<string, CriblEnvironmentPipelineFunction>>()
  const groupFunctions = new Map<string, CriblEnvironmentPipelineFunction>()

  for (const [path, data] of files) {
    const p = normalizePath(path)
    if (!pathUnderScope(p, groupId, scopePrefix)) {
      continue
    }

    const fnMatch = p.match(pipelineFnRe)
    if (fnMatch) {
      const pid = fnMatch[1]!
      const fn = parseFunctionConf(textFromEntry(data), p)
      if (fn) {
        if (!functionsByPipeline.has(pid)) {
          functionsByPipeline.set(pid, new Map())
        }
        functionsByPipeline.get(pid)!.set(fn.id, fn)
      }
      continue
    }

    const gfnMatch = p.match(groupFnRe)
    if (gfnMatch) {
      const fn = parseFunctionConf(textFromEntry(data), p)
      if (fn) {
        groupFunctions.set(fn.id, fn)
      }
      continue
    }

    const confMatch = p.match(pipelineConfRe)
    if (!confMatch) {
      continue
    }
    const id = confMatch[1]!
    if (id === 'route' || id === 'routes') {
      continue
    }

    let doc: Record<string, unknown> = {}
    try {
      const parsed = parseYaml(textFromEntry(data), { maxAliasCount: 50 })
      if (isRecord(parsed)) {
        doc = parsed
      }
    } catch {
      /* keep id only */
    }

    const order = functionOrderFromPipelineConf(doc)
    const fnMap = functionsByPipeline.get(id) ?? new Map()
    for (const fnId of order) {
      if (!fnMap.has(fnId) && groupFunctions.has(fnId)) {
        fnMap.set(fnId, groupFunctions.get(fnId)!)
      }
    }

    byId.set(id, {
      id,
      disabled: doc.disabled === true,
      description: typeof doc.description === 'string' ? doc.description : undefined,
      config: isRecord(doc) ? configFromRecord(doc) : undefined,
      functions: orderFunctions([...fnMap.values()], order),
      sourcePath: p,
    })
  }

  for (const [pid, fnMap] of functionsByPipeline) {
    if (!byId.has(pid)) {
      byId.set(pid, {
        id: pid,
        functions: orderFunctions([...fnMap.values()], []),
      })
    } else {
      const pl = byId.get(pid)!
      const merged = new Map((pl.functions ?? []).map((f) => [f.id, f]))
      for (const fn of fnMap.values()) {
        merged.set(fn.id, fn)
      }
      const order = pl.config ? functionOrderFromPipelineConf(pl.config) : []
      pl.functions = orderFunctions([...merged.values()], order)
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function parseRoutesFromYaml(text: string): CriblEnvironmentRoute[] {
  let doc: unknown
  try {
    doc = parseYaml(text, { maxAliasCount: 100 })
  } catch {
    return []
  }
  const routesBlock = Array.isArray(doc) ? doc : isRecord(doc) ? doc.routes : undefined
  if (!Array.isArray(routesBlock)) {
    return []
  }
  const out: CriblEnvironmentRoute[] = []
  for (const row of routesBlock) {
    if (!isRecord(row)) {
      continue
    }
    const id =
      (typeof row.id === 'string' ? row.id.trim() : '') ||
      (typeof row.name === 'string' ? row.name.trim() : '')
    if (!id) {
      continue
    }
    out.push({
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
    })
  }
  return out
}

function collectRoutesForScope(
  files: Map<string, Uint8Array>,
  groupId: string,
  scopePrefix: string,
): CriblEnvironmentRoute[] {
  const byId = new Map<string, CriblEnvironmentRoute>()
  for (const [path, data] of files) {
    const p = normalizePath(path)
    if (!pathUnderScope(p, groupId, scopePrefix)) {
      continue
    }
    if (!isScopeRoutesYamlPath(p, groupId, scopePrefix)) {
      continue
    }
    for (const route of parseRoutesFromYaml(textFromEntry(data))) {
      byId.set(route.id, route)
    }
  }
  return [...byId.values()]
}

function scopeHasContent(scope: CriblEnvironmentScope): boolean {
  return (
    scope.inputs.length > 0 ||
    scope.routes.length > 0 ||
    scope.pipelines.length > 0 ||
    scope.outputs.length > 0
  )
}

function harvestScope(
  files: Map<string, Uint8Array>,
  groupId: string,
  scopeId: string,
  scopeKind: CriblEnvironmentScopeKind,
  label: string,
  omitDisabled: boolean,
): CriblEnvironmentScope {
  let inputs = parseInputsWithConfig(collectScopeInputYamlTexts(files, groupId, scopeId))
  if (omitDisabled) {
    inputs = inputs.filter((i) => !i.disabled)
  }
  const outputs = parseOutputsYaml(collectScopeYamlHits(files, groupId, scopeId, 'outputs'))
  const pipelines = parsePipelinesForScope(files, groupId, scopeId)
  const routes = collectRoutesForScope(files, groupId, scopeId)
  return {
    id: scopeId,
    label,
    kind: scopeKind,
    inputs,
    routes,
    pipelines,
    outputs,
  }
}

/** Discover cribl/edge product scope and pack folder names under a worker group. */
export function discoverDiagScopes(
  files: Map<string, Uint8Array>,
  groupId: string,
  groupKind: 'stream' | 'edge',
): Array<{ id: string; label: string; kind: CriblEnvironmentScopeKind }> {
  const productId = productScopeIdForGroup(groupKind)
  const packIds = new Set<string>()
  let hasProductTree = false

  for (const path of files.keys()) {
    const p = normalizePath(path)
    if (!pathUnderGroup(p, groupId)) {
      continue
    }
    const m = p.match(/groups\/[^/]+\/(?:local|default)\/([^/]+)\//)
    if (!m) {
      continue
    }
    const seg = m[1]!
    if (seg === 'cribl' || seg === 'edge') {
      if (seg === productId) {
        hasProductTree = true
      }
    } else {
      packIds.add(seg)
    }
  }

  const discovered: Array<{ id: string; label: string; kind: CriblEnvironmentScopeKind }> = []
  if (hasProductTree) {
    discovered.push({
      id: productId,
      label: productScopeLabel(groupKind),
      kind: productId,
    })
  }
  for (const packId of [...packIds].sort()) {
    discovered.push({ id: packId, label: packId, kind: 'pack' })
  }
  return discovered
}

function discoverGroupIds(files: Map<string, Uint8Array>): string[] {
  return discoverDiagGroupIds(files)
}

/** Parse extracted diag files into an environment snapshot (test seam). */
export function harvestDiagEnvironmentFromFiles(
  files: Map<string, Uint8Array>,
  options?: TenantHarvestOptions,
): CriblEnvironmentSnapshot {
  const warnings: string[] = []
  const omitStock = options?.omitStockWorkerGroups === true
  const omitDisabled = options?.omitDisabledInputs !== false
  const capturedAt = new Date().toISOString()

  if (files.size === 0) {
    return {
      snapshotVersion: ENVIRONMENT_SNAPSHOT_VERSION,
      capturedAt,
      source: 'diag',
      warnings: ['Archive contained no readable files.'],
      groups: [],
    }
  }

  const rawIds = discoverGroupIds(files)
  if (rawIds.length === 0) {
    return {
      snapshotVersion: ENVIRONMENT_SNAPSHOT_VERSION,
      capturedAt,
      source: 'diag',
      warnings: ['No `groups/<id>/` paths found in bundle.'],
      groups: [],
    }
  }

  const groups: CriblEnvironmentGroup[] = []

  for (const id of rawIds.sort()) {
    if (isLeaderOutpostGroup({ id })) {
      continue
    }
    if (isDiagSearchGroup(files, id)) {
      warnings.push(
        `Skipped Search / Lakehouse engine group "${id}" — not a Stream worker group or Edge fleet.`,
      )
      continue
    }
    if (omitStock && isStockLeaderWorkerGroup({ id })) {
      continue
    }

    const meta = inferDiagGroupMeta(files, id, {})
    const kind = meta.isFleet || meta.type === 'edge' ? 'edge' : 'stream'

    const scopeDefs = discoverDiagScopes(files, id, kind)
    const scopes: CriblEnvironmentScope[] = []
    for (const def of scopeDefs) {
      const scope = harvestScope(files, id, def.id, def.kind, def.label, omitDisabled)
      if (scopeHasContent(scope)) {
        scopes.push(scope)
      }
    }

    const productScope = scopes.find((s) => s.kind === 'cribl' || s.kind === 'edge')
    if (productScope) {
      const routeWarn = groupRoutesMissingHarvestWarning(id, kind, productScope)
      if (routeWarn) {
        warnings.push(routeWarn)
      }
    }
    warnings.push(...collectPackRoutesMissingHarvestWarnings(id, scopes))

    const hasContent = scopes.length > 0
    if (!hasContent && !meta.isFleet && !meta.description) {
      continue
    }

    groups.push({
      id,
      label: (meta.description ?? '').trim() || id,
      kind,
      scopes,
    })
  }

  return { snapshotVersion: ENVIRONMENT_SNAPSHOT_VERSION, capturedAt, source: 'diag', warnings, groups }
}

export async function harvestDiagEnvironment(
  archiveBytes: Uint8Array,
  options?: TenantHarvestOptions,
): Promise<CriblEnvironmentSnapshot> {
  const files = await extractTarGzArchive(archiveBytes)
  return harvestDiagEnvironmentFromFiles(files, options)
}

/** Reuse plan harvest warnings when diag has no group paths but plan might still work. */
export function diagEnvironmentGroupCount(files: Map<string, Uint8Array>): number {
  return harvestDiagEnvironmentFromFiles(files).groups.length
}
