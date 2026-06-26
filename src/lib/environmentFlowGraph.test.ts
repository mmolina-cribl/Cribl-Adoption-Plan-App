import { describe, expect, it } from 'vitest'
import type { CriblEnvironmentGroup, CriblEnvironmentScope, CriblEnvironmentSnapshot } from './criblEnvironmentTypes'
import {
  applyRoutingFocusHighlight,
  buildEnvironmentFlowGraph,
  buildEnvironmentGroupListGraph,
  buildEnvironmentGroupRoutingGraph,
  buildEnvironmentKindPickerGraph,
  buildEnvironmentMapGraph,
  environmentMapBreadcrumb,
  focusedRoutingNodeIds,
  isCatchAllRouteFilter,
  mergeNodePositions,
  resolveRoutePipelineOutput,
} from './environmentFlowGraph'

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

function sampleGroup(overrides?: Partial<CriblEnvironmentGroup>): CriblEnvironmentGroup {
  return {
    id: 'wg1',
    label: 'WG1',
    kind: 'stream',
    scopes: [criblScope()],
    ...overrides,
  }
}

function sampleSnapshot(groups: CriblEnvironmentGroup[]): CriblEnvironmentSnapshot {
  return {
    capturedAt: '2026-01-01T00:00:00.000Z',
    source: 'diag',
    warnings: [],
    groups,
  }
}

function newHireBootcampGroup(): CriblEnvironmentGroup {
  return sampleGroup({
    id: 'new_hire_bootcamp',
    label: 'new_hire_bootcamp',
    scopes: [
      criblScope({
        inputs: [{ id: 'in_syslog', type: 'syslog' }],
        pipelines: [{ id: 'cribl_main' }],
        outputs: [{ id: 'devnull', type: 'devnull' }],
        routes: [
          { id: 'wg_main', filter: 'true', pipeline: 'cribl_main', output: 'devnull' },
          { id: 'to_pack', filter: 'true', pipeline: 'other_pack/other_main' },
        ],
      }),
      packScope('beginner_mask_multiple_fields', {
        inputs: [{ id: 'pack_in', type: 'syslog' }],
        routes: [{ id: 'pack_mask', filter: 'true', pipeline: 'mask_fields', output: 'pack_out' }],
        pipelines: [{ id: 'mask_fields' }, { id: 'extra_pipeline' }],
        outputs: [{ id: 'pack_out', type: 'devnull' }],
      }),
      packScope('other_pack', {
        routes: [{ id: 'pack_other', filter: 'true', pipeline: 'other_main', output: 'devnull' }],
        pipelines: [{ id: 'other_main' }],
        outputs: [{ id: 'devnull', type: 'devnull' }],
      }),
      packScope('beginner_lookup_host', {
        routes: [{ id: 'pack_lookup', filter: 'true', pipeline: 'lookup_main', output: 'devnull' }],
        pipelines: [{ id: 'lookup_main' }],
        outputs: [{ id: 'devnull', type: 'devnull' }],
      }),
    ],
  })
}

function newHireBootcampGroupWithPackSentinelRoute(): CriblEnvironmentGroup {
  const base = newHireBootcampGroup()
  return {
    ...base,
    scopes: base.scopes.map((scope) => {
      if (scope.id !== 'cribl') {
        return scope
      }
      return {
        ...scope,
        routes: [
          ...scope.routes,
          { id: 'routetopack', filter: 'true', pipeline: 'pack:beginner_lookup_host', output: 'default' },
        ],
      }
    }),
  }
}

function focusFixture() {
  const scope = criblScope({
    inputs: [
      { id: 'in1', type: 'syslog' },
      { id: 'in2', type: 'http' },
    ],
    pipelines: [{ id: 'main' }],
    outputs: [
      { id: 'linked', type: 'devnull' },
      { id: 'orphan', type: 's3' },
    ],
    routes: [{ id: 'r1', filter: 'true', pipeline: 'main', output: 'linked' }],
  })
  return buildEnvironmentFlowGraph(scope, sampleGroup({ id: 'wg', scopes: [scope] }))
}

describe('buildEnvironmentKindPickerGraph', () => {
  it('has two navigable kind picker nodes', () => {
    const snap = sampleSnapshot([
      sampleGroup({ id: 'wg1' }),
      sampleGroup({ id: 'fl1', label: 'FL1', kind: 'edge' }),
    ])
    const { nodes } = buildEnvironmentKindPickerGraph(snap.groups)
    expect(nodes).toHaveLength(2)
  })
})

