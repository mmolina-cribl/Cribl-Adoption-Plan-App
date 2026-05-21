import type { SourceSummaryRow, WorkerGroupRow } from '../types/planTypes'

/**
 * Reorder a list by id (same semantics as `reorderById` in `App.tsx`).
 */
function reorderById<T extends { id: string }>(
  arr: T[],
  fromId: string,
  toId: string,
  position: 'before' | 'after',
): T[] {
  if (fromId === toId) {
    return arr
  }
  const fromIdx = arr.findIndex((r) => r.id === fromId)
  const toIdx = arr.findIndex((r) => r.id === toId)
  if (fromIdx < 0 || toIdx < 0) {
    return arr
  }
  const next = arr.slice()
  const [moved] = next.splice(fromIdx, 1)
  if (!moved) {
    return arr
  }
  const adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx
  const insertAt = position === 'before' ? adjustedTo : adjustedTo + 1
  if (insertAt === fromIdx) {
    return arr
  }
  next.splice(insertAt, 0, moved)
  return next
}

/**
 * Top-level Edge fleets with no sources and no sub-fleets yet — shown in
 * the plan resource map "Unassigned" bucket alongside loose sources.
 */
export function edgeFleetUnassignedOrphans(
  workerGroups: WorkerGroupRow[],
  sourceSummary: SourceSummaryRow[],
): WorkerGroupRow[] {
  return workerGroups.filter((w) => {
    if (w.kind !== 'edge') return false
    if ((w.parentFleetId ?? '').trim()) return false
    if (sourceSummary.some((s) => s.workerGroupId === w.id)) return false
    if (workerGroups.some((c) => (c.parentFleetId ?? '').trim() === w.id)) return false
    return true
  })
}

/**
 * Single-level Edge hierarchy: each sub-fleet's parent must be a top-level
 * fleet. Rebuild `workerGroups` order so every parent is immediately followed
 * by its children (nav + export order).
 */
export function normalizeEdgeFleetOrder(edges: WorkerGroupRow[]): WorkerGroupRow[] {
  const idSet = new Set(edges.map((e) => e.id))
  const byId = new Map(edges.map((e) => [e.id, e] as const))

  const sanitized = edges.map((e) => {
    let pid = (e.parentFleetId ?? '').trim()
    if (!pid || !idSet.has(pid)) {
      pid = ''
    } else {
      const parent = byId.get(pid)
      if (!parent || parent.kind !== 'edge' || (parent.parentFleetId ?? '').trim()) {
        pid = ''
      }
      if (pid === e.id) {
        pid = ''
      }
    }
    return { ...e, parentFleetId: pid }
  })

  const indexOf = new Map(sanitized.map((e, i) => [e.id, i] as const))

  const rootsInAppearanceOrder: WorkerGroupRow[] = []
  const seenRoot = new Set<string>()
  for (const e of sanitized) {
    if (!(e.parentFleetId ?? '').trim() && !seenRoot.has(e.id)) {
      seenRoot.add(e.id)
      rootsInAppearanceOrder.push(e)
    }
  }

  const out: WorkerGroupRow[] = []
  const emitted = new Set<string>()

  for (const root of rootsInAppearanceOrder) {
    if (emitted.has(root.id)) continue
    emitted.add(root.id)
    out.push(root)
    const kids = sanitized.filter((e) => (e.parentFleetId ?? '').trim() === root.id)
    kids.sort((a, b) => (indexOf.get(a.id)! - indexOf.get(b.id)!))
    for (const k of kids) {
      if (emitted.has(k.id)) continue
      emitted.add(k.id)
      out.push(k)
    }
  }

  for (const e of sanitized) {
    if (!emitted.has(e.id)) {
      emitted.add(e.id)
      out.push({ ...e, parentFleetId: '' })
    }
  }
  return out
}

export type FleetDropPosition = 'before' | 'after' | 'nest'

/**
 * Apply a drag-reorder in the Edge fleet list and update `parentFleetId`.
 * `position === 'nest'` is only used when the UI's nest drop-zone fires
 * (become a sub-fleet of the target top-level fleet).
 */
export function applyEdgeFleetReorder(
  edges: WorkerGroupRow[],
  fromId: string,
  toId: string,
  position: FleetDropPosition,
): WorkerGroupRow[] {
  const insertPos: 'before' | 'after' = position === 'nest' ? 'after' : position
  let next = reorderById(edges, fromId, toId, insertPos)
  const to = next.find((w) => w.id === toId)
  const from = next.find((w) => w.id === fromId)
  if (!from || !to) {
    return normalizeEdgeFleetOrder(next)
  }

  let parentFleetId = (from.parentFleetId ?? '').trim()

  if (position === 'nest') {
    // Nest zone is only offered on top-level targets, but if this ever fires
    // on a sub-fleet row, attach under the same parent fleet instead of
    // creating a second nesting level (single-level product rule).
    parentFleetId = (to.parentFleetId ?? '').trim() || to.id
  } else if (position === 'before') {
    parentFleetId = (to.parentFleetId ?? '').trim()
  } else {
    parentFleetId = (to.parentFleetId ?? '').trim()
  }

  if (parentFleetId === fromId) {
    parentFleetId = ''
  }
  const parentRow = parentFleetId ? next.find((x) => x.id === parentFleetId) : null
  if (
    parentFleetId &&
    (!parentRow || parentRow.kind !== 'edge' || (parentRow.parentFleetId ?? '').trim())
  ) {
    parentFleetId = ''
  }

  next = next.map((w) => (w.id === fromId ? { ...w, parentFleetId } : w))
  return normalizeEdgeFleetOrder(next)
}
