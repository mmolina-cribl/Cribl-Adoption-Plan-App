import { describe, expect, it } from 'vitest'
import { migrateEnvironmentSnapshot } from './migrateEnvironmentSnapshot'

describe('migrateEnvironmentSnapshot', () => {
  it('wraps legacy flat group into a single cribl scope', () => {
    const out = migrateEnvironmentSnapshot({
      capturedAt: '2026-01-01T00:00:00.000Z',
      source: 'diag',
      warnings: [],
      groups: [
        {
          id: 'wg1',
          label: 'WG One',
          kind: 'stream',
          inputs: [{ id: 'in1', type: 'syslog' }],
          routes: [{ id: 'r1', pipeline: 'main', output: 'devnull' }],
          pipelines: [{ id: 'main' }],
          outputs: [{ id: 'devnull', type: 'devnull' }],
        },
      ],
    })
    expect(out.groups[0]?.scopes).toHaveLength(1)
    expect(out.groups[0]?.scopes[0]?.id).toBe('cribl')
    expect(out.groups[0]?.scopes[0]?.inputs[0]?.id).toBe('in1')
  })

  it('passes through scoped snapshots unchanged', () => {
    const snap = {
      snapshotVersion: 2,
      capturedAt: '2026-01-01T00:00:00.000Z',
      source: 'diag' as const,
      warnings: [] as string[],
      groups: [
        {
          id: 'wg1',
          label: 'WG',
          kind: 'stream' as const,
          scopes: [
            {
              id: 'cribl',
              label: 'Worker group',
              kind: 'cribl' as const,
              inputs: [],
              routes: [],
              pipelines: [],
              outputs: [],
            },
          ],
        },
      ],
    }
    const out = migrateEnvironmentSnapshot(snap)
    expect(out.groups[0]?.scopes[0]?.id).toBe('cribl')
  })
})
