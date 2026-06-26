import type { PlanState, WorkerGroupKind, WorkerGroupRow } from '../types/planTypes'

export type PlanWorkerGroupRef = {
  wg: string
  kind: WorkerGroupKind
}

export type PlanSourceRef = {
  source: string
  wg: string
}

export type PlanSourceReassignment = {
  source: string
  fromWg: string
  toWg: string
}

export type PlanImportDiff = {
  summary: string
  operations: string[]
  customerNameChanged: boolean
  cseNotesChanged: boolean
  workerGroupsAdded: PlanWorkerGroupRef[]
  workerGroupsRemoved: PlanWorkerGroupRef[]
  sourcesAdded: PlanSourceRef[]
  sourcesRemoved: PlanSourceRef[]
  sourcesReassigned: PlanSourceReassignment[]
  sourceVolumeCount: { before: number; after: number }
  activationWillReset: boolean
  hasStructuralChanges: boolean
}

function wgKey(kind: WorkerGroupKind, wg: string): string {
  return `${kind}\0${wg.trim().toLowerCase()}`
}

function wgNameById(plan: PlanState, workerGroupId: string): string {
  if (!workerGroupId) {
    return ''
  }
  const row = plan.workerGroups.find((w) => w.id === workerGroupId)
  return row?.wg.trim() ?? ''
}

function sourceKey(source: string, wgName: string): string {
  return `${source.trim().toLowerCase()}\0${wgName.trim().toLowerCase()}`
}

function indexWorkerGroups(rows: WorkerGroupRow[]): Map<string, WorkerGroupRow> {
  const m = new Map<string, WorkerGroupRow>()
  for (const row of rows) {
    m.set(wgKey(row.kind, row.wg), row)
  }
  return m
}

function indexSources(plan: PlanState): Map<string, { source: string; wg: string }> {
  const m = new Map<string, { source: string; wg: string }>()
  for (const row of plan.sourceSummary) {
    const wg = wgNameById(plan, row.workerGroupId)
    m.set(sourceKey(row.source, wg), { source: row.source.trim() || row.source, wg })
  }
  return m
}

function wgLabel(ref: PlanWorkerGroupRef): string {
  const kindLabel = ref.kind === 'edge' ? 'Edge fleet' : 'Stream worker group'
  return `${kindLabel} “${ref.wg}”`
}

function buildSummary(parts: string[]): string {
  if (parts.length === 0) {
    return 'No structural plan changes detected.'
  }
  if (parts.length === 1) {
    return parts[0]!
  }
  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}.`
  }
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}.`
}

/**
 * Entity-level diff between two plan states. Matches worker groups by kind + name
 * and sources by label + assigned worker group name (IDs may differ after topology import).
 */
