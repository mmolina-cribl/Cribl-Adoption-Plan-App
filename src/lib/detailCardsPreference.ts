const SOURCE_KEY = 'cribl-adoption-detailcards-source-expanded-v1'
const WG_KEY = 'cribl-adoption-detailcards-workergroup-expanded-v1'

function readBool(key: string, defaultValue: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v === 'true') return true
    if (v === 'false') return false
  } catch {
    /* ignore */
  }
  return defaultValue
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? 'true' : 'false')
  } catch {
    /* ignore */
  }
}

export function getSourceDetailCardsExpanded(): boolean {
  return readBool(SOURCE_KEY, true)
}

export function setSourceDetailCardsExpanded(v: boolean): void {
  writeBool(SOURCE_KEY, v)
}

export function getWorkerGroupDetailCardsExpanded(): boolean {
  return readBool(WG_KEY, true)
}

export function setWorkerGroupDetailCardsExpanded(v: boolean): void {
  writeBool(WG_KEY, v)
}

