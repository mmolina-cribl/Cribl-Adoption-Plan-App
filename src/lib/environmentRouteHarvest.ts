/** Normalize Leader / diag route payloads into flat route row objects. */

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function isLikelyRouteRow(row: Record<string, unknown>): boolean {
  if (typeof row.filter === 'string' || row.filter === true) {
    return true
  }
  if (typeof row.pipeline === 'string' || typeof row.output === 'string') {
    return true
  }
  if (typeof row.destination === 'string') {
    return true
  }
  return false
}

/**
 * Leader returns routes in several shapes:
 * - `{ routes: [ … ] }` from `GET /m/{group}/routes/default`
 * - `{ items: [ { id, routes: [ … ] } ] }` from `GET /m/{group}/routes`
 * - `{ items: [ { id, filter, pipeline, … } ] }` flat route list
 */
export function flattenLeaderRoutesBody(body: unknown): unknown[] {
  if (body == null) {
    return []
  }
  if (Array.isArray(body)) {
    return body
  }
  if (!isRecord(body)) {
    return []
  }

  if (Array.isArray(body.routes)) {
    return body.routes
  }

  if (Array.isArray(body.items)) {
    const flat: unknown[] = []
    for (const item of body.items) {
      if (!isRecord(item)) {
        continue
      }
      if (Array.isArray(item.routes) && item.routes.length > 0) {
        flat.push(...item.routes)
        continue
      }
      if (isLikelyRouteRow(item)) {
        flat.push(item)
      }
    }
    return flat
  }

  return []
}
