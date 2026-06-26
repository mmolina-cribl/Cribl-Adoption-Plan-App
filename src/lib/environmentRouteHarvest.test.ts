import { describe, expect, it } from 'vitest'
import { flattenLeaderRoutesBody } from './environmentRouteHarvest'

describe('flattenLeaderRoutesBody', () => {
  it('returns nested routes from routing table items', () => {
    const body = {
      items: [
        {
          id: 'default',
          routes: [
            { id: 'default', filter: 'true', output: 'default:default' },
            { id: 'r2', filter: '__inputId=="x"', pipeline: 'main', output: 'devnull' },
          ],
        },
      ],
    }
    const flat = flattenLeaderRoutesBody(body)
    expect(flat).toHaveLength(2)
    expect((flat[0] as { id: string }).id).toBe('default')
  })

  it('returns routes array from GET /routes/default shape', () => {
    const body = {
      id: 'default',
      routes: [{ id: 'default', filter: true, output: 'default' }],
    }
    expect(flattenLeaderRoutesBody(body)).toHaveLength(1)
  })

  it('returns flat route items when already a route list', () => {
    const body = {
      items: [{ id: 'r1', filter: 'true', pipeline: 'main', output: 'devnull' }],
    }
    expect(flattenLeaderRoutesBody(body)).toHaveLength(1)
  })
})
