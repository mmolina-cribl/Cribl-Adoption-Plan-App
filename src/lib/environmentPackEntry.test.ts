import { describe, expect, it } from 'vitest'
import type { CriblEnvironmentGroup, CriblEnvironmentScope } from './criblEnvironmentTypes'
import {
  findPackEntryReferences,
  groupRoutesMissingBannerMessage,
  groupRoutesMissingHarvestWarning,
  likelyImplicitCriblDefaultRoute,
  packReachability,
  packRoutesMissingBannerMessage,
  packRoutesMissingHarvestWarning,
  resolveRoutePackPipelineTarget,
  resolveRoutePackTarget,
  scopeRoutesMissing,
} from './environmentPackEntry'

function criblScope(overrides?: Partial<CriblEnvironmentScope>): CriblEnvironmentScope {
  return {
    id: 'cribl',
    label: 'Worker group',
    kind: 'cribl',
    inputs: [],
    routes: [],
    pipelines: [],
    outputs: [],
    ...overrides,
  }
}

function packScope(id: string, overrides?: Partial<CriblEnvironmentScope>): CriblEnvironmentScope {
  return {
    id,
    label: id,
    kind: 'pack',
    inputs: [],
    routes: [],
    pipelines: [],
    outputs: [],
    ...overrides,
  }
}

function group(scopes: CriblEnvironmentScope[]): CriblEnvironmentGroup {
  return { id: 'wg', label: 'WG', kind: 'stream', scopes }
}

describe('resolveRoutePackPipelineTarget', () => {
  const known = new Set(['other_pack', 'beginner_lookup_host'])

  it('detects pack pipeline references but not destination-only output', () => {
    expect(resolveRoutePackPipelineTarget({ id: 'r1', pipeline: 'pack:beginner_lookup_host' }, known)).toBe(
      'beginner_lookup_host',
    )
    expect(resolveRoutePackPipelineTarget({ id: 'r1', output: 'other_pack' }, known)).toBeNull()
  })

  it('treats pack sentinel with output pack id as destination handoff, not pipeline processing', () => {
    expect(
      resolveRoutePackPipelineTarget(
        { id: 'routetopack', pipeline: 'pack', output: 'beginner_lookup_host' },
        known,
      ),
    ).toBeNull()
    expect(
      resolveRoutePackTarget(
        { id: 'routetopack', pipeline: 'pack', output: 'beginner_lookup_host' },
        known,
      ),
    ).toBe('beginner_lookup_host')
  })
})

describe('resolveRoutePackTarget', () => {
  const known = new Set(['other_pack', 'my_pack', 'beginner_lookup_host'])

  it('detects packId/pipeline qualified pipeline', () => {
    expect(resolveRoutePackTarget({ id: 'r1', pipeline: 'other_pack/other_main' }, known)).toBe(
      'other_pack',
    )
  })

  it('detects pack field in route config', () => {
    expect(
      resolveRoutePackTarget(
        { id: 'r1', pipeline: 'main', config: { pack: 'my_pack', context: 'pack' } },
        known,
      ),
    ).toBe('my_pack')
  })

  it('detects config.pack without pipeline field', () => {
    expect(resolveRoutePackTarget({ id: 'r1', config: { pack: 'my_pack' } }, known)).toBe('my_pack')
  })

  it('detects pipeline pack sentinel with output pack id', () => {
    expect(
      resolveRoutePackTarget(
        { id: 'routetopack', pipeline: 'pack', output: 'beginner_lookup_host' },
        known,
      ),
    ).toBe('beginner_lookup_host')
  })

  it('detects pack:packId pipeline format', () => {
    expect(
      resolveRoutePackTarget({ id: 'routetopack', pipeline: 'pack:beginner_lookup_host' }, known),
    ).toBe('beginner_lookup_host')
  })

  it('detects pack:packId:innerPipeline pipeline format', () => {
    expect(
      resolveRoutePackTarget(
        { id: 'routetopack', pipeline: 'pack:beginner_lookup_host:main' },
        known,
      ),
    ).toBe('beginner_lookup_host')
  })

  it('detects pack:packId with WG output default', () => {
    expect(
      resolveRoutePackTarget(
        { id: 'routetopack', pipeline: 'pack:beginner_lookup_host', output: 'default' },
        known,
      ),
    ).toBe('beginner_lookup_host')
  })

  it('detects packId:pipeline colon-qualified pipeline', () => {
    expect(resolveRoutePackTarget({ id: 'r1', pipeline: 'other_pack:other_main' }, known)).toBe(
      'other_pack',
    )
  })

  it('detects output-only pack target', () => {
    expect(resolveRoutePackTarget({ id: 'r1', output: 'other_pack' }, known)).toBe('other_pack')
  })

  it('returns null for unqualified WG pipeline', () => {
    expect(resolveRoutePackTarget({ id: 'r1', pipeline: 'cribl_main' }, known)).toBeNull()
  })

  it('does not treat output pack id as target when pipeline is explicit WG pipeline', () => {
    expect(
      resolveRoutePackTarget(
        { id: 'r1', pipeline: 'cribl_main', output: 'other_pack' },
        known,
      ),
    ).toBeNull()
  })
})

