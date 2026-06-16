import type { PlanState, SourceSummaryRow, WorkerGroupKind, WorkerGroupRow } from '../types/planTypes'
import { defaultSourceRow, defaultWorkerGroupRow } from './defaultState'
import { syncAllSourcesStreamOrEdge } from './workerGroupIds'
import { isSourceRowAttachmentDisabled } from './sourceAttachmentDisabled'
const MAX_NAME_LEN = 512
/** Max length for free-text patch fields (notes, blockers, etc.). */
const MAX_FIELD_LEN = 16384
/** Bound assistant proposals (UI + model). */
export const MAX_PLAN_PATCH_OPS = 40
/** Max `addSource` operations in a single proposal. */
export const MAX_PLAN_PATCH_NEW_SOURCES = 30

export type PlanPatchOp =
  | {
      op: 'updateSourceField'
      sourceId: string
      field: 'blockers' | 'avgDailyGb' | 'additionalNotes' | 'pipelineUsecase'
      value: string
    }
  | { op: 'updateCseNotes'; value: string }
  | {
      op: 'addWorkerGroup'
      kind: WorkerGroupKind
      wg: string
      /** Edge sub-fleet only: parent fleet row `id` (must be top-level Edge fleet). */
      parentFleetId?: string
    }
  | {
      op: 'addSource'
      source: string
      sourceTile?: string
      workerGroupId?: string
      /** Match `WorkerGroupRow.wg` case-insensitive after prior ops in this batch. */
      workerGroupWg?: string
    }
  | {
      op: 'setSourceWorkerGroup'
      sourceId: string
      workerGroupId?: string
      workerGroupWg?: string
    }

export type PlanPatchProposal = {
  summary: string
  operations: PlanPatchOp[]
  nextPlan: PlanState
}

type SourcePatchField = Extract<PlanPatchOp, { op: 'updateSourceField' }>['field']

function clamp(s: string, max: number): string {
  const t = String(s ?? '')
  return t.length <= max ? t : t.slice(0, max)
}

function isAllowedSourceField(f: string): f is SourcePatchField {
  return f === 'blockers' || f === 'avgDailyGb' || f === 'additionalNotes' || f === 'pipelineUsecase'
}

function isWorkerGroupKind(k: unknown): k is WorkerGroupKind {
  return k === 'stream' || k === 'edge'
}

function wgNameKey(name: string): string {
  return name.trim().toLowerCase()
}

function workerGroupNameTaken(workerGroups: WorkerGroupRow[], wg: string): boolean {
  const key = wgNameKey(wg)
  if (!key) return true
  return workerGroups.some((w) => wgNameKey(w.wg) === key)
}

function findWorkerGroupIdByName(workerGroups: WorkerGroupRow[], name: string): string | undefined {
  const key = wgNameKey(name)
  if (!key) return undefined
  const row = workerGroups.find((w) => wgNameKey(w.wg) === key)
  return row?.id
}

/**
 * Resolve attachment target: explicit id, then name, else unassigned (`''`).
 * Returns `{ id }` or `{ error }`.
 */
function resolveWorkerGroupAttachment(
  workerGroups: WorkerGroupRow[],
  workerGroupId: string | undefined,
  workerGroupWg: string | undefined,
): { id: string } | { error: string } {
  const idRaw = typeof workerGroupId === 'string' ? workerGroupId.trim() : ''
  if (idRaw) {
    if (!workerGroups.some((w) => w.id === idRaw)) {
      return { error: `Unknown workerGroupId: ${idRaw}` }
    }
    return { id: idRaw }
  }
  const nameRaw = typeof workerGroupWg === 'string' ? workerGroupWg.trim() : ''
  if (nameRaw) {
    const found = findWorkerGroupIdByName(workerGroups, nameRaw)
    if (!found) {
      return { error: `Unknown worker group name: ${nameRaw}` }
    }
    return { id: found }
  }
  return { id: '' }
}

