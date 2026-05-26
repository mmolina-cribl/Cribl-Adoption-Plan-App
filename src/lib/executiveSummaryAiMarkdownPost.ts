import type { PlanState } from '../types/planTypes'
import type { ExecutiveSnapshot } from './executiveSnapshot'

/** Deterministic bolding context for Summary AI Markdown (matches JSON / snapshot). */
export type ExecutiveSummaryAiBoldContext = {
  customerDisplayName: string
  /** Longest first — reduces accidental partial wraps. */
  workerGroupNames: string[]
  /** Exact PS tier label when set (e.g. Gold). */
  psTierLabel: string | null
  /** Bold these numeric strings when they appear as standalone tokens (at-a-glance counts). */
  countTokens: string[]
}

export function buildExecutiveSummaryAiBoldContext(
  plan: PlanState,
  snap: ExecutiveSnapshot,
): ExecutiveSummaryAiBoldContext {
  const customerDisplayName = (plan.customerName ?? '').trim() || 'Customer'
  const names = snap.workerGroups
    .map((w) => (w.name ?? '').trim())
    .filter((n) => n.length >= 2)
  const uniq = [...new Set(names)].sort((a, b) => b.length - a.length)

  const countTokens: string[] = []
  const pushNum = (n: number) => {
    if (Number.isFinite(n) && n >= 0) {
      countTokens.push(String(n))
    }
  }
  pushNum(snap.wgStreamCount)
  pushNum(snap.wgEdgeCount)
  pushNum(snap.sourceCount)
  const countDedup = [...new Set(countTokens)].sort((a, b) => b.length - a.length)

  return {
    customerDisplayName,
    workerGroupNames: uniq,
    psTierLabel: snap.activationTier,
    countTokens: countDedup,
  }
}

const PRODUCT_TAIL_AFTER_CRIBL = /^\s*(\/(Stream|Edge)|Stream\/|Stream|Edge)\b/i

function alreadyWrappedBold(out: string, i: number, len: number): boolean {
  return out.slice(i - 2, i) === '**' && out.slice(i + len, i + len + 2) === '**'
}

/** True if index `idx` lies inside a `** ... **` span (toggle on each `**` token while scanning). */
function isInsideBoldSpan(md: string, idx: number): boolean {
  let bold = false
  let i = 0
  while (i < idx && i < md.length) {
    if (i + 1 < md.length && md[i] === '*' && md[i + 1] === '*') {
      bold = !bold
      i += 2
    } else {
      i += 1
    }
  }
  return bold
}

function wrapPhraseInMarkdown(
  markdown: string,
  phrase: string,
  options: { skipProductTailWhenPhraseIsCribl: boolean },
): string {
  if (phrase.length < 2) {
    return markdown
  }
  let out = markdown
  let searchFrom = 0
  while (searchFrom < out.length) {
    const i = out.indexOf(phrase, searchFrom)
    if (i === -1) {
      break
    }
    if (alreadyWrappedBold(out, i, phrase.length)) {
      searchFrom = i + phrase.length
      continue
    }
    if (i > 0 && /\w/.test(out[i - 1]!)) {
      searchFrom = i + 1
      continue
    }
    const after = out.slice(i + phrase.length)
    if (after.length > 0 && /\w/.test(after[0]!)) {
      searchFrom = i + 1
      continue
    }
    if (options.skipProductTailWhenPhraseIsCribl && phrase === 'Cribl' && PRODUCT_TAIL_AFTER_CRIBL.test(after)) {
      searchFrom = i + phrase.length
      continue
    }
    out = `${out.slice(0, i)}**${phrase}**${out.slice(i + phrase.length)}`
    searchFrom = i + phrase.length + 4
  }
  return out
}

/**
 * Post-process Summary AI Markdown: bold customer name, worker groups, PS tier, and key counts
 * when they appear as distinct tokens (avoids bolding inside longer words / product lead-ins).
 */
export function postProcessExecutiveSummaryAiMarkdown(
  markdown: string,
  ctx: ExecutiveSummaryAiBoldContext,
): string {
  let out = wrapPhraseInMarkdown(markdown, ctx.customerDisplayName, {
    skipProductTailWhenPhraseIsCribl: ctx.customerDisplayName === 'Cribl',
  })

  for (const wg of ctx.workerGroupNames) {
    if (wg === ctx.customerDisplayName) {
      continue
    }
    out = wrapPhraseInMarkdown(out, wg, { skipProductTailWhenPhraseIsCribl: false })
  }

  if (ctx.psTierLabel) {
    const tier = ctx.psTierLabel.trim()
    if (tier === 'Silver' || tier === 'Gold' || tier === 'Platinum') {
      out = wrapPhraseInMarkdown(out, tier, { skipProductTailWhenPhraseIsCribl: false })
    }
  }

  for (const num of ctx.countTokens) {
    if (num.length < 1) {
      continue
    }
    out = wrapNumericToken(out, num)
  }

  return out
}

/** Bold standalone integer token `num` (not part of a larger number, not already **). */
function wrapNumericToken(markdown: string, num: string): string {
  let out = markdown
  let searchFrom = 0
  while (searchFrom < out.length) {
    const i = out.indexOf(num, searchFrom)
    if (i === -1) {
      break
    }
    if (alreadyWrappedBold(out, i, num.length)) {
      searchFrom = i + num.length
      continue
    }
    if (isInsideBoldSpan(out, i)) {
      searchFrom = i + num.length
      continue
    }
    const before = i > 0 ? out[i - 1]! : ''
    const after = i + num.length < out.length ? out[i + num.length]! : ''
    if (before && /\d/.test(before)) {
      searchFrom = i + 1
      continue
    }
    if (after && /\d/.test(after)) {
      searchFrom = i + 1
      continue
    }
    if (before && /\w/.test(before)) {
      searchFrom = i + 1
      continue
    }
    if (after && /\w/.test(after)) {
      searchFrom = i + 1
      continue
    }
    out = `${out.slice(0, i)}**${num}**${out.slice(i + num.length)}`
    searchFrom = i + num.length + 4
  }
  return out
}
