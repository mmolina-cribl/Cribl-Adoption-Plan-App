import type { SourceSummaryRow } from '../types/planTypes'
import { sourceLabel } from '../types/planTypes'

/**
 * Suffix appended to **Source** for Leader inputs with `disabled: true`
 * (UI + Excel). Must stay aligned with `topologyToPlan` truncation logic.
 */
export const DISABLED_SOURCE_NAME_SUFFIX = ' disabled'

const suffixKey = DISABLED_SOURCE_NAME_SUFFIX.trim().toLowerCase()
const parenDisabledRe = /\s+\(disabled\)\s*$/i

/** True when the **Source** cell matches Leader ` disabled` or export `(DISABLED)` markers. */
export function sourceNameImpliesAttachmentDisabled(source: string): boolean {
  const t = (source || '').trimEnd()
  const lower = t.toLowerCase()
  return lower.endsWith(suffixKey) || parenDisabledRe.test(t)
}

/**
 * Removes a trailing Leader-style ` disabled` marker (requires whitespace before
 * `disabled`, case-insensitive) from the **Source** display string. No-op when
 * {@link sourceNameImpliesAttachmentDisabled} is false for the trimmed value.
 */
export function stripAttachmentDisabledNameSuffix(source: string): string {
  const t = (source || '').trimEnd()
  if (!sourceNameImpliesAttachmentDisabled(t)) {
    return source
  }
  return t.replace(parenDisabledRe, '').replace(/\s+disabled\s*$/i, '').trimEnd()
}

export const ADOPTION_PLAN_EXPORT_DISABLED_SUFFIX = ' (DISABLED)'

/** **Source** cell value for adoption-plan workbook export (not the Summary inventory sheet). */
export function sourceNameForAdoptionPlanExport(row: SourceSummaryRow): string {
  const raw = (row.source ?? '').trim()
  if (!isSourceRowAttachmentDisabled(row)) {
    return raw
  }
  const base = stripAttachmentDisabledNameSuffix(raw).trim()
  return base ? `${base}${ADOPTION_PLAN_EXPORT_DISABLED_SUFFIX}` : raw
}

/** Format a topology **Source** label when only the string is available (no row context). */
export function sourceNameForAdoptionPlanExportFromLabel(source: string): string {
  const raw = (source ?? '').trim()
  if (!raw) {
    return ''
  }
  if (!sourceNameImpliesAttachmentDisabled(raw)) {
    return raw
  }
  const base = stripAttachmentDisabledNameSuffix(raw).trim()
  return base ? `${base}${ADOPTION_PLAN_EXPORT_DISABLED_SUFFIX}` : raw
}

/**
 * True when this source must not be attached or moved between worker groups
 * via maps, combobox, or patches — detach to unassigned is still allowed.
 */
export function isSourceRowAttachmentDisabled(row: SourceSummaryRow): boolean {
  if (row.leaderImportedDisabled === true) {
    return true
  }
  return sourceNameImpliesAttachmentDisabled(row.source)
}

/** UI label for a source row — strips the Leader ` disabled` suffix from the name. */
export function sourceDisplayLabel(row: Pick<SourceSummaryRow, 'source'>, index0: number): string {
  return sourceLabel({ source: stripAttachmentDisabledNameSuffix(row.source) }, index0)
}
