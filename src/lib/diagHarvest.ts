/**
 * Bootstrap plan topology from a **Cribl diagnostic bundle** (`.tar.gz` / `.tgz`).
 *
 * Reads per-group config under `groups/<groupId>/`:
 *   - Stream worker groups: `local|default/cribl/inputs.yml` (+ `inputs/*.yml`)
 *   - Edge fleets: `local|default/edge/inputs.yml` (+ `inputs/*.yml`)
 *
 * Leader-global config outside `groups/` is intentionally **not** imported.
 *
 * @see docs/diag-import.md
 */
import { parse as parseYaml } from 'yaml'
import type { LeaderInputItem, MasterGroupItem, TenantHarvestResult, TenantHarvestOptions } from './tenantHarvest'
import { isLeaderOutpostGroup, isLeaderSearchGroup, isStockLeaderWorkerGroup } from './leaderStockGroups'
import { extractTarGzArchive } from './diagTarGz'

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

const RESERVED_TOP_KEYS = new Set([
  'version',
  'groups',
  'routes',
  'packs',
  'outputs',
  'pipelines',
  'global',
  'system',
  'distributed',
  'license',
  'authentication',
])

function inputFromEntry(id: string, cfg: unknown): LeaderInputItem | null {
  const tid = id.trim()
  if (!tid) {
    return null
  }
  if (!isRecord(cfg)) {
    return { id: tid }
  }
  const typ = typeof cfg.type === 'string' ? cfg.type : undefined
  const disabled = cfg.disabled === true
  const description = typeof cfg.description === 'string' ? cfg.description : undefined
  return { id: tid, type: typ, disabled, description }
}

/**
 * Parse a Cribl `inputs.yml` / merged inputs document into normalized Leader-style inputs.
 * Supports `sources:` / `inputs:` maps, or top-level id → config objects with a `type` field.
 */
export function extractLeaderInputsFromInputsYaml(text: string): LeaderInputItem[] {
  let doc: unknown
  try {
    doc = parseYaml(text, { maxAliasCount: 100 })
  } catch {
    return []
  }
  if (!isRecord(doc)) {
    return []
  }

  const out: LeaderInputItem[] = []
  const pushMap = (m: Record<string, unknown>) => {
    for (const [id, cfg] of Object.entries(m)) {
      const row = inputFromEntry(id, cfg)
      if (row) {
        out.push(row)
      }
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
        if (!id) {
          continue
        }
        const r = inputFromEntry(id, row)
        if (r) {
          out.push(r)
        }
      }
      if (out.length > 0) {
        return out
      }
    }
    if (isRecord(block)) {
      pushMap(block)
      return out
    }
  }

  for (const [id, cfg] of Object.entries(doc)) {
    if (RESERVED_TOP_KEYS.has(id)) {
      continue
    }
    const row = inputFromEntry(id, cfg)
    if (row) {
      out.push(row)
    }
  }
  return out
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\/+/, '')
}

function groupPathNeedle(groupId: string): string {
  return `groups/${groupId}/`
}

function pathUnderGroup(normalizedPath: string, groupId: string): boolean {
  const needle = groupPathNeedle(groupId)
  return normalizedPath.includes(`/${needle}`) || normalizedPath.startsWith(needle)
}

function pathEndsWith(normalizedPath: string, suffix: string): boolean {
  return normalizedPath.endsWith(suffix) || normalizedPath.endsWith(`/${suffix}`)
}

/**
 * True if path is under a real worker-group config tree (`…/groups/<id>/local/` or `…/default/`),
 * not a stray match like `…/groups/default/log/…`.
 */
