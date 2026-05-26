/**
 * In-browser **.tar.gz** (gzip-compressed tar) reader for Cribl **diag** bundles.
 * Used only on the Import page — no upload to a server.
 */

function hasGzipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

/** Decompress gzip using the platform `DecompressionStream` when available. */
export async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as unknown as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream
  if (!DS) {
    throw new Error(
      'This browser cannot decompress .tar.gz (no DecompressionStream). Try a current Chrome, Edge, or Firefox.',
    )
  }
  const copy = new Uint8Array(input)
  const stream = new Blob([copy]).stream().pipeThrough(new DS('gzip'))
  const out = await new Response(stream).arrayBuffer()
  return new Uint8Array(out)
}

/** If bytes are gzip-wrapped, decompress; otherwise return a copy (plain `.tar`). */
export async function maybeGunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (hasGzipMagic(bytes)) {
    return gunzipBytes(bytes)
  }
  return bytes
}

function readOctal(field: Uint8Array): number {
  const s = new TextDecoder('ascii').decode(field).replace(/\0/g, '').trim()
  if (!s) {
    return 0
  }
  const n = parseInt(s, 8)
  return Number.isFinite(n) ? n : 0
}

function trimAscii(buf: Uint8Array): string {
  const i = buf.findIndex((b) => b === 0)
  const slice = i === -1 ? buf : buf.subarray(0, i)
  return new TextDecoder('utf-8', { fatal: false }).decode(slice).replace(/\0/g, '')
}

export type TarFileEntry = { path: string; data: Uint8Array }

/**
 * Parse a **POSIX ustar** tar archive into path → file bytes.
 * Skips directories, symlinks, and long-link extension blocks without following GNU chains (diag bundles use short paths).
 */
export function parseTarArchive(tarBytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>()
  let offset = 0
  const u8 = tarBytes

  while (offset + 512 <= u8.length) {
    const header = u8.subarray(offset, offset + 512)
    offset += 512

    if (header.every((b) => b === 0)) {
      break
    }

    const name = trimAscii(header.subarray(0, 100))
    const prefix = trimAscii(header.subarray(345, 500))
    const path = prefix ? `${prefix}/${name}`.replace(/\/+/g, '/') : name
    const size = readOctal(header.subarray(124, 136))
    const typeflag = header[156] ?? 0

    const dataStart = offset
    const padded = Math.ceil(size / 512) * 512
    offset += padded

    if (!path || size < 0 || dataStart + size > u8.length) {
      continue
    }

    const data = u8.subarray(dataStart, dataStart + size)

    // '0' or NUL = regular file; '5' = directory
    if (typeflag === 0x30 || typeflag === 0) {
      const norm = path.replace(/\\/g, '/').replace(/^\.\/+/, '')
      if (norm) {
        out.set(norm, data)
      }
    }
  }

  return out
}

/** Gunzip (if needed) + parse tar → normalized forward-slash paths. */
export async function extractTarGzArchive(archiveBytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const tar = await maybeGunzip(archiveBytes)
  return parseTarArchive(tar)
}
