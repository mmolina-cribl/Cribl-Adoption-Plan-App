import { describe, expect, it } from 'vitest'
import { buildExecutiveSourcesInventoryAoA, buildExecutiveSnapshot } from './executiveSnapshot'
import type { PlanState } from '../types/planTypes'
import { createEmptyPlan } from './defaultState'

describe('buildExecutiveSourcesInventoryAoA', () => {
  it('matches the Summary table columns and strips display dashes', () => {
    const plan: PlanState = {
      ...createEmptyPlan(),
      customerName: 'Acme',
      sourceSummary: [
        {
          ...createEmptyPlan().sourceSummary[0]!,
          id: 's1',
          source: 'logs disabled',
          leaderImportedDisabled: true,
          sourceTile: 'Syslog',
          avgDailyGb: '12',
          streamOrEdge: 'Stream',
          blockers: 'Firewall',
        },
      ],
    }
    const snap = buildExecutiveSnapshot(plan)
    const aoa = buildExecutiveSourcesInventoryAoA(snap)
    expect(aoa[0]).toEqual([
      'Source',
      'Tile',
      'State',
      'GB/d',
      'WG / fleet',
      'Stream/Edge',
      'Blockers',
    ])
    expect(aoa[1]).toEqual(['logs', 'Syslog', 'Disabled', '12', '', 'Stream', 'Firewall'])
  })
})
