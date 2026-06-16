/**
 * Persisted UI: whether **disabled** sources appear in the Sources index,
 * left-rail source list, and mobile source chips. Default off; uses `localStorage`.
 */
import { getSafeLocalStorage } from './safeLocalStorage'

const LS_KEY = 'adoption-plan-show-disabled-sources-in-lists'

/**
 * Default **false** — disabled rows are hidden in the Sources index and nav until
 * the user turns on “Show disabled”. Persisted `'1'` means show; absent or any
 * other value means hide (including legacy `'0'` from the previous default-on scheme).
 */
export function readShowDisabledSourcesInLists(): boolean {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return false
  }
  return ls.getItem(LS_KEY) === '1'
}

export function writeShowDisabledSourcesInLists(show: boolean): void {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return
  }
  if (show) {
    ls.setItem(LS_KEY, '1')
  } else {
    ls.removeItem(LS_KEY)
  }
}
