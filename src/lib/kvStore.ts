import { getSafeLocalStorage, getSafeSessionStorage } from './safeLocalStorage'
import { criblApiBase } from './leaderApi'

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
 * stays generic over `T`, **except** pack key `openaiKey` (raw `sk-…` body — see
 * below). Side effect: string values appear quoted (`"wizard"`)
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
 * **Exception:** `probeOpenAiKeyPresent`, `kvSetOpenAiKey`, and `kvClearOpenAiKey`
 * use the pack root key `openaiKey` (no `users/.../` prefix) so
 * `proxies.yml` expressions like `kv.openaiKey` resolve correctly.
 *
 * ## Local-dev fallback
 *
 * When `window.CRIBL_API_URL` is undefined (plain `localhost`), or a tab-local
 * session hint was set after a pack KV `PUT`/`GET` returned `Unknown App "__local__"`
 * (hybrid dev without `__local__` in the URL), the OpenAI pack key uses browser
 * storage; see `openAiKeyUsesBrowserStorageOnly()`.
 * **Cribl `__local__` shell** (`isCriblLocalShell()`): BYOL OpenAI is **disabled** in
 * Settings and the assistant — use a **deployed** installed pack for `openaiKey` /
 * `proxies.yml`. Pack KV is also unavailable here; `kvGet` / `kvSet` / `kvDelete`
 * for normal keys (`plan`, rail prefs, etc.) use **localStorage** (same as plain
 * localhost) so state survives refresh while Leader APIs (e.g. tenant import) still work.
 * **Installed pack:** a non-`__local__` / non-`__dev__…` `CRIBL_APP_ID` forces pack
 * KV + proxy and clears a stale session hint (so the client does not send a bogus
 * `Authorization` header). **Sandboxed iframe:** if `localStorage` is blocked, the
 * secret may be kept in tab memory only until reload.
 * With an installed pack id and `CRIBL_API_URL` set, normal keys use pack KV.
 * For **non–installed-pack** iframe contexts (`__local__`, `__dev__…`, or
 * `CRIBL_APP_ID` not yet injected), `kvGet` / `kvSet` also use **`localStorage`**
 * when KV returns **404** or errors so plan hydration can recover after refresh.
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

function kvKeyPresentInLocalStorage(nsKey: string): boolean {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return false
  }
  try {
    return ls.getItem(localStorageKey(nsKey)) !== null
  } catch {
    return false
  }
}

/** Pack KV keys we know exist remotely (successful GET/PUT). */
const remoteKvKeysPresent = new Set<string>()
/** Keys that returned 404 this session — skip repeat GET/DELETE round-trips. */
const remoteKvKeysAbsent = new Set<string>()
/** Coalesce parallel GETs for the same pack key (e.g. React Strict Mode double-mount). */
const kvGetInFlight = new Map<string, Promise<unknown>>()

const KV_ABSENT_LS_PREFIX = 'cribl-kv-absent:'
const KV_TOUCHED_LS_PREFIX = 'cribl-kv-touched:'

function persistedKvAbsentKey(nsKey: string): string {
  return `${KV_ABSENT_LS_PREFIX}${nsKey}`
}

function persistedKvTouchedKey(nsKey: string): string {
  return `${KV_TOUCHED_LS_PREFIX}${nsKey}`
}

function readPersistedKvAbsent(nsKey: string): boolean {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return false
  }
  try {
    return ls.getItem(persistedKvAbsentKey(nsKey)) === '1'
  } catch {
    return false
  }
}

function writePersistedKvAbsent(nsKey: string, absent: boolean): void {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return
  }
  try {
    const key = persistedKvAbsentKey(nsKey)
    if (absent) {
      ls.setItem(key, '1')
    } else {
      ls.removeItem(key)
    }
  } catch {
    /* ignore */
  }
}

function readKvTouched(nsKey: string): boolean {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return false
  }
  try {
    return ls.getItem(persistedKvTouchedKey(nsKey)) === '1'
  } catch {
    return false
  }
}

