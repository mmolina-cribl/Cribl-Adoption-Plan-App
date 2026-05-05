import { fetchAdoptionPlanEmptyBufferIfMissing } from './adoptionPlanTemplateExport'
import { getImportShellBuffer } from './importShellStore'
import { planToBlobWithShellExcelJs } from './adoptionPlanShellExceljs'
import { titleForAdoptionPlanExport } from './exportWorkbook'
import { bufferIsV091Shell, planToBlobV091 } from './v091ExportWorkbook'
import type { PlanState } from '../types/planTypes'

/**
 * Route a candidate shell buffer to the v0.9.1 multi-sheet exporter when the
 * buffer is a v0.9.1 workbook (Stream Overview / Edge Overview present, or any
 * `wg-<name>` / `fl-<name>` sub-sheet) or to the legacy v0.8.6 ExcelJS
 * pipeline otherwise. The probe is a pure JSZip read of `xl/workbook.xml`,
 * cheap enough to run on every export attempt.
 */
async function fillShell(plan: PlanState, buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (await bufferIsV091Shell(buffer)) {
    return planToBlobV091(plan, buffer)
  }
  return planToBlobWithShellExcelJs(plan, buffer)
}

/** Thrown when no Cribl shell is available or ExcelJS cannot fill it (we do not fall back to a plain generator). */
export class ExportShellUnavailableError extends Error {
  readonly causeError: unknown

  constructor(message: string, causeError?: unknown) {
    super(message)
    this.name = 'ExportShellUnavailableError'
    this.causeError = causeError
  }
}

/**
 * Export always emits the current v0.9.1 workbook shape.
 *
 * Shell preference:
 *   1. Last imported workbook **only if it is already v0.9.1**. This preserves
 *      harmless customer-side workbook styling edits on modern files.
 *   2. Bundled empty v0.9.1 shell from `public/adoption-plan-empty.xlsx`
 *      (fetched if not yet cached; base64-inlined in the standalone build).
 *
 * Legacy v0.8.6 imports are data-only: they hydrate the GUI, but we deliberately
 * do not reuse the legacy workbook as an export shell. Otherwise a user who
 * imports an old Adoption Plan would keep downloading the old `Source summary` /
 * `Copy of Sources and WGs` layout instead of being upgraded to the current
 * v0.9.1 per-WG / per-Fleet workbook.
 *
 * There is **no** third “plain” xlsx path: that build is ~1.5× the template
 * size, unstyled, and easy to mistake for a real export.
 */
export async function planToBlobAsync(plan: PlanState): Promise<ArrayBuffer> {
  let lastError: unknown
  const imp = getImportShellBuffer()
  if (imp) {
    try {
      if (await bufferIsV091Shell(imp)) {
        return await planToBlobV091(plan, imp)
      }
    } catch (e) {
      lastError = e
    }
  }
  const empty = await fetchAdoptionPlanEmptyBufferIfMissing()
  if (empty) {
    try {
      return await fillShell(plan, empty)
    } catch (e) {
      lastError = e
    }
  }
  const base =
    'Cribl-styled export is not available. After the page loads, import your “Copy of Adoption plan” .xlsx again, or wait a few seconds and retry. '
  const detail =
    lastError instanceof Error ? `(${lastError.message})` : lastError != null ? '(export failed — check the console.)' : '(no import shell in memory and /adoption-plan-empty.xlsx did not load.)'
  throw new ExportShellUnavailableError(
    `${base}Plain unstyled .xlsx files are not offered here; they are much larger and lack Cribl colors and table styles. ${detail}`,
    lastError,
  )
}

/**
 * Today's date as `MM-DD-YYYY`. We use `-` separators (not `/`) because
 * `/` is not a legal filename character on Windows / macOS / Linux —
 * `MM/DD/YYYY` would just get scrubbed by the sanitizer below into the
 * same shape, so we author it that way directly to keep intent obvious.
 */
function todayMmDdYyyy(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  return `${mm}-${dd}-${yyyy}`
}

function downloadFilenameForPlan(plan: PlanState): string {
  const stem = titleForAdoptionPlanExport(plan)
  const safeStem = stem
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'Adoption Plan'
  return `${safeStem} - ${todayMmDdYyyy()}.xlsx`
}

export async function downloadXlsxForPlan(plan: PlanState) {
  const ab = await planToBlobAsync(plan)
  const blob = new Blob([ab], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const filename = downloadFilenameForPlan(plan)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.setAttribute('rel', 'noopener')
  a.setAttribute('tabindex', '-1')
  a.setAttribute('hidden', '')
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
