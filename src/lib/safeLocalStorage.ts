/**
 * Returns `window.localStorage` when the API is usable.
 *
 * In sandboxed documents without `allow-same-origin`, **reading**
 * `window.localStorage` (and even `typeof localStorage`) can throw
 * `SecurityError`. Callers must never touch `localStorage` directly.
 */
export function getSafeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Same contract as `getSafeLocalStorage` — sandboxed documents may throw. */
export function getSafeSessionStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