describe('buildEnvironmentGroupListGraph', () => {
  it('filters to stream worker groups only', () => {
    const snap = sampleSnapshot([
      sampleGroup({ id: 'wg1' }),
      sampleGroup({ id: 'fl1', label: 'FL1', kind: 'edge' }),
    ])
    const { nodes } = buildEnvironmentGroupListGraph(snap.groups, 'stream')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.data.navAction).toEqual({ type: 'group', groupId: 'wg1' })
  })
})

describe('buildEnvironmentGroupRoutingGraph', () => {
  it('places referenced pack nodes on the pipeline tier', () => {
    const group = newHireBootcampGroup()
    const { nodes } = buildEnvironmentGroupRoutingGraph(group)
    expect(nodes.some((n) => n.id === 'pack:other_pack')).toBe(true)
    const packNode = nodes.find((n) => n.id === 'pack:other_pack')!
    const wgPipeline = nodes.find((n) => n.id === 'pl:cribl_main')!
    expect(packNode.position.y).toBe(wgPipeline.position.y)
    expect(packNode.data.packPlacement).toBe('pipeline')
  })

  it('places unreferenced pack nodes at the top row', () => {
    const group = newHireBootcampGroup()
    const { nodes } = buildEnvironmentGroupRoutingGraph(group)
    expect(nodes.some((n) => n.id === 'pack:beginner_mask_multiple_fields')).toBe(true)
    const orphanPack = nodes.find((n) => n.id === 'pack:beginner_mask_multiple_fields')!
    const input = nodes.find((n) => n.id === 'in:in_syslog')!
    expect(orphanPack.position.y).toBeLessThan(input.position.y)
    expect(orphanPack.data.packPlacement).toBe('top')
    expect(orphanPack.data.packReachabilityStatus).toBe('local_inputs_only')
  })

  it('labels local-input packs as Local pack and route-only packs as unreferenced', () => {
    const group = newHireBootcampGroup()
    const { nodes } = buildEnvironmentGroupRoutingGraph(group)
    expect(nodes.find((n) => n.id === 'pack:beginner_mask_multiple_fields')?.data.packReachabilityStatus).toBe(
      'local_inputs_only',
    )
    expect(nodes.find((n) => n.id === 'pack:beginner_lookup_host')?.data.packReachabilityStatus).toBe(
      'unreferenced',
    )
    expect(nodes.find((n) => n.id === 'pack:other_pack')?.data.packReachabilityStatus).toBe('referenced')
  })

  it('connects WG route to referenced pack', () => {
    const group = newHireBootcampGroup()
    const { edges } = buildEnvironmentGroupRoutingGraph(group)
    expect(edges.some((e) => e.source === 'rt:to_pack' && e.target === 'pack:other_pack')).toBe(true)
  })

  it('does not connect unreferenced pack to routes', () => {
    const group = newHireBootcampGroup()
    const { edges } = buildEnvironmentGroupRoutingGraph(group)
    expect(edges.some((e) => e.target === 'pack:beginner_mask_multiple_fields')).toBe(false)
  })

  it('labels WG routes that target a pack', () => {
    const group = newHireBootcampGroup()
    const { nodes } = buildEnvironmentGroupRoutingGraph(group)
    const route = nodes.find((n) => n.id === 'rt:to_pack')
    expect(route?.data.sublabel).toContain('→ pack: other_pack')
  })

  it('pack nodes have pack nav action', () => {
    const group = newHireBootcampGroup()
    const { nodes } = buildEnvironmentGroupRoutingGraph(group)
    expect(nodes.find((n) => n.id === 'pack:other_pack')?.data.navAction).toEqual({
      type: 'pack',
      groupId: 'new_hire_bootcamp',
      packId: 'other_pack',
    })
  })

  it('maps pipeline pack sentinel routes to pack nodes on the pipeline tier', () => {
    const group = newHireBootcampGroupWithPackSentinelRoute()
    const { nodes, edges } = buildEnvironmentGroupRoutingGraph(group)
    expect(edges.some((e) => e.source === 'rt:routetopack' && e.target === 'pack:beginner_lookup_host')).toBe(
      true,
    )
    expect(nodes.some((n) => n.id === 'pl:pack')).toBe(false)
    expect(nodes.some((n) => n.id === 'out:beginner_lookup_host')).toBe(false)
    const packNode = nodes.find((n) => n.id === 'pack:beginner_lookup_host')!
    expect(packNode.data.packPlacement).toBe('pipeline')
    const wgPipeline = nodes.find((n) => n.id === 'pl:cribl_main')!
    expect(packNode.position.y).toBe(wgPipeline.position.y)
    const route = nodes.find((n) => n.id === 'rt:routetopack')
    expect(route?.data.sublabel).toContain('→ pack: beginner_lookup_host')
  })

  it('links processing pack routes to the global route destination', () => {
    const group = newHireBootcampGroupWithPackSentinelRoute()
    const { edges } = buildEnvironmentGroupRoutingGraph(group)
    expect(
      edges.some((e) => e.source === 'pack:beginner_lookup_host' && e.target === 'out:default'),
    ).toBe(true)
  })

  it('links processing pack routes when destination is default:default', () => {
    const group = newHireBootcampGroupWithPackSentinelRoute()
    const cribl = group.scopes.find((s) => s.id === 'cribl')!
    const routes = cribl.routes.map((r) =>
      r.id === 'routetopack' ? { ...r, output: 'default:default' } : r,
    )
    const patched = {
      ...group,
      scopes: group.scopes.map((s) =>
        s.id === 'cribl' ? { ...s, routes, outputs: [...s.outputs, { id: 'default', type: 'default' }] } : s,
      ),
    }
    const { edges } = buildEnvironmentGroupRoutingGraph(patched)
    expect(
      edges.some((e) => e.source === 'pack:beginner_lookup_host' && e.target === 'out:default'),
    ).toBe(true)
  })

  it('does not link destination-pack routes to a separate global output', () => {
    const group = newHireBootcampGroup()
    const patched = {
      ...group,
      scopes: group.scopes.map((s) =>
        s.id === 'cribl'
          ? {
              ...s,
              routes: [...s.routes, { id: 'dest_pack', filter: 'true', output: 'other_pack' }],
            }
          : s,
      ),
    }
    const { edges } = buildEnvironmentGroupRoutingGraph(patched)
    expect(edges.some((e) => e.source === 'rt:dest_pack' && e.target === 'pack:other_pack')).toBe(true)
    expect(edges.some((e) => e.source === 'pack:other_pack' && e.target.startsWith('out:'))).toBe(false)
  })

  it('wires route to pack when route id differs from display name', () => {
    const group = newHireBootcampGroupWithPackSentinelRoute()
    const cribl = group.scopes.find((s) => s.id === 'cribl')!
    const routes = cribl.routes.map((r) =>
      r.id === 'routetopack'
        ? { ...r, id: 'GxKwCs', name: 'routetopack', pipeline: 'pack:beginner_lookup_host', output: 'default' }
        : r,
    )
    const patched = {
      ...group,
      scopes: group.scopes.map((s) => (s.id === 'cribl' ? { ...s, routes } : s)),
    }
    const { edges } = buildEnvironmentGroupRoutingGraph(patched)
    expect(edges.some((e) => e.source === 'rt:GxKwCs' && e.target === 'pack:beginner_lookup_host')).toBe(true)
  })
})

