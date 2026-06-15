/**
 * Persisted UI defaults for **Import from live tenant** and **Import from diagnostic bundle**.
 * Uses browser `localStorage` (same pattern as other small prefs; works in standalone + iframe when allowed).
 */
import { getSafeLocalStorage } from './safeLocalStorage'

const LS_OMIT_STOCK = 'adoption-plan-import-omit-stock-groups'
const LS_OMIT_DISABLED = 'adoption-plan-import-omit-disabled-inputs'

/** When true, Leader groups `default` / `defaultHybrid` / `default_fleet` / `default_outpost` are not harvested. Default false. */
export function readImportOmitStockGroups(): boolean {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return false
  }
  return ls.getItem(LS_OMIT_STOCK) === '1'
}

export function writeImportOmitStockGroups(value: boolean): void {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return
  }
  if (value) {
    ls.setItem(LS_OMIT_STOCK, '1')
  } else {
    ls.setItem(LS_OMIT_STOCK, '0')
  }
}

/** When true, Leader inputs with `disabled: true` are not harvested. Default true. */
export function readImportOmitDisabledInputs(): boolean {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return true
  }
  const v = ls.getItem(LS_OMIT_DISABLED)
  if (v === '0') {
    return false
  }
  return true
}

export function writeImportOmitDisabledInputs(value: boolean): void {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return
  }
  if (value) {
    ls.setItem(LS_OMIT_DISABLED, '1')
  } else {
    ls.setItem(LS_OMIT_DISABLED, '0')
  }
}
