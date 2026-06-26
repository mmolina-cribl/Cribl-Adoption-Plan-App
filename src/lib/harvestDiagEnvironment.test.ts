import { describe, expect, it } from 'vitest'
import { harvestDiagEnvironmentFromFiles } from './harvestDiagEnvironment'
import { buildEnvironmentFlowGraph } from './environmentFlowGraph'

function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function filesOf(entries: Record<string, string>): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>()
  for (const [path, text] of Object.entries(entries)) {
    m.set(path, enc(text))
  }
  return m
}

describe('harvestDiagEnvironmentFromFiles', () => {
  it('harvests full input/output config and pipeline functions in cribl scope', () => {
    const files = filesOf({
      'groups/wg/local/cribl/inputs.yml':
        'in_syslog:\n  type: syslog\n  description: Main feed\n  host: 10.0.0.1\n  password: secret123\n',
      'groups/wg/default/cribl/outputs.yml':
        'outputs:\n  s3_out:\n    type: s3\n    bucket: my-bucket\n    awsSecretKey: abc\n',
      'groups/wg/default/cribl/pipelines/main/conf.yml':
        'description: Main pipeline\nfunctions:\n  - drop_debug\n  - eval_fields\n',
      'groups/wg/default/cribl/pipelines/main/functions/drop_debug/conf.yml':
        'id: drop_debug\nfilter: "true"\ndescription: Drop debug events\n',
      'groups/wg/default/cribl/pipelines/main/functions/eval_fields/conf.yml':
        'id: eval_fields\nfilter: "level != \\"debug\\""\nconf:\n  add:\n    - name: env\n      value: prod\n',
    })
    const snap = harvestDiagEnvironmentFromFiles(files)
    const g = snap.groups.find((x) => x.id === 'wg')
    const cribl = g?.scopes.find((s) => s.id === 'cribl')
    expect(cribl?.inputs[0]?.config?.host).toBe('10.0.0.1')
    expect(cribl?.inputs[0]?.config?.password).toBe('••••••••')
    expect(cribl?.outputs[0]?.config?.awsSecretKey).toBe('••••••••')
    const pl = cribl?.pipelines.find((p) => p.id === 'main')
    expect(pl?.description).toBe('Main pipeline')
    expect(pl?.functions).toHaveLength(2)
  })

  it('parses local cribl and pack scopes separately (new_hire_bootcamp layout)', () => {
    const files = filesOf({
      'groups/new_hire_bootcamp/local/cribl/inputs.yml': 'in_syslog:\n  type: syslog\n',
      'groups/new_hire_bootcamp/local/cribl/outputs.yml': 'outputs:\n  devnull:\n    type: devnull\n',
      'groups/new_hire_bootcamp/local/cribl/pipelines/routes.yml':
        'routes:\n  - id: wg_main\n    filter: "true"\n    pipeline: cribl_main\n    output: devnull\n  - id: to_pack\n    filter: "true"\n    pipeline: other_pack/other_main\n',
      'groups/new_hire_bootcamp/local/cribl/pipelines/cribl_main/conf.yml': 'description: WG main\n',
      'groups/new_hire_bootcamp/local/beginner_mask_multiple_fields/inputs.yml':
        'pack_in:\n  type: syslog\n',
      'groups/new_hire_bootcamp/local/beginner_mask_multiple_fields/outputs.yml':
        'outputs:\n  pack_out:\n    type: devnull\n',
      'groups/new_hire_bootcamp/local/beginner_mask_multiple_fields/pipelines/routes.yml':
        'routes:\n  - id: pack_mask\n    filter: "true"\n    pipeline: mask_fields\n    output: pack_out\n',
      'groups/new_hire_bootcamp/local/beginner_mask_multiple_fields/pipelines/mask_fields/conf.yml':
        'description: Mask fields\n',
      'groups/new_hire_bootcamp/local/beginner_mask_multiple_fields/pipelines/extra_pipeline/conf.yml':
        'description: Extra pack pipeline\n',
      'groups/new_hire_bootcamp/local/other_pack/pipelines/routes.yml':
        'routes:\n  - id: pack_other\n    filter: "true"\n    pipeline: other_main\n    output: devnull\n',
      'groups/new_hire_bootcamp/local/other_pack/pipelines/other_main/conf.yml': 'description: Other pack\n',
    })
    const snap = harvestDiagEnvironmentFromFiles(files)
    const g = snap.groups.find((x) => x.id === 'new_hire_bootcamp')
    expect(g?.scopes.map((s) => s.id).sort()).toEqual(
      ['beginner_mask_multiple_fields', 'cribl', 'other_pack'].sort(),
    )

    const cribl = g?.scopes.find((s) => s.id === 'cribl')
    expect(cribl?.routes).toHaveLength(2)
    expect(cribl?.routes.find((r) => r.id === 'wg_main')?.pipeline).toBe('cribl_main')
    expect(cribl?.routes.find((r) => r.id === 'to_pack')?.pipeline).toBe('other_pack/other_main')
    expect(cribl?.pipelines.map((p) => p.id)).toEqual(['cribl_main'])

    const pack = g?.scopes.find((s) => s.id === 'beginner_mask_multiple_fields')
    expect(pack?.inputs[0]?.id).toBe('pack_in')
    expect(pack?.outputs[0]?.id).toBe('pack_out')
    expect(pack?.routes[0]?.pipeline).toBe('mask_fields')
    expect(pack?.pipelines.map((p) => p.id).sort()).toEqual(['extra_pipeline', 'mask_fields'].sort())
    expect(cribl?.routes[0]?.id).not.toBe(pack?.routes[0]?.id)
  })

  it('still parses default-tier pack route.yml (singular)', () => {
    const files = filesOf({
      'groups/bootcamp/local/cribl/inputs.yml': 'in_splunk_hec:\n  type: splunk_hec\n',
      'groups/bootcamp/default/cribl/outputs.yml': 'outputs:\n  devnull:\n    type: devnull\n',
      'groups/bootcamp/default/my_pack/pipelines/main/conf.yml': 'asyncFuncTimeout: 1000\n',
      'groups/bootcamp/default/my_pack/pipelines/route.yml':
        'routes:\n  - id: r1\n    name: main_route\n    filter: "true"\n    pipeline: main\n    output: devnull\n',
    })
    const snap = harvestDiagEnvironmentFromFiles(files)
    const g = snap.groups.find((x) => x.id === 'bootcamp')
    const pack = g?.scopes.find((s) => s.id === 'my_pack')
    expect(pack?.pipelines.some((p) => p.id === 'main')).toBe(true)
    expect(pack?.routes).toHaveLength(1)
    expect(pack?.routes[0]?.pipeline).toBe('main')
  })

  it('coerces boolean filter true from YAML routes', () => {
    const files = filesOf({
      'groups/wg/local/cribl/inputs.yml': 'in_splunk_hec:\n  type: splunk_hec\n',
      'groups/wg/default/cribl/outputs.yml': 'outputs:\n  devnull:\n    type: devnull\n',
      'groups/wg/default/cribl/pipelines/routes.yml':
        'routes:\n  - id: r1\n    filter: true\n    pipeline: main\n    output: devnull\n',
      'groups/wg/default/cribl/pipelines/main/conf.yml': 'description: Main\n',
    })
    const snap = harvestDiagEnvironmentFromFiles(files)
    const g = snap.groups.find((x) => x.id === 'wg')
    const cribl = g?.scopes.find((s) => s.id === 'cribl')
    expect(cribl?.routes[0]?.filter).toBe('true')
  })

  it('parses scope-level routes.yml (not only under pipelines/)', () => {
    const files = filesOf({
      'groups/new_hire/local/cribl/inputs.yml': 'in_syslog:\n  type: syslog\n',
      'groups/new_hire/local/cribl/outputs.yml': 'outputs:\n  default:\n    type: default\n',
      'groups/new_hire/local/cribl/routes.yml':
        'routes:\n  - id: default\n    filter: true\n    output: default:default\n',
      'groups/new_hire/local/cribl/pipelines/main/conf.yml': 'description: Main\n',
    })
    const snap = harvestDiagEnvironmentFromFiles(files)
    const cribl = snap.groups.find((x) => x.id === 'new_hire')?.scopes.find((s) => s.id === 'cribl')
    expect(cribl?.routes).toHaveLength(1)
    expect(cribl?.routes[0]?.id).toBe('default')
    expect(cribl?.routes[0]?.output).toBe('default:default')
  })

  it('New_Hire_Bootcamp diag layout: cribl inputs/pipelines but no WG routes in git', () => {
    const packRoute =
      'id: default\nroutes:\n  - id: default\n    filter: "true"\n    pipeline: main\n    output: default\n'
    const files = filesOf({
      'groups/New_Hire_Bootcamp/local/cribl/inputs.yml': 'inputs:\n  in_splunk_hec:\n    type: splunk_hec\n',
      'groups/New_Hire_Bootcamp/default/cribl/inputs.yml':
        'inputs:\n  http:\n    type: http\n  in_syslog:\n    type: syslog\n',
      'groups/New_Hire_Bootcamp/default/cribl/outputs.yml':
        'outputs:\n  devnull:\n    type: devnull\n  default:\n    type: default\n    defaultId: devnull\n',
      'groups/New_Hire_Bootcamp/default/cribl/pipelines/main/conf.yml': 'description: main\n',
      'groups/New_Hire_Bootcamp/default/beginner_extract_host/pipelines/route.yml': packRoute,
    })
    const snap = harvestDiagEnvironmentFromFiles(files)
    const g = snap.groups.find((x) => x.id === 'New_Hire_Bootcamp')
    const cribl = g?.scopes.find((s) => s.id === 'cribl')
    expect(cribl?.inputs.length).toBeGreaterThan(1)
    expect(cribl?.pipelines.some((p) => p.id === 'main')).toBe(true)
    expect(cribl?.routes).toHaveLength(0)
    expect(snap.warnings.some((w) => w.includes('catch-all default route'))).toBe(true)
    const pack = g?.scopes.find((s) => s.id === 'beginner_extract_host')
    expect(pack?.routes).toHaveLength(1)
    expect(pack?.routes[0]?.id).toBe('default')
  })

  it('warns when a pack has sources and pipelines but no routes.yml in the bundle', () => {
    const files = filesOf({
      'groups/new_hire_bootcamp/local/cribl/inputs.yml': 'in_syslog:\n  type: syslog\n',
      'groups/new_hire_bootcamp/local/beginner_extract_host/inputs.yml':
        'pack_in:\n  type: syslog\n',
      'groups/new_hire_bootcamp/local/beginner_extract_host/outputs.yml':
        'outputs:\n  default:\n    type: default\n',
      'groups/new_hire_bootcamp/local/beginner_extract_host/pipelines/main/conf.yml':
        'description: Pack main\n',
    })
    const snap = harvestDiagEnvironmentFromFiles(files)
    const pack = snap.groups
      .find((x) => x.id === 'new_hire_bootcamp')
      ?.scopes.find((s) => s.id === 'beginner_extract_host')
    expect(pack?.inputs[0]?.id).toBe('pack_in')
    expect(pack?.routes).toHaveLength(0)
    expect(
      snap.warnings.some(
        (w) => w.includes('beginner_extract_host') && w.includes('pack inputs.yml'),
      ),
    ).toBe(true)
  })

  it('does not import Lakehouse Search group folder as a worker group', () => {
    const files = filesOf({
      'groups/search/local/cribl/inputs.yml': 'in_splunk_hec:\n  type: splunk_hec\n',
      'groups/search/local/cribl/local-search-engines.yml':
        'lake_house_engine:\n  engineType: local\n',
      'groups/New_Hire_Bootcamp/local/cribl/inputs.yml': 'in_syslog:\n  type: syslog\n',
    })
    const snap = harvestDiagEnvironmentFromFiles(files)
    expect(snap.groups.map((g) => g.id)).toEqual(['New_Hire_Bootcamp'])
    expect(snap.warnings.some((w) => w.includes('Lakehouse engine group "search"'))).toBe(true)
  })
})

