/**
 * Bootstrap plan topology from a **Cribl diagnostic bundle** (`.tar.gz` / `.tgz`).
 *
 * Reads `groups/<groupId>/local/cribl/inputs.yml` (and `default/`, `inputs/*.yml` fallbacks)
 * the same way the Leader exposes configured inputs — offline, in the browser.
 *
 * @see docs/diag-import.md
 */
import { parse as parseYaml } from 'yaml'
import type { LeaderInputItem, MasterGroupItem, TenantHarvestResult } from './tenantHarvest'
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

/**
 * True if path is under a real worker-group config tree (`…/groups/<id>/local/` or `…/default/`),
 * not a stray match like `…/groups/default/log/…`.
 */
export function groupConfigPathPrefix(normalizedPath: string): string | null {
  const m = normalizedPath.match(/\/groups\/([^/]+)\/(local|default)\//)
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

function collectInputsForGroup(files: Map<string, Uint8Array>, groupId: string): LeaderInputItem[] {
  type Hit = { priority: number; text: string }
  const hits: Hit[] = []
  for (const [path, data] of files) {
    const p = normalizePath(path)
    if (!p.includes(`/groups/${groupId}/`)) {
      continue
    }
    const text = textFromEntry(data)
    if (p.endsWith(`/groups/${groupId}/default/cribl/inputs.yml`) || p.endsWith(`/groups/${groupId}/default/cribl/inputs.yaml`)) {
      hits.push({ priority: 20, text })
      continue
    }
    if (p.endsWith(`/groups/${groupId}/local/cribl/inputs.yml`) || p.endsWith(`/groups/${groupId}/local/cribl/inputs.yaml`)) {
      hits.push({ priority: 40, text })
      continue
    }
    if (
      (p.includes(`/groups/${groupId}/default/cribl/inputs/`) || p.includes(`/groups/${groupId}/local/cribl/inputs/`)) &&
      (p.endsWith('.yml') || p.endsWith('.yaml'))
    ) {
      const base = p.includes('/local/cribl/inputs/') ? 60 : 35
      const tie = (p.split('/').pop() ?? '').length / 1000
      hits.push({ priority: base + tie, text })
    }
  }
  hits.sort((a, b) => a.priority - b.priority)
  return mergeInputsYamlTexts(hits.map((h) => h.text))
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
      if (typeof doc.type === 'string') {
        meta.type = doc.type
      }
      return meta
    }
  }
  return {}
}

/** Cribl stock / template group dirs that often appear in diags with **no** per-group `inputs.yml`. */
const STOCK_GROUP_IDS_NO_INPUTS = new Set([
  'default',
  'defaultHybrid',
  'default_fleet',
  'default_outpost',
  'default_search',
])

function discoverGroupIds(files: Map<string, Uint8Array>): string[] {
  const ids = new Set<string>()
  for (const path of files.keys()) {
    const gid = groupConfigPathPrefix(normalizePath(path))
    if (gid && gid !== 'default_search') {
      ids.add(gid)
    }
  }
  return [...ids].filter((id) => id.length > 0)
}

const LEADER_GLOBAL_LEADER_ID = '__diag_leader_scope__'

/** `$CRIBL_HOME/local/cribl/inputs.yml` (and `default/`) — **not** under `groups/`. */
function collectLeaderHomeScopeInputs(files: Map<string, Uint8Array>): LeaderInputItem[] {
  type Hit = { priority: number; text: string }
  const hits: Hit[] = []
  for (const [path, data] of files) {
    const p = normalizePath(path)
    if (p.includes('/groups/')) {
      continue
    }
    if (p.endsWith('/default/cribl/inputs.yml') || p.endsWith('/default/cribl/inputs.yaml')) {
      hits.push({ priority: 15, text: textFromEntry(data) })
      continue
    }
    if (p.endsWith('/local/cribl/inputs.yml') || p.endsWith('/local/cribl/inputs.yaml')) {
      hits.push({ priority: 35, text: textFromEntry(data) })
    }
  }
  hits.sort((a, b) => a.priority - b.priority)
  return mergeInputsYamlTexts(hits.map((h) => h.text))
}

/**
 * Parse a diagnostic bundle archive and return the same harvest shape as {@link harvestTenantTopology}.
 */
export async function harvestDiagBundle(archiveBytes: Uint8Array): Promise<TenantHarvestResult> {
  const warnings: string[] = []
  const files = await extractTarGzArchive(archiveBytes)
  if (files.size === 0) {
    return {
      groups: [],
      inputsByGroup: {},
      warnings: ['Archive contained no readable files (empty or unsupported tar layout).'],
    }
  }

  const rawIds = discoverGroupIds(files)
  const leaderScopeInputs = collectLeaderHomeScopeInputs(files)

  const groups: MasterGroupItem[] = []
  const inputsByGroup: Record<string, LeaderInputItem[]> = {}

  if (leaderScopeInputs.length > 0) {
    groups.push({
      id: LEADER_GLOBAL_LEADER_ID,
      description: 'Leader (global)',
      type: 'stream',
    })
    inputsByGroup[LEADER_GLOBAL_LEADER_ID] = leaderScopeInputs
  }

  if (rawIds.length === 0 && leaderScopeInputs.length === 0) {
    warnings.push(
      'No worker-group config paths (`groups/<id>/local/` or `groups/<id>/default/`) and no Leader-scope `local/cribl/inputs.yml` — is this a Cribl Stream/Edge diagnostic bundle, or were configs excluded from the diag?',
    )
    return { groups: [], inputsByGroup: {}, warnings }
  }

  let skippedStock = 0
  for (const id of rawIds.sort()) {
    const meta = readGroupsMetaYml(files, id)
    const g: MasterGroupItem = {
      id,
      description: meta.description,
      isFleet: meta.isFleet,
      type: meta.type,
    }
    const inputs = collectInputsForGroup(files, id)
    if (STOCK_GROUP_IDS_NO_INPUTS.has(id) && inputs.length === 0) {
      skippedStock++
      continue
    }
    inputsByGroup[id] = inputs
    groups.push(g)

    if (inputs.length === 0) {
      warnings.push(
        `No inputs parsed for group "${id}" (looked for local/default cribl/inputs.yml and inputs/*.yml under groups/).`,
      )
    }
  }

  if (skippedStock > 0) {
    warnings.push(
      `Skipped ${skippedStock} stock template group folder(s) (e.g. default / default_fleet) with no inputs.yml — these often appear from logs/state paths in diags.`,
    )
  }

  // Drop groups that have zero inputs AND no meaningful metadata (often empty stub dirs)
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
      'No parsable inputs.yml content found under `groups/<id>/local|default/cribl/` or Leader `local/cribl/inputs.yml` — bundle may omit configs, use a different on-disk layout, or inputs may live only on workers (try a Worker Node diag).',
    )
  }

  return { groups: pruned, inputsByGroup: prunedInputs, warnings }
}
