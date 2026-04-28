/**
 * In-memory + KV cache for the last **imported** .xlsx bytes. Export re-reads
 * that buffer so the downloaded file matches the CSE's file (sheets, styles,
 * input_data) with only modeled cells updated. Cleared on "Clear plan".
 *
 * The in-memory `memory: ArrayBuffer | null` is the synchronous read path for
 * Export's click handler. KV is the persistent backing store: hydrated into
 * `memory` on app start, written back on every successful import, deleted on
 * "Clear plan".
 *
 * KV stores text only, so the ArrayBuffer is base64-encoded on write and
 * decoded on read. For typical .xlsx files (a few hundred KB to a few MB)
 * the base64 inflation (~33%) and the encode/decode work are negligible.
 * Very large workbooks (~50MB+) may want a different transport eventually.
 */

import { kvDelete, kvGet, kvSet } from './kvStore'

const KEY = 'import-shell'

let memory: ArrayBuffer | null = null

/**
 * Chunked base64 encode that avoids the "stack overflow" / "argument list
 * too long" failure mode of `String.fromCharCode(...largeArray)` on big
 * buffers. 32 KB chunk is well under every browser's apply() limit.
 */
function arrayBufferToBase64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToArrayBuffer(s: string): ArrayBuffer {
  const binary = atob(s)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/** Synchronous read for the export click path. */
export function getImportShellBuffer(): ArrayBuffer | null {
  return memory
}

/** Import succeeded — store a copy; cleared by {@link clearImportShell}. */
export function setImportShellFromBytes(bytes: Uint8Array) {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  memory = ab
  void kvSet(KEY, arrayBufferToBase64(ab))
}

/** On app start, restore import shell from KV so Export still works after a refresh. */
export async function hydrateImportShell(): Promise<void> {
  const b64 = await kvGet<string | null>(KEY, null)
  if (typeof b64 !== 'string' || b64.length === 0) {
    memory = null
    return
  }
  try {
    memory = base64ToArrayBuffer(b64)
  } catch {
    // Corrupt/truncated value in KV — treat as missing.
    memory = null
  }
}

export function clearImportShell() {
  memory = null
  void kvDelete(KEY)
}
