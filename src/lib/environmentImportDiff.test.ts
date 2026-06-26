import { describe, expect, it } from 'vitest'
import type { CriblEnvironmentGroup, CriblEnvironmentScope, CriblEnvironmentSnapshot } from './criblEnvironmentTypes'
import { computeEnvironmentImportDiff, scopeEntityCounts } from './environmentImportDiff'

function scope(
  id: string,
  kind: CriblEnvironmentScope['kind'],
  counts: { inputs?: number; routes?: number; pipelines?: number; outputs?: number },
): CriblEnvironmentScope {
  const n = (k: keyof typeof counts) => counts[k] ?? 0
  return {
    id,
    label: id,
    kind,
    inputs: Array.from({ length: n('inputs') }, (_, i) => ({ id: `${id}-in-${i}` })),
    routes: Array.from({ length: n('routes') }, (_, i) => ({ id: `${id}-rt-${i}` })),
    pipelines: Array.from({ length: n('pipelines') }, (_, i) => ({ id: `${id}-pl-${i}` })),
    outputs: Array.from({ length: n('outputs') }, (_, i) => ({ id: `${id}-out-${i}` })),
  }
}

function group(id: string, scopes: CriblEnvironmentScope[]): CriblEnvironmentGroup {
  return { id, label: id, kind: 'stream', scopes }
}

const snap = (groups: CriblEnvironmentGroup[], source: 'diag' | 'tenant' = 'diag'): CriblEnvironmentSnapshot => ({
  capturedAt: '2026-01-01T12:00:00.000Z',
  source,
  warnings: [],
  groups,
})

describe('scopeEntityCounts', () => {
  it('counts entities in a scope', () => {
    expect(scopeEntityCounts(scope('cribl', 'cribl', { inputs: 2, routes: 1 }))).toEqual({
      inputs: 2,
      routes: 1,
      pipelines: 0,
      outputs: 0,
    })
  })
})

describe('computeEnvironmentImportDiff', () => {
  it('detects added and removed groups', () => {
    const current = snap([group('a', [scope('cribl', 'cribl', { inputs: 1 })])])
    const next = snap([group('b', [scope('cribl', 'cribl', { inputs: 2 })])])

    const diff = computeEnvironmentImportDiff(current, next)
    expect(diff.groupsRemoved).toHaveLength(1)
    expect(diff.groupsRemoved[0]?.groupId).toBe('a')
    expect(diff.groupsAdded).toHaveLength(1)
    expect(diff.groupsAdded[0]?.groupId).toBe('b')
    expect(diff.hasStructuralChanges).toBe(true)
  })

  it('detects scope count changes including packs', () => {
    const current = snap([
      group('wg1', [
        scope('cribl', 'cribl', { inputs: 1, routes: 0 }),
        scope('my-pack', 'pack', { routes: 1, pipelines: 2 }),
      ]),
    ])
    const next = snap([
      group('wg1', [
        scope('cribl', 'cribl', { inputs: 2, routes: 1 }),
        scope('my-pack', 'pack', { routes: 1, pipelines: 3 }),
      ]),
    ])

    const diff = computeEnvironmentImportDiff(current, next)
    expect(diff.groupsChanged).toHaveLength(1)
    const scopes = diff.groupsChanged[0]?.scopes ?? []
    expect(scopes.some((s) => s.scopeId === 'cribl' && s.status === 'changed')).toBe(true)
    expect(scopes.some((s) => s.scopeId === 'my-pack' && s.status === 'changed')).toBe(true)
  })

  it('reports clear-on-excel when importClearsEnvironment', () => {
    const current = snap([group('a', [scope('cribl', 'cribl', { routes: 2 })])])
    const diff = computeEnvironmentImportDiff(current, null, { importClearsEnvironment: true })
    expect(diff.willClear).toBe(true)
    expect(diff.summary).toMatch(/removed/)
    expect(diff.groupsRemoved).toHaveLength(1)
    expect(diff.snapshotTotals.after).toEqual({ inputs: 0, routes: 0, pipelines: 0, outputs: 0 })
  })

  it('reports no structural changes for identical snapshots', () => {
    const s = snap([group('a', [scope('cribl', 'cribl', { inputs: 1 })])])
    const diff = computeEnvironmentImportDiff(s, { ...s, groups: s.groups.map((g) => ({ ...g, scopes: g.scopes.map((sc) => ({ ...sc })) })) })
    expect(diff.hasStructuralChanges).toBe(false)
  })
})
