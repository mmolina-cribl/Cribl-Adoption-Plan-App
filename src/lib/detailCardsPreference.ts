import { kvGet, kvSet } from './kvStore'

const SOURCE_KEY = 'prefs/detail-cards/source'
const WG_KEY = 'prefs/detail-cards/worker-group'

const DEFAULT_EXPANDED = true

// In-memory caches. Reads are synchronous against these; writes update both
// the cache (immediately) and KV (asynchronously, fire-and-forget). On first
// import, an IIFE hydrates each cache from KV.
//
// Until hydration completes, callers see the default (true). For these cards
// that's a flash-of-default on the first render after a hard refresh — the
// cards expand-then-collapse if the user had previously collapsed them. This
// is the trade-off agreed in CRIBL_DEV_NOTES.md "Decision 1": small UI prefs
// hydrate after first paint to avoid gating the whole app on a KV round-trip.
let sourceExpanded: boolean = DEFAULT_EXPANDED
let wgExpanded: boolean = DEFAULT_EXPANDED

void (async () => {
  sourceExpanded = await kvGet<boolean>(SOURCE_KEY, DEFAULT_EXPANDED)
})()
void (async () => {
  wgExpanded = await kvGet<boolean>(WG_KEY, DEFAULT_EXPANDED)
})()

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
