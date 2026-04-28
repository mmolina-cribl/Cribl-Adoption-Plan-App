/**
 * In-memory + IndexedDB cache for the last **imported** .xlsx bytes. Export re-reads that
 * buffer so the downloaded file matches the CSE’s file (sheets, styles, input_data) with
 * only modeled cells updated. Cleared on “Clear plan”.
 */

const DB_NAME = 'cribl-adoption-web'
const DB_VERSION = 1
const STORE = 'importShell'
const IDB_KEY = 'buffer'

let memory: ArrayBuffer | null = null

function openWithStore(): IDBOpenDBRequest | null {
  // In sandboxed iframes (e.g. Cribl App Platform without `allow-same-origin`),
  // even reading `window.indexedDB` throws a SecurityError. The classic
  // `typeof indexedDB === 'undefined'` guard does not help, so we try/catch.
  let req: IDBOpenDBRequest
  try {
    req = indexedDB.open(DB_NAME, DB_VERSION)
  } catch {
    return null
  }
  req.onupgradeneeded = (e) => {
    const db = (e.target as IDBOpenDBRequest).result
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE)
    }
  }
  return req
}

function idbSet(ab: ArrayBuffer | null): Promise<void> {
  return new Promise((resolve) => {
    const req = openWithStore()
    if (!req) {
      resolve()
      return
    }
    req.onerror = () => resolve()
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.close()
        resolve()
        return
      }
      const tx = db.transaction(STORE, 'readwrite')
      if (ab) {
        tx.objectStore(STORE).put(ab, IDB_KEY)
      } else {
        tx.objectStore(STORE).delete(IDB_KEY)
      }
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
    }
  })
}

/** Synchronous read for the export click path. */
export function getImportShellBuffer(): ArrayBuffer | null {
  return memory
}

/** Import succeeded — store a copy; cleared by {@link clearImportShell}. */
export function setImportShellFromBytes(bytes: Uint8Array) {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  memory = ab
  void idbSet(ab)
}

/** On app start, restore import shell for export after a refresh. */
export function hydrateImportShellFromIdb(): Promise<void> {
  return new Promise((resolve) => {
    const req = openWithStore()
    if (!req) {
      resolve()
      return
    }
    req.onerror = () => resolve()
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.close()
        resolve()
        return
      }
      const g = db.transaction(STORE, 'readonly').objectStore(STORE).get(IDB_KEY)
      g.onsuccess = () => {
        const v = g.result
        if (v instanceof ArrayBuffer) {
          memory = v
        } else {
          memory = null
        }
        db.close()
        resolve()
      }
      g.onerror = () => {
        db.close()
        resolve()
      }
    }
  })
}

export function clearImportShell() {
  memory = null
  void idbSet(null)
}
