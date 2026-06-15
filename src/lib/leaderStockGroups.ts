/**
 * Cribl Leader ships **stock** worker groups / fleets / outposts (`default`,
 * `defaultHybrid`, …) with many template inputs. Adoption import should focus on
 * **customer-created** groups from `/master/groups` and per-group `inputs.yml`.
 *
 * Per-input payloads from `GET …/system/inputs` only reliably carry `id`, `type`,
 * `disabled`, `description` in our normalizer — there is **no** explicit
 * “isDefaultSource” flag; `disabled: true` can still mean a real source the
 * customer turned off, so we do **not** treat `disabled` as “ignore”.
 */

/** Leader `groups[].id` values for built-in topology (not customer-created). */
export const STOCK_LEADER_WORKER_GROUP_IDS = new Set([
  'default',
  'defaultHybrid',
  'default_fleet',
  'default_outpost',
])

/**
 * True when this group is Cribl stock scaffolding (skip for adoption harvest).
 * Callers must still exclude Search-only groups (`default_search`, `isSearch`)
 * before or after this check.
 */
export function isStockLeaderWorkerGroup(g: { id: string }): boolean {
  const id = (g.id ?? '').trim()
  if (!id) {
    return false
  }
  return STOCK_LEADER_WORKER_GROUP_IDS.has(id)
}
