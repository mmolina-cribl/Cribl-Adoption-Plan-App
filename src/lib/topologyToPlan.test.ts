import { describe, expect, it } from 'vitest'
import type { TenantHarvestResult } from './tenantHarvest'
import { topologyHarvestToPlanState } from './topologyToPlan'

describe('topologyHarvestToPlanState — Leader source names', () => {
  it('appends " disabled" to Source when the Leader input is disabled', () => {
    const harvest: TenantHarvestResult = {
      groups: [{ id: 'wg-acme', description: 'Acme Stream' }],
      inputsByGroup: {
        'wg-acme': [{ id: 'in_tcp', type: 'tcp', disabled: true }],
      },
      warnings: [],
    }
    const plan = topologyHarvestToPlanState(harvest)
    expect(plan.sourceSummary).toHaveLength(1)
    expect(plan.sourceSummary[0]!.source).toBe('in_tcp disabled')
    expect(plan.sourceSummary[0]!.leaderImportedDisabled).toBe(true)
  })

  it('does not append suffix when the Leader input is enabled', () => {
    const harvest: TenantHarvestResult = {
      groups: [{ id: 'wg-acme', description: 'Acme Stream' }],
      inputsByGroup: {
        'wg-acme': [{ id: 'in_tcp', type: 'tcp', disabled: false }],
      },
      warnings: [],
    }
    const plan = topologyHarvestToPlanState(harvest)
    expect(plan.sourceSummary[0]!.source).toBe('in_tcp')
    expect(plan.sourceSummary[0]!.leaderImportedDisabled).not.toBe(true)
  })

  it('uses Leader group id as worker group name, not description', () => {
    const harvest: TenantHarvestResult = {
      groups: [{ id: 'New_Hire_Bootcamp', description: 'New Hire Bootcamp' }],
      inputsByGroup: { New_Hire_Bootcamp: [] },
      warnings: [],
    }
    const plan = topologyHarvestToPlanState(harvest)
    expect(plan.workerGroups[0]!.wg).toBe('New_Hire_Bootcamp')
  })

  it('truncates base id so Source + " disabled" stays within 200 chars', () => {
    const longId = 'x'.repeat(200)
    const harvest: TenantHarvestResult = {
      groups: [{ id: 'wg', description: 'WG' }],
      inputsByGroup: {
        wg: [{ id: longId, type: 'tcp', disabled: true }],
      },
      warnings: [],
    }
    const plan = topologyHarvestToPlanState(harvest)
    const name = plan.sourceSummary[0]!.source
    expect(name).toMatch(/ disabled$/)
    expect(name.length).toBe(200)
  })
})
