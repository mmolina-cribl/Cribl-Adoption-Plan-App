/**
 * Typed GET helper for Leader URLs under `window.CRIBL_API_URL`.
 * The App Platform fetch proxy injects auth — see AGENTS.md.
 */

function trimBase(base: string): string {
  return base.replace(/\/+$/, '')
}

export function criblApiBase(): string | null {
  if (typeof window === 'undefined' || typeof window.CRIBL_API_URL !== 'string') {
    return null
  }
  const t = window.CRIBL_API_URL.trim()
  if (!t) {
    return null
  }
  return trimBase(t)
}

export async function criblGetJson<T>(path: string): Promise<T> {
  const base = criblApiBase()
  if (!base) {
    throw new Error('Not running inside the Cribl App Platform iframe (CRIBL_API_URL is unset).')
  }
  const url = path.startsWith('/') ? `${base}${path}` : `${base}/${path}`
  const r = await fetch(url, { headers: { accept: 'application/json' } })
  const text = await r.text()
  if (!r.ok) {
    throw new Error(`GET ${path} failed (${r.status}): ${text.slice(0, 400)}`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`GET ${path}: response was not JSON (${text.slice(0, 120)})`)
  }
}