function writeKvTouched(nsKey: string, touched: boolean): void {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return
  }
  try {
    const key = persistedKvTouchedKey(nsKey)
    if (touched) {
      ls.setItem(key, '1')
    } else {
      ls.removeItem(key)
    }
  } catch {
    /* ignore */
  }
}

function markRemoteKvKeyPresent(nsKey: string): void {
  remoteKvKeysPresent.add(nsKey)
  remoteKvKeysAbsent.delete(nsKey)
  writePersistedKvAbsent(nsKey, false)
  writeKvTouched(nsKey, true)
}

function markRemoteKvKeyAbsent(nsKey: string): void {
  remoteKvKeysPresent.delete(nsKey)
  remoteKvKeysAbsent.add(nsKey)
  writePersistedKvAbsent(nsKey, true)
}

function isRemoteKvKeyKnownAbsent(nsKey: string): boolean {
  if (remoteKvKeysPresent.has(nsKey) || kvKeyPresentInLocalStorage(nsKey)) {
    return false
  }
  if (remoteKvKeysAbsent.has(nsKey)) {
    return true
  }
  if (readPersistedKvAbsent(nsKey)) {
    remoteKvKeysAbsent.add(nsKey)
    return true
  }
  return false
}

/**
 * Optional prefs / import shell: skip a pack GET when this browser already
 * learned the key is absent, or when the user has never saved it here (avoids
 * noisy 404s for unset keys on installed packs).
 */
function shouldSkipSpeculativeKvGet(nsKey: string): boolean {
  if (isRemoteKvKeyKnownAbsent(nsKey)) {
    return true
  }
  if (readKvTouched(nsKey) || kvKeyPresentInLocalStorage(nsKey)) {
    return false
  }
  return true
}

function shouldSkipRemoteKvDelete(nsKey: string): boolean {
  if (isRemoteKvKeyKnownAbsent(nsKey)) {
    return true
  }
  return !remoteKvKeysPresent.has(nsKey) && !kvKeyPresentInLocalStorage(nsKey)
}

/**
 * Clear a pack KV key remotely. Uses PUT with an empty body instead of DELETE
 * because the Cribl App Platform fetch proxy / service worker can throw
 * `Response with null body status cannot have body` when DELETE returns 204.
 */
async function kvRemoteEraseKey(base: string, keyPath: string): Promise<boolean> {
  try {
    const r = await fetch(`${base}/kvstore/${keyPath}`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: '',
    })
    return r.ok
  } catch (e) {
    console.warn(`[kvStore] PUT (erase) ${keyPath} threw:`, e)
    return false
  }
}

function isInCriblIframe(): boolean {
  return criblApiBase() != null
}

/**
 * When true, the BYOL `openaiKey` is read/written only in browser storage and
 * the assistant uses `Authorization` from the client.
 *
 * - Plain `localhost` (no `CRIBL_API_URL`).
 * - **Session hint:** after a pack KV `PUT`/`GET` returns `Unknown App "__local__"`
 *   (hybrid dev without `__local__` in the URL), we persist a tab-local hint.
 * - **`__local__` shell** (`isCriblLocalShell()`): always **false** — BYOL is disabled there.
 * - **Installed pack:** when `CRIBL_APP_ID` is a real pack id (not `__local__` /
 *   `__dev__…`), pack KV + proxy are always used and a stale hint is cleared.
 */
const OPENAI_KEY_BROWSER_ONLY_SESSION_KEY = 'cribl:openaiKey:browserOnlyHint'

function clearOpenAiKeyBrowserOnlySessionHint(): void {
  const ss = getSafeSessionStorage()
  if (!ss) {
    return
  }
  try {
    ss.removeItem(OPENAI_KEY_BROWSER_ONLY_SESSION_KEY)
  } catch {
    /* ignore */
  }
}

/** BYOL secret when `localStorage` is blocked (sandboxed `__local__` iframe). Cleared on full reload. */
let memoryOnlyOpenAiKey: string | null = null

