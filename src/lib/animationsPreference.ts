import { useEffect, useState } from 'react'
import { kvGet, kvSet } from './kvStore'

/**
 * Per-user "Animations enabled" preference.
 *
 * When `true` (the default), bars, pie graphs, and resource-map
 * connectors play a subtle entry animation the first time they
 * mount inside a view. Customers with motion sensitivities, or who
 * just prefer instant rendering, can flip this off in Settings.
 *
 * Persistence model mirrors `detailCardsPreference.ts`:
 *   - Synchronous in-memory cache (`enabled`) backs every read.
 *   - Cache is hydrated from KV on module load (fire-and-forget).
 *   - Until hydration completes, callers see the default. For an
 *     "animations on/off" knob the worst case is one extra entry
 *     animation on cold start, which is benign.
 *   - Writes update the cache immediately and persist to KV in the
 *     background.
 *
 * Components that need to *react* to changes from the Settings page
 * mount the `useAnimationsEnabled()` hook so they can transition
 * between modes without a page reload.
 */

const KEY = 'prefs/animations-enabled'
const DEFAULT_ENABLED = true

let enabled: boolean = DEFAULT_ENABLED
const listeners = new Set<(v: boolean) => void>()

void (async () => {
  enabled = await kvGet<boolean>(KEY, DEFAULT_ENABLED)
  for (const fn of listeners) {
    fn(enabled)
  }
})()

export function getAnimationsEnabled(): boolean {
  return enabled
}

export function setAnimationsEnabled(v: boolean): void {
  if (enabled === v) return
  enabled = v
  for (const fn of listeners) {
    fn(enabled)
  }
  void kvSet(KEY, v)
}

/**
 * React hook that returns the current "animations enabled" value
 * and re-renders the calling component whenever the preference
 * changes (e.g. when the user toggles it in Settings while a chart
 * is on screen).
 */
export function useAnimationsEnabled(): boolean {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((n) => n + 1)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return enabled
}

/**
 * One-shot "entry animation" hook. Returns a boolean that is
 * `false` during the first paint of the calling component and
 * flips to `true` on the next animation frame, giving CSS
 * transitions a clean off → on edge to animate against.
 *
 * If animations are disabled (or the user has the OS-level
 * `prefers-reduced-motion` setting on), the hook returns `true`
 * synchronously on the first paint so charts / connectors render
 * at their final state with no transition.
 *
 * The hook deliberately does NOT re-trigger when the user toggles
 * the preference mid-session. Toggling animations on after the
 * chart already settled would replay the entry effect on every
 * preference change, which feels noisy. The user gets the new
 * behaviour on the next navigation that remounts the chart.
 */
export function useEntryAnimation(): { animated: boolean; enabled: boolean } {
  const enabled = useAnimationsEnabled()
  const reduced = usePrefersReducedMotion()
  const active = enabled && !reduced
  // Initial state is the *final* value when animations are off, and
  // `false` (pre-animation) when they're on. This avoids a sync
  // setState in the effect body.
  const [animated, setAnimated] = useState<boolean>(() => !active)
  useEffect(() => {
    // Already at the final state for the current `active` mode.
    if (animated) return
    if (!active) {
      // Pref flipped off after mount before the entry animation got
      // a chance to play. Settle to the final state via a microtask
      // so we're not setting state synchronously in the effect body.
      const t = setTimeout(() => setAnimated(true), 0)
      return () => clearTimeout(t)
    }
    // Two RAFs: first to commit the "off" state to the DOM, second
    // to flip to "on" so the browser picks up the transition. A
    // single RAF can race with React's batching on the very first
    // mount and the transition is skipped.
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setAnimated(true))
    })
    return () => {
      cancelAnimationFrame(r1)
      if (r2) cancelAnimationFrame(r2)
    }
  }, [active, animated])
  return { animated, enabled: active }
}

/**
 * Mirrors the OS `prefers-reduced-motion` media query so we can
 * automatically suppress entry animations for users who've set it.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}