describe('buildEnvironmentMapGraph', () => {
  const snap = sampleSnapshot([newHireBootcampGroup()])

  it('returns group routing map at group level', () => {
    const { nodes } = buildEnvironmentMapGraph(
      { step: 'group', kind: 'stream', groupId: 'new_hire_bootcamp' },
      snap,
    )
    expect(nodes.some((n) => n.data.nodeKind === 'route')).toBe(true)
    expect(nodes.some((n) => n.data.nodeKind === 'pack')).toBe(true)
  })

  it('returns pack zoom graph at pack level', () => {
    const { nodes } = buildEnvironmentMapGraph(
      { step: 'pack', kind: 'stream', groupId: 'new_hire_bootcamp', packId: 'other_pack' },
      snap,
    )
    expect(nodes.some((n) => n.id === 'rt:pack_other')).toBe(true)
    expect(nodes.some((n) => n.id === 'ingress:worker-group')).toBe(false)
  })

  it('routing nodes carry scoped entityRef on group map', () => {
    const scope = criblScope({
      inputs: [{ id: 'in1', type: 'syslog' }],
      pipelines: [{ id: 'main' }],
      outputs: [{ id: 'devnull', type: 'devnull' }],
      routes: [{ id: 'r1', filter: 'true', pipeline: 'main', output: 'devnull' }],
    })
    const group = sampleGroup({ scopes: [scope] })
    const { nodes } = buildEnvironmentGroupRoutingGraph(group)
    expect(nodes.find((n) => n.id === 'in:in1')?.data.entityRef).toEqual({
      groupId: 'wg1',
      scopeId: 'cribl',
      entity: 'input',
      id: 'in1',
    })
  })

  it('lays out routing in fixed horizontal tiers', () => {
    const scope = criblScope({
      inputs: [
        { id: 'in1', type: 'syslog' },
        { id: 'in2', type: 'http' },
      ],
      pipelines: [{ id: 'main' }],
      outputs: [
        { id: 'linked', type: 'devnull' },
        { id: 'orphan', type: 's3' },
      ],
      routes: [{ id: 'r1', filter: 'true', pipeline: 'main', output: 'linked' }],
    })
    const group = sampleGroup({ id: 'wg', scopes: [scope] })
    const { nodes } = buildEnvironmentFlowGraph(scope, group)

    const in1 = nodes.find((n) => n.id === 'in:in1')!
    const route = nodes.find((n) => n.id === 'rt:r1')!
    const pipeline = nodes.find((n) => n.id === 'pl:main')!
    const linked = nodes.find((n) => n.id === 'out:linked')!

    expect(route.position.y).toBeGreaterThan(in1.position.y)
    expect(pipeline.position.y).toBeGreaterThan(route.position.y)
    expect(linked.position.y).toBeGreaterThan(pipeline.position.y)
  })
})

