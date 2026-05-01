/**
 * Backfill / normalize an `Activation` value loaded from KV or imported
 * from a workbook so it always has the gold-true shape (5 base-scope
 * rows / 5 use-case-overview slots / 3 base-scope worksheet rows /
 * 5 use cases × 5 parameters). Tolerant of `undefined`, partial
 * objects, and over-/under-sized sub-arrays so older saved plans and
 * future schema additions don't crash the loader.
 *
 * Used by `usePlanStorage.normalizePlan` (KV hydrate) and by the v0.9.1
 * importer (PR C activation reader). Pure function — no side effects.
 */

import {
  defaultActivation,
} from './defaultState'
import {
  PS_BASE_SCOPE_ITEMS,
  PS_BASE_SCOPE_WORKSHEET_LABELS,
  PS_DEFAULT_STATUS,
  PS_PARAMETERS_PER_USE_CASE,
  PS_STATUS_OPTIONS,
  PS_USE_CASE_COUNT,
  PS_USE_CASE_KIND_OPTIONS,
  PS_TIER_OPTIONS,
} from './psUseCaseLayout'
import type {
  Activation,
  ActivationBaseScopeRow,
  ActivationStatus,
  ActivationTier,
  ActivationUseCase,
  ActivationUseCaseOverviewRow,
  ActivationWorksheetRow,
} from '../types/planTypes'

function coerceStatus(v: unknown): ActivationStatus {
  if (typeof v === 'string') {
    const s = v.trim()
    for (const opt of PS_STATUS_OPTIONS) {
      if (opt.toLowerCase() === s.toLowerCase()) {
        return opt
      }
    }
  }
  return PS_DEFAULT_STATUS
}

function coerceTier(v: unknown): ActivationTier | null {
  if (typeof v === 'string') {
    const s = v.trim()
    for (const opt of PS_TIER_OPTIONS) {
      if (opt.toLowerCase() === s.toLowerCase()) {
        return opt
      }
    }
  }
  return null
}

function coerceKind(v: unknown): string {
  if (typeof v !== 'string') return ''
  const s = v.trim()
  if (!s) return ''
  // Match against the canonical 12-option vocabulary case-insensitively
  // so a v1.x plan saved with mixed casing still hydrates cleanly. Any
  // string the gold doesn't recognize falls through to "Other" (which
  // IS a valid gold value), preserving the user's intent rather than
  // dropping it silently.
  for (const opt of PS_USE_CASE_KIND_OPTIONS) {
    if (opt.toLowerCase() === s.toLowerCase()) {
      return opt
    }
  }
  return s.length > 0 ? 'Other' : ''
}

function coerceText(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v
}

function normalizeBaseScopeRow(v: unknown): ActivationBaseScopeRow {
  const r = (v ?? {}) as Partial<ActivationBaseScopeRow>
  return {
    status: coerceStatus(r.status),
    notes: coerceText(r.notes),
  }
}

function normalizeWorksheetRow(v: unknown): ActivationWorksheetRow {
  const r = (v ?? {}) as Partial<ActivationWorksheetRow>
  return {
    parameters: coerceText(r.parameters),
    status: coerceStatus(r.status),
    notes: coerceText(r.notes),
  }
}

function normalizeUseCaseOverviewRow(v: unknown): ActivationUseCaseOverviewRow {
  const r = (v ?? {}) as Partial<ActivationUseCaseOverviewRow>
  return { kind: coerceKind(r.kind) }
}

function normalizeUseCase(v: unknown): ActivationUseCase {
  const u = (v ?? {}) as Partial<ActivationUseCase>
  const params = Array.isArray(u.parameters) ? u.parameters : []
  const out: ActivationWorksheetRow[] = []
  for (let i = 0; i < PS_PARAMETERS_PER_USE_CASE; i += 1) {
    out.push(normalizeWorksheetRow(params[i]))
  }
  return { parameters: out }
}

/**
 * Normalize whatever shape we got into a valid `Activation`. Always
 * returns the gold's exact shape (5 / 5 / 3 / 5×5), padding with
 * defaults where the input is missing rows and dropping anything
 * extra.
 */
export function backfillActivation(input: Activation | undefined | null): Activation {
  if (!input || typeof input !== 'object') {
    return defaultActivation()
  }
  const baseScope: ActivationBaseScopeRow[] = []
  const inBaseScope = Array.isArray(input.baseScope) ? input.baseScope : []
  for (let i = 0; i < PS_BASE_SCOPE_ITEMS.length; i += 1) {
    baseScope.push(normalizeBaseScopeRow(inBaseScope[i]))
  }

  const useCaseOverview: ActivationUseCaseOverviewRow[] = []
  const inOverview = Array.isArray(input.useCaseOverview) ? input.useCaseOverview : []
  for (let i = 0; i < PS_USE_CASE_COUNT; i += 1) {
    useCaseOverview.push(normalizeUseCaseOverviewRow(inOverview[i]))
  }

  const baseScopeWorksheet: ActivationWorksheetRow[] = []
  const inBSW = Array.isArray(input.baseScopeWorksheet) ? input.baseScopeWorksheet : []
  for (let i = 0; i < PS_BASE_SCOPE_WORKSHEET_LABELS.length; i += 1) {
    baseScopeWorksheet.push(normalizeWorksheetRow(inBSW[i]))
  }

  const useCases: ActivationUseCase[] = []
  const inUseCases = Array.isArray(input.useCases) ? input.useCases : []
  for (let i = 0; i < PS_USE_CASE_COUNT; i += 1) {
    useCases.push(normalizeUseCase(inUseCases[i]))
  }

  return {
    tier: coerceTier(input.tier),
    baseScope,
    useCaseOverview,
    baseScopeWorksheet,
    useCases,
  }
}
