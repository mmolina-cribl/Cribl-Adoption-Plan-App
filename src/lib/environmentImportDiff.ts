import type {
  CriblEnvironmentGroup,
  CriblEnvironmentScope,
  CriblEnvironmentScopeKind,
  CriblEnvironmentSnapshot,
} from './criblEnvironmentTypes'

export type ScopeEntityCounts = {
  inputs: number
  routes: number
  pipelines: number
  outputs: number
}

export type EnvironmentScopeDiff = {
  scopeId: string
  scopeLabel: string
  scopeKind: CriblEnvironmentScopeKind
  status: 'added' | 'removed' | 'changed' | 'unchanged'
  before?: ScopeEntityCounts
  after?: ScopeEntityCounts
}

export type EnvironmentGroupDiff = {
  groupId: string
  groupLabel: string
  kind?: 'stream' | 'edge'
  status: 'added' | 'removed' | 'changed' | 'unchanged'
  scopes: EnvironmentScopeDiff[]
}

export type EnvironmentImportDiff = {
  summary: string
  willClear: boolean
  currentSource: 'tenant' | 'diag' | null
  nextSource: 'tenant' | 'diag' | null
  capturedAtChanged: boolean
  groupsAdded: EnvironmentGroupDiff[]
  groupsRemoved: EnvironmentGroupDiff[]
  groupsChanged: EnvironmentGroupDiff[]
  snapshotTotals: { before: ScopeEntityCounts; after: ScopeEntityCounts }
  hasStructuralChanges: boolean
}

export function scopeEntityCounts(scope: CriblEnvironmentScope): ScopeEntityCounts {
  return {
    inputs: scope.inputs.length,
    routes: scope.routes.length,
    pipelines: scope.pipelines.length,
    outputs: scope.outputs.length,
  }
}

function emptyCounts(): ScopeEntityCounts {
  return { inputs: 0, routes: 0, pipelines: 0, outputs: 0 }
}

function addCounts(a: ScopeEntityCounts, b: ScopeEntityCounts): ScopeEntityCounts {
  return {
    inputs: a.inputs + b.inputs,
    routes: a.routes + b.routes,
    pipelines: a.pipelines + b.pipelines,
    outputs: a.outputs + b.outputs,
  }
}

function countsEqual(a: ScopeEntityCounts, b: ScopeEntityCounts): boolean {
  return (
    a.inputs === b.inputs &&
    a.routes === b.routes &&
    a.pipelines === b.pipelines &&
    a.outputs === b.outputs
  )
}

function sumSnapshotCounts(snapshot: CriblEnvironmentSnapshot | null): ScopeEntityCounts {
  if (!snapshot) {
    return emptyCounts()
  }
  let total = emptyCounts()
  for (const group of snapshot.groups) {
    for (const scope of group.scopes) {
      total = addCounts(total, scopeEntityCounts(scope))
    }
  }
  return total
}

function scopeDiffForAdded(scope: CriblEnvironmentScope): EnvironmentScopeDiff {
  return {
    scopeId: scope.id,
    scopeLabel: scope.label,
    scopeKind: scope.kind,
    status: 'added',
    after: scopeEntityCounts(scope),
  }
}

function scopeDiffForRemoved(scope: CriblEnvironmentScope): EnvironmentScopeDiff {
  return {
    scopeId: scope.id,
    scopeLabel: scope.label,
    scopeKind: scope.kind,
    status: 'removed',
    before: scopeEntityCounts(scope),
  }
}

function compareScopes(
  beforeGroup: CriblEnvironmentGroup | undefined,
  afterGroup: CriblEnvironmentGroup | undefined,
): EnvironmentScopeDiff[] {
  const beforeById = new Map((beforeGroup?.scopes ?? []).map((s) => [s.id, s]))
  const afterById = new Map((afterGroup?.scopes ?? []).map((s) => [s.id, s]))
  const scopeIds = new Set([...beforeById.keys(), ...afterById.keys()])
  const diffs: EnvironmentScopeDiff[] = []

  for (const scopeId of scopeIds) {
    const before = beforeById.get(scopeId)
    const after = afterById.get(scopeId)
    if (before && !after) {
      diffs.push(scopeDiffForRemoved(before))
      continue
    }
    if (!before && after) {
      diffs.push(scopeDiffForAdded(after))
      continue
    }
    if (before && after) {
      const beforeCounts = scopeEntityCounts(before)
      const afterCounts = scopeEntityCounts(after)
      const status = countsEqual(beforeCounts, afterCounts) ? 'unchanged' : 'changed'
      diffs.push({
        scopeId: after.id,
        scopeLabel: after.label,
        scopeKind: after.kind,
        status,
        before: beforeCounts,
        after: afterCounts,
      })
    }
  }

  return diffs.sort((a, b) => a.scopeId.localeCompare(b.scopeId))
}

