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
