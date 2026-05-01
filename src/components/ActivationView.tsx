import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { SectionBox } from './FormControls'
import { TierPickerDialog } from './TierPickerDialog'
import {
  PS_BASE_SCOPE_ITEMS,
  PS_BASE_SCOPE_WORKSHEET_LABELS,
  PS_PARAMETERS_PER_USE_CASE,
  PS_PARAMETER_NUMBERS,
  PS_STATUS_OPTIONS,
  PS_USE_CASE_KIND_OPTIONS,
  PS_USE_CASE_OVERVIEW_NUMBERS,
  PS_USE_CASE_TIERS,
  unlockedUseCaseCountForTier,
  useCaseHeaderLabel,
} from '../lib/psUseCaseLayout'
import type {
  Activation,
  ActivationStatus,
  ActivationTier,
  PlanState,
} from '../types/planTypes'

type Props = {
  plan: PlanState
  setPlan: Dispatch<SetStateAction<PlanState>>
}

/**
 * The Activation page — a 1-to-1 interactive view of the gold's
 * `PS Use Case Worksheet` sheet plus a soft tier picker. Three stacked
 * sections mirror the gold's three banner-separated blocks:
 *
 * 1. Activation Base Scope (5 fixed deliverables, Status + Notes).
 * 2. Activation Use Case Overview (5 use-case slots, kind picker).
 * 3. Activation Use Case Worksheet (3 base-scope sub-rows + 5 use-case
 *    cards × 5 parameter rows each, all with Parameters / Status / Notes).
 *
 * Soft-gating: when `tier` is set, use-case cards beyond the tier's
 * unlocked count fade to ~50% opacity with an "Out of scope" pill but
 * stay fully editable. When `tier` is `null`, no fading happens.
 */