export function computePlanImportDiff(
  current: PlanState,
  next: PlanState,
  opts?: { activationWillReset?: boolean },
): PlanImportDiff {
  const activationWillReset = opts?.activationWillReset === true
  const operations: string[] = []

  const customerNameChanged = current.customerName.trim() !== next.customerName.trim()
  if (customerNameChanged) {
    const from = current.customerName.trim() || '(empty)'
    const to = next.customerName.trim() || '(empty)'
    operations.push(`Customer name: “${from}” → “${to}”`)
  }

  const cseNotesChanged = current.cseNotes.trim() !== next.cseNotes.trim()
  if (cseNotesChanged) {
    operations.push('Plan notes (CSE notes) will change')
  }

  const currentWgs = indexWorkerGroups(current.workerGroups)
  const nextWgs = indexWorkerGroups(next.workerGroups)

  const workerGroupsAdded: PlanWorkerGroupRef[] = []
  const workerGroupsRemoved: PlanWorkerGroupRef[] = []

  for (const [key, row] of nextWgs) {
    if (!currentWgs.has(key)) {
      const ref = { wg: row.wg, kind: row.kind }
      workerGroupsAdded.push(ref)
      operations.push(`Add ${wgLabel(ref)}`)
    }
  }
  for (const [key, row] of currentWgs) {
    if (!nextWgs.has(key)) {
      const ref = { wg: row.wg, kind: row.kind }
      workerGroupsRemoved.push(ref)
      operations.push(`Remove ${wgLabel(ref)}`)
    }
  }

  const currentSources = indexSources(current)
  const nextSources = indexSources(next)

  const sourcesAdded: PlanSourceRef[] = []
  const sourcesRemoved: PlanSourceRef[] = []
  const sourcesReassigned: PlanSourceReassignment[] = []

  for (const [key, ref] of nextSources) {
    if (!currentSources.has(key)) {
      sourcesAdded.push(ref)
      const attach = ref.wg ? ` → “${ref.wg}”` : ' (unassigned)'
      operations.push(`Add source “${ref.source}”${attach}`)
    }
  }
  for (const [key, ref] of currentSources) {
    if (!nextSources.has(key)) {
      const removedByReassign = [...nextSources.values()].some(
        (n) => n.source.trim().toLowerCase() === ref.source.trim().toLowerCase() && n.wg !== ref.wg,
      )
      if (!removedByReassign) {
        sourcesRemoved.push(ref)
        const attach = ref.wg ? ` from “${ref.wg}”` : ' (unassigned)'
        operations.push(`Remove source “${ref.source}”${attach}`)
      }
    }
  }

  const reassignedLabels = new Set<string>()
  for (const [, nextRef] of nextSources) {
    const labelKey = nextRef.source.trim().toLowerCase()
    if (reassignedLabels.has(labelKey)) {
      continue
    }
    const currentMatch = [...currentSources.entries()].find(
      ([, c]) => c.source.trim().toLowerCase() === labelKey,
    )
    if (!currentMatch) {
      continue
    }
    const [, currentRef] = currentMatch
    if (currentRef.wg !== nextRef.wg) {
      reassignedLabels.add(labelKey)
      sourcesReassigned.push({
        source: nextRef.source,
        fromWg: currentRef.wg || '(unassigned)',
        toWg: nextRef.wg || '(unassigned)',
      })
      operations.push(
        `Reassign source “${nextRef.source}”: “${currentRef.wg || 'unassigned'}” → “${nextRef.wg || 'unassigned'}”`,
      )
    }
  }

  const sourceVolumeCount = {
    before: current.sourceVolume.length,
    after: next.sourceVolume.length,
  }
  if (sourceVolumeCount.before !== sourceVolumeCount.after) {
    operations.push(
      `Source volume rows: ${sourceVolumeCount.before} → ${sourceVolumeCount.after}`,
    )
  }

  if (activationWillReset) {
    operations.push('Activation tracker will reset to defaults (PS Use Case Worksheet)')
  }

  const hasStructuralChanges =
    customerNameChanged ||
    cseNotesChanged ||
    workerGroupsAdded.length > 0 ||
    workerGroupsRemoved.length > 0 ||
    sourcesAdded.length > 0 ||
    sourcesRemoved.length > 0 ||
    sourcesReassigned.length > 0 ||
    sourceVolumeCount.before !== sourceVolumeCount.after ||
    activationWillReset

  const summaryParts: string[] = []
  if (workerGroupsAdded.length > 0) {
    summaryParts.push(
      `${workerGroupsAdded.length} worker group${workerGroupsAdded.length === 1 ? '' : 's'} added`,
    )
  }
  if (workerGroupsRemoved.length > 0) {
    summaryParts.push(
      `${workerGroupsRemoved.length} worker group${workerGroupsRemoved.length === 1 ? '' : 's'} removed`,
    )
  }
  if (sourcesAdded.length > 0) {
    summaryParts.push(`${sourcesAdded.length} source${sourcesAdded.length === 1 ? '' : 's'} added`)
  }
  if (sourcesRemoved.length > 0) {
    summaryParts.push(`${sourcesRemoved.length} source${sourcesRemoved.length === 1 ? '' : 's'} removed`)
  }
  if (sourcesReassigned.length > 0) {
    summaryParts.push(
      `${sourcesReassigned.length} source${sourcesReassigned.length === 1 ? '' : 's'} reassigned`,
    )
  }
  if (customerNameChanged) {
    summaryParts.push('customer name changed')
  }
  if (cseNotesChanged) {
    summaryParts.push('plan notes changed')
  }
  if (sourceVolumeCount.before !== sourceVolumeCount.after) {
    summaryParts.push('source volume row count changed')
  }
  if (activationWillReset) {
    summaryParts.push('activation will reset')
  }

  return {
    summary: buildSummary(summaryParts),
    operations,
    customerNameChanged,
    cseNotesChanged,
    workerGroupsAdded,
    workerGroupsRemoved,
    sourcesAdded,
    sourcesRemoved,
    sourcesReassigned,
    sourceVolumeCount,
    activationWillReset,
    hasStructuralChanges,
  }
}
