import { describe, expect, it } from 'vitest'
import { isLeaderOutpostGroup, isLeaderSearchGroup, isStockLeaderWorkerGroup, STOCK_LEADER_WORKER_GROUP_IDS } from './leaderStockGroups'

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

describe('isLeaderOutpostGroup', () => {
  it('flags default_outpost', () => {
    expect(isLeaderOutpostGroup({ id: 'default_outpost' })).toBe(true)
  })
})

describe('isLeaderSearchGroup', () => {
  it('flags default_search and Leader search metadata', () => {
    expect(isLeaderSearchGroup({ id: 'default_search' })).toBe(true)
    expect(isLeaderSearchGroup({ id: 'any', isSearch: true })).toBe(true)
    expect(isLeaderSearchGroup({ id: 'any', type: 'search' })).toBe(true)
    expect(isLeaderSearchGroup({ id: 'New_Hire_Bootcamp', type: 'stream' })).toBe(false)
  })
})