function readOpenAiKeyBrowserOnlySessionHint(): boolean {
  const ss = getSafeSessionStorage()
  if (!ss) {
    return false
  }
  try {
    return ss.getItem(OPENAI_KEY_BROWSER_ONLY_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function rememberOpenAiKeyBrowserOnlyAfterKvError(): void {
  const ss = getSafeSessionStorage()
  if (!ss) {
    return
  }
  try {
    ss.setItem(OPENAI_KEY_BROWSER_ONLY_SESSION_KEY, '1')
  } catch {
    /* ignore */
  }
}

function locationMentionsLocalShell(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    const { href, search, hash, pathname } = window.location
    const blob = `${href}\0${search}\0${hash}\0${pathname}`.toLowerCase()
    return blob.includes('__local__')
  } catch {
    return false
  }
}

/**
 * Cribl Apps **`__local__`** dev shell, or hybrid dev whose URL references
 * `__local__` (e.g. `?init=…/__local__/init.js`). BYOL OpenAI (Settings key +
 * right-rail assistant) is **not** supported here — use a deployed installed pack.
 */
export function isCriblLocalShell(): boolean {
  if (!isInCriblIframe()) {
    return false
  }
  const raw = typeof window !== 'undefined' ? (window as Window & { CRIBL_APP_ID?: unknown }).CRIBL_APP_ID : undefined
  const id = raw == null ? '' : String(raw).trim().toLowerCase()
  if (id === '__local__') {
    return true
  }
  return locationMentionsLocalShell()
}

/** Response body from pack KV when the shell targets app id `__local__` (no KV). */
function isKvUnknownLocalAppResponse(body: string): boolean {
  const s = body.toLowerCase()
  return s.includes('__local__') && s.includes('unknown app')
}

/** Non-empty app id for a tenant-installed pack (uses pack KV, not `__local__` / Vite `__dev__`). */
function isInstalledCriblPackAppId(id: string): boolean {
  const t = id.trim().toLowerCase()
  if (!t) {
    return false
  }
  if (t === '__local__') {
    return false
  }
  if (t.startsWith('__dev__')) {
    return false
  }
  return true
}

/**
 * When true, pack KV for generic keys (`plan`, prefs, …) is unreliable or absent
 * (`__local__`, `__dev__…`, missing `CRIBL_APP_ID` on first paint). Reads should
 * fall back to `localStorage` after KV 404/errors; writes should mirror there on
 * KV failure so tenant import survives refresh in the dev shell.
 */
function genericKvShouldMirrorToBrowser(): boolean {
  if (!isInCriblIframe()) {
    return true
  }
  if (isCriblLocalShell()) {
    return true
  }
  const raw = typeof window !== 'undefined' ? (window as Window & { CRIBL_APP_ID?: unknown }).CRIBL_APP_ID : undefined
  const id = raw == null ? '' : String(raw).trim()
  return !isInstalledCriblPackAppId(id)
}

export function openAiKeyUsesBrowserStorageOnly(): boolean {
  if (!isInCriblIframe()) {
    return true
  }

  const raw = typeof window !== 'undefined' ? (window as Window & { CRIBL_APP_ID?: unknown }).CRIBL_APP_ID : undefined
  const id = raw == null ? '' : String(raw).trim().toLowerCase()

  if (isInstalledCriblPackAppId(id)) {
    clearOpenAiKeyBrowserOnlySessionHint()
    memoryOnlyOpenAiKey = null
    return false
  }

  if (isCriblLocalShell()) {
    return false
  }

  return readOpenAiKeyBrowserOnlySessionHint()
}

/** localStorage key used by the local-dev fallback. Mirrors the KV namespacing. */
function localStorageKey(namespacedKey: string): string {
  return `cribl-kv:${namespacedKey}`
}

function lsGet<T>(nsKey: string, fallback: T): T {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return fallback
  }
  try {
    const raw = ls.getItem(localStorageKey(nsKey))
    if (raw == null) {
      return fallback
    }
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function lsSet<T>(nsKey: string, value: T): void {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return
  }
  try {
    ls.setItem(localStorageKey(nsKey), JSON.stringify(value))
  } catch {
    // Sandboxed iframe, or quota exceeded. Best-effort.
  }
}

function lsDelete(nsKey: string): void {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return
  }
  try {
    ls.removeItem(localStorageKey(nsKey))
  } catch {
    /* ignore */
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

  // `__local__` shell: CRIBL_API_URL is set but pack KV is unavailable — use
  // localStorage like plain localhost so plan state survives refresh.
  if (isCriblLocalShell()) {
    return lsGet(nsKey, fallback)
  }

  const base = criblApiBase()
  if (!base) {
    return lsGet(nsKey, fallback)
  }

  if (isRemoteKvKeyKnownAbsent(nsKey)) {
    if (genericKvShouldMirrorToBrowser()) {
      return lsGet(nsKey, fallback)
    }
    return fallback
  }

  const inflight = kvGetInFlight.get(nsKey)
  if (inflight) {
    return inflight as Promise<T>
  }

  const promise = kvGetRemote<T>(base, nsKey, fallback)
  kvGetInFlight.set(nsKey, promise)
  try {
    return await promise
  } finally {
    kvGetInFlight.delete(nsKey)
  }
}

/**
 * Read an optional UI preference or other non-critical key. Uses the same
 * failure model as {@link kvGet}, but skips the pack round-trip when this
 * browser already knows the key is absent or has never written it (so unset
 * prefs do not produce console 404 noise on installed packs).
 */
export async function kvGetPreference<T>(key: string, fallback: T): Promise<T> {
  const nsKey = namespaced(key)

  if (!isInCriblIframe()) {
    return lsGet(nsKey, fallback)
  }
  if (isCriblLocalShell()) {
    return lsGet(nsKey, fallback)
  }
  const base = criblApiBase()
  if (!base) {
    return lsGet(nsKey, fallback)
  }
  if (shouldSkipSpeculativeKvGet(nsKey)) {
    if (genericKvShouldMirrorToBrowser()) {
      return lsGet(nsKey, fallback)
    }
    return fallback
  }
  return kvGet(key, fallback)
}

async function kvGetRemote<T>(base: string, nsKey: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(`${base}/kvstore/${nsKey}`)
    if (r.status === 404) {
      markRemoteKvKeyAbsent(nsKey)
      if (genericKvShouldMirrorToBrowser()) {
        return lsGet(nsKey, fallback)
      }
      return fallback
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.warn(`[kvStore] GET ${nsKey} failed: ${r.status} ${r.statusText}`, body.slice(0, 200))
      if (isKvUnknownLocalAppResponse(body)) {
        rememberOpenAiKeyBrowserOnlyAfterKvError()
      }
      if (isKvUnknownLocalAppResponse(body) || genericKvShouldMirrorToBrowser()) {
        return lsGet(nsKey, fallback)
      }
      return fallback
    }
    const text = await r.text()
    if (!text) {
      markRemoteKvKeyAbsent(nsKey)
      if (genericKvShouldMirrorToBrowser()) {
        return lsGet(nsKey, fallback)
      }
      return fallback
    }
    markRemoteKvKeyPresent(nsKey)
    try {
      return JSON.parse(text) as T
    } catch {
      console.warn(`[kvStore] GET ${nsKey}: response was not valid JSON`, text.slice(0, 200))
      if (genericKvShouldMirrorToBrowser()) {
        return lsGet(nsKey, fallback)
      }
      return fallback
    }
  } catch (e) {
    console.warn(`[kvStore] GET ${nsKey} threw:`, e)
    if (genericKvShouldMirrorToBrowser()) {
      return lsGet(nsKey, fallback)
    }
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
    markRemoteKvKeyPresent(nsKey)
    return
  }

  if (isCriblLocalShell()) {
    lsSet(nsKey, value)
    markRemoteKvKeyPresent(nsKey)
    return
  }

  const base = criblApiBase()
  if (!base) {
    lsSet(nsKey, value)
    markRemoteKvKeyPresent(nsKey)
    return
  }

  try {
    const r = await fetch(`${base}/kvstore/${nsKey}`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(value),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.warn(`[kvStore] PUT ${nsKey} failed: ${r.status} ${r.statusText}`, body.slice(0, 200))
      if (isKvUnknownLocalAppResponse(body)) {
        rememberOpenAiKeyBrowserOnlyAfterKvError()
      }
      if (isKvUnknownLocalAppResponse(body) || genericKvShouldMirrorToBrowser()) {
        lsSet(nsKey, value)
        markRemoteKvKeyPresent(nsKey)
      }
      return
    }
    markRemoteKvKeyPresent(nsKey)
  } catch (e) {
    console.warn(`[kvStore] PUT ${nsKey} threw:`, e)
    if (genericKvShouldMirrorToBrowser()) {
      lsSet(nsKey, value)
      markRemoteKvKeyPresent(nsKey)
    }
  }
}

/**
 * Remove a key from KV. Uses PUT with an empty body on installed packs (DELETE
 * can trip the platform fetch proxy on 204). 404 on GET is treated as absent.
 * Errors are logged and swallowed.
 */
export async function kvDelete(key: string): Promise<void> {
  const nsKey = namespaced(key)

  if (!isInCriblIframe()) {
    lsDelete(nsKey)
    return
  }

  if (isCriblLocalShell()) {
    lsDelete(nsKey)
    return
  }

  const base = criblApiBase()
  if (!base) {
    lsDelete(nsKey)
    return
  }

  if (shouldSkipRemoteKvDelete(nsKey)) {
    lsDelete(nsKey)
    markRemoteKvKeyAbsent(nsKey)
    writeKvTouched(nsKey, false)
    return
  }

  try {
    const erased = await kvRemoteEraseKey(base, nsKey)
    if (erased) {
      markRemoteKvKeyAbsent(nsKey)
      writeKvTouched(nsKey, false)
    } else {
      console.warn(`[kvStore] erase ${nsKey} failed — cleared local mirror only`)
      markRemoteKvKeyAbsent(nsKey)
      writeKvTouched(nsKey, false)
    }
  } catch (e) {
    console.warn(`[kvStore] erase ${nsKey} threw:`, e)
  }
  lsDelete(nsKey)
}

// ── OpenAI API key (BYOL assistant): stored at pack KV key `openaiKey` with NO
// `users/<id>/` prefix so `proxies.yml` header injection `kv.openaiKey` resolves.
//
/** Fired after pack KV or browser storage updates the BYOL key so UI can re-probe. */
export const OPENAI_KEY_AVAILABILITY_EVENT = 'adoption-plan-openai-key-availability-changed'

function dispatchOpenAiKeyAvailabilityChanged(): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.dispatchEvent(new CustomEvent(OPENAI_KEY_AVAILABILITY_EVENT))
  } catch {
    /* ignore */
  }
}