function normalizeOps(raw: unknown): { ok: true; ops: PlanPatchOp[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ['operations must be an array'] }
  }
  if (raw.length > MAX_PLAN_PATCH_OPS) {
    return { ok: false, errors: [`At most ${MAX_PLAN_PATCH_OPS} operations allowed`] }
  }
  let addSourceCount = 0
  const ops: PlanPatchOp[] = []
  const errors: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]
    if (!row || typeof row !== 'object') {
      errors.push(`Operation ${i}: not an object`)
      continue
    }
    const op = (row as { op?: unknown }).op
    if (op === 'updateCseNotes') {
      const value = (row as { value?: unknown }).value
      if (typeof value !== 'string') {
        errors.push(`Operation ${i}: updateCseNotes requires string value`)
        continue
      }
      ops.push({ op: 'updateCseNotes', value: clamp(value, MAX_FIELD_LEN) })
      continue
    }
    if (op === 'updateSourceField') {
      const sourceId = (row as { sourceId?: unknown }).sourceId
      const field = (row as { field?: unknown }).field
      const value = (row as { value?: unknown }).value
      if (typeof sourceId !== 'string' || !sourceId.trim()) {
        errors.push(`Operation ${i}: updateSourceField requires sourceId`)
        continue
      }
      if (typeof field !== 'string' || !isAllowedSourceField(field)) {
        errors.push(`Operation ${i}: invalid field for updateSourceField`)
        continue
      }
      if (typeof value !== 'string') {
        errors.push(`Operation ${i}: updateSourceField requires string value`)
        continue
      }
      ops.push({
        op: 'updateSourceField',
        sourceId: sourceId.trim(),
        field,
        value: clamp(value, MAX_FIELD_LEN),
      })
      continue
    }
    if (op === 'addWorkerGroup') {
      const kind = (row as { kind?: unknown }).kind
      const wg = (row as { wg?: unknown }).wg
      const parentFleetId = (row as { parentFleetId?: unknown }).parentFleetId
      if (!isWorkerGroupKind(kind)) {
        errors.push(`Operation ${i}: addWorkerGroup requires kind "stream" or "edge"`)
        continue
      }
      if (typeof wg !== 'string' || !wg.trim()) {
        errors.push(`Operation ${i}: addWorkerGroup requires non-empty wg`)
        continue
      }
      const wgClamped = clamp(wg.trim(), MAX_NAME_LEN)
      if (typeof parentFleetId === 'string' && parentFleetId.trim()) {
        if (kind !== 'edge') {
          errors.push(`Operation ${i}: parentFleetId is only valid for edge addWorkerGroup`)
          continue
        }
        ops.push({
          op: 'addWorkerGroup',
          kind,
          wg: wgClamped,
          parentFleetId: parentFleetId.trim(),
        })
        continue
      }
      if (parentFleetId != null && parentFleetId !== '') {
        errors.push(`Operation ${i}: addWorkerGroup parentFleetId must be a non-empty string or omitted`)
        continue
      }
      ops.push({ op: 'addWorkerGroup', kind, wg: wgClamped })
      continue
    }
    if (op === 'addSource') {
      const source = (row as { source?: unknown }).source
      const sourceTile = (row as { sourceTile?: unknown }).sourceTile
      const workerGroupId = (row as { workerGroupId?: unknown }).workerGroupId
      const workerGroupWg = (row as { workerGroupWg?: unknown }).workerGroupWg
      if (typeof source !== 'string' || !source.trim()) {
        errors.push(`Operation ${i}: addSource requires non-empty source`)
        continue
      }
      addSourceCount += 1
      if (addSourceCount > MAX_PLAN_PATCH_NEW_SOURCES) {
        errors.push(`Operation ${i}: at most ${MAX_PLAN_PATCH_NEW_SOURCES} addSource operations allowed`)
        continue
      }
      ops.push({
        op: 'addSource',
        source: clamp(source.trim(), MAX_NAME_LEN),
        sourceTile:
          typeof sourceTile === 'string' && sourceTile.trim()
            ? clamp(sourceTile.trim(), MAX_NAME_LEN)
            : undefined,
        workerGroupId: typeof workerGroupId === 'string' ? workerGroupId.trim() : undefined,
        workerGroupWg: typeof workerGroupWg === 'string' ? workerGroupWg.trim() : undefined,
      })
      continue
    }
    if (op === 'setSourceWorkerGroup') {
      const sourceId = (row as { sourceId?: unknown }).sourceId
      const workerGroupId = (row as { workerGroupId?: unknown }).workerGroupId
      const workerGroupWg = (row as { workerGroupWg?: unknown }).workerGroupWg
      if (typeof sourceId !== 'string' || !sourceId.trim()) {
        errors.push(`Operation ${i}: setSourceWorkerGroup requires sourceId`)
        continue
      }
      ops.push({
        op: 'setSourceWorkerGroup',
        sourceId: sourceId.trim(),
        workerGroupId: typeof workerGroupId === 'string' ? workerGroupId.trim() : undefined,
        workerGroupWg: typeof workerGroupWg === 'string' ? workerGroupWg.trim() : undefined,
      })
      continue
    }
    errors.push(`Operation ${i}: unknown op ${String(op)}`)
  }
  if (errors.length > 0) {
    return { ok: false, errors }
  }
  if (ops.length === 0) {
    return { ok: false, errors: ['operations array is empty'] }
  }
  return { ok: true, ops }
}

