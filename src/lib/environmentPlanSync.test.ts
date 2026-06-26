import { describe, expect, it } from 'vitest'
import { environmentEmptyHint, environmentPlanOutOfSync } from './environmentPlanSync'
import type { CriblEnvironmentSnapshot } from './criblEnvironmentTypes'

const snap = (overrides?: Partial<CriblEnvironmentSnapshot>): CriblEnvironmentSnapshot => ({
  capturedAt: '2026-01-01T12:00:00.000Z',
  source: 'diag',
  warnings: [],
  groups: [],
  ...overrides,
})

describe('environmentPlanOutOfSync', () => {
  it('flags xlsx and scratch provenance', () => {
    expect(environmentPlanOutOfSync(snap(), { kind: 'xlsx' })).toBe(true)
    expect(environmentPlanOutOfSync(snap(), { kind: 'scratch' })).toBe(true)
  })

  it('flags kind or capturedAt mismatch', () => {
    expect(
      environmentPlanOutOfSync(snap({ source: 'diag', capturedAt: 'a' }), {
        kind: 'diag',
        capturedAt: 'b',
      }),
    ).toBe(true)
    expect(
      environmentPlanOutOfSync(snap({ source: 'tenant' }), { kind: 'diag', capturedAt: '2026-01-01T12:00:00.000Z' }),
    ).toBe(true)
  })

  it('is in sync when provenance matches snapshot', () => {
    expect(
      environmentPlanOutOfSync(snap({ source: 'diag', capturedAt: '2026-01-01T12:00:00.000Z' }), {
        kind: 'diag',
        capturedAt: '2026-01-01T12:00:00.000Z',
      }),
    ).toBe(false)
  })
})

describe('environmentEmptyHint', () => {
  it('returns contextual hints', () => {
    expect(environmentEmptyHint({ kind: 'xlsx' })).toMatch(/Excel/)
    expect(environmentEmptyHint({ kind: 'diag' })).toMatch(/Re-import/)
    expect(environmentEmptyHint({ kind: 'scratch' })).toMatch(/diagnostic bundle/)
  })
})