describe('focusedRoutingNodeIds', () => {
  it('focuses route pipeline and destination when a pipeline is selected', () => {
    const { nodes, edges } = focusFixture()
    const focused = focusedRoutingNodeIds('pl:main', nodes, edges)
    expect([...focused].sort()).toEqual(['out:linked', 'pl:main', 'rt:r1'])
  })

  it('focuses full downstream path when an input is selected', () => {
    const { nodes, edges } = focusFixture()
    const focused = focusedRoutingNodeIds('in:in1', nodes, edges)
    expect([...focused].sort()).toEqual(['in:in1', 'out:linked', 'pl:main', 'rt:r1'])
  })
})

describe('applyRoutingFocusHighlight', () => {
  it('dims nodes outside the focused routing path', () => {
    const { nodes, edges } = focusFixture()
    const { nodes: highlighted } = applyRoutingFocusHighlight(nodes, edges, 'pl:main')
    expect(highlighted.find((n) => n.id === 'in:in1')?.data.focusDimmed).toBe(true)
    expect(highlighted.find((n) => n.id === 'rt:r1')?.data.focusDimmed).toBe(false)
  })
})

describe('environmentMapBreadcrumb', () => {
  it('labels pack zoom breadcrumb with Pack badge', () => {
    const snapshot = sampleSnapshot([newHireBootcampGroup()])
    const crumbs = environmentMapBreadcrumb(
      { step: 'pack', kind: 'stream', groupId: 'new_hire_bootcamp', packId: 'other_pack' },
      snapshot,
    )
    const last = crumbs[crumbs.length - 1]
    expect(last.label).toBe('other_pack')
    expect(last.scopeBadge).toBe('Pack')
  })

  it('group breadcrumb ends at group name', () => {
    const snapshot = sampleSnapshot([newHireBootcampGroup()])
    const crumbs = environmentMapBreadcrumb(
      { step: 'group', kind: 'stream', groupId: 'new_hire_bootcamp' },
      snapshot,
    )
    expect(crumbs[crumbs.length - 1]?.label).toBe('new_hire_bootcamp')
    expect(crumbs[crumbs.length - 1]?.scopeBadge).toBeUndefined()
  })
})

describe('isCatchAllRouteFilter', () => {
  it('matches true string variants', () => {
    expect(isCatchAllRouteFilter('true')).toBe(true)
    expect(isCatchAllRouteFilter(' true ')).toBe(true)
    expect(isCatchAllRouteFilter('TRUE')).toBe(true)
    expect(isCatchAllRouteFilter('level != "debug"')).toBe(false)
    expect(isCatchAllRouteFilter(undefined)).toBe(false)
  })
})

