import { kvGetPreference, kvSet } from './kvStore'

const SOURCE_KEY = 'prefs/detail-cards/source'
const WG_KEY = 'prefs/detail-cards/worker-group'

const DEFAULT_EXPANDED = true

// In-memory caches. Reads are synchronous against these; writes update both
// the cache (immediately) and KV (asynchronously, fire-and-forget). Hydration
// is lazy — see `ensureDetailCardsPreferenceHydrated`.
let sourceExpanded: boolean = DEFAULT_EXPANDED
let wgExpanded: boolean = DEFAULT_EXPANDED
let hydratePromise: Promise<void> | null = null

export function ensureDetailCardsPreferenceHydrated(): void {
  if (hydratePromise) {
    return
  }
  hydratePromise = (async () => {
    sourceExpanded = await kvGetPreference<boolean>(SOURCE_KEY, DEFAULT_EXPANDED)
    wgExpanded = await kvGetPreference<boolean>(WG_KEY, DEFAULT_EXPANDED)
  })()
}

export function whenDetailCardsPreferenceHydrated(): Promise<void> {
  ensureDetailCardsPreferenceHydrated()
  return hydratePromise ?? Promise.resolve()
}

export function getSourceDetailCardsExpanded(): boolean {
  return sourceExpanded
}

export function setSourceDetailCardsExpanded(v: boolean): void {
  sourceExpanded = v
  void kvSet(SOURCE_KEY, v)
}

export function getWorkerGroupDetailCardsExpanded(): boolean {
  return wgExpanded
}

export function setWorkerGroupDetailCardsExpanded(v: boolean): void {
  wgExpanded = v
  void kvSet(WG_KEY, v)
}
