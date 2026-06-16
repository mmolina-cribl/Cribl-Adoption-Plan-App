import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as safeLocalStorage from './safeLocalStorage'
import {
  readShowDisabledSourcesInLists,
  writeShowDisabledSourcesInLists,
} from './showDisabledSourcesPreference'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => {
      m.delete(k)
    },
    setItem: (k: string, v: string) => {
      m.set(k, v)
    },
  } as Storage
}

describe('showDisabledSourcesPreference', () => {
  beforeEach(() => {
    vi.spyOn(safeLocalStorage, 'getSafeLocalStorage').mockReturnValue(memoryStorage())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to hiding disabled sources (checkbox unchecked)', () => {
    expect(readShowDisabledSourcesInLists()).toBe(false)
  })

  it('persists show / hide', () => {
    writeShowDisabledSourcesInLists(true)
    expect(readShowDisabledSourcesInLists()).toBe(true)
    writeShowDisabledSourcesInLists(false)
    expect(readShowDisabledSourcesInLists()).toBe(false)
  })

  it('treats legacy explicit hide (0) as hidden', () => {
    const ls = safeLocalStorage.getSafeLocalStorage()
    expect(ls).not.toBeNull()
    ls!.setItem('adoption-plan-show-disabled-sources-in-lists', '0')
    expect(readShowDisabledSourcesInLists()).toBe(false)
  })
})
