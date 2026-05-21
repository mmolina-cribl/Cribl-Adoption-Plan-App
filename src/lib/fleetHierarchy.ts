import type { PlanState, SourceSummaryRow, WorkerGroupRow } from '../types/planTypes'
import { sumAvgDailyFromSourceSummaryForWg } from './workerGroupRollup'

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
 * Edge hierarchy is single-level: every sub-fleet's `parentFleetId` must
 * reference a **top-level** fleet (`kind === 'edge'` with an empty
 * `parentFleetId`). Given any edge row id (fleet or sub-fleet), return the
 * top-level fleet id new sub-fleets should attach under, or `null` if the
 * row is missing or not Edge.
 */
export function topLevelFleetIdForNewSubfleet(
  workerGroups: WorkerGroupRow[],
  edgeFleetOrSubfleetId: string,
): string | null {
  const w = workerGroups.find((x) => x.id === edgeFleetOrSubfleetId)
  if (!w || w.kind !== 'edge') {
    return null
  }
  const pid = (w.parentFleetId ?? '').trim()
  if (!pid) {
    return w.id
  }
  const parent = workerGroups.find((x) => x.id === pid)
  if (!parent || parent.kind !== 'edge' || (parent.parentFleetId ?? '').trim()) {
    return null
  }
  return parent.id
}

/** Top-level Edge fleets with no sources and no sub-fleets yet — "orphan" hubs in the plan map. */
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

const wgLabelKey = (r: WorkerGroupRow) => (r.wg.trim() || r.id).toLowerCase()

const collateFleetRows = (a: WorkerGroupRow, b: WorkerGroupRow) =>
  wgLabelKey(a).localeCompare(wgLabelKey(b), undefined, { sensitivity: 'base' }) ||
  a.id.localeCompare(b.id)

function collateFleetRowsOrdered(direction: 'asc' | 'desc', a: WorkerGroupRow, b: WorkerGroupRow): number {
  const c = collateFleetRows(a, b)
  return direction === 'asc' ? c : -c
}

/**
 * Sort **top-level** Edge fleets alphabetically and each parent’s **sub-fleets**
 * among themselves, preserving parent → children export/nav grouping. Rows that
 * still reference a missing parent are normalized like {@link normalizeEdgeFleetOrder}.
 */
export function sortEdgeFleetsAlphabetically(
  edges: WorkerGroupRow[],
  direction: 'asc' | 'desc' = 'asc',
): WorkerGroupRow[] {
  const norm = normalizeEdgeFleetOrder(edges)
  if (norm.length <= 1) {
    return norm
  }

  const roots = norm
    .filter((e) => !(e.parentFleetId ?? '').trim())
    .sort((a, b) => collateFleetRowsOrdered(direction, a, b))
  const out: WorkerGroupRow[] = []
  for (const r of roots) {
    out.push(r)
    const kids = norm
      .filter((e) => (e.parentFleetId ?? '').trim() === r.id)
      .sort((a, b) => collateFleetRowsOrdered(direction, a, b))
    out.push(...kids)
  }
  const placed = new Set(out.map((x) => x.id))
  for (const e of norm) {
    if (!placed.has(e.id)) {
      placed.add(e.id)
      out.push({ ...e, parentFleetId: '' })
    }
  }
  return normalizeEdgeFleetOrder(out)
}

function ingestGbForWgSort(plan: PlanState, workerGroupId: string): number {
  const { sum } = sumAvgDailyFromSourceSummaryForWg(plan, workerGroupId)
  return Number.isFinite(sum) && sum >= 0 ? sum : 0
}

function compareFleetRowsByIngest(
  plan: PlanState,
  direction: 'desc' | 'asc',
  a: WorkerGroupRow,
  b: WorkerGroupRow,
): number {
  const va = ingestGbForWgSort(plan, a.id)
  const vb = ingestGbForWgSort(plan, b.id)
  const primary = direction === 'desc' ? vb - va : va - vb
  if (primary !== 0) {
    return primary > 0 ? 1 : -1
  }
  return a.id.localeCompare(b.id)
}

/**
 * Sort Edge fleets by summed **source-summary** ingest (GB/d) per row, same basis
 * as the left-nav subtitle. Top-level fleets sort among themselves; sub-fleets
 * sort within each parent. See {@link sortEdgeFleetsAlphabetically} for structure.
 */
export function sortEdgeFleetsByIngest(
  edges: WorkerGroupRow[],
  plan: PlanState,
  direction: 'desc' | 'asc',
): WorkerGroupRow[] {
  const norm = normalizeEdgeFleetOrder(edges)
  if (norm.length <= 1) {
    return norm
  }

  const roots = norm
    .filter((e) => !(e.parentFleetId ?? '').trim())
    .sort((a, b) => compareFleetRowsByIngest(plan, direction, a, b))
  const out: WorkerGroupRow[] = []
  for (const r of roots) {
    out.push(r)
    const kids = norm
      .filter((e) => (e.parentFleetId ?? '').trim() === r.id)
      .sort((a, b) => compareFleetRowsByIngest(plan, direction, a, b))
    out.push(...kids)
  }
  const placed = new Set(out.map((x) => x.id))
  for (const e of norm) {
    if (!placed.has(e.id)) {
      placed.add(e.id)
      out.push({ ...e, parentFleetId: '' })
    }
  }
  return normalizeEdgeFleetOrder(out)
}
