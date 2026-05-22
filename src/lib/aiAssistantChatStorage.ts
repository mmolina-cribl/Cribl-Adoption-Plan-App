import type { PlanState } from '../types/planTypes'
import { getSafeLocalStorage } from './safeLocalStorage'

export type PersistedChatMessage = { role: 'user' | 'assistant'; text: string }

const STORAGE_PREFIX = 'cribl-adoption-ai-chat-v2:'
const MAX_MESSAGES = 100
const MAX_BYTES = 450_000

function scrubSegment(s: string): string {
  return s.replace(/:/g, '_').slice(0, 120)
}

/**
 * Stable id for localStorage: app install (when known) + coarse plan shape so
 * unrelated tenants / blank vs filled plans do not share one thread.
 *
 * Coerces segments with `String()` so malformed KV blobs (e.g. numeric
 * `customerName`) cannot throw during render and blank the UI.
 */
export function planChatStorageId(plan: PlanState): string {
  try {
    let app = 'local'
    if (typeof window !== 'undefined') {
      const id = (window as { CRIBL_APP_ID?: unknown }).CRIBL_APP_ID
      const s = typeof id === 'string' ? id.trim() : id != null ? String(id).trim() : ''
      if (s) {
        app = scrubSegment(s)
      }
    }
    const nameRaw = String(plan.customerName ?? '')
      .trim()
      .toLowerCase()
    const name = scrubSegment(nameRaw || 'unnamed')
    const prov = scrubSegment(String(plan.planProvenance?.kind ?? 'scratch'))
    const wgLen = Array.isArray(plan.workerGroups) ? plan.workerGroups.length : 0
    const srcLen = Array.isArray(plan.sourceSummary) ? plan.sourceSummary.length : 0
    return `${app}:${name}:${prov}:${wgLen}:${srcLen}`
  } catch {
    return 'local:unnamed:scratch:0:0'
  }
}

export function loadPersistedChatMessages(id: string): PersistedChatMessage[] {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return []
  }
  try {
    const raw = ls.getItem(STORAGE_PREFIX + id)
    if (raw == null) {
      return []
    }
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) {
      return []
    }
    const out: PersistedChatMessage[] = []
    for (const x of data) {
      if (!x || typeof x !== 'object') {
        continue
      }
      const role = (x as { role?: unknown }).role
      const text = (x as { text?: unknown }).text
      if (role !== 'user' && role !== 'assistant') {
        continue
      }
      if (typeof text !== 'string') {
        continue
      }
      out.push({ role, text: text.slice(0, 80_000) })
    }
    return out.slice(-MAX_MESSAGES)
  } catch {
    return []
  }
}

/** Persist chat (including an empty list after “Clear chat”). */
export function savePersistedChatMessages(id: string, messages: PersistedChatMessage[]): void {
  const ls = getSafeLocalStorage()
  if (!ls) {
    return
  }
  try {
    let trimmed = messages.slice(-MAX_MESSAGES)
    for (;;) {
      const json = JSON.stringify(trimmed)
      if (json.length <= MAX_BYTES || trimmed.length <= 1) {
        ls.setItem(STORAGE_PREFIX + id, json)
        return
      }
      trimmed = trimmed.slice(-Math.max(1, Math.floor(trimmed.length * 0.75)))
    }
  } catch {
    try {
      ls.removeItem(STORAGE_PREFIX + id)
    } catch {
      /* ignore */
    }
  }
}
