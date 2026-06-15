/**
 * Cribl App Platform: read worker groups + configured **inputs** (sources) from the Leader.
 *
 * **Data scope** (what is called, what is imported, what is ignored) is documented in
 * `docs/tenant-import-leader-data.md` — keep that file in sync when changing harvest behavior.
 */
import { criblGetJson, criblApiBase } from './leaderApi'
import { isStockLeaderWorkerGroup } from './leaderStockGroups'
import type { LeaderCloudInfo } from './leaderWorkerGroupMetrics'

export type MasterGroupItem = {
  id: string
  description?: string
  isFleet?: boolean
  isSearch?: boolean
  /** Leader group type when present (`stream`, `edge`, `outpost`, …). */
  type?: string
  /**
   * Cribl provisioned-ingest **tier code** (maps to max MB/s) when returned by
   * `GET /master/groups` — not GB/day. See `leaderWorkerGroupMetrics.ts`.
   */
  estimatedIngestRate?: number
  onPrem?: boolean
  cloud?: LeaderCloudInfo
}

/** One configured Stream/Edge **input** (source) from Leader `GET …/system/inputs`. */
export type LeaderInputItem = {
  id: string
  type?: string
  disabled?: boolean
  description?: string
}

export type HarvestWarning = string

export type TenantHarvestResult = {
  groups: MasterGroupItem[]
  /** groupId → configured inputs (sources) from Leader */
  inputsByGroup: Record<string, LeaderInputItem[]>
  warnings: HarvestWarning[]
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** Top-level list from Leader JSON bodies (`{ items: [] }`, `{ routes: [] }`, or raw array). */
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
  }
  return []
}

/**
 * Normalize `GET /m/{group}/system/inputs` (and similar) responses into input records.
 */
export function normalizeLeaderInputsResponse(body: unknown): LeaderInputItem[] {
  const out: LeaderInputItem[] = []
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
      type: typeof row.type === 'string' ? row.type : undefined,
      disabled: row.disabled === true,
      description: typeof row.description === 'string' ? row.description : undefined,
    })
  }
  return out
}

async function fetchInputsForGroup(groupId: string): Promise<LeaderInputItem[]> {
  const base = criblApiBase()
  if (!base) {
    return []
  }
  const paths = [
    `/m/${encodeURIComponent(groupId)}/system/inputs`,
    `/m/${encodeURIComponent(groupId)}/inputs`,
  ]
  for (const p of paths) {
    const url = `${base}${p}`
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' } })
      if (!r.ok) {
        continue
      }
      const raw: unknown = await r.json()
      const normalized = normalizeLeaderInputsResponse(raw)
      if (normalized.length > 0) {
        return normalized
      }
    } catch {
      /* try next path */
    }
  }
  return []
}

/**
 * Read Stream / Edge worker-group inventory and **configured sources** (Leader inputs)
 * per group from the live Leader. Search-only groups (`default_search`, `isSearch`) and
 * Cribl **stock** groups (`default`, `defaultHybrid`, `default_fleet`, `default_outpost`) are skipped.
 */
export async function harvestTenantTopology(signal?: AbortSignal): Promise<TenantHarvestResult> {
  const warnings: HarvestWarning[] = []
  const data = await criblGetJson<{ items?: MasterGroupItem[] }>('/master/groups')
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const rawItems = data.items ?? []
  let skippedStockGroups = 0
  const groups = rawItems.filter((g) => {
    if (!g?.id) {
      return false
    }
    if (g.id === 'default_search') {
      return false
    }
    if (g.isSearch === true) {
      return false
    }
    if (isStockLeaderWorkerGroup(g)) {
      skippedStockGroups += 1
      return false
    }
    return true
  })

  if (skippedStockGroups > 0) {
    warnings.push(
      `Skipped ${skippedStockGroups} built-in Cribl worker group(s) (default / defaultHybrid / default_fleet / default_outpost). Only customer-created groups are imported; stock groups still exist on the Leader.`,
    )
  }

  if (groups.length === 0) {
    warnings.push(
      'No worker groups returned from /master/groups (after filtering Search and built-in default groups).',
    )
  }

  const inputsByGroup: Record<string, LeaderInputItem[]> = {}
  for (const g of groups) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const inputs = await fetchInputsForGroup(g.id)
    inputsByGroup[g.id] = inputs
    if (inputs.length === 0) {
      warnings.push(
        `No inputs (sources) returned for group "${g.id}" (tried /m/.../system/inputs and /m/.../inputs).`,
      )
    }
  }

  return { groups, inputsByGroup, warnings }
}
