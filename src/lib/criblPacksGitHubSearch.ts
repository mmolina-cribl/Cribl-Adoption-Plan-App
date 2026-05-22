/**
 * Search public repos in https://github.com/criblpacks via GitHub REST API.
 * Used by the adoption assistant tool loop — results are real `html_url` values
 * (no model hallucination for those links).
 *
 * Unauthenticated search is rate-limited (see response headers); a PAT is not
 * wired here — CSEs hitting limits can wait or we can add optional KV later.
 */

const GITHUB_ACCEPT = 'application/vnd.github+json'

export type CriblPackSearchHit = {
  full_name: string
  html_url: string
  description: string
  stars: number
}

export async function searchCriblPacksOnGitHub(searchQuery: string): Promise<string> {
  const trimmed = searchQuery.trim().slice(0, 240)
  if (!trimmed) {
    return JSON.stringify({ error: 'empty_query', items: [] satisfies CriblPackSearchHit[] })
  }

  const q = `org:criblpacks ${trimmed} in:name,description`
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=10`

  try {
    const r = await fetch(url, {
      headers: {
        Accept: GITHUB_ACCEPT,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    const text = await r.text()
    if (!r.ok) {
      return JSON.stringify({
        error: `github_http_${r.status}`,
        message: text.slice(0, 500),
        items: [],
      })
    }

    const data = JSON.parse(text) as {
      total_count?: number
      items?: Array<{
        full_name?: string
        html_url?: string
        description?: string | null
        stargazers_count?: number
      }>
    }

    const items: CriblPackSearchHit[] = (data.items ?? []).map((it) => ({
      full_name: it.full_name ?? '',
      html_url: it.html_url ?? '',
      description: (it.description ?? '').slice(0, 400),
      stars: it.stargazers_count ?? 0,
    }))

    return JSON.stringify({
      search_query: trimmed,
      total_count: data.total_count ?? items.length,
      items,
    })
  } catch (e) {
    return JSON.stringify({
      error: 'network',
      message: e instanceof Error ? e.message : 'unknown',
      items: [],
    })
  }
}
