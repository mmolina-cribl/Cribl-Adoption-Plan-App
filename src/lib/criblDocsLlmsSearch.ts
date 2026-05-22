/**
 * Search Cribl's official documentation **indexes** (llms.txt link lists).
 * See https://docs.cribl.io/llms.txt — each product area publishes markdown URLs
 * the assistant may return verbatim (no fabricated doc paths).
 *
 * Always includes the **global** index (`/llms.txt`) so What's New, Apps,
 * Release notes entry points appear in results when keywords match.
 * Optionally adds **known issues** (`/llms-known-issues.txt`) and **App Platform**
 * (`/apps/llms.txt`) when the query (or explicit `doc_areas`) asks for them.
 *
 * In the Cribl iframe, `fetch('https://docs.cribl.io/...')` is rewritten by the
 * platform proxy (`proxies.yml`). On **localhost / 127.0.0.1** without
 * `CRIBL_API_URL`, fetches go through **Vite** at `/__cribl_docs__/…` (see
 * `vite.config.ts`) so the browser does not apply CORS to docs.cribl.io.
 */

function isInCriblIframe(): boolean {
  return typeof window !== 'undefined' && typeof window.CRIBL_API_URL === 'string'
}

const LOCAL_DOCS_PROXY_PREFIX = '/__cribl_docs__'

function resolveDocsLlmsFetchUrl(canonicalHttpsUrl: string): string {
  if (!canonicalHttpsUrl.startsWith('https://docs.cribl.io/')) {
    return canonicalHttpsUrl
  }
  if (typeof window === 'undefined') {
    return canonicalHttpsUrl
  }
  if (isInCriblIframe()) {
    return canonicalHttpsUrl
  }
  const host = window.location.hostname
  if (host !== 'localhost' && host !== '127.0.0.1') {
    return canonicalHttpsUrl
  }
  const path = canonicalHttpsUrl.slice('https://docs.cribl.io'.length)
  return `${LOCAL_DOCS_PROXY_PREFIX}${path.startsWith('/') ? path : `/${path}`}`
}

const ROOT_LLMS = 'https://docs.cribl.io/llms.txt'
const KNOWN_ISSUES_LLMS = 'https://docs.cribl.io/llms-known-issues.txt'
const APPS_LLMS = 'https://docs.cribl.io/apps/llms.txt'

/** Product-area indexes (subset of global llms.txt tree). */
export type DocArea =
  | 'stream'
  | 'edge'
  | 'search'
  | 'lake'
  | 'insights'
  | 'copilot'
  | 'guard'
  | 'iam'
  | 'cribl-as-code'
  | 'reference-architectures'
  | 'llm-observability'
  | 'use-cases'
  | 'fedramp'
  | 'billing-licensing'
  /** Full known-issues link index (flat file). */
  | 'known-issues'
  /** App Platform / packaged apps / proxies — may 403 from some clients; still allowlisted. */
  | 'apps'

const LLMS_BY_AREA: Record<DocArea, string> = {
  stream: 'https://docs.cribl.io/stream/llms.txt',
  edge: 'https://docs.cribl.io/edge/llms.txt',
  search: 'https://docs.cribl.io/search/llms.txt',
  lake: 'https://docs.cribl.io/lake/llms.txt',
  insights: 'https://docs.cribl.io/insights/llms.txt',
  copilot: 'https://docs.cribl.io/copilot/llms.txt',
  guard: 'https://docs.cribl.io/guard/llms.txt',
  iam: 'https://docs.cribl.io/iam/llms.txt',
  'cribl-as-code': 'https://docs.cribl.io/cribl-as-code/llms.txt',
  'reference-architectures': 'https://docs.cribl.io/reference-architectures/llms.txt',
  'llm-observability': 'https://docs.cribl.io/llm-observability/llms.txt',
  'use-cases': 'https://docs.cribl.io/use-cases/llms.txt',
  fedramp: 'https://docs.cribl.io/fedramp/llms.txt',
  'billing-licensing': 'https://docs.cribl.io/billing-licensing/llms.txt',
  'known-issues': KNOWN_ISSUES_LLMS,
  apps: APPS_LLMS,
}

const AREA_HINTS: Array<{ re: RegExp; areas: DocArea[] }> = [
  { re: /\b(cribl\s+)?search\b|lakehouse|dataset field/i, areas: ['search'] },
  { re: /\b(cribl\s+)?lake\b|parquet lake/i, areas: ['lake'] },
  { re: /\binsights\b/i, areas: ['insights'] },
  { re: /\bcopilot\b|cribl\s+ai\b|mcp\b/i, areas: ['copilot'] },
  { re: /\bguard\b|pii|classif(y|ication)\b|sensitive data/i, areas: ['guard'] },
  { re: /\biam\b|sso|oauth|rbac|scim\b/i, areas: ['iam'] },
  { re: /\bcribl\s+as\s+code\b|control\s+plane\s+api\b|management\s+plane\b/i, areas: ['cribl-as-code'] },
  { re: /\breference\s+architect|deployment\s+pattern|sizing\b/i, areas: ['reference-architectures'] },
  { re: /\buse\s+cases?\b|common\s+pattern/i, areas: ['use-cases'] },
  { re: /\bfedramp\b|government\s+cloud|cribl\.cloud\s+government/i, areas: ['fedramp'] },
  { re: /\bbilling\b|licen[cs]e|subscription|credits?\b/i, areas: ['billing-licensing'] },
  { re: /\bllm\s+observ|genai|openai telemetry\b/i, areas: ['llm-observability'] },
  { re: /\b(known issues?|known\s+bugs?|regression)\b/i, areas: ['known-issues'] },
  { re: /\b(app platform|packaged app|cribl apps?|\.tgz|proxies\.yml|kv\s*store|iframe)\b/i, areas: ['apps'] },
]

