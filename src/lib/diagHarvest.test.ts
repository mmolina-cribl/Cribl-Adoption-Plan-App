import { describe, expect, it } from 'vitest'
import {
  collectInputsForGroup,
  harvestDiagFromFiles,
  inferDiagGroupMeta,
} from './diagHarvest'
import { isLeaderOutpostGroup } from './leaderStockGroups'

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

describe('collectInputsForGroup', () => {
  it('local/cribl overrides default/cribl for the same input id', () => {
    const files = filesOf({
      'groups/wg1/default/cribl/inputs.yml': 'src_default:\n  type: splunk\n',
      'groups/wg1/local/cribl/inputs.yml': 'src_default:\n  type: http\n',
    })
    const inputs = collectInputsForGroup(files, 'wg1')
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({ id: 'src_default', type: 'http' })
  })

  it('merges default/edge/inputs.yml with cribl inputs', () => {
    const files = filesOf({
      'groups/fleet1/default/cribl/inputs.yml': 'stream_src:\n  type: splunk\n',
      'groups/fleet1/default/edge/inputs.yml': 'edge_src:\n  type: syslog\n',
    })
    const inputs = collectInputsForGroup(files, 'fleet1')
    expect(inputs.map((i) => i.id).sort()).toEqual(['edge_src', 'stream_src'])
  })
})

describe('inferDiagGroupMeta', () => {
  it('marks fleet when edge inputs exist', () => {
    const files = filesOf({
      'groups/acme/default/edge/inputs.yml': 'e:\n  type: syslog\n',
    })
    const meta = inferDiagGroupMeta(files, 'acme', {})
    expect(meta.isFleet).toBe(true)
    expect(meta.type).toBe('edge')
  })

  it('marks default_fleet as edge fleet even without edge yaml', () => {
    const meta = inferDiagGroupMeta(new Map(), 'default_fleet', {})
    expect(meta.isFleet).toBe(true)
    expect(meta.type).toBe('edge')
  })
})

describe('harvestDiagFromFiles', () => {
  it('imports per-group topology and ignores root Leader-scope inputs.yml', () => {
    const files = filesOf({
      'default/cribl/inputs.yml': 'leader_global:\n  type: splunk\n',
      'groups/custom/local/cribl/inputs.yml': 'custom_src:\n  type: http\n',
    })
    const { groups, inputsByGroup } = harvestDiagFromFiles(files)
    expect(groups.some((g) => g.description === 'Leader (global)')).toBe(false)
    expect(groups.map((g) => g.id)).toEqual(['custom'])
    expect(inputsByGroup.custom).toHaveLength(1)
    expect(inputsByGroup.custom![0]).toMatchObject({ id: 'custom_src' })
  })

  it('skips default_outpost and imports customer groups', () => {
    const files = filesOf({
      'groups/default_outpost/default/cribl/inputs.yml': 'outpost_src:\n  type: outpost\n',
      'groups/New_Hire_Bootcamp/local/cribl/inputs.yml': 'in_splunk_hec:\n  type: splunk_hec\n',
    })
    const { groups, warnings } = harvestDiagFromFiles(files)
    expect(groups.map((g) => g.id)).toEqual(['New_Hire_Bootcamp'])
    expect(warnings.some((w) => w.includes('Skipped Outpost group "default_outpost"'))).toBe(true)
  })

  it('infers fleet from edge/inputs.yml when groups.yml is absent', () => {
    const files = filesOf({
      'groups/default_fleet/default/edge/inputs.yml': 'fleet_in:\n  type: syslog\n',
    })
    const { groups, inputsByGroup } = harvestDiagFromFiles(files)
    const fleet = groups.find((g) => g.id === 'default_fleet')
    expect(fleet?.isFleet).toBe(true)
    expect(fleet?.type).toBe('edge')
    expect(inputsByGroup.default_fleet).toHaveLength(1)
    expect(inputsByGroup.default_fleet![0]).toMatchObject({ id: 'fleet_in' })
  })

  it('returns empty harvest when no groups/ paths exist', () => {
    const files = filesOf({
      'default/cribl/inputs.yml': 'only_leader:\n  type: splunk\n',
    })
    const { groups, warnings } = harvestDiagFromFiles(files)
    expect(groups).toHaveLength(0)
    expect(warnings.some((w) => w.includes('No worker-group config paths'))).toBe(true)
  })

  it('skips Lakehouse Search engine folder groups/search (diag alias for default_search)', () => {
    const files = filesOf({
      'local/cribl/groups.yml':
        'default_search:\n  description: Search Group\n  isSearch: true\n  type: search\n  id: default_search\n',
      'groups/search/local/cribl/inputs.yml':
        'in_splunk_hec:\n  type: splunk_hec\n  port: 8088\n  host: 0.0.0.0\n',
      'groups/search/local/cribl/local-search-engines.yml':
        'lake_house_engine:\n  engineType: local\n  tierSize: 3xsmall\n',
      'groups/search/local/cribl/outputs.yml':
        'outputs:\n  engine_lake_house_engine:\n    type: local_search_storage\n',
      'groups/New_Hire_Bootcamp/local/cribl/inputs.yml': 'in_syslog:\n  type: syslog\n',
    })
    const { groups, warnings } = harvestDiagFromFiles(files)
    expect(groups.map((g) => g.id)).toEqual(['New_Hire_Bootcamp'])
    expect(warnings.some((w) => w.includes('Skipped Search / Lakehouse engine group "search"'))).toBe(true)
  })

  it('skips default_search when only that folder exists in the bundle', () => {
    const files = filesOf({
      'groups/default_search/local/cribl/local-search-engines.yml':
        'lake_house_engine:\n  engineType: local\n',
      'groups/default_search/local/cribl/inputs.yml': 'in_syslog:\n  type: syslog\n',
    })
    const { groups, warnings } = harvestDiagFromFiles(files)
    expect(groups).toHaveLength(0)
    expect(warnings.some((w) => w.includes('default_search'))).toBe(true)
  })
})

describe('isLeaderOutpostGroup', () => {
  it('flags outpost stock and naming patterns', () => {
    expect(isLeaderOutpostGroup({ id: 'default_outpost' })).toBe(true)
    expect(isLeaderOutpostGroup({ id: 'acme_outpost' })).toBe(true)
    expect(isLeaderOutpostGroup({ id: 'wg', type: 'outpost' })).toBe(true)
    expect(isLeaderOutpostGroup({ id: 'default_fleet' })).toBe(false)
    expect(isLeaderOutpostGroup({ id: 'New_Hire_Bootcamp' })).toBe(false)
  })
})