//
// **Body format:** store the raw `sk-…` string (plain `text/plain` body), not
// JSON quotes — otherwise `Authorization: 'Bearer ' + kv.openaiKey` can send
// extra `"` characters and OpenAI returns 401. Reads still accept legacy
// JSON-quoted values from older app versions.

const OPENAI_KV_KEY = 'openaiKey'
const OPENAI_KEY_ABSENT_LS_KEY = `${KV_ABSENT_LS_PREFIX}${OPENAI_KV_KEY}`
const OPENAI_KEY_TOUCHED_LS_KEY = `${KV_TOUCHED_LS_PREFIX}${OPENAI_KV_KEY}`
let openAiKeyKnownAbsentOnServer = readOpenAiKeyPersistedAbsent()
let probeOpenAiKeyInFlight: Promise<boolean> | null = null

function readOpenAiKeyPersistedAbsent(): boolean {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return false
  }
  try {
    return ls.getItem(OPENAI_KEY_ABSENT_LS_KEY) === '1'
  } catch {
    return false
  }
}

function writeOpenAiKeyPersistedAbsent(absent: boolean): void {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return
  }
  try {
    if (absent) {
      ls.setItem(OPENAI_KEY_ABSENT_LS_KEY, '1')
    } else {
      ls.removeItem(OPENAI_KEY_ABSENT_LS_KEY)
    }
  } catch {
    /* ignore */
  }
  openAiKeyKnownAbsentOnServer = absent
}

