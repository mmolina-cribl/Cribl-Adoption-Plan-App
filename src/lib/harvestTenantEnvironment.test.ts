import { describe, expect, it } from 'vitest'
import {
  inferPackOutputsFromRoutes,
  leaderPackInputApiPaths,
  leaderPackPipelineApiPaths,
  leaderPackRouteApiPaths,
  leaderProductPipelineApiPaths,
} from './harvestTenantEnvironment'
import { packReachability } from './environmentPackEntry'
import type { CriblEnvironmentGroup, CriblEnvironmentScope } from './criblEnvironmentTypes'

describe('leaderProductPipelineApiPaths', () => {
  it('prefers /pipelines over legacy /system/pipelines', () => {
    const paths = leaderProductPipelineApiPaths('default')
    expect(paths[0]).toBe('/m/default/pipelines')
    expect(paths[1]).toBe('/m/default/system/pipelines')
  })
})

describe('leaderPackInputApiPaths', () => {
  it('prefers pack system/inputs endpoints used by the Leader API', () => {
    const paths = leaderPackInputApiPaths('New_Hire_Bootcamp', 'beginner_extract_host')
    expect(paths[0]).toBe('/m/New_Hire_Bootcamp/p/beginner_extract_host/system/inputs')
    expect(paths).toContain('/m/New_Hire_Bootcamp/packs/beginner_extract_host/system/inputs')
    expect(paths).toContain('/m/New_Hire_Bootcamp/p/beginner_extract_host/inputs')
  })
})

describe('inferPackOutputsFromRoutes', () => {
  it('collects unique output ids from pack routes', () => {
    const outputs = inferPackOutputsFromRoutes([
      { id: 'r1', output: 'default' },
      { id: 'r2', output: 'splunk' },
      { id: 'r3', output: 'default' },
    ])
    expect(outputs).toEqual([
      { id: 'default', type: 'default' },
      { id: 'splunk', type: undefined },
    ])
  })
})

describe('leaderPackRouteApiPaths', () => {
  it('prefers bare pack routes before system/routes fallback', () => {
    const paths = leaderPackRouteApiPaths('New_Hire_Bootcamp', 'beginner_extract_host')
    expect(paths[0]).toBe('/m/New_Hire_Bootcamp/p/beginner_extract_host/routes')
    expect(paths[1]).toBe('/m/New_Hire_Bootcamp/p/beginner_extract_host/routes/default')
    expect(paths[2]).toBe('/m/New_Hire_Bootcamp/p/beginner_extract_host/system/routes')
  })
})

describe('leaderPackPipelineApiPaths', () => {
  it('prefers bare pack pipelines before system/pipelines fallback', () => {
    const paths = leaderPackPipelineApiPaths('New_Hire_Bootcamp', 'beginner_mask_multiple_fields')
    expect(paths[0]).toBe('/m/New_Hire_Bootcamp/p/beginner_mask_multiple_fields/pipelines')
    expect(paths[1]).toBe('/m/New_Hire_Bootcamp/p/beginner_mask_multiple_fields/system/pipelines')
  })
})

describe('packReachability tenant/diag parity', () => {
  function packScope(inputs: CriblEnvironmentScope['inputs']): CriblEnvironmentGroup {
    return {
      id: 'new_hire_bootcamp',
      label: 'new_hire_bootcamp',
      kind: 'stream',
      scopes: [
        {
          id: 'cribl',
          label: 'Worker group',
          kind: 'cribl',
          inputs: [],
          routes: [],
          pipelines: [],
          outputs: [],
        },
        {
          id: 'beginner_extract_host',
          label: 'beginner_extract_host',
          kind: 'pack',
          inputs,
          routes: [{ id: 'pack_route', filter: 'true', pipeline: 'Extract_Field', output: 'default' }],
          pipelines: [{ id: 'Extract_Field' }],
          outputs: [{ id: 'default', type: 'default' }],
        },
      ],
    }
  }

  it('marks pack local_inputs_only when pack inputs are harvested', () => {
    const group = packScope([{ id: 'datagen', type: 'datagen' }])
    const pack = group.scopes.find((s) => s.id === 'beginner_extract_host')!
    expect(packReachability(group, pack).status).toBe('local_inputs_only')
  })

  it('marks pack unreferenced when tenant harvest omitted pack inputs', () => {
    const group = packScope([])
    const pack = group.scopes.find((s) => s.id === 'beginner_extract_host')!
    expect(packReachability(group, pack).status).toBe('unreferenced')
  })
})
