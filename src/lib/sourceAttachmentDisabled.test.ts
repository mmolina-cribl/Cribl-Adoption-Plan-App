import { describe, expect, it } from 'vitest'
import type { SourceSummaryRow } from '../types/planTypes'
import {
  DISABLED_SOURCE_NAME_SUFFIX,
  isSourceRowAttachmentDisabled,
  sourceNameImpliesAttachmentDisabled,
  stripAttachmentDisabledNameSuffix,
} from './sourceAttachmentDisabled'

function row(partial: Partial<SourceSummaryRow>): SourceSummaryRow {
  return {
    id: '1',
    workerGroupId: '',
    source: '',
    securityOrObs: '',
    streamOrEdge: '',
    type: '',
    physicalLocations: '',
    sourceTile: '',
    pipelineUsecase: '',
    destinations: '',
    retention: '',
    avgDailyGb: '',
    complianceRelated: false,
    dataCriticality: '',
    stakeholders: '',
    currentCollection: '',
    isCurrent: false,
    targetOnboardStart: '',
    targetOnboardEnd: '',
    onboardingCompletedOn: '',
    blockers: '',
    growth: '',
    dataOptPct: '',
    dataOptGb: '',
    initiativeCase: '',
    technicalUsecase: '',
    financial: '',
    operational: '',
    riskReduction: '',
    strategic: '',
    onboardingEffort: '',
    politics: '',
    additionalNotes: '',
    ...partial,
  }
}

describe('sourceAttachmentDisabled', () => {
  it('detects suffix case-insensitively', () => {
    expect(sourceNameImpliesAttachmentDisabled(`foo${DISABLED_SOURCE_NAME_SUFFIX}`)).toBe(true)
    expect(sourceNameImpliesAttachmentDisabled('foo DISABLED')).toBe(true)
    expect(sourceNameImpliesAttachmentDisabled('foo')).toBe(false)
  })

  it('isSourceRowAttachmentDisabled uses flag or suffix', () => {
    expect(isSourceRowAttachmentDisabled(row({ leaderImportedDisabled: true, source: 'x' }))).toBe(true)
    expect(isSourceRowAttachmentDisabled(row({ source: 'mySource disabled' }))).toBe(true)
    expect(isSourceRowAttachmentDisabled(row({ source: 'normal' }))).toBe(false)
  })

  it('stripAttachmentDisabledNameSuffix removes Leader-style suffix only when implied', () => {
    expect(stripAttachmentDisabledNameSuffix('mySource disabled')).toBe('mySource')
    expect(stripAttachmentDisabledNameSuffix('mySource DISABLED')).toBe('mySource')
    expect(stripAttachmentDisabledNameSuffix('normal')).toBe('normal')
    expect(stripAttachmentDisabledNameSuffix('no trailing')).toBe('no trailing')
  })
})
