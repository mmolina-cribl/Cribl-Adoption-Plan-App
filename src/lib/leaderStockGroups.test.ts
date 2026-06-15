import { describe, expect, it } from 'vitest'
import { isStockLeaderWorkerGroup, STOCK_LEADER_WORKER_GROUP_IDS } from './leaderStockGroups'

describe('isStockLeaderWorkerGroup', () => {
  it('flags Cribl built-in group ids', () => {
    for (const id of STOCK_LEADER_WORKER_GROUP_IDS) {
      expect(isStockLeaderWorkerGroup({ id })).toBe(true)
    }
  })

  it('allows typical customer group ids', () => {
    expect(isStockLeaderWorkerGroup({ id: 'my-wg-1' })).toBe(false)
    expect(isStockLeaderWorkerGroup({ id: 'prod-stream' })).toBe(false)
    expect(isStockLeaderWorkerGroup({ id: '' })).toBe(false)
  })
})
