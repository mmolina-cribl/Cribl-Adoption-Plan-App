import type { PlanState, SourceSummaryRow } from '../types/planTypes'

const MAX_FIELD_LEN = 4_000

export type PlanPatchOp =
  | {
      op: 'updateSourceField'
      sourceId: string
      field: 'blockers' | 'avgDailyGb' | 'additionalNotes' | 'pipelineUsecase'
      value: string
    }
  | { op: 'updateCseNotes'; value: string }

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

function normalizeOps(raw: unknown): { ok: true; ops: PlanPatchOp[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ['operations must be an array'] }
  }
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

/**
 * Validates assistant-proposed plan edits and returns a cloned PlanState with changes applied.
 * Allowlist only — no structural adds/deletes.
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

  const next: PlanState = JSON.parse(JSON.stringify(plan)) as PlanState

  for (const op of norm.ops) {
    if (op.op === 'updateCseNotes') {
      next.cseNotes = op.value
      continue
    }
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
    next.sourceSummary[idx] = row
  }

  return {
    summary: sum,
    operations: norm.ops,
    nextPlan: next,
  }
}