export function ActivationView({ plan, setPlan }: Props) {
  const activation = plan.activation
  const tier = activation.tier

  /**
   * Has the user ever seen the tier picker on this device this
   * session? `false` on first mount, then `true` after the picker
   * has been opened (or auto-opened) once. Prevents the auto-open
   * from triggering again if the user dismisses with "I'll pick
   * later" — they'd find that re-popping every time the page is
   * revisited annoying.
   */
  const [tierPickerSeen, setTierPickerSeen] = useState(false)
  /** Force-open from clicking the tier chip in the header. */
  const [tierPickerForced, setTierPickerForced] = useState(false)

  /**
   * On mount, if the user has never picked a tier and hasn't seen
   * the picker yet this session, auto-open the modal. The flag flips
   * to `true` immediately so a subsequent dismiss-and-skip persists
   * the user's "not now" preference for the session.
   */
  useEffect(() => {
    if (tier === null && !tierPickerSeen) {
      setTierPickerSeen(true)
      setTierPickerForced(true)
    }
  }, [tier, tierPickerSeen])

  const setActivation = (next: Activation) => {
    setPlan((p) => ({ ...p, activation: next }))
  }

  const setTier = (t: ActivationTier | null) => {
    setActivation({ ...activation, tier: t })
  }

  const customerName = plan.customerName.trim() || 'this customer'

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <header
        id="activation-header"
        className="flex min-w-0 flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-cribl-primary">
            Activation
          </p>
          <h1 className="m-0 text-xl font-semibold leading-tight text-cribl-ink sm:text-2xl">
            PS Use Case Worksheet
          </h1>
          <p className="m-0 mt-1 max-w-2xl text-sm text-cribl-muted">
            Track {customerName}'s Cribl Professional Services activation — base-scope deliverables,
            use-case selections, and per-use-case parameters with Status and Notes. Round-trips to
            the <span className="text-cribl-ink/80">PS Use Case Worksheet</span> tab on export.
          </p>
        </div>
        <TierChip
          tier={tier}
          onClick={() => setTierPickerForced(true)}
        />
      </header>

      <SectionBox
        id="activation-base-scope"
        kicker="Block 1"
        title="Activation Base Scope"
        defaultOpen
        allowOverflow
      >
        <p className="m-0 mb-3 text-xs text-cribl-muted">
          The 5 fixed deliverables every Cribl PS engagement covers. Pick a status and add notes
          as the activation progresses.
        </p>
        <BaseScopeChecklistCard activation={activation} setActivation={setActivation} />
      </SectionBox>

      <SectionBox
        id="activation-use-case-overview"
        kicker="Block 2"
        title="Activation Use Case Overview"
        defaultOpen
        allowOverflow
      >
        <p className="m-0 mb-3 text-xs text-cribl-muted">
          Pick what each numbered use-case slot is for {customerName}. The list below mirrors the
          12 options the gold workbook accepts.
        </p>
        <UseCaseOverviewCard activation={activation} setActivation={setActivation} />
      </SectionBox>

      <SectionBox
        id="activation-use-case-worksheet"
        kicker="Block 3"
        title="Activation Use Case Worksheet"
        defaultOpen
        allowOverflow
      >
        <p className="m-0 mb-3 text-xs text-cribl-muted">
          The expanded worksheet — 3 base-scope anchor rows and 5 use cases (5 parameter rows
          each). Per-row Parameters, Status, and Notes.
        </p>
        <BaseScopeWorksheetCard activation={activation} setActivation={setActivation} />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {activation.useCases.map((_, useCaseIndex) => (
            <UseCaseWorksheetCard
              key={useCaseIndex}
              useCaseIndex={useCaseIndex}
              activation={activation}
              setActivation={setActivation}
            />
          ))}
        </div>
      </SectionBox>

      {tierPickerForced ? (
        <TierPickerDialog
          current={tier}
          onSelect={(t) => {
            setTier(t)
            setTierPickerForced(false)
          }}
          onSkip={() => {
            setTierPickerForced(false)
          }}
        />
      ) : null}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Sticky tier chip (re-opens the picker)
// ────────────────────────────────────────────────────────────────────

function TierChip({ tier, onClick }: { tier: ActivationTier | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Change PS tier"
      className="inline-flex h-9 shrink-0 items-center gap-2 self-start rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-ink shadow-ctrl transition hover:border-cribl-primary/50 hover:bg-cribl-primary-soft sm:self-end"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-cribl-muted">
        PS Tier
      </span>
      <span className="text-cribl-ink">{tier ?? 'Pick…'}</span>
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-cribl-muted" aria-hidden>
        <path
          fill="currentColor"
          d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z"
        />
      </svg>
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────
// Block 1 — Activation Base Scope (5 deliverables)
// ────────────────────────────────────────────────────────────────────

function BaseScopeChecklistCard({
  activation,
  setActivation,
}: {
  activation: Activation
  setActivation: (next: Activation) => void
}) {
  const updateRow = (rowIndex: number, patch: Partial<Activation['baseScope'][number]>) => {
    const next = activation.baseScope.map((r, i) => (i === rowIndex ? { ...r, ...patch } : r))
    setActivation({ ...activation, baseScope: next })
  }

  return (
    <div className="grid gap-2.5">
      {PS_BASE_SCOPE_ITEMS.map((meta, i) => {
        const row = activation.baseScope[i]
        return (
          <div
            key={meta.item}
            className="grid grid-cols-1 gap-2 rounded-xl border border-cribl-border/80 bg-white p-3 shadow-ctrl sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,170px)_minmax(0,1.5fr)] sm:items-center sm:gap-3"
          >
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-primary">
                Item
              </p>
              <p className="m-0 text-sm font-semibold text-cribl-ink">{meta.item}</p>
            </div>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-muted">
                Deliverable
              </p>
              <p className="m-0 text-sm text-cribl-ink/90">{meta.deliverable}</p>
            </div>
            <StatusSelect
              ariaLabel={`Status for ${meta.item}`}
              value={row.status}
              onChange={(v) => updateRow(i, { status: v })}
            />
            <NotesInput
              ariaLabel={`Notes for ${meta.item}`}
              value={row.notes}
              onChange={(v) => updateRow(i, { notes: v })}
            />
          </div>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Block 2 — Activation Use Case Overview (5 kind pickers)
// ────────────────────────────────────────────────────────────────────

function UseCaseOverviewCard({
  activation,
  setActivation,
}: {
  activation: Activation
  setActivation: (next: Activation) => void
}) {
  const updateRow = (rowIndex: number, kind: string) => {
    const next = activation.useCaseOverview.map((r, i) => (i === rowIndex ? { ...r, kind } : r))
    setActivation({ ...activation, useCaseOverview: next })
  }

  const unlockedCount = unlockedUseCaseCountForTier(activation.tier)

  return (
    <div className="grid gap-2.5">
      {activation.useCaseOverview.map((row, i) => {
        const number = PS_USE_CASE_OVERVIEW_NUMBERS[i]
        const tier = PS_USE_CASE_TIERS[i]
        const isLocked = activation.tier !== null && i >= unlockedCount
        return (
          <div
            key={number}
            className={[
              'grid grid-cols-1 gap-2 rounded-xl border border-cribl-border/80 bg-white p-3 shadow-ctrl sm:grid-cols-[minmax(0,90px)_minmax(0,90px)_minmax(0,1fr)] sm:items-center sm:gap-3 transition',
              isLocked ? 'opacity-50' : '',
            ].join(' ')}
          >
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-primary">
                Use Case #
              </p>
              <p className="m-0 text-sm font-semibold tabular-nums text-cribl-ink">{number}</p>
            </div>
            <TierBadge tier={tier} faded={isLocked} />
            <UseCaseKindSelect
              ariaLabel={`Use case kind for slot ${number}`}
              value={row.kind}
              onChange={(v) => updateRow(i, v)}
            />
          </div>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Block 3a — Base-scope worksheet sub-rows (Primary Source / etc.)
// ────────────────────────────────────────────────────────────────────

function BaseScopeWorksheetCard({
  activation,
  setActivation,
}: {
  activation: Activation
  setActivation: (next: Activation) => void
}) {
  const updateRow = (
    rowIndex: number,
    patch: Partial<Activation['baseScopeWorksheet'][number]>,
  ) => {
    const next = activation.baseScopeWorksheet.map((r, i) =>
      i === rowIndex ? { ...r, ...patch } : r,
    )
    setActivation({ ...activation, baseScopeWorksheet: next })
  }

  return (
    <div className="rounded-xl border border-cribl-border/80 bg-cribl-card-body/40 p-3 shadow-ctrl sm:p-4">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-cribl-muted">
        Base scope anchors
      </p>
      <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">
        Pre-engagement infrastructure questions that aren't part of any numbered use case.
      </p>
      <div className="mt-3 grid gap-2.5">
        {PS_BASE_SCOPE_WORKSHEET_LABELS.map((label, i) => {
          const row = activation.baseScopeWorksheet[i]
          return (
            <div
              key={label}
              className="grid grid-cols-1 gap-2 rounded-lg border border-cribl-border/80 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,170px)_minmax(0,1.5fr)] sm:items-center sm:gap-3"
            >
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-primary">
                  Anchor
                </p>
                <p className="m-0 text-sm font-semibold text-cribl-ink">
                  {label.replace(/^Base Scope - /, '')}
                </p>
              </div>
              <ParametersInput
                ariaLabel={`Parameters for ${label}`}
                value={row.parameters}
                onChange={(v) => updateRow(i, { parameters: v })}
              />
              <StatusSelect
                ariaLabel={`Status for ${label}`}
                value={row.status}
                onChange={(v) => updateRow(i, { status: v })}
              />
              <NotesInput
                ariaLabel={`Notes for ${label}`}
                value={row.notes}
                onChange={(v) => updateRow(i, { notes: v })}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Block 3b — Per-use-case worksheet card (5 parameter rows)
// ────────────────────────────────────────────────────────────────────

function UseCaseWorksheetCard({
  useCaseIndex,
  activation,
  setActivation,
}: {
  useCaseIndex: number
  activation: Activation
  setActivation: (next: Activation) => void
}) {
  const tier = PS_USE_CASE_TIERS[useCaseIndex]
  const headerLabel = useCaseHeaderLabel(useCaseIndex)
  const useCase = activation.useCases[useCaseIndex]
  const overviewKind = activation.useCaseOverview[useCaseIndex]?.kind ?? ''
  const unlockedCount = unlockedUseCaseCountForTier(activation.tier)
  const isLocked = activation.tier !== null && useCaseIndex >= unlockedCount

  const updateParam = (
    paramIndex: number,
    patch: Partial<Activation['useCases'][number]['parameters'][number]>,
  ) => {
    const nextParams = useCase.parameters.map((p, i) =>
      i === paramIndex ? { ...p, ...patch } : p,
    )
    const nextUseCases = activation.useCases.map((u, i) =>
      i === useCaseIndex ? { parameters: nextParams } : u,
    )
    setActivation({ ...activation, useCases: nextUseCases })
  }

  return (
    <div
      className={[
        'card-axiom flex min-w-0 flex-col gap-3 border-cribl-border/80 bg-white p-3.5 shadow-ctrl transition sm:p-4',
        isLocked ? 'opacity-50' : '',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-primary">
            {headerLabel}
          </p>
          <p className="m-0 text-sm font-semibold text-cribl-ink">
            {overviewKind || <span className="text-cribl-muted">— no kind picked —</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <TierBadge tier={tier} faded={false} />
          {isLocked ? (
            <span
              className="rounded-md border border-cribl-border bg-cribl-card-body px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cribl-muted"
              title={`Out of scope for ${activation.tier} tier — still editable`}
            >
              Out of scope
            </span>
          ) : null}
        </div>
      </div>
      <div className="grid gap-2">
        {useCase.parameters.map((p, paramIndex) => (
          <div
            key={paramIndex}
            className="grid grid-cols-1 gap-2 rounded-lg border border-cribl-border/80 bg-cribl-card-body/40 p-2.5 sm:grid-cols-[minmax(0,52px)_minmax(0,1.5fr)_minmax(0,170px)_minmax(0,1.5fr)] sm:items-center sm:gap-2.5"
          >
            <span className="text-xs font-semibold tabular-nums text-cribl-muted">
              {PS_PARAMETER_NUMBERS[paramIndex] ?? `${paramIndex + 1}.0`}
            </span>
            <ParametersInput
              ariaLabel={`Parameters for ${headerLabel} parameter ${paramIndex + 1}`}
              value={p.parameters}
              onChange={(v) => updateParam(paramIndex, { parameters: v })}
            />
            <StatusSelect
              ariaLabel={`Status for ${headerLabel} parameter ${paramIndex + 1}`}
              value={p.status}
              onChange={(v) => updateParam(paramIndex, { status: v })}
            />
            <NotesInput
              ariaLabel={`Notes for ${headerLabel} parameter ${paramIndex + 1}`}
              value={p.notes}
              onChange={(v) => updateParam(paramIndex, { notes: v })}
            />
          </div>
        ))}
      </div>
      {/*
       * Footer is a no-op visual breather. We don't surface a "remove
       * use case" affordance because the gold's row layout is fixed:
       * always 5 use case slots, always 5 parameters each.
       */}
      <p className="m-0 text-[10px] text-cribl-muted">
        {PS_PARAMETERS_PER_USE_CASE} parameter rows · gold-fixed layout
      </p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Tiny shared inputs
// ────────────────────────────────────────────────────────────────────

function StatusSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: ActivationStatus
  onChange: (v: ActivationStatus) => void
  ariaLabel: string
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as ActivationStatus)}
      className="h-9 w-full rounded-lg border border-cribl-border bg-white px-2 text-sm text-cribl-ink"
    >
      {PS_STATUS_OPTIONS.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}

function UseCaseKindSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  ariaLabel: string
}) {
  // Allow the empty placeholder option (rendered as "— pick one —") so a
  // brand-new plan or a deliberate "clear my pick" both work.
  const options = useMemo(() => ['', ...PS_USE_CASE_KIND_OPTIONS], [])
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-lg border border-cribl-border bg-white px-2 text-sm text-cribl-ink"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt || '— pick one —'}
        </option>
      ))}
    </select>
  )
}

function NotesInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  ariaLabel: string
}) {
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Notes…"
      className="h-9 w-full rounded-lg border border-cribl-border bg-white px-2 text-sm text-cribl-ink placeholder:text-cribl-muted/70"
    />
  )
}

function ParametersInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  ariaLabel: string
}) {
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Specific logs / tasks…"
      className="h-9 w-full rounded-lg border border-cribl-border bg-white px-2 text-sm text-cribl-ink placeholder:text-cribl-muted/70"
    />
  )
}

function TierBadge({ tier, faded }: { tier: ActivationTier; faded: boolean }) {
  const palette =
    tier === 'Platinum'
      ? 'border-violet-200 bg-violet-50 text-violet-700'
      : tier === 'Gold'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-slate-200 bg-slate-50 text-slate-700'
  return (
    <span
      className={[
        'inline-flex w-fit shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition',
        palette,
        faded ? 'opacity-70' : '',
      ].join(' ')}
      title={`Cribl PS ${tier} tier`}
    >
      {tier}
    </span>
  )
}

// PR C ToDo (post-rc.2 nice-to-haves):
// - Surface unlocked count vs total in the page header ("Showing 3 of 5")
// - Inline rollup of "% complete" per use-case card (reflects Status column)
// - When `tier` changes, scroll the first locked card into view briefly so
//   the user notices the soft-fade.
