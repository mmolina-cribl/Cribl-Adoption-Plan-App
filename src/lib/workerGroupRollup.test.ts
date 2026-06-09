import { describe, expect, it } from 'vitest'
import { createEmptyPlan, defaultSourceRow, defaultWorkerGroupRow } from './defaultState'
import { sumAvgDailyFromSourceSummaryForWg } from './workerGroupRollup'

describe('sumAvgDailyFromSourceSummaryForWg', () => {
  it('counts every attached source; sums only rows with parseable avgDailyGb', () => {
    const plan = createEmptyPlan()
    const wg = defaultWorkerGroupRow('stream')
    plan.workerGroups = [wg]
    const wgId = wg.id
    const base = defaultSourceRow(0, wgId)
    plan.sourceSummary = [
      { ...base, id: 's1', source: 'a', avgDailyGb: '' },
      { ...base, id: 's2', source: 'b', avgDailyGb: '1.5' },
      { ...base, id: 's3', source: 'c', avgDailyGb: 'not-a-number' },
    ]
    const r = sumAvgDailyFromSourceSummaryForWg(plan, wgId)
    expect(r.count).toBe(3)
    expect(r.sum).toBeCloseTo(1.5, 5)
  })
})
