import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultSourceRow, defaultWorkerGroupRow } from './defaultState'
import { validatePlanPatchProposal } from './planPatchApply'

describe('validatePlanPatchProposal', () => {
  it('adds Edge fleet then two sources by workerGroupWg', () => {
    const plan = createEmptyPlan()
    const r = validatePlanPatchProposal(plan, [
      { op: 'addWorkerGroup', kind: 'edge', wg: 'test fleet' },
      { op: 'addSource', source: 's3', workerGroupWg: 'test fleet' },
      { op: 'addSource', source: 'syslog', workerGroupWg: 'test fleet' },
    ], 'Add fleet and sources')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.nextPlan.workerGroups).toHaveLength(1)
    expect(r.nextPlan.workerGroups[0]!.wg).toBe('test fleet')
    expect(r.nextPlan.workerGroups[0]!.kind).toBe('edge')
    expect(r.nextPlan.sourceSummary).toHaveLength(2)
    expect(r.nextPlan.sourceSummary[0]!.source).toBe('s3')
    expect(r.nextPlan.sourceSummary[0]!.workerGroupId).toBe(r.nextPlan.workerGroups[0]!.id)
    expect(r.nextPlan.sourceSummary[0]!.streamOrEdge).toBe('Edge')
    expect(r.nextPlan.sourceSummary[1]!.streamOrEdge).toBe('Edge')
  })

  it('rejects duplicate worker group name', () => {
    const plan = createEmptyPlan()
    plan.workerGroups = [defaultWorkerGroupRow('stream')]
    plan.workerGroups[0]!.wg = 'WG1'
    const r = validatePlanPatchProposal(plan, [{ op: 'addWorkerGroup', kind: 'stream', wg: 'wg1' }], 'dup')
    expect('error' in r).toBe(true)
    if (!('error' in r)) return
    expect(r.error).toMatch(/already exists/i)
  })

  it('setSourceWorkerGroup updates streamOrEdge when crossing Stream to Edge', () => {
    const plan = createEmptyPlan()
    const wgS = defaultWorkerGroupRow('stream')
    wgS.wg = 'S'
    const wgE = defaultWorkerGroupRow('edge')
    wgE.wg = 'E'
    plan.workerGroups = [wgS, wgE]
    const row = defaultSourceRow(0, wgS.id)
    row.id = 'src1'
    row.source = 'logs'
    row.streamOrEdge = 'Stream'
    plan.sourceSummary = [row]

    const r = validatePlanPatchProposal(
      plan,
      [{ op: 'setSourceWorkerGroup', sourceId: 'src1', workerGroupWg: 'E' }],
      'move to edge',
    )
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.nextPlan.sourceSummary[0]!.workerGroupId).toBe(wgE.id)
    expect(r.nextPlan.sourceSummary[0]!.streamOrEdge).toBe('Edge')
  })

  it('rejects addSource with unknown worker group name', () => {
    const plan = createEmptyPlan()
    const r = validatePlanPatchProposal(plan, [{ op: 'addSource', source: 'x', workerGroupWg: 'nope' }], 'bad')
    expect('error' in r).toBe(true)
    if (!('error' in r)) return
    expect(r.error).toMatch(/Unknown worker group name/)
  })

  it('rejects too many addSource ops', () => {
    const plan = createEmptyPlan()
    const ops = Array.from({ length: 31 }, (_, i) => ({
      op: 'addSource' as const,
      source: `s${i}`,
    }))
    const r = validatePlanPatchProposal(plan, ops, 'too many')
    expect('error' in r).toBe(true)
  })

  it('addWorkerGroup edge sub-fleet requires top-level parent', () => {
    const plan = createEmptyPlan()
    const parent = defaultWorkerGroupRow('edge')
    parent.wg = 'parent'
    const sub = defaultWorkerGroupRow('edge')
    sub.wg = 'child'
    sub.parentFleetId = parent.id
    plan.workerGroups = [parent, sub]
    const r = validatePlanPatchProposal(
      plan,
      [{ op: 'addWorkerGroup', kind: 'edge', wg: 'grand', parentFleetId: sub.id }],
      'nested',
    )
    expect('error' in r).toBe(true)
    if (!('error' in r)) return
    expect(r.error).toMatch(/top-level/i)
  })

  it('allows Edge sub-fleet under top-level parent', () => {
    const plan = createEmptyPlan()
    const parent = defaultWorkerGroupRow('edge')
    parent.wg = 'parent'
    plan.workerGroups = [parent]
    const r = validatePlanPatchProposal(
      plan,
      [{ op: 'addWorkerGroup', kind: 'edge', wg: 'child', parentFleetId: parent.id }],
      'sub',
    )
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.nextPlan.workerGroups).toHaveLength(2)
    expect(r.nextPlan.workerGroups[1]!.parentFleetId).toBe(parent.id)
  })
})