export function groupConfigPathPrefix(normalizedPath: string): string | null {
  const m = normalizedPath.match(/(?:^|\/)groups\/([^/]+)\/(local|default)\//)
  return m ? m[1]! : null
}

/** @deprecated use {@link groupConfigPathPrefix} — kept for tests / external imports */
export function groupIdFromPath(normalizedPath: string): string | null {
  return groupConfigPathPrefix(normalizedPath)
}

function textFromEntry(data: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(data)
}

function mergeInputsYamlTexts(parts: string[]): LeaderInputItem[] {
  const byId = new Map<string, LeaderInputItem>()
  for (const text of parts) {
    for (const row of extractLeaderInputsFromInputsYaml(text)) {
      byId.set(row.id, row)
    }
  }
  return [...byId.values()]
}

type ConfigTier = 'default' | 'local'
type ConfigProduct = 'cribl' | 'edge'

const INPUT_FILE_PRIORITY: Record<`${ConfigTier}-${ConfigProduct}`, number> = {
  'default-cribl': 20,
  'default-edge': 25,
  'local-cribl': 40,
  'local-edge': 45,
}

const INPUT_DIR_BASE_PRIORITY: Record<`${ConfigTier}-${ConfigProduct}`, number> = {
  'default-cribl': 35,
  'default-edge': 38,
  'local-cribl': 60,
  'local-edge': 65,
}

/** Merge Stream (`cribl`) and Edge fleet (`edge`) inputs for one Leader group id. */
export function collectInputsForGroup(files: Map<string, Uint8Array>, groupId: string): LeaderInputItem[] {
  type Hit = { priority: number; text: string }
  const hits: Hit[] = []

  for (const [path, data] of files) {
    const p = normalizePath(path)
    if (!pathUnderGroup(p, groupId)) {
      continue
    }
    const text = textFromEntry(data)
    for (const tier of ['default', 'local'] as const) {
      for (const product of ['cribl', 'edge'] as const) {
        const inputsBase = groupPathNeedle(groupId) + `${tier}/${product}/inputs`
        if (pathEndsWith(p, `${inputsBase}.yml`) || pathEndsWith(p, `${inputsBase}.yaml`)) {
          hits.push({ priority: INPUT_FILE_PRIORITY[`${tier}-${product}`], text })
          continue
        }
        const dirNeedle = `${inputsBase}/`
        if ((p.includes(`/${dirNeedle}`) || p.includes(dirNeedle)) && (p.endsWith('.yml') || p.endsWith('.yaml'))) {
          const tie = (p.split('/').pop() ?? '').length / 1000
          hits.push({ priority: INPUT_DIR_BASE_PRIORITY[`${tier}-${product}`] + tie, text })
        }
      }
    }
  }

  hits.sort((a, b) => a.priority - b.priority)
  return mergeInputsYamlTexts(hits.map((h) => h.text))
}

function readLeaderGroupsMetaEntry(files: Map<string, Uint8Array>, groupId: string): Partial<MasterGroupItem> {
  for (const suffix of ['local/cribl/groups.yml', 'default/cribl/groups.yml'] as const) {
    for (const [path, data] of files) {
      const p = normalizePath(path)
      if (!p.endsWith(suffix)) {
        continue
      }
      let doc: unknown
      try {
        doc = parseYaml(textFromEntry(data), { maxAliasCount: 100 })
      } catch {
        continue
      }
      if (!isRecord(doc)) {
        continue
      }
      const entry = doc[groupId]
      if (!isRecord(entry)) {
        continue
      }
      const meta: Partial<MasterGroupItem> = {}
      if (typeof entry.description === 'string') {
        meta.description = entry.description
      }
      if (typeof entry.name === 'string' && !meta.description) {
        meta.description = entry.name
      }
      if (entry.isFleet === true) {
        meta.isFleet = true
      }
      if (entry.isSearch === true) {
        meta.isSearch = true
      }
      if (typeof entry.type === 'string') {
        meta.type = entry.type
      }
      return meta
    }
  }
  return {}
}

/** Leader `groups.yml` entry plus per-group `groups.yml` when present. */
export function readDiagGroupMeta(files: Map<string, Uint8Array>, groupId: string): Partial<MasterGroupItem> {
  return { ...readLeaderGroupsMetaEntry(files, groupId), ...readGroupsMetaYml(files, groupId) }
}

/** Diag paths for Cribl Search / Lakehouse engine groups (not Stream routing). */
export function groupHasLakehouseSearchPaths(files: Map<string, Uint8Array>, groupId: string): boolean {
  const needle = groupPathNeedle(groupId)
  for (const path of files.keys()) {
    const p = normalizePath(path)
    if (!pathUnderGroup(p, groupId)) {
      continue
    }
    if (
      /\/cribl\/local-search-engines\.ya?ml$/.test(p) ||
      /\/cribl\/local_search\.ya?ml$/.test(p) ||
      /\/cribl\/search\.ya?ml$/.test(p)
    ) {
      return true
    }
    if (p.includes(`${needle}local/cribl/datasets.yml`) || p.includes(`${needle}default/cribl/datasets.yml`)) {
      const text = textFromEntry(files.get(path)!)
      if (text.includes('lake_house_engine') || text.includes('provider: lakehouse')) {
        return true
      }
    }
  }
  return false
}

export function isDiagSearchGroup(files: Map<string, Uint8Array>, groupId: string): boolean {
  const meta = readDiagGroupMeta(files, groupId)
  if (isLeaderSearchGroup({ id: groupId, ...meta })) {
    return true
  }
  return groupHasLakehouseSearchPaths(files, groupId)
}

function readGroupsMetaYml(files: Map<string, Uint8Array>, groupId: string): Partial<MasterGroupItem> {
  const candidates = [
    `/groups/${groupId}/local/cribl/groups.yml`,
    `/groups/${groupId}/default/cribl/groups.yml`,
  ]
  for (const needle of candidates) {
    for (const [path, data] of files) {
      const p = normalizePath(path)
      if (!p.endsWith(needle)) {
        continue
      }
      const text = textFromEntry(data)
      let doc: unknown
      try {
        doc = parseYaml(text, { maxAliasCount: 50 })
      } catch {
        continue
      }
      if (!isRecord(doc)) {
        continue
      }
      const meta: Partial<MasterGroupItem> = {}
      if (typeof doc.description === 'string') {
        meta.description = doc.description
      }
      if (typeof doc.name === 'string' && !meta.description) {
        meta.description = doc.name
      }
      if (doc.isFleet === true) {
        meta.isFleet = true
      }
      if (doc.isSearch === true) {
        meta.isSearch = true
      }
      if (typeof doc.type === 'string') {
        meta.type = doc.type
      }
      return meta
    }
  }
  return {}
}

function discoverGroupIds(files: Map<string, Uint8Array>): string[] {
  const ids = new Set<string>()
  for (const path of files.keys()) {
    const gid = groupConfigPathPrefix(normalizePath(path))
    if (gid) {
      ids.add(gid)
    }
  }
  return [...ids].filter((id) => id.length > 0)
}

/** @internal exported for environment harvest */
export function discoverDiagGroupIds(files: Map<string, Uint8Array>): string[] {
  return discoverGroupIds(files)
}

/** True when the bundle has Edge fleet `inputs.yml` (or split files) under this group. */
export function groupHasEdgeInputPaths(files: Map<string, Uint8Array>, groupId: string): boolean {
  for (const path of files.keys()) {
    const p = normalizePath(path)
    if (!pathUnderGroup(p, groupId)) {
      continue
    }
    const edgeDefault = `${groupPathNeedle(groupId)}default/edge/inputs`
    const edgeLocal = `${groupPathNeedle(groupId)}local/edge/inputs`
    if (
      (p.includes(edgeDefault) || p.includes(edgeLocal)) &&
      (p.endsWith('.yml') || p.endsWith('.yaml'))
    ) {
      return true
    }
  }
  return false
}

/** Fill `isFleet` / `type` when `groups.yml` is missing from the diag. */
export function inferDiagGroupMeta(
  files: Map<string, Uint8Array>,
  groupId: string,
  meta: Partial<MasterGroupItem>,
): Partial<MasterGroupItem> {
  const result: Partial<MasterGroupItem> = { ...meta }
  if (result.isFleet === true) {
    return result
  }
  if (groupHasEdgeInputPaths(files, groupId)) {
    result.isFleet = true
    if (!result.type) {
      result.type = 'edge'
    }
    return result
  }
  if (groupId === 'default_fleet') {
    result.isFleet = true
    if (!result.type) {
      result.type = 'edge'
    }
  }
  return result
}

/**
 * Parse an extracted diag file map (test seam) or call via {@link harvestDiagBundle}.
 */
export function harvestDiagFromFiles(
  files: Map<string, Uint8Array>,
  options?: TenantHarvestOptions,
): TenantHarvestResult {
  const warnings: string[] = []
  const omitStock = options?.omitStockWorkerGroups === true
  const omitDisabled = options?.omitDisabledInputs !== false

  if (files.size === 0) {
    return {
      groups: [],
      inputsByGroup: {},
      warnings: ['Archive contained no readable files (empty or unsupported tar layout).'],
    }
  }

  const rawIds = discoverGroupIds(files)

  if (rawIds.length === 0) {
    warnings.push(
      'No worker-group config paths found (`groups/<id>/local/` or `groups/<id>/default/`) — is this a Cribl Stream/Edge diagnostic bundle, or were configs excluded from the diag?',
    )
    return { groups: [], inputsByGroup: {}, warnings }
  }

  let omittedDisabledInputs = 0
  const groups: MasterGroupItem[] = []
  const inputsByGroup: Record<string, LeaderInputItem[]> = {}

  let skippedStock = 0
  let skippedOutpost = 0
  let skippedSearch = 0

  for (const id of rawIds.sort()) {
    const metaFromFile = readDiagGroupMeta(files, id)
    if (isLeaderOutpostGroup({ id, type: metaFromFile.type })) {
      skippedOutpost += 1
      warnings.push(`Skipped Outpost group "${id}" — not imported into adoption plans.`)
      continue
    }

    if (isDiagSearchGroup(files, id)) {
      skippedSearch += 1
      warnings.push(
        `Skipped Search / Lakehouse engine group "${id}" — not a Stream worker group or Edge fleet.`,
      )
      continue
    }

    if (omitStock && isStockLeaderWorkerGroup({ id })) {
      skippedStock += 1
      continue
    }

    const meta = inferDiagGroupMeta(files, id, metaFromFile)
    const g: MasterGroupItem = {
      id,
      description: meta.description,
      isFleet: meta.isFleet,
      type: meta.type,
    }

    let inputs = collectInputsForGroup(files, id)
    if (omitDisabled) {
      omittedDisabledInputs += inputs.filter((i) => i.disabled).length
      inputs = inputs.filter((i) => !i.disabled)
    }
    inputsByGroup[id] = inputs
    groups.push(g)

    if (inputs.length === 0) {
      warnings.push(
        `No inputs parsed for group "${id}" (looked for local/default cribl/edge inputs.yml and inputs/*.yml under groups/)${omitDisabled ? ' after skipping disabled inputs' : ''}.`,
      )
    }
  }

  if (skippedOutpost > 0) {
    warnings.push(
      `Skipped ${skippedOutpost} Outpost group folder(s) — Outpost topology is not imported into adoption plans.`,
    )
  }

  if (skippedSearch > 0) {
    warnings.push(
      `Skipped ${skippedSearch} Search / Lakehouse engine group folder(s) — use Cribl Search for lakehouse routing, not adoption-plan worker groups.`,
    )
  }

  if (omitStock && skippedStock > 0) {
    warnings.push(
      `Omitted ${skippedStock} built-in Cribl group folder(s) (default / defaultHybrid / default_fleet) per import option.`,
    )
  }

  if (omitDisabled && omittedDisabledInputs > 0) {
    warnings.push(
      `Omitted ${omittedDisabledInputs} disabled input(s) from the bundle per import option — check “Include disabled inputs” to include them next time.`,
    )
  }

  const pruned = groups.filter((g) => {
    const inputs = inputsByGroup[g.id] ?? []
    if (inputs.length > 0) {
      return true
    }
    const hasMeta = !!(g.description?.trim() || g.isFleet || g.type)
    return hasMeta
  })

  const prunedInputs: Record<string, LeaderInputItem[]> = {}
  for (const g of pruned) {
    prunedInputs[g.id] = inputsByGroup[g.id] ?? []
  }

  if (pruned.length === 0) {
    warnings.push(
      'No parsable inputs.yml content found under `groups/<id>/local|default/cribl|edge/` — bundle may omit configs, use a different on-disk layout, or inputs may live only on workers (try a Worker Node diag).',
    )
  }

  return { groups: pruned, inputsByGroup: prunedInputs, warnings }
}

/**
 * Parse a diagnostic bundle archive and return the same harvest shape as {@link harvestTenantTopology}.
 */
export async function harvestDiagBundle(
  archiveBytes: Uint8Array,
  options?: TenantHarvestOptions,
): Promise<TenantHarvestResult> {
  const files = await extractTarGzArchive(archiveBytes)
  return harvestDiagFromFiles(files, options)
}