describe('buildEnvironmentFlowGraph', () => {
  it('creates route → pipeline → output chain within a scope', () => {
    const scope = {
      id: 'cribl',
      label: 'Worker group',
      kind: 'cribl' as const,
      inputs: [{ id: 'in1', type: 'syslog' }],
      pipelines: [{ id: 'main' }],
      outputs: [{ id: 'devnull', type: 'devnull' }],
      routes: [{ id: 'r1', filter: 'true', pipeline: 'main', output: 'devnull' }],
    }
    const group = {
      id: 'wg',
      label: 'WG',
      kind: 'stream' as const,
      scopes: [scope],
    }
    const { nodes, edges } = buildEnvironmentFlowGraph(scope, group)
    expect(nodes.some((n) => n.id === 'rt:r1')).toBe(true)
    expect(nodes.some((n) => n.id === 'pl:main')).toBe(true)
    expect(edges.some((e) => e.source === 'rt:r1' && e.target === 'pl:main')).toBe(true)
  })

  it('includes unrouted pipelines in the scope', () => {
    const scope = {
      id: 'beginner_mask_multiple_fields',
      label: 'beginner_mask_multiple_fields',
      kind: 'pack' as const,
      inputs: [],
      pipelines: [{ id: 'mask_fields' }, { id: 'extra_pipeline' }],
      outputs: [{ id: 'devnull', type: 'devnull' }],
      routes: [{ id: 'r1', filter: 'true', pipeline: 'mask_fields', output: 'devnull' }],
    }
    const group = {
      id: 'wg',
      label: 'WG',
      kind: 'stream' as const,
      scopes: [scope],
    }
    const { nodes } = buildEnvironmentFlowGraph(scope, group)
    expect(nodes.some((n) => n.id === 'pl:mask_fields')).toBe(true)
    expect(nodes.some((n) => n.id === 'pl:extra_pipeline')).toBe(true)
  })
})