function isTopLevelEdgeFleet(w: WorkerGroupRow): boolean {
  return w.kind === 'edge' && !(w.parentFleetId ?? '').trim()
}

/**
 * Validates assistant-proposed plan edits and returns a cloned PlanState with changes applied.
 * Operations run in array order so e.g. `addWorkerGroup` can precede `addSource` with `workerGroupWg`.
 */
export function validatePlanPatchProposal(plan: PlanState, operationsRaw: unknown, summary: string): PlanPatchProposal | { error: string } {
  const sum = typeof summary === 'string' ? summary.trim() : ''
  if (!sum) {
    return { error: 'summary is required' }
  }
  const norm = normalizeOps(operationsRaw)
  if (!norm.ok) {
    return { error: norm.errors.join('; ') }
  }

  let next: PlanState = JSON.parse(JSON.stringify(plan)) as PlanState

  for (const op of norm.ops) {
    if (op.op === 'updateCseNotes') {
      next = { ...next, cseNotes: op.value }
      continue
    }
    if (op.op === 'updateSourceField') {
      const idx = next.sourceSummary.findIndex((r) => r.id === op.sourceId)
      if (idx === -1) {
        return { error: `Unknown source id: ${op.sourceId}` }
      }
      const row = { ...next.sourceSummary[idx] } as SourceSummaryRow
      if (op.field === 'blockers') {
        row.blockers = op.value
      } else if (op.field === 'avgDailyGb') {
        row.avgDailyGb = op.value
      } else if (op.field === 'additionalNotes') {
        row.additionalNotes = op.value
      } else {
        row.pipelineUsecase = op.value
      }
      const sourceSummary = next.sourceSummary.slice()
      sourceSummary[idx] = row
      next = syncAllSourcesStreamOrEdge({ ...next, sourceSummary })
      continue
    }
    if (op.op === 'addWorkerGroup') {
      if (workerGroupNameTaken(next.workerGroups, op.wg)) {
        return { error: `Worker group or fleet name already exists: ${op.wg}` }
      }
      const row = defaultWorkerGroupRow(op.kind)
      row.wg = op.wg
      if (op.kind === 'edge' && (op.parentFleetId ?? '').trim()) {
        const pid = op.parentFleetId!.trim()
        const parent = next.workerGroups.find((w) => w.id === pid)
        if (!parent || parent.kind !== 'edge') {
          return { error: `addWorkerGroup: parent fleet not found: ${pid}` }
        }
        if (!isTopLevelEdgeFleet(parent)) {
          return { error: 'addWorkerGroup: parent must be a top-level Edge fleet (not a sub-fleet)' }
        }
        row.parentFleetId = pid
      }
      next = {
        ...next,
        workerGroups: [...next.workerGroups, row],
      }
      next = syncAllSourcesStreamOrEdge(next)
      continue
    }
    if (op.op === 'addSource') {
      const resolved = resolveWorkerGroupAttachment(next.workerGroups, op.workerGroupId, op.workerGroupWg)
      if ('error' in resolved) {
        return { error: resolved.error }
      }
      const base = defaultSourceRow(next.sourceSummary.length, resolved.id)
      base.source = op.source
      if (op.sourceTile != null && op.sourceTile !== '') {
        base.sourceTile = op.sourceTile
      }
      next = {
        ...next,
        sourceSummary: [...next.sourceSummary, base],
      }
      next = syncAllSourcesStreamOrEdge(next)
      continue
    }
    if (op.op === 'setSourceWorkerGroup') {
      const idx = next.sourceSummary.findIndex((r) => r.id === op.sourceId)
      if (idx === -1) {
        return { error: `Unknown source id: ${op.sourceId}` }
      }
      const resolved = resolveWorkerGroupAttachment(next.workerGroups, op.workerGroupId, op.workerGroupWg)
      if ('error' in resolved) {
        return { error: resolved.error }
      }
      const srcRow = next.sourceSummary[idx]!
      if (isSourceRowAttachmentDisabled(srcRow) && resolved.id !== '') {
        return {
          error:
            'setSourceWorkerGroup: disabled sources cannot be attached or moved to a worker group (detach only)',
        }
      }
      const row = { ...srcRow, workerGroupId: resolved.id }
      const sourceSummary = next.sourceSummary.slice()
      sourceSummary[idx] = row
      next = syncAllSourcesStreamOrEdge({ ...next, sourceSummary })
      continue
    }
  }

  return {
    summary: sum,
    operations: norm.ops,
    nextPlan: next,
  }
}