function readOpenAiKeyTouched(): boolean {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return false
  }
  try {
    return ls.getItem(OPENAI_KEY_TOUCHED_LS_KEY) === '1'
  } catch {
    return false
  }
}

function writeOpenAiKeyTouched(touched: boolean): void {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return
  }
  try {
    if (touched) {
      ls.setItem(OPENAI_KEY_TOUCHED_LS_KEY, '1')
    } else {
      ls.removeItem(OPENAI_KEY_TOUCHED_LS_KEY)
    }
  } catch {
    /* ignore */
  }
}

function shouldSkipSpeculativeOpenAiKeyProbe(): boolean {
  if (openAiKeyKnownAbsentOnServer || readOpenAiKeyPersistedAbsent()) {
    return true
  }
  if (readOpenAiKeyTouched() || probeOpenAiKeyPresentInBrowser()) {
    return false
  }
  return true
}

function rawLocalStorageKey(): string {
  return `cribl-kv-raw:${OPENAI_KV_KEY}`
}

/** Rejects prose / UI text accidentally stored where an `sk-…` secret belongs. */
function looksLikeOpenAiApiKey(s: string): boolean {
  const t = s.trim()
  if (t.length < 24 || !t.startsWith('sk-')) {
    return false
  }
  const lower = t.toLowerCase()
  if (
    lower.includes('browser') ||
    lower.includes('storage') ||
    lower.includes('blocked') ||
    lower.includes('sandbox') ||
    lower.includes('private mode')
  ) {
    return false
  }
  return /^sk-[a-zA-Z0-9._-]+$/.test(t)
}

