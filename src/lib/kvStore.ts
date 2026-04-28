/**
 * Cribl App Platform KV store helper.
 *
 * Per AGENTS.md, the platform's locked `window.fetch` automatically:
 *   - Injects the user's auth token on every call to `CRIBL_API_URL`.
 *   - Rewrites the URL to `/api/v1/a/<appId>/kvstore/<key>` so requests are
 *     scoped to this app. Other apps can't read or write our keys.
 *
 * So all we do here is fetch with the right method/body and let the platform
 * handle auth and per-app scoping.
 *
 * ## Wire format (verified against staging tenant 2026-04-28)
 *
 * - `PUT /kvstore/<key>` with `content-type: text/plain` and the raw value
 *   in the body. Returns 201 Created. **JSON content-type is rejected with
 *   400 Bad Request** (don't ask me why — the server just doesn't like it).
 * - `GET /kvstore/<key>` returns 200 with `text/plain` body, or 404 if absent.
 * - Multi-segment keys with literal `/` are supported: `users/abc/plan` is
 *   stored verbatim. **Do not URL-encode the slashes** (`users%2Fabc%2Fplan`)
 *   — the platform's route matcher doesn't decode them and returns 404.
 *
 * We always `JSON.stringify` on write and `JSON.parse` on read so the helper
 * stays generic over `T`. Side effect: string values appear quoted (`"wizard"`)
 * in the KV admin UI. That's cosmetic; round-trips are correct.
 *
 * ## Per-user namespacing
 *
 * The platform's KV store is per-app shared across users (confirmed via
 * internal Cribl chat 2026-04-28). Two CSEs at the same tenant who both
 * `PUT /kvstore/plan` would overwrite each other. Per the platform team's
 * recommendation, every key here is silently namespaced as
 * `users/<userId>/<key>` inside this helper. Call sites pass logical keys
 * (`plan`, `prefs/rail/px`); they are unaware of the prefix.
 *
 * `getCurrentUserId()` is a stub for now — see CRIBL_DEV_NOTES.md
 * "User identity inside the iframe — confirmed gap" for the full story.
 *
 * ## Local-dev fallback
 *
 * When `window.CRIBL_API_URL` is undefined (i.e. someone is running this
 * scaffold directly on `http://localhost:5173/` outside the Cribl iframe),
 * we transparently use `localStorage` so persistence still works. Same key
 * namespacing as the iframe path, so test data is symmetric.
 *
 * ## Failure model
 *
 * `kvGet` returns `fallback` on missing key (404), HTTP error, network
 * error, or JSON parse error. Never throws. Same for `kvSet` / `kvDelete`
 * (errors are logged with `console.warn` and swallowed). Callers can treat
 * KV as a best-effort cache: it usually works, but never crashes the app
 * if it doesn't.
 */

// TODO(per-user-scoping): swap this stub for a real call to the user-info
// endpoint once the platform team confirms the path. For the dev tenant
// (single user) `'default'` is safe; for multi-user deployment this MUST
// be replaced or two CSEs will overwrite each other's KV data.
function getCurrentUserId(): string {
  return 'default'
}

function namespaced(key: string): string {
  return `users/${getCurrentUserId()}/${key}`
}

function isInCriblIframe(): boolean {
  return typeof window !== 'undefined' && typeof window.CRIBL_API_URL === 'string'
}

/** localStorage key used by the local-dev fallback. Mirrors the KV namespacing. */
function localStorageKey(namespacedKey: string): string {
  return `cribl-kv:${namespacedKey}`
}

function lsGet<T>(nsKey: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(localStorageKey(nsKey))
    if (raw == null) {
      return fallback
    }
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function lsSet<T>(nsKey: string, value: T): void {
  try {
    localStorage.setItem(localStorageKey(nsKey), JSON.stringify(value))
  } catch {
    // Sandboxed iframe (no CRIBL_API_URL but also no localStorage), or quota
    // exceeded. Best-effort.
  }
}

function lsDelete(nsKey: string): void {
  try {
    localStorage.removeItem(localStorageKey(nsKey))
  } catch {
    // Best-effort.
  }
}

/**
 * Read a value from KV. Returns `fallback` on 404, HTTP error, network
 * error, or JSON parse error. Never throws.
 */
export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const nsKey = namespaced(key)

  if (!isInCriblIframe()) {
    return lsGet(nsKey, fallback)
  }

  try {
    const r = await fetch(`${window.CRIBL_API_URL}/kvstore/${nsKey}`)
    if (r.status === 404) {
      return fallback
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.warn(`[kvStore] GET ${nsKey} failed: ${r.status} ${r.statusText}`, body.slice(0, 200))
      return fallback
    }
    const text = await r.text()
    if (!text) {
      return fallback
    }
    try {
      return JSON.parse(text) as T
    } catch {
      console.warn(`[kvStore] GET ${nsKey}: response was not valid JSON`, text.slice(0, 200))
      return fallback
    }
  } catch (e) {
    console.warn(`[kvStore] GET ${nsKey} threw:`, e)
    return fallback
  }
}

/**
 * Write a value to KV. Errors are logged with `console.warn` and swallowed.
 * Returns when the request completes (success or failure).
 */
export async function kvSet<T>(key: string, value: T): Promise<void> {
  const nsKey = namespaced(key)

  if (!isInCriblIframe()) {
    lsSet(nsKey, value)
    return
  }

  try {
    const r = await fetch(`${window.CRIBL_API_URL}/kvstore/${nsKey}`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(value),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.warn(`[kvStore] PUT ${nsKey} failed: ${r.status} ${r.statusText}`, body.slice(0, 200))
    }
  } catch (e) {
    console.warn(`[kvStore] PUT ${nsKey} threw:`, e)
  }
}

/**
 * Delete a key from KV. 404 (already absent) is treated as success.
 * Other errors are logged and swallowed.
 */
export async function kvDelete(key: string): Promise<void> {
  const nsKey = namespaced(key)

  if (!isInCriblIframe()) {
    lsDelete(nsKey)
    return
  }

  try {
    const r = await fetch(`${window.CRIBL_API_URL}/kvstore/${nsKey}`, {
      method: 'DELETE',
    })
    if (!r.ok && r.status !== 404) {
      const body = await r.text().catch(() => '')
      console.warn(`[kvStore] DELETE ${nsKey} failed: ${r.status} ${r.statusText}`, body.slice(0, 200))
    }
  } catch (e) {
    console.warn(`[kvStore] DELETE ${nsKey} threw:`, e)
  }
}
