import { describe, expect, it } from 'vitest'
import type { CriblEnvironmentSnapshot } from './criblEnvironmentTypes'
import { resolveEnvironmentEntity } from './environmentEntityLookup'

const snap: CriblEnvironmentSnapshot = {
  capturedAt: '2026-01-01T00:00:00.000Z',
  source: 'diag',
  warnings: [],
  groups: [
    {
      id: 'wg1',
      label: 'WG One',
      kind: 'stream',
      scopes: [
        {
          id: 'cribl',
          label: 'Worker group',
          kind: 'cribl',
          inputs: [{ id: 'in1', type: 'syslog', config: { host: '10.0.0.1' } }],
          pipelines: [
            {
              id: 'main',
              functions: [{ id: 'fn1', filter: 'true' }],
            },
          ],
          outputs: [{ id: 'devnull', type: 'devnull' }],
          routes: [{ id: 'r1', pipeline: 'main', output: 'devnull' }],
        },
      ],
    },
  ],
}

describe('resolveEnvironmentEntity', () => {
  it('resolves pipeline with functions in scope', () => {
    const resolved = resolveEnvironmentEntity(snap, {
      groupId: 'wg1',
      scopeId: 'cribl',
      entity: 'pipeline',
      id: 'main',
    })
    expect(resolved?.kind).toBe('pipeline')
    if (resolved?.kind === 'pipeline') {
      expect(resolved.entity.functions).toHaveLength(1)
      expect(resolved.scope.id).toBe('cribl')
      expect(resolved.group.label).toBe('WG One')
    }
  })

  it('returns null for unknown entity or scope', () => {
    expect(
      resolveEnvironmentEntity(snap, {
        groupId: 'wg1',
        scopeId: 'cribl',
        entity: 'input',
        id: 'missing',
      }),
    ).toBeNull()
    expect(
      resolveEnvironmentEntity(snap, {
        groupId: 'wg1',
        scopeId: 'no_such_pack',
        entity: 'input',
        id: 'in1',
      }),
    ).toBeNull()
  })
})
