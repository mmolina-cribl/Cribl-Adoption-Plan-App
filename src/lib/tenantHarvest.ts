/**
 * Cribl App Platform: read worker groups + configured **inputs** (sources) from the Leader.
 *
 * **Data scope** (what is called, what is imported, what is ignored) is documented in
 * `docs/tenant-import-leader-data.md` — keep that file in sync when changing harvest behavior.
 */
import { criblGetJson, criblApiBase } from './leaderApi'
import { isStockLeaderWorkerGroup, isLeaderSearchGroup } from './leaderStockGroups'
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

/** Options for {@link harvestTenantTopology} and {@link harvestDiagBundle} (same shape). */
export type TenantHarvestOptions = {
  /**
   * When `true`, omit Cribl stock worker groups (`default`, `defaultHybrid`, `default_fleet`, `default_outpost`).
   * Default **`false`** — import those groups when customers run workloads there.
   */
  omitStockWorkerGroups?: boolean
  /**
   * When `true`, omit Leader inputs with `disabled: true`. Default **`true`** — check **Include disabled…** in the UI to import them
   * (each row gets ` disabled` on **Source** and `leaderImportedDisabled` in the plan).
   */
  omitDisabledInputs?: boolean
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
 * per group from the live Leader. Search-only groups (`default_search`, `isSearch`) are always skipped.
 *
 * Optional {@link TenantHarvestOptions}:
 * - **`omitStockWorkerGroups`** — omit built-in `default*` groups (default off).
 * - **`omitDisabledInputs`** — omit `disabled` inputs (default on).
 */
export async function harvestTenantTopology(
  signal?: AbortSignal,
  options?: TenantHarvestOptions,
): Promise<TenantHarvestResult> {
  const warnings: HarvestWarning[] = []
  const omitStock = options?.omitStockWorkerGroups === true
  const omitDisabled = options?.omitDisabledInputs !== false

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
    if (isLeaderSearchGroup(g)) {
      return false
    }
    if (omitStock && isStockLeaderWorkerGroup(g)) {
      skippedStockGroups += 1
      return false
    }
    return true
  })

  if (omitStock && skippedStockGroups > 0) {
    warnings.push(
      `Omitted ${skippedStockGroups} built-in Cribl worker group(s) (default / defaultHybrid / default_fleet / default_outpost) per import option.`,
    )
  }

  if (groups.length === 0) {
    if (omitStock && skippedStockGroups > 0) {
      warnings.push(
        'No worker groups remain after omitting built-in defaults — turn off that import option if your tenant uses those groups.',
      )
    } else {
      warnings.push('No worker groups returned from /master/groups (after filtering Search groups).')
    }
  }

  const inputsByGroup: Record<string, LeaderInputItem[]> = {}
  let omittedDisabledInputs = 0
  for (const g of groups) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    let inputs = await fetchInputsForGroup(g.id)
    if (omitDisabled) {
      omittedDisabledInputs += inputs.filter((i) => i.disabled).length
      inputs = inputs.filter((i) => !i.disabled)
    }
    inputsByGroup[g.id] = inputs
    if (inputs.length === 0) {
      warnings.push(
        `No inputs (sources) returned for group "${g.id}" (tried /m/.../system/inputs and /m/.../inputs)${omitDisabled ? ' after skipping disabled inputs' : ''}.`,
      )
    }
  }

  if (omitDisabled && omittedDisabledInputs > 0) {
    warnings.push(
      `Omitted ${omittedDisabledInputs} disabled Leader input(s) per import option — check “Include disabled Leader inputs” to include them next time.`,
    )
  }

  return { groups, inputsByGroup, warnings }
}
