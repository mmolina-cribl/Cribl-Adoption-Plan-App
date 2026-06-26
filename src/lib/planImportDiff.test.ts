import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultSourceRow, defaultWorkerGroupRow } from './defaultState'
import { newId } from '../types/planTypes'
import { computePlanImportDiff } from './planImportDiff'

function planWithWg(wg: string, kind: 'stream' | 'edge' = 'stream') {
  const plan = createEmptyPlan()
  const row = { ...defaultWorkerGroupRow(kind), id: newId(), wg }
  plan.workerGroups.push(row)
  return { plan, wgId: row.id }
}

describe('computePlanImportDiff', () => {
  it('detects worker group add and remove', () => {
    const current = createEmptyPlan()
    const { plan: next, wgId } = planWithWg('prod')
    next.sourceSummary.push({
      ...defaultSourceRow(0, wgId),
      id: newId(),
      workerGroupId: wgId,
      source: 'syslog',
    })

    const diff = computePlanImportDiff(current, next)
    expect(diff.workerGroupsAdded).toHaveLength(1)
    expect(diff.workerGroupsAdded[0]?.wg).toBe('prod')
    expect(diff.sourcesAdded).toHaveLength(1)
    expect(diff.hasStructuralChanges).toBe(true)
    expect(diff.operations.some((o) => o.includes('Add Stream worker group'))).toBe(true)
  })

  it('detects customer name change', () => {
    const current = createEmptyPlan()
    current.customerName = 'Acme'
    const next = createEmptyPlan()
    next.customerName = 'Globex'

    const diff = computePlanImportDiff(current, next)
    expect(diff.customerNameChanged).toBe(true)
    expect(diff.operations[0]).toMatch(/Acme/)
    expect(diff.operations[0]).toMatch(/Globex/)
  })

  it('detects source reassignment between worker groups', () => {
    const current = createEmptyPlan()
    const wgA = { ...defaultWorkerGroupRow('stream'), id: newId(), wg: 'alpha' }
    const wgB = { ...defaultWorkerGroupRow('stream'), id: newId(), wg: 'beta' }
    current.workerGroups.push(wgA, wgB)
    current.sourceSummary.push({
      ...defaultSourceRow(0, wgA.id),
      id: newId(),
      workerGroupId: wgA.id,
      source: 'firewall-logs',
    })

    const next = createEmptyPlan()
    next.workerGroups.push({ ...wgA }, { ...wgB })
    next.sourceSummary.push({
      ...defaultSourceRow(0, wgB.id),
      id: newId(),
      workerGroupId: wgB.id,
      source: 'firewall-logs',
    })

    const diff = computePlanImportDiff(current, next)
    expect(diff.sourcesReassigned).toHaveLength(1)
    expect(diff.sourcesReassigned[0]?.fromWg).toBe('alpha')
    expect(diff.sourcesReassigned[0]?.toWg).toBe('beta')
  })

  it('flags activation reset for topology imports', () => {
    const current = createEmptyPlan()
    current.activation.tier = 'Gold'
    const next = createEmptyPlan()

    const diff = computePlanImportDiff(current, next, { activationWillReset: true })
    expect(diff.activationWillReset).toBe(true)
    expect(diff.operations.some((o) => o.includes('Activation tracker'))).toBe(true)
  })

  it('reports no structural changes for identical plans', () => {
    const { plan } = planWithWg('same')
    const diff = computePlanImportDiff(plan, { ...plan, workerGroups: plan.workerGroups.map((w) => ({ ...w })) })
    expect(diff.hasStructuralChanges).toBe(false)
    expect(diff.summary).toMatch(/No structural/)
  })
})