describe('packReachability', () => {
  it('marks pack referenced when WG route targets it', () => {
    const g = group([
      criblScope({
        routes: [{ id: 'wg_main', pipeline: 'other_pack/other_main' }],
      }),
      packScope('other_pack', { routes: [{ id: 'pr1' }] }),
    ])
    expect(packReachability(g, g.scopes[1]!)).toEqual({
      status: 'referenced',
      references: [
        expect.objectContaining({ routeId: 'wg_main', fromScopeId: 'cribl' }),
      ],
    })
  })

  it('marks local_inputs_only when pack has inputs but no WG entry', () => {
    const g = group([
      criblScope(),
      packScope('p1', { inputs: [{ id: 'pack_in' }], routes: [{ id: 'r1' }] }),
    ])
    expect(packReachability(g, g.scopes[1]!)).toEqual({ status: 'local_inputs_only' })
  })

  it('marks unreferenced when no WG route and no pack inputs', () => {
    const g = group([criblScope(), packScope('orphan', { routes: [{ id: 'r1' }] })])
    expect(packReachability(g, g.scopes[1]!)).toEqual({ status: 'unreferenced' })
    expect(findPackEntryReferences(g, 'orphan')).toEqual([])
  })
})

describe('packRoutesMissingHarvestWarning', () => {
  const pack = {
    inputs: [{ id: 'pack_in', type: 'syslog' }],
    routes: [] as [],
    pipelines: [{ id: 'main' }],
    outputs: [{ id: 'default', type: 'default' }],
  }

  it('mentions implicit default route and inputs.yml for packs with routing artifacts', () => {
    const msg = packRoutesMissingHarvestWarning('new_hire_bootcamp', 'beginner_extract_host', pack)
    expect(msg).toContain('Pack "beginner_extract_host"')
    expect(msg).toContain('pack inputs.yml')
    expect(msg).toContain('default catch-all route')
  })

  it('returns null when pack routes exist', () => {
    expect(
      packRoutesMissingHarvestWarning('wg1', 'my_pack', {
        ...pack,
        routes: [{ id: 'default', filter: 'true', pipeline: 'main', output: 'default' }],
      }),
    ).toBeNull()
  })
})

describe('packRoutesMissingBannerMessage', () => {
  it('warns on pack zoom when sources exist but routes do not', () => {
    const msg = packRoutesMissingBannerMessage(
      {
        inputs: [{ id: 'pack_in' }],
        routes: [],
        pipelines: [{ id: 'main' }],
        outputs: [{ id: 'default', type: 'default' }],
      },
      'diag',
    )
    expect(msg?.tone).toBe('amber')
    expect(msg?.message).toContain('pack inputs.yml')
  })

  it('returns null when pack has routes', () => {
    expect(
      packRoutesMissingBannerMessage(
        {
          inputs: [{ id: 'pack_in' }],
          routes: [{ id: 'default', filter: 'true', pipeline: 'main', output: 'default' }],
          pipelines: [],
          outputs: [],
        },
        'diag',
      ),
    ).toBeNull()
  })
})

describe('scopeRoutesMissing', () => {
  it('is true when inputs exist without routes', () => {
    expect(scopeRoutesMissing({ inputs: [{ id: 'in1' }], routes: [] })).toBe(true)
    expect(likelyImplicitCriblDefaultRoute({ inputs: [{ id: 'in1' }], routes: [], pipelines: [{ id: 'p1' }], outputs: [] })).toBe(
      true,
    )
  })
})

describe('groupRoutesMissingBannerMessage', () => {
  it('warns when product scope has inputs but no routes', () => {
    const g = group([criblScope({ inputs: [{ id: 'in1' }] })])
    const msg = groupRoutesMissingBannerMessage(g, 'diag')
    expect(msg?.tone).toBe('amber')
    expect(msg?.message).toContain('No worker group routes')
  })

  it('mentions implicit default route when pipelines exist but routes do not', () => {
    const g = group([
      criblScope({
        inputs: [{ id: 'in1' }],
        pipelines: [{ id: 'main' }],
        outputs: [{ id: 'default', type: 'default' }],
      }),
    ])
    expect(likelyImplicitCriblDefaultRoute(g.scopes[0]!)).toBe(true)
    const msg = groupRoutesMissingBannerMessage(g, 'diag')
    expect(msg?.message).toContain('default catch-all')
    expect(msg?.message).toContain('toggle default off and on')
  })

  it('returns null when routes exist', () => {
    const g = group([
      criblScope({
        inputs: [{ id: 'in1' }],
        routes: [{ id: 'default', filter: 'true', pipeline: 'main', output: 'default' }],
      }),
    ])
    expect(groupRoutesMissingBannerMessage(g, 'diag')).toBeNull()
  })
})

describe('groupRoutesMissingHarvestWarning', () => {
  const product = {
    inputs: [{ id: 'in1' }],
    routes: [] as [],
    pipelines: [{ id: 'main' }],
    outputs: [{ id: 'default', type: 'default' }],
  }

  it('uses worker group wording for stream groups', () => {
    const msg = groupRoutesMissingHarvestWarning('wg1', 'stream', product)
    expect(msg).toContain('Worker group "wg1"')
    expect(msg).toContain('worker group routes')
  })

  it('uses fleet wording for edge groups', () => {
    const msg = groupRoutesMissingHarvestWarning('default_fleet', 'edge', product)
    expect(msg).toContain('Fleet "default_fleet"')
    expect(msg).toContain('fleet routes')
    expect(msg).not.toContain('worker group')
  })

  it('names the scope folder in the generic fallback message', () => {
    const inputsOnly = {
      inputs: [{ id: 'in1' }],
      routes: [] as [],
      pipelines: [] as [],
      outputs: [] as [],
    }
    expect(groupRoutesMissingHarvestWarning('wg1', 'stream', inputsOnly)).toContain('cribl/')
    expect(groupRoutesMissingHarvestWarning('default_fleet', 'edge', inputsOnly)).toContain('edge/')
  })
})