/** Normalize KV / localStorage payload: raw secret or legacy JSON string. */
function normalizeOpenAiSecretFromKvPayload(raw: string): string | null {
  const t = raw.trim()
  if (!t) {
    return null
  }
  try {
    const v = JSON.parse(t) as unknown
    if (typeof v === 'string') {
      const x = v.trim()
      return x.length > 0 ? x : null
    }
  } catch {
    /* plain-text secret */
  }
  return t
}

function openAiSecretFromPackKvText(text: string): string | null {
  const cand = normalizeOpenAiSecretFromKvPayload(text)
  return cand != null && looksLikeOpenAiApiKey(cand) ? cand : null
}

/** Read from `localStorage`; drops junk values (e.g. pasted UI copy). */
function pickOpenAiSecretFromBrowserRaw(raw: string, ls: Storage): string | null {
  const cand = normalizeOpenAiSecretFromKvPayload(raw)
  if (cand == null || !looksLikeOpenAiApiKey(cand)) {
    if (cand != null) {
      try {
        ls.removeItem(rawLocalStorageKey())
        console.warn('[kvStore] Removed invalid openaiKey from browser storage (expected sk-… secret).')
      } catch {
        /* ignore */
      }
    }
    return null
  }
  return cand
}

/**
 * Returns the OpenAI API key when pack KV is not used (plain `localhost`, or
 * hybrid dev with a session hint). In a deployed Cribl app iframe the platform
 * proxy injects `Authorization`; this returns `null` there. Always `null` in the
 * `__local__` shell (`isCriblLocalShell()`).
 */
export function getOpenAiKeyForLocalDevOnly(): string | null {
  if (!openAiKeyUsesBrowserStorageOnly()) {
    return null
  }
  if (memoryOnlyOpenAiKey != null) {
    if (looksLikeOpenAiApiKey(memoryOnlyOpenAiKey)) {
      return memoryOnlyOpenAiKey
    }
    memoryOnlyOpenAiKey = null
  }
  const ls = getSafeLocalStorage()
  if (!ls) {
    return null
  }
  try {
    const raw = ls.getItem(rawLocalStorageKey())
    if (raw == null) {
      return null
    }
    return pickOpenAiSecretFromBrowserRaw(raw, ls)
  } catch {
    return null
  }
}