describe('resolveRoutePipelineOutput', () => {
  it('splits default:default destination into pipeline and output ids', () => {
    expect(resolveRoutePipelineOutput({ id: 'default', filter: 'true', output: 'default:default' })).toEqual({
      pipelineId: 'default',
      outputId: 'default',
    })
  })

  it('reads destination field from route config when output is absent', () => {
    expect(
      resolveRoutePipelineOutput({
        id: 'default',
        filter: 'true',
        config: { destination: 'default:default' },
      }),
    ).toEqual({ pipelineId: 'default', outputId: 'default' })
  })

  it('does not split pack pipeline paths', () => {
    expect(
      resolveRoutePipelineOutput({ id: 'to_pack', filter: 'true', pipeline: 'other_pack/other_main' }),
    ).toEqual({ pipelineId: 'other_pack/other_main', outputId: undefined })
  })

  it('does not split pack:packId pipeline sentinel into pipeline and output', () => {
    expect(
      resolveRoutePipelineOutput({
        id: 'routetopack',
        filter: 'true',
        pipeline: 'pack:beginner_lookup_host',
        output: 'default',
      }),
    ).toEqual({ pipelineId: 'pack:beginner_lookup_host', outputId: 'default' })
  })
})

describe('catch-all route fan-in edges', () => {
  it('connects all inputs to catch-all routes in same scope', () => {
    const scope = criblScope({
      inputs: [{ id: 'in1', type: 'syslog' }, { id: 'in2', type: 'http' }],
      routes: [{ id: 'r1', filter: 'true', pipeline: 'main', output: 'devnull' }],
      pipelines: [{ id: 'main' }],
      outputs: [{ id: 'devnull', type: 'devnull' }],
    })
    const { edges } = buildEnvironmentFlowGraph(scope, sampleGroup({ scopes: [scope] }))
    expect(edges.some((e) => e.source === 'in:in1' && e.target === 'rt:r1')).toBe(true)
    expect(edges.some((e) => e.source === 'in:in2' && e.target === 'rt:r1')).toBe(true)
  })

  it('does not connect inputs to expression-filter routes', () => {
    const scope = criblScope({
      inputs: [{ id: 'in1', type: 'syslog' }],
      routes: [{ id: 'r1', filter: 'level != "debug"', pipeline: 'main', output: 'devnull' }],
      pipelines: [{ id: 'main' }],
      outputs: [{ id: 'devnull', type: 'devnull' }],
    })
    const { edges } = buildEnvironmentFlowGraph(scope, sampleGroup({ scopes: [scope] }))
    expect(edges.some((e) => e.source.startsWith('in:') && e.target === 'rt:r1')).toBe(false)
  })

  it('pack zoom has no ingress when pack has no local inputs', () => {
    const scope = packScope('other_pack', {
      routes: [{ id: 'pack_other', filter: 'true', pipeline: 'other_main', output: 'devnull' }],
      pipelines: [{ id: 'other_main' }],
      outputs: [{ id: 'devnull', type: 'devnull' }],
    })
    const { nodes, edges } = buildEnvironmentFlowGraph(scope, sampleGroup({ scopes: [criblScope(), scope] }))
    expect(nodes.some((n) => n.id === 'ingress:worker-group')).toBe(false)
    expect(edges.some((e) => e.source.startsWith('in:'))).toBe(false)
    const placeholder = nodes.find((n) => n.data.nodeKind === 'noSources')!
    const route = nodes.find((n) => n.id === 'rt:pack_other')!
    expect(placeholder).toBeDefined()
    expect(placeholder.position.y).toBeLessThan(route.position.y)
  })

  it('shows a no-sources placeholder above routes when the scope has routing but no inputs', () => {
    const scope = criblScope({
      routes: [{ id: 'default', filter: 'true', pipeline: 'main', output: 'devnull' }],
      pipelines: [{ id: 'main' }],
      outputs: [{ id: 'devnull', type: 'devnull' }],
    })
    const { nodes } = buildEnvironmentFlowGraph(scope, sampleGroup({ scopes: [scope] }))
    const placeholder = nodes.find((n) => n.data.nodeKind === 'noSources')!
    const route = nodes.find((n) => n.id === 'rt:default')!
    expect(placeholder.data.label).toBe('No sources configured')
    expect(placeholder.position.y).toBeLessThan(route.position.y)
  })

  it('shows a no-sources placeholder on the worker group map when only packs are present', () => {
    const group = sampleGroup({
      scopes: [
        criblScope(),
        packScope('orphan_pack', {
          inputs: [{ id: 'pack_in', type: 'syslog' }],
        }),
      ],
    })
    const { nodes } = buildEnvironmentGroupRoutingGraph(group)
    const placeholder = nodes.find((n) => n.data.nodeKind === 'noSources')!
    const pack = nodes.find((n) => n.id === 'pack:orphan_pack')!
    expect(placeholder).toBeDefined()
    expect(placeholder.position.y).toBeGreaterThan(pack.position.y)
  })

  it('shows a no-destinations placeholder below pipelines when the scope has routing but no outputs', () => {
    const scope = criblScope({
      inputs: [{ id: 'in_syslog', type: 'syslog' }],
      routes: [{ id: 'default', filter: 'true', pipeline: 'main' }],
      pipelines: [{ id: 'main' }],
    })
    const { nodes } = buildEnvironmentFlowGraph(scope, sampleGroup({ scopes: [scope] }))
    const placeholder = nodes.find((n) => n.data.nodeKind === 'noDestinations')!
    const pipeline = nodes.find((n) => n.id === 'pl:main')!
    expect(placeholder.data.label).toBe('No destinations configured')
    expect(placeholder.position.y).toBeGreaterThan(pipeline.position.y)
    expect(nodes.some((n) => n.data.nodeKind === 'output')).toBe(false)
  })

  it('does not show a no-destinations placeholder when route output nodes exist', () => {
    const scope = criblScope({
      routes: [{ id: 'default', filter: 'true', pipeline: 'main', output: 'devnull' }],
      pipelines: [{ id: 'main' }],
      outputs: [{ id: 'devnull', type: 'devnull' }],
    })
    const { nodes } = buildEnvironmentFlowGraph(scope, sampleGroup({ scopes: [scope] }))
    expect(nodes.some((n) => n.data.nodeKind === 'noDestinations')).toBe(false)
    expect(nodes.some((n) => n.id === 'out:devnull')).toBe(true)
  })

  it('shows a no-destinations placeholder on the worker group map when only packs are present', () => {
    const group = sampleGroup({
      scopes: [
        criblScope(),
        packScope('orphan_pack', {
          inputs: [{ id: 'pack_in', type: 'syslog' }],
        }),
      ],
    })
    const { nodes } = buildEnvironmentGroupRoutingGraph(group)
    const placeholder = nodes.find((n) => n.data.nodeKind === 'noDestinations')!
    expect(placeholder).toBeDefined()
    expect(placeholder.data.label).toBe('No destinations configured')
  })

  it('wires catch-all default route through default:default destination', () => {
    const scope = criblScope({
      inputs: [{ id: 'syslog_in', type: 'syslog' }],
      routes: [{ id: 'default', filter: 'true', output: 'default:default' }],
      pipelines: [{ id: 'default' }],
      outputs: [{ id: 'default', type: 'default' }],
    })
    const { nodes, edges } = buildEnvironmentFlowGraph(scope, sampleGroup({ scopes: [scope] }))
    expect(nodes.some((n) => n.id === 'pl:default')).toBe(true)
    expect(nodes.some((n) => n.id === 'out:default')).toBe(true)
    expect(edges.some((e) => e.source === 'in:syslog_in' && e.target === 'rt:default')).toBe(true)
    expect(edges.some((e) => e.source === 'rt:default' && e.target === 'pl:default')).toBe(true)
    expect(edges.some((e) => e.source === 'pl:default' && e.target === 'out:default')).toBe(true)
  })
})

describe('mergeNodePositions', () => {
  it('applies overrides while preserving other node fields', () => {
    const scope = criblScope({
      inputs: [{ id: 'in1', type: 'syslog' }],
      routes: [{ id: 'r1', filter: 'true' }],
    })
    const { nodes } = buildEnvironmentFlowGraph(scope, sampleGroup({ scopes: [scope] }))
    const merged = mergeNodePositions(nodes, { 'in:in1': { x: 99, y: 42 } })
    expect(merged.find((n) => n.id === 'in:in1')?.position).toEqual({ x: 99, y: 42 })
    expect(merged.find((n) => n.id === 'rt:r1')?.position).toEqual(nodes.find((n) => n.id === 'rt:r1')?.position)
  })
})
