import { kvDelete, kvGet, kvSet } from './kvStore'

const KEY = 'prefs/post-add'

export type PostAddDefaultChoice = 'wizard' | 'manual'

// In-memory cache of the value. Reads are synchronous against this; writes
// update both the cache (immediately) and KV (asynchronously, fire-and-forget).
//
// Initial value is `null` ("no preference"); the auto-hydration below replaces
// it once the GET resolves. If a read happens during the brief window before
// hydration completes, callers see `null` — same as "user has never set this",
// which means the post-add choice dialog appears once. Acceptable flash-of-
// default for a setting that's only consulted inside a click handler (well
// after mount).
let cached: PostAddDefaultChoice | null = null

void (async () => {
  cached = await kvGet<PostAddDefaultChoice | null>(KEY, null)
})()

/**
 * If set, the "How do you want to get started?" step is skipped for new sources.
 */
export function getPostAddPreference(): PostAddDefaultChoice | null {
  return cached
}

export function setPostAddPreference(choice: PostAddDefaultChoice): void {
  cached = choice
  void kvSet(KEY, choice)
}

export function clearPostAddPreference(): void {
  cached = null
  void kvDelete(KEY)
}