function probeOpenAiKeyPresentInBrowser(): boolean {
  if (memoryOnlyOpenAiKey != null && looksLikeOpenAiApiKey(memoryOnlyOpenAiKey)) {
    return true
  }
  const ls = getSafeLocalStorage()
  if (!ls) {
    return false
  }
  try {
    const raw = ls.getItem(rawLocalStorageKey())
    if (raw == null) {
      return false
    }
    const key = pickOpenAiSecretFromBrowserRaw(raw, ls)
    return key != null && key.length > 0
  } catch {
    return false
  }
}

export type OpenAiKeySaveResult =
  | { ok: true; devTabMemoryOnly?: true }
  | { ok: false; message: string }

function tryPersistOpenAiKeyToBrowser(trimmed: string): OpenAiKeySaveResult {
  if (!looksLikeOpenAiApiKey(trimmed)) {
    return {
      ok: false,
      message: 'Key must look like an OpenAI API secret (starts with sk-…). Paste the key from platform.openai.com, not other UI text.',
    }
  }
  const ls = getSafeLocalStorage()
  if (ls) {
    try {
      ls.setItem(rawLocalStorageKey(), trimmed)
      memoryOnlyOpenAiKey = null
      return { ok: true }
    } catch {
      memoryOnlyOpenAiKey = trimmed
      return { ok: true, devTabMemoryOnly: true }
    }
  }
  memoryOnlyOpenAiKey = trimmed
  return { ok: true, devTabMemoryOnly: true }
}

/**
 * Returns whether a non-empty OpenAI API key exists at the pack KV key
 * `openaiKey` (the path expected by `kv.openaiKey` in `proxies.yml`).
 * Does not expose the secret to callers.
 */
export async function probeOpenAiKeyPresent(): Promise<boolean> {
  if (isCriblLocalShell()) {
    return false
  }
  if (openAiKeyUsesBrowserStorageOnly()) {
    return probeOpenAiKeyPresentInBrowser()
  }
  if (shouldSkipSpeculativeOpenAiKeyProbe()) {
    return false
  }
  if (probeOpenAiKeyInFlight) {
    return probeOpenAiKeyInFlight
  }

  probeOpenAiKeyInFlight = probeOpenAiKeyPresentRemote()
  try {
    return await probeOpenAiKeyInFlight
  } finally {
    probeOpenAiKeyInFlight = null
  }
}

async function probeOpenAiKeyPresentRemote(): Promise<boolean> {
  try {
    const base = criblApiBase()
    if (!base) {
      return false
    }
    const r = await fetch(`${base}/kvstore/${OPENAI_KV_KEY}`)
    const text = await r.text().catch(() => '')
    if (!r.ok) {
      if (r.status === 404) {
        writeOpenAiKeyPersistedAbsent(true)
        writeOpenAiKeyTouched(false)
      }
      if (isKvUnknownLocalAppResponse(text)) {
        rememberOpenAiKeyBrowserOnlyAfterKvError()
        return probeOpenAiKeyPresentInBrowser()
      }
      return false
    }
    if (!text) {
      writeOpenAiKeyPersistedAbsent(true)
      writeOpenAiKeyTouched(false)
      return false
    }
    const key = openAiSecretFromPackKvText(text)
    const present = key != null && key.length > 0
    if (present) {
      writeOpenAiKeyPersistedAbsent(false)
      writeOpenAiKeyTouched(true)
    } else {
      writeOpenAiKeyPersistedAbsent(true)
      writeOpenAiKeyTouched(false)
    }
    return present
  } catch {
    return false
  }
}

function describeOpenAiKeyPutFailure(status: number, statusText: string, body: string): string {
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 200)
  const extra = snippet ? ` ${snippet}` : ''
  if (status === 401 || status === 403) {
    return `HTTP ${status}: write to pack key \`openaiKey\` was denied.${extra} Your role may lack KV write access for this app — ask a workspace or app admin.`
  }
  if (status === 400 || status === 422) {
    return `HTTP ${status}: the server rejected the key payload.${extra} Confirm the value looks like a valid OpenAI API key.`
  }
  if (status >= 500) {
    return `HTTP ${status}: upstream error while saving.${extra} Retry in a moment.`
  }
  return `HTTP ${status} ${statusText}.${extra ? ` ${extra}` : ''}`
}

