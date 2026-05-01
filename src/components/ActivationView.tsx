import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from 'react'
import { TierPickerDialog } from './TierPickerDialog'
import {
  PS_BASE_SCOPE_ITEMS,
  PS_BASE_SCOPE_WORKSHEET_LABELS,
  PS_PARAMETERS_PER_USE_CASE,
  PS_PARAMETER_NUMBERS,
  PS_STATUS_OPTIONS,
  PS_USE_CASE_COUNT,
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

type ActivationTabId = 'base-scope' | 'use-case-overview' | 'use-case-worksheet'

const TABS: ReadonlyArray<{
  id: ActivationTabId
  label: string
  hint: string
}> = [
  {
    id: 'base-scope',
    label: 'Base Scope',
    hint: '5 fixed deliverables every Cribl PS engagement covers.',
  },
  {
    id: 'use-case-overview',
    label: 'Use Case Overview',
    hint: 'Pick what each numbered use-case slot is for this customer.',
  },
  {
    id: 'use-case-worksheet',
    label: 'Use Case Worksheet',
    hint: '3 base-scope anchor rows and 5 use-case cards (5 parameters each).',
  },
]

/**
 * The Activation page — a 1-to-1 interactive view of the gold's
 * `PS Use Case Worksheet` sheet plus a soft tier picker. Three tabs
 * mirror the gold's three banner-separated blocks; only one tab's
 * content renders at a time so each block has the full content width
 * for writing and selections.
 *
 * Tier scope: when `tier` is set, the Use Case Overview and Use Case
 * Worksheet tabs only render the slots actually in scope (Silver = 2,
 * Gold = 3, Platinum = 5) — out-of-scope slots are hidden so the page
 * isn't longer than it needs to be. Their data is preserved in state,
 * so changing tier later restores the hidden picks unchanged. When
 * `tier` is `null`, all 5 slots render (no gating).
 */
export function ActivationView({ plan, setPlan }: Props) {
  const activation = plan.activation
  const tier = activation.tier

  const [activeTab, setActiveTab] = useState<ActivationTabId>('base-scope')

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
  const activeTabMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]!

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
        <TierChip tier={tier} onClick={() => setTierPickerForced(true)} />
      </header>

      <ActivationTabBar activeTab={activeTab} onChange={setActiveTab} />

      <div
        role="tabpanel"
        id={`activation-tab-${activeTab}`}
        aria-labelledby={`activation-tab-${activeTab}-button`}
        className="card-axiom min-w-0 border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5"
      >
        <p className="m-0 mb-4 text-xs text-cribl-muted">{activeTabMeta.hint}</p>

        {activeTab === 'base-scope' ? (
          <BaseScopeChecklistCard activation={activation} setActivation={setActivation} />
        ) : null}

        {activeTab === 'use-case-overview' ? (
          <UseCaseOverviewCard activation={activation} setActivation={setActivation} />
        ) : null}

        {activeTab === 'use-case-worksheet' ? (
          <UseCaseWorksheetTab activation={activation} setActivation={setActivation} />
        ) : null}
      </div>

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
// Tab strip
// ────────────────────────────────────────────────────────────────────

function ActivationTabBar({
  activeTab,
  onChange,
}: {
  activeTab: ActivationTabId
  onChange: (id: ActivationTabId) => void
}) {
  /**
   * Left/Right arrow keys move focus along the tab strip. Tab list
   * follows WAI-ARIA tabs pattern — only the active tab is in the
   * default tab order.
   */
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = e.key === 'ArrowLeft' ? (idx - 1 + TABS.length) % TABS.length : (idx + 1) % TABS.length
    const target = TABS[next]!
    onChange(target.id)
    const btn = document.getElementById(`activation-tab-${target.id}-button`)
    if (btn instanceof HTMLButtonElement) btn.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="Activation sections"
      className="flex w-full min-w-0 gap-1 overflow-x-auto rounded-xl border border-cribl-border bg-cribl-canvas p-1 shadow-ctrl"
    >
      {TABS.map((t, i) => {
        const isActive = activeTab === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`activation-tab-${t.id}-button`}
            aria-selected={isActive}
            aria-controls={`activation-tab-${t.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={[
              'min-w-0 flex-1 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cribl-primary/40',
              isActive
                ? 'bg-white text-cribl-ink shadow-ctrl'
                : 'text-cribl-muted hover:bg-white/60 hover:text-cribl-ink',
            ].join(' ')}
          >
            <span className="block truncate">{t.label}</span>
          </button>
        )
      })}
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
// Tab 1 — Activation Base Scope (5 deliverables)
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
    <div className="grid gap-3">
      {PS_BASE_SCOPE_ITEMS.map((meta, i) => {
        const row = activation.baseScope[i]
        return (
          <div
            key={meta.item}
            className="rounded-xl border border-cribl-border/80 bg-cribl-card-body/40 p-3 sm:p-4"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,200px)] md:items-center">
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
              <FieldLabel label="Status">
                <StatusSelect
                  ariaLabel={`Status for ${meta.item}`}
                  value={row.status}
                  onChange={(v) => updateRow(i, { status: v })}
                />
              </FieldLabel>
            </div>
            <FieldLabel className="mt-3" label="Notes">
              <NotesTextarea
                ariaLabel={`Notes for ${meta.item}`}
                value={row.notes}
                onChange={(v) => updateRow(i, { notes: v })}
              />
            </FieldLabel>
          </div>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Tab 2 — Activation Use Case Overview (5 kind pickers)
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

  // Hide (don't fade) slots beyond the picked tier so the page only
  // surfaces what's actually in scope. Out-of-scope picks remain in
  // `activation.useCaseOverview[3..4]` so a later tier upgrade restores
  // them — only the rendering is gated.
  const unlockedCount = unlockedUseCaseCountForTier(activation.tier)
  const visible = activation.useCaseOverview.slice(0, unlockedCount)

  return (
    <div className="grid gap-3">
      {visible.map((row, i) => {
        const number = PS_USE_CASE_OVERVIEW_NUMBERS[i]
        const tier = PS_USE_CASE_TIERS[i]
        return (
          <div
            key={number}
            className="rounded-xl border border-cribl-border/80 bg-cribl-card-body/40 p-3 sm:p-4"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,90px)_minmax(0,90px)_minmax(0,1fr)] md:items-center">
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-primary">
                  Use Case #
                </p>
                <p className="m-0 text-sm font-semibold tabular-nums text-cribl-ink">{number}</p>
              </div>
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-muted">
                  Tier
                </p>
                <TierBadge tier={tier} faded={false} />
              </div>
              <FieldLabel label="Use case kind">
                <UseCaseKindSelect
                  ariaLabel={`Use case kind for slot ${number}`}
                  value={row.kind}
                  onChange={(v) => updateRow(i, v)}
                />
              </FieldLabel>
            </div>
          </div>
        )
      })}
      <TierScopeFooter unlockedCount={unlockedCount} tier={activation.tier} noun="use case" />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Tab 3 — Activation Use Case Worksheet
// ────────────────────────────────────────────────────────────────────

function UseCaseWorksheetTab({
  activation,
  setActivation,
}: {
  activation: Activation
  setActivation: (next: Activation) => void
}) {
  // Hide (don't fade) cards beyond the picked tier so the worksheet
  // tab only surfaces what's actually in scope. Card data for
  // out-of-scope slots is preserved in `activation.useCases[3..4]` so
  // a later tier upgrade brings them back unchanged.
  const unlockedCount = unlockedUseCaseCountForTier(activation.tier)

  return (
    <div className="space-y-4">
      <BaseScopeWorksheetCard activation={activation} setActivation={setActivation} />
      <div className="grid gap-3">
        {activation.useCases.slice(0, unlockedCount).map((_, useCaseIndex) => (
          <UseCaseWorksheetCard
            key={useCaseIndex}
            useCaseIndex={useCaseIndex}
            activation={activation}
            setActivation={setActivation}
          />
        ))}
      </div>
      <TierScopeFooter unlockedCount={unlockedCount} tier={activation.tier} noun="use case" />
    </div>
  )
}

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
    <div className="rounded-xl border border-cribl-border/80 bg-cribl-canvas p-3 sm:p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-cribl-muted">
          Base scope anchors
        </p>
        <p className="m-0 text-[11px] text-cribl-muted">
          Pre-engagement infrastructure (rows 19–21).
        </p>
      </div>
      <div className="mt-3 grid gap-3">
        {PS_BASE_SCOPE_WORKSHEET_LABELS.map((label, i) => {
          const row = activation.baseScopeWorksheet[i]
          const shortLabel = label.replace(/^Base Scope - /, '')
          return (
            <div
              key={label}
              className="rounded-lg border border-cribl-border/80 bg-white p-3"
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,200px)_minmax(0,1fr)_minmax(0,200px)] md:items-start">
                <div className="min-w-0">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-primary">
                    Anchor
                  </p>
                  <p className="m-0 text-sm font-semibold text-cribl-ink">{shortLabel}</p>
                </div>
                <FieldLabel label="Parameters (specific logs / tasks)">
                  <ParametersTextarea
                    ariaLabel={`Parameters for ${label}`}
                    value={row.parameters}
                    onChange={(v) => updateRow(i, { parameters: v })}
                  />
                </FieldLabel>
                <FieldLabel label="Status">
                  <StatusSelect
                    ariaLabel={`Status for ${label}`}
                    value={row.status}
                    onChange={(v) => updateRow(i, { status: v })}
                  />
                </FieldLabel>
              </div>
              <FieldLabel className="mt-3" label="Notes">
                <NotesTextarea
                  ariaLabel={`Notes for ${label}`}
                  value={row.notes}
                  onChange={(v) => updateRow(i, { notes: v })}
                />
              </FieldLabel>
            </div>
          )
        })}
      </div>
    </div>
  )
}

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
    <div className="rounded-xl border border-cribl-border/80 bg-cribl-canvas p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-primary">
            {headerLabel}
          </p>
          <p className="m-0 text-sm font-semibold text-cribl-ink">
            {overviewKind || <span className="text-cribl-muted">— no kind picked —</span>}
          </p>
        </div>
        <TierBadge tier={tier} faded={false} />
      </div>
      <div className="mt-3 grid gap-3">
        {useCase.parameters.map((p, paramIndex) => (
          <div
            key={paramIndex}
            className="rounded-lg border border-cribl-border/80 bg-white p-3"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,52px)_minmax(0,1fr)_minmax(0,200px)] md:items-start">
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-muted">
                  #
                </p>
                <p className="m-0 text-sm font-semibold tabular-nums text-cribl-ink">
                  {PS_PARAMETER_NUMBERS[paramIndex] ?? `${paramIndex + 1}.0`}
                </p>
              </div>
              <FieldLabel label="Parameters (specific logs / tasks)">
                <ParametersTextarea
                  ariaLabel={`Parameters for ${headerLabel} parameter ${paramIndex + 1}`}
                  value={p.parameters}
                  onChange={(v) => updateParam(paramIndex, { parameters: v })}
                />
              </FieldLabel>
              <FieldLabel label="Status">
                <StatusSelect
                  ariaLabel={`Status for ${headerLabel} parameter ${paramIndex + 1}`}
                  value={p.status}
                  onChange={(v) => updateParam(paramIndex, { status: v })}
                />
              </FieldLabel>
            </div>
            <FieldLabel className="mt-3" label="Notes">
              <NotesTextarea
                ariaLabel={`Notes for ${headerLabel} parameter ${paramIndex + 1}`}
                value={p.notes}
                onChange={(v) => updateParam(paramIndex, { notes: v })}
              />
            </FieldLabel>
          </div>
        ))}
      </div>
      <p className="m-0 mt-3 text-[10px] text-cribl-muted">
        {PS_PARAMETERS_PER_USE_CASE} parameter rows · gold-fixed layout
      </p>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// Tiny shared inputs
// ────────────────────────────────────────────────────────────────────

function FieldLabel({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={['flex min-w-0 flex-col gap-1', className].filter(Boolean).join(' ')}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-cribl-muted">
        {label}
      </span>
      {children}
    </label>
  )
}

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

/**
 * Multi-line, vertically resizable Notes input. Mirrors the Stakeholder(s)
 * textarea pattern from the source form (`field-strong min-h-10 resize-y`,
 * `rows={2}`) so the user can drag the bottom-right corner to give long
 * notes more breathing room.
 */
function NotesTextarea({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  ariaLabel: string
}) {
  return (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      placeholder="Notes — drag the bottom-right corner to expand…"
      className="field-strong min-h-10 w-full resize-y text-sm text-cribl-ink placeholder:text-cribl-muted/70"
    />
  )
}

/**
 * Multi-line, vertically resizable Parameters input. Same expandable
 * pattern as `NotesTextarea` so users describing complex source / task
 * lists ("/var/log/*.log + container stdout + Lambda CloudWatch
 * groups") aren't squeezed into a single line.
 */
function ParametersTextarea({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  ariaLabel: string
}) {
  return (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      placeholder="Specific logs / tasks — drag to expand…"
      className="field-strong min-h-10 w-full resize-y text-sm text-cribl-ink placeholder:text-cribl-muted/70"
    />
  )
}

/**
 * Soft footer surfaced under the visible cards on Tabs 2 + 3 when a
 * tier is picked AND its unlocked count is fewer than 5. Reassures
 * the user that hidden cards aren't lost — they'll come back if the
 * tier picker is changed.
 */
function TierScopeFooter({
  unlockedCount,
  tier,
  noun,
}: {
  unlockedCount: number
  tier: ActivationTier | null
  noun: string
}) {
  if (tier === null || unlockedCount >= PS_USE_CASE_COUNT) return null
  const hidden = PS_USE_CASE_COUNT - unlockedCount
  return (
    <p className="m-0 text-[11px] text-cribl-muted">
      Showing {unlockedCount} of {PS_USE_CASE_COUNT} {noun}s — {tier} tier scope. Change tier in the
      page header to see the remaining {hidden}.
    </p>
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
