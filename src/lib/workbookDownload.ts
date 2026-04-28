import { fetchAdoptionPlanEmptyBufferIfMissing } from './adoptionPlanTemplateExport'
import { getImportShellBuffer } from './importShellStore'
import { planToBlobWithShellExcelJs } from './adoptionPlanShellExceljs'
import { titleForAdoptionPlanExport } from './exportWorkbook'
import type { PlanState } from '../types/planTypes'

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
 * 1) Last **imported** .xlsx (if any) — ExcelJS + OOXML merge for Cribl styling.  
 * 2) **Empty** v0.8.6 shell from `public/adoption-plan-empty.xlsx` (fetched if not yet cached).  
 * There is **no** third “plain” xlsx path: that build is ~1.5× the template size, unstyled, and easy to mistake for a real export.
 */
export async function planToBlobAsync(plan: PlanState): Promise<ArrayBuffer> {
  let lastError: unknown
  const imp = getImportShellBuffer()
  if (imp) {
    try {
      return await planToBlobWithShellExcelJs(plan, imp)
    } catch (e) {
      lastError = e
    }
  }
  const empty = await fetchAdoptionPlanEmptyBufferIfMissing()
  if (empty) {
    try {
      return await planToBlobWithShellExcelJs(plan, empty)
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

function downloadFilenameForPlan(plan: PlanState): string {
  const stem = titleForAdoptionPlanExport(plan)
  const safe = stem
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'Adoption Plan'
  return `${safe}.xlsx`
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
