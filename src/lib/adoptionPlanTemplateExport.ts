/**
 * In-memory cache for the official **empty** v0.9.1 shell
 * (`public/adoption-plan-empty.xlsx`). Actual in-place fill (styles
 * preserved) is in `v091ExportWorkbook.ts` (v0.9.1 multi-sheet pipeline) or
 * `adoptionPlanShellExceljs.ts` (legacy v0.8.6 fallback). The router in
 * `workbookDownload.ts#fillShell` decides at export time.
 *
 * ## How the gold template is loaded
 *
 * Two build flavors, two load strategies — both routed through the same
 * runtime resolver here so call sites don't need to care:
 *
 *   - **Cribl Apps build** (`npm run build`, served from inside the
 *     App Platform iframe): `fetch('/adoption-plan-empty.xlsx')` against
 *     the platform's static-asset host. Fast warm-cache hit on every
 *     subsequent export.
 *
 *   - **Standalone HTML build** (`npm run build:standalone`, opened via
 *     `file://`): the .xlsx is **inlined into the bundled JS at build
 *     time** as a base64 string, exposed by the virtual module
 *     `virtual:embedded-gold-template` (registered by the
 *     {@link inlineGoldTemplatePlugin} in `vite.standalone.config.ts`).
 *     We try the runtime `fetch` first (cheap, harmless to attempt), and
 *     fall back to the inlined buffer when the fetch fails — which it
 *     always does under `file://` because every modern browser blocks
 *     cross-origin local-file fetches by default.
 *
 * The primary `vite.config.ts` registers a **no-op stub** for the same
 * virtual module that exports `hasEmbeddedGoldTemplate = false`, so the
 * dynamic import resolves cleanly in the App-Platform build too without
 * shipping any base64 payload (the stub adds ~50 bytes to the bundle).
 * That means the same runtime branching logic works in both targets,
 * picked apart only by the per-target build-time data the virtual
 * module hands back.
 */

let cachedAdoptionPlanEmpty: ArrayBuffer | null = null

export function getCachedAdoptionPlanEmptyBuffer(): ArrayBuffer | null {
  return cachedAdoptionPlanEmpty
}

/** Set when preloading the shell in `App` (optional; see {@link fetchAdoptionPlanEmptyBufferIfMissing}). */
export function setAdoptionPlanEmptyBuffer(b: ArrayBuffer | null) {
  cachedAdoptionPlanEmpty = b
}

/**
 * Decode the build-time-embedded base64 gold template into a fresh
 * ArrayBuffer. Returns `null` on any failure (including the case where
 * the virtual module isn't available — e.g. someone wires this loader
 * into a non-standalone build by mistake; the dynamic import resolves
 * to a missing module at runtime and we just return `null`).
 *
 * Allocation note: each call returns its own ArrayBuffer copy. JSZip
 * keeps internal references to whatever buffer it parses, so handing
 * back a shared buffer would risk surprising mutation patterns. The
 * one-time decode is ~280 KB → ~210 KB of work — fast on every modern
 * device and this only runs the first time the user clicks Export.
 */
async function loadEmbeddedGoldTemplate(): Promise<ArrayBuffer | null> {
  try {
    const mod = (await import('virtual:embedded-gold-template')) as {
      embeddedGoldTemplateBase64: string
      hasEmbeddedGoldTemplate: boolean
    }
    if (!mod.hasEmbeddedGoldTemplate || !mod.embeddedGoldTemplateBase64) {
      return null
    }
    const binStr = atob(mod.embeddedGoldTemplateBase64)
    const bytes = new Uint8Array(binStr.length)
    for (let i = 0; i < binStr.length; i += 1) {
      bytes[i] = binStr.charCodeAt(i)
    }
    return bytes.buffer
  } catch {
    return null
  }
}

/**
 * v0.9.1 Cribl shell — used when no import buffer is in memory. `App`
 * preloads, but the first **Export** can run before that fetch
 * resolves; this awaits it so we do not fall through to the unstyled
 * `xlsx` programmatic export.
 *
 * Loading order:
 *
 *   1. In-memory cache hit → return.
 *   2. `fetch('/adoption-plan-empty.xlsx')` — works inside Cribl Apps
 *      and against `vite preview`. Returns `null` on network/HTTP
 *      failure rather than throwing.
 *   3. Build-time-embedded buffer (standalone build only). The runtime
 *      attempts this whenever the fetch returned `null`, which covers
 *      the `file://` case where the fetch is silently blocked by the
 *      browser.
 *
 * Returns `null` if every path fails. Callers (e.g.
 * `workbookDownload.ts`) treat that as "no shell available — surface
 * an error to the user" rather than "fall back to a plain xlsx
 * generator", on the basis that an unstyled export is worse than a
 * clear failure.
 */
export async function fetchAdoptionPlanEmptyBufferIfMissing(): Promise<ArrayBuffer | null> {
  if (cachedAdoptionPlanEmpty) {
    return cachedAdoptionPlanEmpty
  }
  try {
    const r = await fetch('/adoption-plan-empty.xlsx')
    if (r.ok) {
      const b = await r.arrayBuffer()
      cachedAdoptionPlanEmpty = b
      return b
    }
  } catch {
    // Fall through to the embedded fallback. Common under file://, in
    // an offline-first PWA, or any environment where a relative fetch
    // can't resolve.
  }

  const embedded = await loadEmbeddedGoldTemplate()
  if (embedded) {
    cachedAdoptionPlanEmpty = embedded
    return embedded
  }

  return null
}
