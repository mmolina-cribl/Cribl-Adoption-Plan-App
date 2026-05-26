import { describe, expect, it } from 'vitest'
import { postProcessExecutiveSummaryAiMarkdown, type ExecutiveSummaryAiBoldContext } from './executiveSummaryAiMarkdownPost'

function ctx(partial: Partial<ExecutiveSummaryAiBoldContext>): ExecutiveSummaryAiBoldContext {
  return {
    customerDisplayName: 'Acme',
    workerGroupNames: [],
    psTierLabel: null,
    countTokens: [],
    ...partial,
  }
}

describe('postProcessExecutiveSummaryAiMarkdown', () => {
  it('bolds customer, worker group, tier label, and standalone counts', () => {
    const out = postProcessExecutiveSummaryAiMarkdown(
      '- Meet Acme about prod-wg-east; Gold tier with 12 sources across 3 worker groups.',
      ctx({
        customerDisplayName: 'Acme',
        workerGroupNames: ['prod-wg-east'],
        psTierLabel: 'Gold',
        countTokens: ['12', '3'],
      }),
    )
    expect(out).toContain('**Acme**')
    expect(out).toContain('**prod-wg-east**')
    expect(out).toContain('**Gold**')
    expect(out).toContain('**12**')
    expect(out).toContain('**3**')
  })

  it('does not bold Cribl when followed by Stream/Edge product tail', () => {
    const md = '## Talking points\n- Lead with Cribl Stream/Edge for observability.\n- Also align with Cribl on licensing.'
    const out = postProcessExecutiveSummaryAiMarkdown(
      md,
      ctx({
        customerDisplayName: 'Cribl',
        workerGroupNames: [],
        psTierLabel: null,
        countTokens: [],
      }),
    )
    expect(out).toContain('Cribl Stream/Edge')
    expect(out).not.toContain('**Cribl** Stream/Edge')
    expect(out).toContain('**Cribl** on licensing')
  })

  it('does not double-wrap already bold phrases', () => {
    const out = postProcessExecutiveSummaryAiMarkdown('**Acme** and Acme.', ctx({ customerDisplayName: 'Acme' }))
    expect(out).toBe('**Acme** and **Acme**.')
  })

  it('avoids bolding numeric substrings inside larger numbers', () => {
    const out = postProcessExecutiveSummaryAiMarkdown('Volume near 1200 GB/day; 12 sources.', ctx({ countTokens: ['12'] }))
    expect(out).toContain('1200')
    expect(out).not.toContain('**12**00')
    expect(out).toContain('**12** sources')
  })

  it('does not inject extra ** when the model already bolded a phrase containing the count', () => {
    const md = 'A total of **24 source rows** have been included in the plan.'
    const out = postProcessExecutiveSummaryAiMarkdown(md, ctx({ countTokens: ['24'] }))
    expect(out).toBe(md)
    expect(out).not.toMatch(/\*\*\*\*/)
    expect(out).toContain('**24 source rows**')
  })
})
