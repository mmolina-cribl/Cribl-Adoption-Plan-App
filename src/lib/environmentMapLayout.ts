import { getSafeLocalStorage } from './safeLocalStorage'
import type { NodePositionMap } from './environmentFlowGraph'

const LS_PREFIX = 'adoption-plan-environment-map-layout:'

function storageKey(scopeKey: string): string {
  return `${LS_PREFIX}${scopeKey}`
}

export function readEnvironmentMapLayout(scopeKey: string): NodePositionMap {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return {}
  }
  try {
    const raw = ls.getItem(storageKey(scopeKey))
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    const out: NodePositionMap = {}
    for (const [id, pos] of Object.entries(parsed)) {
      if (
        pos &&
        typeof pos === 'object' &&
        typeof (pos as { x?: unknown }).x === 'number' &&
        typeof (pos as { y?: unknown }).y === 'number'
      ) {
        out[id] = { x: (pos as { x: number }).x, y: (pos as { y: number }).y }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function writeEnvironmentMapLayout(scopeKey: string, positions: NodePositionMap): void {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return
  }
  if (Object.keys(positions).length === 0) {
    ls.removeItem(storageKey(scopeKey))
    return
  }
  ls.setItem(storageKey(scopeKey), JSON.stringify(positions))
}

export function clearEnvironmentMapLayout(scopeKey: string): void {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return
  }
  ls.removeItem(storageKey(scopeKey))
}
