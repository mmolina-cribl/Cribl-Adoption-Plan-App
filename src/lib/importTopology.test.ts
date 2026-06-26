import { describe, expect, it } from 'vitest'
import { importDiagTopologyFromFiles } from './importTopology'

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

describe('importDiagTopologyFromFiles', () => {
  it('returns aligned plan harvest and environment snapshot from one bundle', () => {
    const files = filesOf({
      'groups/bootcamp/local/cribl/inputs.yml': 'in_splunk_hec:\n  type: splunk_hec\n',
      'groups/bootcamp/default/cribl/outputs.yml': 'outputs:\n  devnull:\n    type: devnull\n',
      'groups/bootcamp/default/cribl/pipelines/main/conf.yml': 'asyncFuncTimeout: 1000\n',
      'groups/bootcamp/default/my_pack/pipelines/route.yml':
        'routes:\n  - id: r1\n    name: main_route\n    filter: "true"\n    pipeline: main\n    output: devnull\n',
    })
    const { capturedAt, harvest, environment } = importDiagTopologyFromFiles(files)
    expect(environment.capturedAt).toBe(capturedAt)
    expect(environment.source).toBe('diag')
    expect(harvest.groups.some((g) => g.id === 'bootcamp')).toBe(true)
    expect(harvest.inputsByGroup.bootcamp).toHaveLength(1)
    const g = environment.groups.find((x) => x.id === 'bootcamp')
    const cribl = g?.scopes.find((s) => s.id === 'cribl')
    const pack = g?.scopes.find((s) => s.id === 'my_pack')
    expect(cribl?.inputs).toHaveLength(1)
    expect(pack?.routes).toHaveLength(1)
    expect(cribl?.outputs.some((o) => o.id === 'devnull')).toBe(true)
  })
})