export function inferKnownIssuesFromQuery(q: string): boolean {
  return /\b(known issues?|known\s+bugs?|regression|broken\s+in|cve|defect|jira|ga\b|preview|release notes?|changelog|what'?s new)\b/i.test(
    q,
  )
}

export function inferAppsFromQuery(q: string): boolean {
  return /\b(app platform|packaged app|cribl apps?|install.*tgz|proxies\.yml|kv\s*store|sandboxed iframe|workspace apps?)\b/i.test(
    q,
  )
}

export function inferDocAreasFromQuery(q: string): DocArea[] {
  const base: DocArea[] = ['stream', 'edge']
  const extra = new Set<DocArea>()
  for (const { re, areas } of AREA_HINTS) {
    if (re.test(q)) {
      for (const a of areas) extra.add(a)
    }
  }
  if (inferKnownIssuesFromQuery(q)) {
    extra.add('known-issues')
  }
  if (inferAppsFromQuery(q)) {
    extra.add('apps')
  }
  const merged = [...new Set([...base, ...extra])]
  return merged.slice(0, 6)
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9+/._-]+/i)
    .filter((t) => t.length >= 2)
}

function scoreLine(line: string, tokens: string[]): number {
  if (!line.includes('https://docs.cribl.io/')) {
    return 0
  }
  const l = line.toLowerCase()
  let score = 0
  for (const t of tokens) {
    if (l.includes(t)) {
      score += 2 + Math.min(t.length, 10)
    }
  }
  return score
}

function isDocLinkLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith('- [') && t.includes('](https://docs.cribl.io/')
}

const VALID_AREAS = new Set<string>(Object.keys(LLMS_BY_AREA))

export function parseDocAreasInput(raw: unknown): DocArea[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null
  }
  const out: DocArea[] = []
  for (const x of raw) {
    if (typeof x === 'string' && VALID_AREAS.has(x)) {
      out.push(x as DocArea)
    }
  }
  return out.length > 0 ? out.slice(0, 8) : null
}

/** Build ordered fetch list: global index first, then requested or inferred indexes (deduped, capped). */
function buildFetchList(searchQuery: string, explicit: DocArea[] | null): Array<{ label: string; url: string }> {
  const q = searchQuery
  const seen = new Set<string>()
  const out: Array<{ label: string; url: string }> = []

  const push = (label: string, url: string) => {
    if (seen.has(url)) return
    seen.add(url)
    out.push({ label, url })
  }

  push('cribl-root', ROOT_LLMS)

  if (explicit?.length) {
    for (const a of explicit) {
      const url = LLMS_BY_AREA[a]
      if (url) {
        push(a, url)
      }
    }
    return out.slice(0, 9)
  }

  const areas = inferDocAreasFromQuery(q)
  for (const a of areas) {
    const url = LLMS_BY_AREA[a]
    if (url) {
      push(a, url)
    }
  }
  if (inferKnownIssuesFromQuery(q) && !seen.has(KNOWN_ISSUES_LLMS)) {
    push('known-issues', KNOWN_ISSUES_LLMS)
  }
  if (inferAppsFromQuery(q) && !seen.has(APPS_LLMS)) {
    push('apps', APPS_LLMS)
  }

  return out.slice(0, 9)
}

export async function searchCriblDocsLlms(args: {
  search_query: string
  doc_areas?: unknown
}): Promise<string> {
  const q = args.search_query.trim().slice(0, 280)
  if (!q) {
    return JSON.stringify({ error: 'empty_query', hits: [] })
  }

  const explicitParsed = parseDocAreasInput(args.doc_areas)

  const tokens = tokenize(q)
  if (tokens.length === 0) {
    tokens.push('stream', 'source')
  }

  type Hit = { markdown_line: string; area: string; score: number }
  const scored: Hit[] = []

  const fetchList = buildFetchList(q, explicitParsed)

  for (const { label, url } of fetchList) {
    try {
      const r = await fetch(resolveDocsLlmsFetchUrl(url))
      if (!r.ok) {
        scored.push({
          markdown_line: `(index fetch failed for ${label}: HTTP ${r.status})`,
          area: label,
          score: 0,
        })
        continue
      }
      const text = await r.text()
      for (const line of text.split('\n')) {
        if (!isDocLinkLine(line)) {
          continue
        }
        const trimmed = line.trim()
        const sc = scoreLine(trimmed, tokens)
        if (sc > 0) {
          scored.push({ markdown_line: trimmed.slice(0, 600), area: label, score: sc })
        }
      }
    } catch (e) {
      scored.push({
        markdown_line: `(index network error for ${label}: ${e instanceof Error ? e.message : 'unknown'})`,
        area: label,
        score: 0,
      })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  const hits = scored.slice(0, 24)

  return JSON.stringify({
    search_query: q,
    indexes_fetched: fetchList.map((f) => f.label),
    note:
      'Includes global docs.cribl.io/llms.txt plus product indexes. known-issues and apps indexes load when the query (or doc_areas) targets them. markdown_line values are verbatim from those files.',
    hits,
  })
}
