import type { SourceSummaryRow } from '../types/planTypes'

/**
 * Suffix appended to **Source** for Leader inputs with `disabled: true`
 * (UI + Excel). Must stay aligned with `topologyToPlan` truncation logic.
 */
export const DISABLED_SOURCE_NAME_SUFFIX = ' disabled'

const suffixKey = DISABLED_SOURCE_NAME_SUFFIX.trim().toLowerCase()

/** True when the **Source** cell alone matches the Leader-disabled naming convention. */
export function sourceNameImpliesAttachmentDisabled(source: string): boolean {
  return (source || '').trimEnd().toLowerCase().endsWith(suffixKey)
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
  return t.replace(/\s+disabled\s*$/i, '').trimEnd()
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
