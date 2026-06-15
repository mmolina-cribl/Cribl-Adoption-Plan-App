import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as safeLocalStorage from './safeLocalStorage'
import {
  readImportOmitDisabledInputs,
  readImportOmitStockGroups,
  writeImportOmitDisabledInputs,
  writeImportOmitStockGroups,
} from './importHarvestOptions'

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

describe('importHarvestOptions', () => {
  beforeEach(() => {
    vi.spyOn(safeLocalStorage, 'getSafeLocalStorage').mockReturnValue(memoryStorage())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults: include stock groups, omit disabled inputs', () => {
    expect(readImportOmitStockGroups()).toBe(false)
    expect(readImportOmitDisabledInputs()).toBe(true)
  })

  it('persists stock toggle', () => {
    writeImportOmitStockGroups(true)
    expect(readImportOmitStockGroups()).toBe(true)
    writeImportOmitStockGroups(false)
    expect(readImportOmitStockGroups()).toBe(false)
  })

  it('persists disabled toggle', () => {
    writeImportOmitDisabledInputs(false)
    expect(readImportOmitDisabledInputs()).toBe(false)
    writeImportOmitDisabledInputs(true)
    expect(readImportOmitDisabledInputs()).toBe(true)
  })
})