function groupDiffFromScopes(
  group: CriblEnvironmentGroup,
  status: 'added' | 'removed',
): EnvironmentGroupDiff {
  return {
    groupId: group.id,
    groupLabel: group.label,
    kind: group.kind,
    status,
    scopes:
      status === 'added'
        ? group.scopes.map(scopeDiffForAdded)
        : group.scopes.map(scopeDiffForRemoved),
  }
}

function buildSummary(parts: string[]): string {
  if (parts.length === 0) {
    return 'No routing snapshot changes detected.'
  }
  if (parts.length === 1) {
    return parts[0]!
  }
  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}.`
  }
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}.`
}

export function computeEnvironmentImportDiff(
  current: CriblEnvironmentSnapshot | null,
  next: CriblEnvironmentSnapshot | null,
  opts?: { importClearsEnvironment?: boolean },
): EnvironmentImportDiff {
  const willClear = opts?.importClearsEnvironment === true && current != null

  if (willClear) {
    const beforeTotals = sumSnapshotCounts(current)
    return {
      summary: 'Current routing snapshot will be removed.',
      willClear: true,
      currentSource: current?.source ?? null,
      nextSource: null,
      capturedAtChanged: true,
      groupsAdded: [],
      groupsRemoved: (current?.groups ?? []).map((g) => groupDiffFromScopes(g, 'removed')),
      groupsChanged: [],
      snapshotTotals: { before: beforeTotals, after: emptyCounts() },
      hasStructuralChanges: true,
    }
  }

  const currentSource = current?.source ?? null
  const nextSource = next?.source ?? null
  const capturedAtChanged =
    (current?.capturedAt ?? '') !== (next?.capturedAt ?? '') || current == null !== (next == null)

  const currentById = new Map((current?.groups ?? []).map((g) => [g.id, g]))
  const nextById = new Map((next?.groups ?? []).map((g) => [g.id, g]))
  const groupIds = new Set([...currentById.keys(), ...nextById.keys()])

  const groupsAdded: EnvironmentGroupDiff[] = []
  const groupsRemoved: EnvironmentGroupDiff[] = []
  const groupsChanged: EnvironmentGroupDiff[] = []

  for (const groupId of [...groupIds].sort()) {
    const before = currentById.get(groupId)
    const after = nextById.get(groupId)
    if (before && !after) {
      groupsRemoved.push(groupDiffFromScopes(before, 'removed'))
      continue
    }
    if (!before && after) {
      groupsAdded.push(groupDiffFromScopes(after, 'added'))
      continue
    }
    if (before && after) {
      const scopes = compareScopes(before, after)
      const changedScopes = scopes.filter((s) => s.status !== 'unchanged')
      if (changedScopes.length > 0 || before.label !== after.label || before.kind !== after.kind) {
        groupsChanged.push({
          groupId: after.id,
          groupLabel: after.label,
          kind: after.kind,
          status: 'changed',
          scopes: changedScopes.length > 0 ? changedScopes : scopes.filter((s) => s.status === 'unchanged'),
        })
      }
    }
  }

  const snapshotTotals = {
    before: sumSnapshotCounts(current),
    after: sumSnapshotCounts(next),
  }

  const hasStructuralChanges =
    groupsAdded.length > 0 ||
    groupsRemoved.length > 0 ||
    groupsChanged.length > 0 ||
    current == null !== (next == null) ||
    !countsEqual(snapshotTotals.before, snapshotTotals.after)

  const summaryParts: string[] = []
  if (groupsAdded.length > 0) {
    summaryParts.push(`${groupsAdded.length} routing group${groupsAdded.length === 1 ? '' : 's'} added`)
  }
  if (groupsRemoved.length > 0) {
    summaryParts.push(`${groupsRemoved.length} routing group${groupsRemoved.length === 1 ? '' : 's'} removed`)
  }
  if (groupsChanged.length > 0) {
    summaryParts.push(`${groupsChanged.length} routing group${groupsChanged.length === 1 ? '' : 's'} changed`)
  }
  if (currentSource !== nextSource && nextSource) {
    summaryParts.push(`snapshot source will be ${nextSource}`)
  }
  if (capturedAtChanged && next?.capturedAt) {
    summaryParts.push('capture timestamp will update')
  }
  if (!hasStructuralChanges && next == null && current != null) {
    summaryParts.push('routing snapshot will be cleared')
  }

  return {
    summary: buildSummary(summaryParts),
    willClear: false,
    currentSource,
    nextSource,
    capturedAtChanged,
    groupsAdded,
    groupsRemoved,
    groupsChanged,
    snapshotTotals,
    hasStructuralChanges,
  }
}
