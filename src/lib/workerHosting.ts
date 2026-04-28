/**
 * Canonical worker-hosting taxonomy used in the planner.
 *
 * The underlying field (`WorkerGroupRow.workerHosting`) is a free-text
 * string for backwards compatibility with workbooks people already have
 * on disk — but in the UI we steer users toward this short list so
 * filters and bulk actions are meaningful.
 *
 * The "Other / free-text" escape hatch is intentional: a CSE may need
 * to record nuance like "AWS GovCloud — FedRAMP boundary" that doesn't
 * fit a generic bucket. Anything outside the canonical list is treated
 * as "Other" by the editor, the index filter, and bulk actions.
 */

export const WORKER_HOSTING_OPTIONS = [
  'Cribl-managed Cloud',
  'Customer-managed Cloud',
  'Customer-managed On-Prem',
  'Hybrid',
] as const

export type CanonicalWorkerHosting = (typeof WORKER_HOSTING_OPTIONS)[number]

const CANONICAL_LOOKUP = new Map<string, CanonicalWorkerHosting>(
  WORKER_HOSTING_OPTIONS.map((o) => [o.toLowerCase(), o]),
)

/** Returns the canonical match for a free-text value, case-insensitive. */
export function matchCanonicalHosting(value: string): CanonicalWorkerHosting | null {
  const trimmed = (value || '').trim()
  if (!trimmed) {
    return null
  }
  return CANONICAL_LOOKUP.get(trimmed.toLowerCase()) ?? null
}

export type HostingClassification =
  | { kind: 'unset' }
  | { kind: 'canonical'; value: CanonicalWorkerHosting }
  | { kind: 'other'; raw: string }

/** Classifies a stored value for filtering / display. */
export function classifyHosting(value: string): HostingClassification {
  const trimmed = (value || '').trim()
  if (!trimmed) {
    return { kind: 'unset' }
  }
  const canonical = CANONICAL_LOOKUP.get(trimmed.toLowerCase())
  if (canonical) {
    return { kind: 'canonical', value: canonical }
  }
  return { kind: 'other', raw: trimmed }
}
