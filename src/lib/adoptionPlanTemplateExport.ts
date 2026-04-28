/**
 * In-memory cache for the official **empty** v0.8.6 shell (`public/adoption-plan-empty.xlsx`).
 * Actual in-place fill (styles preserved) is in `adoptionPlanShellExceljs.ts` (ExcelJS).
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
 * v0.8.6 Cribl shell in `public/adoption-plan-empty.xlsx` — used when no import buffer is in memory.
 * `App` preloads, but the first **Export** can run before that fetch resolves; this awaits it so we
 * do not fall through to the unstyled `xlsx` programmatic export.
 */
export async function fetchAdoptionPlanEmptyBufferIfMissing(): Promise<ArrayBuffer | null> {
  if (cachedAdoptionPlanEmpty) {
    return cachedAdoptionPlanEmpty
  }
  try {
    const r = await fetch('/adoption-plan-empty.xlsx')
    if (!r.ok) {
      return null
    }
    const b = await r.arrayBuffer()
    cachedAdoptionPlanEmpty = b
    return b
  } catch {
    return null
  }
}
