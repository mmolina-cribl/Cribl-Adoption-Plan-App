import { useEffect, useState } from 'react'
import { kvGet, kvSet } from './kvStore'

/**
 * KV-backed dismissal flag for the "Plan in shape? Activate it." nudge
 * on the Plan dashboard. Once the user clicks the (×), the callout
 * stays hidden until they reset the flag from Settings (or set an
 * Activation tier — at which point the compact tier strip takes over,
 * which is informational, not a nudge, and isn't dismissible).
 *
 * Same shape / hydration trade-off as `detailCardsPreference.ts`:
 *   - In-memory cache + fire-and-forget KV writes for snappy reads.
 *   - First paint after a hard refresh sees the default (`false` — not
 *     dismissed). If the user previously dismissed, there's a brief
 *     flash of the callout before hydration flips it back to hidden.
 *     Acceptable for a one-time nudge.
 *   - Default false. The callout is the primary "next step" prompt; we
 *     want first-time customers to see it.
 *
 * App-scoped, not plan-scoped. Each user dismisses once; the dismissal
 * persists across plan imports / exports / new-plan flows. If we
 * later want per-plan dismissal, the right shape is to lift it onto
 * `PlanState.activation` itself rather than splitting the KV key.
 */
const KEY = 'prefs/plan-overview/activation-callout-dismissed'

const DEFAULT_DISMISSED = false

let cache: boolean = DEFAULT_DISMISSED

void (async () => {
  cache = await kvGet<boolean>(KEY, DEFAULT_DISMISSED)
})()

/**
 * React hook over the in-memory cache. Reactivity matters here because
 * dismissal flips the callout's visibility instantly — a stale closure
 * would keep showing it after the (×) click until the next external
 * re-render.
 *
 * On mount we re-read the KV value (covers cold-start before hydration
 * completed) and subscribe to writes. The setter both updates local
 * state (synchronously, for snappy UX) and persists to KV.
 */
export function useActivationCalloutDismissed(): readonly [boolean, (v: boolean) => void] {
  const [dismissed, setDismissedLocal] = useState<boolean>(cache)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const v = await kvGet<boolean>(KEY, DEFAULT_DISMISSED)
      if (!cancelled) {
        cache = v
        setDismissedLocal(v)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const setDismissed = (v: boolean) => {
    cache = v
    setDismissedLocal(v)
    void kvSet(KEY, v)
  }

  return [dismissed, setDismissed] as const
}