/** Persist OpenAI API key for proxy injection. */
export async function kvSetOpenAiKey(apiKey: string): Promise<OpenAiKeySaveResult> {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    return { ok: false, message: 'Enter a non-empty API key.' }
  }

  if (isCriblLocalShell()) {
    return {
      ok: false,
      message:
        'BYOL OpenAI is not available in the Cribl `__local__` shell. Install the pack on a tenant and open **Settings** in the **deployed** app to set pack KV `openaiKey` (see `proxies.yml`).',
    }
  }

  if (openAiKeyUsesBrowserStorageOnly()) {
    const r = tryPersistOpenAiKeyToBrowser(trimmed)
    if (r.ok) {
      dispatchOpenAiKeyAvailabilityChanged()
    }
    return r
  }

  const base = criblApiBase()
  if (!base) {
    return {
      ok: false,
      message: 'CRIBL_API_URL is not set — open Adoption Plan from the Cribl Apps UI (installed pack or dev iframe).',
    }
  }

  if (!looksLikeOpenAiApiKey(trimmed)) {
    return {
      ok: false,
      message:
        'Key must look like an OpenAI API secret (starts with sk-…). Paste the key from platform.openai.com.',
    }
  }

  try {
    const r = await fetch(`${base}/kvstore/${OPENAI_KV_KEY}`, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: trimmed,
    })
    const body = await r.text().catch(() => '')
    if (!r.ok) {
      if (isKvUnknownLocalAppResponse(body)) {
        rememberOpenAiKeyBrowserOnlyAfterKvError()
        const r = tryPersistOpenAiKeyToBrowser(trimmed)
        if (r.ok) {
          dispatchOpenAiKeyAvailabilityChanged()
        }
        return r
      }
      console.warn(`[kvStore] PUT ${OPENAI_KV_KEY} failed: ${r.status} ${r.statusText}`, body.slice(0, 200))
      return {
        ok: false,
        message: describeOpenAiKeyPutFailure(r.status, r.statusText, body),
      }
    }
    dispatchOpenAiKeyAvailabilityChanged()
    writeOpenAiKeyPersistedAbsent(false)
    writeOpenAiKeyTouched(true)
    return { ok: true }
  } catch (e) {
    console.warn(`[kvStore] PUT ${OPENAI_KV_KEY} threw:`, e)
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, message: `Network or browser error: ${msg}` }
  }
}

/** Remove the OpenAI API key from pack KV. */
export async function kvClearOpenAiKey(): Promise<void> {
  try {
    memoryOnlyOpenAiKey = null
    if (isCriblLocalShell()) {
      const ls = getSafeLocalStorage()
      if (ls) {
        try {
          ls.removeItem(rawLocalStorageKey())
        } catch {
          /* ignore */
        }
      }
      return
    }
  if (openAiKeyUsesBrowserStorageOnly()) {
    const ls = getSafeLocalStorage()
    if (ls) {
      try {
        ls.removeItem(rawLocalStorageKey())
      } catch {
        /* ignore */
      }
    }
    return
  }

  const base = criblApiBase()
  if (!base) {
    return
  }

  if (readOpenAiKeyPersistedAbsent()) {
    return
  }
  if (!readOpenAiKeyTouched() && !probeOpenAiKeyPresentInBrowser()) {
    writeOpenAiKeyPersistedAbsent(true)
    return
  }

  try {
    const erased = await kvRemoteEraseKey(base, OPENAI_KV_KEY)
    if (erased) {
      writeOpenAiKeyPersistedAbsent(true)
      writeOpenAiKeyTouched(false)
    } else {
      console.warn(`[kvStore] erase ${OPENAI_KV_KEY} failed`)
    }
  } catch (e) {
    console.warn(`[kvStore] erase ${OPENAI_KV_KEY} threw:`, e)
  }
  } finally {
    dispatchOpenAiKeyAvailabilityChanged()
  }
}
