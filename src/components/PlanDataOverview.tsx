import { useEffect, useMemo, useRef, useState } from 'react'
import { formatGbOrTbPerDayStr } from '../lib/formatRate'
import { CHART_CRIBL_BLUE } from '../lib/chartColors'
import { buildDashboardSnapshot, type DashboardSourceRow } from '../lib/planDashboardStats'
import {
  effectiveIngestEgressGbdForWg,
  sumAvgDailyFromSourceSummaryForWg,
} from '../lib/workerGroupRollup'
import { getOnboardingStatusCounts, ONBOARDING_STATUS_COLORS } from '../lib/onboardingStatus'
import { useEntryAnimation } from '../lib/animationsPreference'
import { tierPalette } from '../lib/psUseCaseLayout'
import { useActivationCalloutDismissed } from '../lib/activationCalloutPreference'
import { PencilIcon } from './PencilIcon'
import { PlanResourceMap } from './PlanResourceMap'
import { SearchInput } from './SearchInput'
import { sourceLabel, type PlanState } from '../types/planTypes'

const WG_SNAPSHOT_PAGE_SIZE = 2

type Props = {
  plan: PlanState
  /** Open the Stream "Worker groups" index view. */
  onGoToWorkers: () => void
  /** Open the Edge "Fleets" index view. */
  onGoToFleets: () => void
  onOpenWorkerGroup: (id: string) => void
  onGoToSources: () => void
  onSelectSource: (id: string) => void
  /**
   * Move a source between worker groups (drag-to-reassign in the resource
   * map) or detach it from its current group (`null` = unassigned).
   */
  onReassignSource: (sourceId: string, newWorkerGroupId: string | null) => void
  /**
   * Open the global "New data source" dialog (same flow used by the left
   * sidebar "+ Add source" button). Surfaces a "+ New source" action in
   * the resource map header so users can spawn new sources right from
   * the plan view.
   */
  onAddSource: () => void
  /**
   * Open the global "New worker group / fleet" dialog (same flow used by
   * the left sidebar "+ Add" buttons). Surfaces "+ New worker group" /
   * "+ New fleet" shortcuts in the resource map header so users can grow
   * the topology directly from the plan view. The optional `kind` arg
   * lets each shortcut spawn the matching resource (Stream vs Edge);
   * omitting it preserves the legacy default ('stream').
   */
  onAddWorkerGroup: (kind?: 'stream' | 'edge') => void
  /**
   * Jump to the Activation page (the Cribl PS Use Case Worksheet —
   * tier picker, base scope checklist, use case overview / worksheet).
   * Wired to the "Plan in shape? Activate it." banner under the hero,
   * which is the primary nudge on the dashboard for the next step.
   */
  onGoToActivation: () => void
  /**
   * Persist a new value for `plan.customerName` — wired into the hero's
   * inline pencil-edit affordance. Mirrors the same setter the header
   * customer-name field uses so editing in either place updates the
   * single source of truth in `PlanState`.
   */
  onChangeCustomerName: (name: string) => void
}

function parseGb(s: string | undefined): number {
  if (!s || !s.trim()) return Number.NaN
  return parseFloat(s.replace(/,/g, ''))
}

function fmtGb(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'
}

function parseMultiValue(v: string): string[] {
  const parts = (v || '')
    .split(/[,;\n]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    const k = p.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
  }
  return out
}

function DonutChart({ items }: { items: { label: string; value: number; color: string }[] }) {
  const { animated, enabled: animEnabled } = useEntryAnimation()
  const total = items.reduce((a, x) => a + x.value, 0)
  const r = 16
  const c = 2 * Math.PI * r
  let offset = 0
  const segs = items
    .filter((x) => x.value > 0)
    .map((x) => {
      const frac = total > 0 ? x.value / total : 0
      const dash = frac * c
      const visibleDash = animated ? dash : 0
      const seg = (
        <circle
          key={x.label}
          cx="20"
          cy="20"
          r={r}
          fill="transparent"
          stroke={x.color}
          strokeWidth="8"
          strokeDasharray={`${visibleDash} ${c - visibleDash}`}
          strokeDashoffset={-offset}
          strokeLinecap="butt"
          style={
            animEnabled
              ? { transition: 'stroke-dasharray 700ms cubic-bezier(0.22, 1, 0.36, 1)' }
              : undefined
          }
        />
      )
      offset += dash
      return seg
    })

  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 40 40" className="h-14 w-14 shrink-0">
        <circle cx="20" cy="20" r={r} fill="transparent" stroke="rgba(226,229,234,0.9)" strokeWidth="8" />
        <g transform="rotate(-90 20 20)">{segs}</g>
        <circle cx="20" cy="20" r="10" fill="white" />
      </svg>
      <div className="min-w-0 space-y-1">
        {items.map((x) => (
          <div key={x.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-cribl-muted">
              <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: x.color }} />
              {x.label}
            </span>
            <span className="shrink-0 tabular-nums text-cribl-ink/80">{x.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MiniBars({
  items,
  suffix,
}: {
  items: { label: string; value: number }[]
  suffix?: string
}) {
  const { animated, enabled: animEnabled } = useEntryAnimation()
  const max = Math.max(0, ...items.map((x) => x.value))
  return (
    <div className="space-y-2">
      {items.map((it) => {
        const w = max > 0 ? Math.round((it.value / max) * 100) : 0
        return (
          <div key={it.label} className="flex items-center gap-2">
            <span className="w-28 shrink-0 truncate text-xs text-cribl-muted" title={it.label}>
              {it.label}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-cribl-border/70">
              <div
                className="h-full rounded-full bg-cribl-blue"
                style={{
                  width: `${animated ? w : 0}%`,
                  transition: animEnabled
                    ? 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)'
                    : undefined,
                }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-xs tabular-nums text-cribl-ink/80">
              {fmtGb(it.value)}
              {suffix || ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint: string
}) {
  return (
    <div className="card-axiom min-h-[5.5rem] border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
      <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-muted">{label}</p>
      <p className="m-0 mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-cribl-ink sm:text-3xl">
        {value}
      </p>
      <p className="m-0 mt-0.5 text-xs text-cribl-muted">{hint}</p>
    </div>
  )
}

/**
 * Single Recent Sources entry on the Plan dashboard. The whole card
 * is a `<button>` so the entire surface is the click target — no
 * mini "Open" affordance to hunt for. Shows an at-a-glance snapshot:
 * worker-group / fleet attachment, onboarding status, criticality,
 * target onboard end, and stakeholder preview, in addition to the
 * existing name / sourcetype / completion-progress row.
 */
function RecentSourceCard({
  row,
  onOpen,
}: {
  row: DashboardSourceRow
  onOpen: () => void
}) {
  const volSuffix = row.volGb !== '—' ? ' GB/d' : ''
  const wgLabel = row.wgName ?? 'Unassigned'
  const wgKindLabel = row.wgKind === 'edge' ? 'Fleet' : row.wgKind === 'stream' ? 'WG' : 'Unassigned'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card-axiom group flex w-full min-w-0 flex-col gap-2.5 border-cribl-border/80 bg-white p-3.5 text-left shadow-ctrl transition hover:border-cribl-primary/50 hover:bg-cribl-elevate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cribl-primary/40 sm:p-4"
      aria-label={`Open source ${row.name}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-cribl-ink sm:text-base">{row.name}</span>
        <OnboardingBadge status={row.status} />
        <CriticalityBadge value={row.criticality} />
        <WgAttachmentBadge label={wgLabel} kindLabel={wgKindLabel} kind={row.wgKind} />
        <span className="ml-auto text-xs tabular-nums text-cribl-muted">
          {row.pct}% · {row.filled}/{row.total} fields
        </span>
      </div>
      <p className="m-0 text-xs text-cribl-muted">
        <span className="text-cribl-ink/90">Sourcetype:</span> {row.label}
        <span className="mx-1 text-cribl-border/90">·</span>
        <span className="text-cribl-ink/90">Est.</span>{' '}
        <span className="tabular-nums">
          {row.volGb}
          {volSuffix}
        </span>
        {row.targetEnd ? (
          <>
            <span className="mx-1 text-cribl-border/90">·</span>
            <span className="text-cribl-ink/90">Target onboard:</span>{' '}
            <span className="tabular-nums">{row.targetEnd}</span>
          </>
        ) : null}
      </p>
      {row.stakeholders.total > 0 ? (
        <p className="m-0 text-xs text-cribl-muted">
          <span className="text-cribl-ink/90">Stakeholders:</span> {row.stakeholders.display}
        </p>
      ) : null}
      <div className="max-w-md">
        <ProgressMini pct={row.pct} />
      </div>
    </button>
  )
}

function OnboardingBadge({ status }: { status: DashboardSourceRow['status'] }) {
  // Reuse the donut palette so the badges match the Source Onboarding
  // stat-card on the same page.
  const palette: Record<DashboardSourceRow['status'], { dot: string; bg: string; text: string; label: string }> = {
    complete: {
      dot: 'bg-emerald-500',
      bg: 'bg-emerald-50 border-emerald-200',
      text: 'text-emerald-700',
      label: 'Complete',
    },
    current: {
      dot: 'bg-cribl-primary',
      bg: 'bg-cribl-primary-soft border-cribl-primary/30',
      text: 'text-cribl-primary-ink',
      label: 'In progress',
    },
    planned: {
      dot: 'bg-slate-400',
      bg: 'bg-slate-50 border-slate-200',
      text: 'text-slate-700',
      label: 'Planned',
    },
  }
  const p = palette[status]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${p.bg} ${p.text}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${p.dot}`} aria-hidden />
      {p.label}
    </span>
  )
}

function CriticalityBadge({ value }: { value: DashboardSourceRow['criticality'] }) {
  if (value === null) return null
  const palette: Record<Exclude<DashboardSourceRow['criticality'], null>, string> = {
    High: 'border-rose-200 bg-rose-50 text-rose-700',
    Medium: 'border-amber-200 bg-amber-50 text-amber-800',
    Low: 'border-slate-200 bg-slate-50 text-slate-700',
    Other: 'border-cribl-border bg-cribl-card-body text-cribl-muted',
  }
  return (
    <span
      title={`Data criticality: ${value}`}
      className={`inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${palette[value]}`}
    >
      {value}
    </span>
  )
}

function WgAttachmentBadge({
  label,
  kindLabel,
  kind,
}: {
  label: string
  kindLabel: string
  kind: 'stream' | 'edge' | null
}) {
  const palette =
    kind === 'edge'
      ? 'border-cribl-primary/30 bg-cribl-primary-soft text-cribl-primary-ink'
      : kind === 'stream'
      ? 'border-cribl-border bg-cribl-card-body text-cribl-ink/80'
      : 'border-dashed border-cribl-border bg-cribl-canvas text-cribl-muted'
  const display = kind === null ? 'Unassigned' : `${kindLabel}: ${label}`
  return (
    <span
      title={kind === null ? 'No worker group or fleet attached' : `Routes to ${kindLabel} ${label}`}
      className={`inline-flex min-w-0 max-w-[16ch] truncate rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${palette}`}
    >
      {display}
    </span>
  )
}

function ProgressMini({ pct }: { pct: number }) {
  const { animated, enabled: animEnabled } = useEntryAnimation()
  const w = Math.min(100, Math.max(0, pct))
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-cribl-border/80"
      role="progressbar"
      aria-valuenow={w}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-cribl-blue"
        style={{
          width: `${animated ? w : 0}%`,
          transition: animEnabled
            ? 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)'
            : undefined,
        }}
      />
    </div>
  )
}

/**
 * "Plan in shape? Activate it." — the dashboard's primary next-step
 * nudge.
 *
 * Two visual modes:
 *
 *   - **Tier unset**: a Cribl-blue gradient band with a primary CTA
 *     pointing at Activation, and a dismiss (×) in the top-right.
 *     Customers who don't want the nudge (e.g. they're already mid-
 *     engagement and don't need the prompt) can click × to hide it.
 *     The dismissal is persisted in KV via {@link useActivationCalloutDismissed}
 *     so it survives reloads. Setting an Activation tier later
 *     swaps the callout to the compact tinted strip below — that one
 *     is informational, not a nudge, and isn't dismissible.
 *
 *   - **Tier set**: a compact tier-tinted strip that reads as a status
 *     badge ("Activation: Gold") with a "View" link. It still surfaces
 *     the page, but stays out of the way once the customer has already
 *     committed.
 *
 * Lives between the hero block and the resource map so it's the first
 * actionable card a returning user sees, but doesn't compete with the
 * map for the dashboard's main fold.
 */
function ActivationCallout({
  plan,
  onGoToActivation,
}: {
  plan: PlanState
  onGoToActivation: () => void
}) {
  const tier = plan.activation.tier
  const [dismissed, setDismissed] = useActivationCalloutDismissed()

  if (tier) {
    const palette = tierPalette(tier)!
    return (
      <button
        type="button"
        onClick={onGoToActivation}
        className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-cribl-border/80 bg-white px-5 py-3.5 text-left shadow-ctrl transition hover:border-cribl-primary/40 hover:shadow-card-float"
        aria-label={`Open Activation — ${tier} tier engagement`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span
            className={[
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              palette.chip,
            ].join(' ')}
          >
            <span aria-hidden className={['h-1.5 w-1.5 rounded-full', palette.dot].join(' ')} />
            {tier}
          </span>
          <span className="min-w-0 truncate text-sm text-cribl-ink">
            Activation engagement is set to{' '}
            <span className={['font-semibold', palette.accentText].join(' ')}>{tier}</span>
            <span className="text-cribl-muted"> — review base scope and use cases</span>
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-cribl-primary group-hover:underline">
          Open Activation
          <span aria-hidden>→</span>
        </span>
      </button>
    )
  }

  if (dismissed) {
    return null
  }

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-cribl-primary/30 bg-gradient-to-r from-cribl-primary-soft/70 via-white to-cribl-primary-soft/40 px-5 py-4 pr-12 shadow-ctrl sm:px-6 sm:py-5 sm:pr-14"
      aria-labelledby="plan-activation-callout-title"
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-cribl-muted transition hover:bg-cribl-primary-soft/60 hover:text-cribl-ink focus:outline-none focus:ring-2 focus:ring-cribl-primary/40"
        aria-label="Dismiss Activation prompt"
        title="Dismiss"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <path
            d="M3 3 L13 13 M13 3 L3 13"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-primary">
            Next step
          </p>
          <h3
            id="plan-activation-callout-title"
            className="m-0 mt-0.5 text-base font-semibold text-cribl-ink sm:text-lg"
          >
            Plan in shape? Activate it.
          </h3>
          <p className="m-0 mt-1 max-w-2xl text-sm leading-relaxed text-cribl-muted">
            Pick a Cribl Professional Services tier, lock the base scope, and walk the use cases that
            will deliver this rollout. Silver, Gold, or Platinum — your choice shapes which use cases
            are in scope.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToActivation}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-cribl-primary px-4 py-2 text-sm font-medium text-white shadow-ctrl transition hover:bg-cribl-primary/90 sm:self-auto"
        >
          Set up Activation
          <span aria-hidden>→</span>
        </button>
      </div>
    </section>
  )
}

/**
 * Inline-edit customer name shown in the Plan dashboard hero.
 *
 * Mirrors the {@link HeaderCustomerName} top-right pencil affordance,
 * but at hero scale (text-xl / sm:text-2xl, left-aligned) so the
 * customer can edit the name right where they read it on the dashboard.
 * Both controls are bound to the same `plan.customerName` setter, so
 * they stay in sync — editing in one updates the other.
 *
 * UX: when `value` is empty, we render the placeholder "Cribl" in a
 * muted italic with a pencil icon, signalling "this is editable, here's
 * a hint of what to put". Once the customer types something, the value
 * shows in the normal `text-cribl-ink` weight. The pencil stays visible
 * either way as the explicit edit affordance — clicking the row swaps
 * to a focused input that commits on blur / Enter / Escape.
 */
function HeroCustomerName({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmed = value.trim()

  useEffect(() => {
    if (!editing) {
      return
    }
    const el = inputRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [editing])

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="m-0 mt-1 block w-full max-w-xl rounded-md border border-cribl-primary/50 bg-white px-2 py-1 text-xl font-semibold leading-tight text-cribl-ink shadow-ctrl outline-none focus:border-cribl-primary focus:ring-2 focus:ring-cribl-primary/30 sm:text-2xl"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.currentTarget.blur()
          }
        }}
        placeholder="Cribl"
        autoComplete="organization"
        aria-label="Customer name"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Edit customer name"
      aria-label={trimmed ? `Customer: ${trimmed}. Click to edit.` : 'Edit customer name'}
      className="group mt-1 inline-flex max-w-full items-center gap-2 rounded-md border-0 bg-transparent px-1 py-0.5 text-left transition hover:bg-cribl-elevate/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cribl-primary/30"
    >
      <span
        className={[
          'block min-w-0 max-w-full truncate text-xl font-semibold leading-tight sm:text-2xl',
          trimmed ? 'text-cribl-ink' : 'italic text-cribl-muted/70',
        ].join(' ')}
      >
        {trimmed || 'Cribl'}
      </span>
      <PencilIcon className="h-5 w-5 shrink-0 text-cribl-muted/70 transition group-hover:text-cribl-primary" />
    </button>
  )
}

export function PlanDataOverview({
  plan,
  onGoToWorkers,
  onGoToFleets,
  onOpenWorkerGroup,
  onGoToSources,
  onSelectSource,
  onReassignSource,
  onAddSource,
  onAddWorkerGroup,
  onGoToActivation,
  onChangeCustomerName,
}: Props) {
  const snap = useMemo(() => buildDashboardSnapshot(plan), [plan])
  const nSources = plan.sourceSummary.length
  const nWgStream = plan.workerGroups.filter((w) => w.kind !== 'edge').length
  const nWgEdge = plan.workerGroups.filter((w) => w.kind === 'edge').length
  const unassignedSources = plan.sourceSummary.filter((s) => !s.workerGroupId).length
  const [wgPage, setWgPage] = useState(0)
  const [recentSrcQ, setRecentSrcQ] = useState('')
  const [recentWgQ, setRecentWgQ] = useState('')
  const wgStats = useMemo(
    () =>
      plan.workerGroups.map((w) => {
        const sources = plan.sourceSummary.filter((s) => s.workerGroupId === w.id)
        const srcVol = sumAvgDailyFromSourceSummaryForWg(plan, w.id)
        const cap = effectiveIngestEgressGbdForWg(plan, w)
        return {
          id: w.id,
          name: w.wg.trim() || 'Unnamed',
          kind: w.kind,
          sources: sources.length,
          effIngest: cap?.ingestGb ?? null,
          effEgress: cap?.egressGb ?? null,
          srcVolSum: srcVol.sum,
        }
      }),
    [plan],
  )
  // When the user is actively filtering, drop pagination and show all
  // matches up to a safety cap so the result list stays scannable.
  const wgFiltered = useMemo(() => {
    const needle = recentWgQ.trim().toLowerCase()
    if (!needle) {
      return wgStats
    }
    return wgStats.filter((w) => w.name.toLowerCase().includes(needle))
  }, [wgStats, recentWgQ])
  const wgSearchActive = recentWgQ.trim().length > 0
  const wgPageCount = Math.max(1, Math.ceil(wgStats.length / WG_SNAPSHOT_PAGE_SIZE))
  const wgPageSafe = Math.min(wgPage, Math.max(0, wgPageCount - 1))
  const wgPageSlice = useMemo(() => {
    if (wgSearchActive) {
      return wgFiltered.slice(0, 12)
    }
    return wgStats.slice(
      wgPageSafe * WG_SNAPSHOT_PAGE_SIZE,
      wgPageSafe * WG_SNAPSHOT_PAGE_SIZE + WG_SNAPSHOT_PAGE_SIZE,
    )
  }, [wgFiltered, wgSearchActive, wgStats, wgPageSafe])
  useEffect(() => {
    setWgPage((p) => {
      const maxP = Math.max(0, wgPageCount - 1)
      return Math.min(p, maxP)
    })
  }, [wgPageCount, wgStats.length])

  const filteredRecentSources = useMemo(() => {
    const needle = recentSrcQ.trim().toLowerCase()
    if (!needle) {
      return snap.sourceRows.slice(0, 4)
    }
    return snap.sourceRows
      .filter((row) => row.name.toLowerCase().includes(needle) || row.label.toLowerCase().includes(needle))
      .slice(0, 12)
  }, [snap.sourceRows, recentSrcQ])
  const recentSrcSearchActive = recentSrcQ.trim().length > 0
  const totalIngest = wgStats.reduce((a, x) => a + (x.effIngest ?? 0), 0)
  const totalEgress = wgStats.reduce((a, x) => a + (x.effEgress ?? 0), 0)

  const onboardingCounts = getOnboardingStatusCounts(plan.sourceSummary)
  const critCounts = new Map<string, number>()
  for (const r of plan.sourceSummary) {
    const v = (r.dataCriticality || '').trim()
    const key =
      /^high$/i.test(v) ? 'High' : /^medium$/i.test(v) ? 'Medium' : /^low$/i.test(v) ? 'Low' : v ? 'Other' : 'Unknown'
    critCounts.set(key, (critCounts.get(key) || 0) + 1)
  }
  const vols = plan.sourceSummary
    .map((r, i) => ({ label: sourceLabel(r, i), value: parseGb(r.avgDailyGb) }))
    .filter((x) => Number.isFinite(x.value) && x.value >= 0)
    .sort((a, b) => b.value - a.value)
  const topVols = vols.slice(0, 6)
  const summaryTopoVols = plan.sourceSummary
    .map((r, i) => ({ label: sourceLabel(r, i), value: parseGb(r.avgDailyGb) }))
    .filter((x) => Number.isFinite(x.value) && x.value >= 0)
  const tableTopoVols = plan.sourceVolume
    .map((r) => ({ label: r.source?.trim() || 'Source', value: parseGb(r.dailyVolumeGb) }))
    .filter((x) => Number.isFinite(x.value) && x.value >= 0)
  const topoFromSummary = summaryTopoVols.length > 0
  const topoVols = topoFromSummary ? summaryTopoVols : tableTopoVols
  const topTopoVols = topoVols.slice(0, 6)
  const topoTotal = topoVols.reduce((a, x) => a + x.value, 0)
  const typeOnPrem = plan.sourceSummary.filter((r) => r.type === 'On-Prem').length
  const typeCloud = plan.sourceSummary.filter((r) => r.type === 'Cloud/Internet').length
  const typeUnset = plan.sourceSummary.filter(
    (r) => r.type !== 'On-Prem' && r.type !== 'Cloud/Internet',
  ).length

  const regionCounts = new Map<string, number>()
  for (const r of plan.sourceSummary) {
    for (const reg of parseMultiValue(r.physicalLocations || '')) {
      regionCounts.set(reg, (regionCounts.get(reg) || 0) + 1)
    }
  }
  const topRegions = Array.from(regionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }))

  return (
    <div className="space-y-6 sm:space-y-8">
      {/*
       * Adoption-plan hero: floats on the page (no card chrome) so the
       * eye lands on the customer name + intro copy directly. The
       * follow-up "Plan in shape? Activate it." callout below keeps
       * its card framing because it's the primary CTA — the contrast
       * between a chrome-less hero and a framed nudge gives the nudge
       * its own visual weight without competing with the title.
       */}
      <section>
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-cribl-primary">Adoption plan</p>
        {/*
         * TODO: derive the company name from the user's Cribl account details
         * once the platform exposes that to embedded apps. For now the user
         * types their own company name (it's *their* org's name, since
         * their customers will be the ones reading the plan). The hero
         * exposes a pencil-edit affordance so editing happens right where
         * the name is read; the same value is also editable from the
         * top-right header field — both share `plan.customerName`.
         * See CRIBL_DEV_NOTES.md "User identity inside the iframe".
         */}
        <HeroCustomerName value={plan.customerName} onChange={onChangeCustomerName} />
        <p className="m-0 mt-2 text-sm leading-relaxed text-cribl-muted">
          Your end-to-end <span className="text-cribl-ink/80">Cribl</span> rollout in one place — worker groups,
          the sources feeding them, and daily volume. Build it from the left nav, visualize the topology in the{' '}
          <span className="text-cribl-ink/80">resource maps</span>, and{' '}
          <span className="text-cribl-ink/80">Export</span> or{' '}
          <span className="text-cribl-ink/80">Import</span> any time.
        </p>
      </section>

      <ActivationCallout plan={plan} onGoToActivation={onGoToActivation} />

      {/*
       * The resource map is the most actionable surface on this page —
       * customers can drag sources between worker groups and detach them
       * inline — so it's anchored right under the hero, above the
       * read-only stat cards and mix charts.
       */}
      <PlanResourceMap
        plan={plan}
        onOpenSource={onSelectSource}
        onOpenWorkerGroup={onOpenWorkerGroup}
        onReassignSource={onReassignSource}
        onAddSource={onAddSource}
        onAddWorkerGroup={onAddWorkerGroup}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Data sources" value={nSources} hint="Per-source summary rows" />
        <StatCard
          label="Worker groups & fleets"
          value={
            nWgEdge > 0
              ? `${nWgStream} / ${nWgEdge}`
              : nWgStream
          }
          hint={nWgEdge > 0 ? 'Stream WGs / Edge fleets · capacity + specs' : 'Capacity + specs'}
        />
        <StatCard
          label="Total ingest"
          value={formatGbOrTbPerDayStr(totalIngest)}
          hint="Effective ingest (auto from sources or override) per group"
        />
        <StatCard
          label="Total egress"
          value={formatGbOrTbPerDayStr(totalEgress)}
          hint="Effective egress (auto: ingest − reduction, or override) per group"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
          <p className="m-0 text-sm font-semibold text-cribl-ink">Onboarding mix</p>
          <p className="m-0 mt-0.5 text-xs text-cribl-muted">Complete · Current · Planned</p>
          <div className="mt-3">
            <DonutChart
              items={[
                { label: 'Complete', value: onboardingCounts.complete, color: ONBOARDING_STATUS_COLORS.complete },
                { label: 'Current', value: onboardingCounts.current, color: ONBOARDING_STATUS_COLORS.current },
                { label: 'Planned', value: onboardingCounts.planned, color: ONBOARDING_STATUS_COLORS.planned },
              ]}
            />
          </div>
        </div>
        <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
          <p className="m-0 text-sm font-semibold text-cribl-ink">Criticality mix</p>
          <p className="m-0 mt-0.5 text-xs text-cribl-muted">Across all sources</p>
          <div className="mt-3">
            <DonutChart
              items={[
                { label: 'High', value: critCounts.get('High') || 0, color: '#ef4444' },
                { label: 'Medium', value: critCounts.get('Medium') || 0, color: '#f59e0b' },
                { label: 'Low', value: critCounts.get('Low') || 0, color: CHART_CRIBL_BLUE },
                { label: 'Unknown', value: critCounts.get('Unknown') || 0, color: '#94a3b8' },
              ]}
            />
          </div>
        </div>
        <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
          <p className="m-0 text-sm font-semibold text-cribl-ink">Top volume drivers</p>
          <p className="m-0 mt-0.5 text-xs text-cribl-muted">Avg daily volume</p>
          <div className="mt-3">
            {topVols.length === 0 ? (
              <p className="m-0 text-sm text-cribl-muted">No volumes yet.</p>
            ) : (
              <MiniBars items={topVols} suffix=" GB/d" />
            )}
          </div>
        </div>
      </div>

      {nSources > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
            <p className="m-0 text-sm font-semibold text-cribl-ink">Source type mix</p>
            <p className="m-0 mt-0.5 text-xs text-cribl-muted">On-Prem vs cloud vs not set</p>
            <div className="mt-3">
              <DonutChart
                items={[
                  { label: 'On-Prem', value: typeOnPrem, color: '#4f46e5' },
                  { label: 'Cloud/Internet', value: typeCloud, color: '#0284c7' },
                  { label: 'Not set', value: typeUnset, color: '#94a3b8' },
                ]}
              />
            </div>
          </div>
          <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
            <p className="m-0 text-sm font-semibold text-cribl-ink">Physical locations</p>
            <p className="m-0 mt-0.5 text-xs text-cribl-muted">
              Counts by location tag (a source with several locations adds to each)
            </p>
            <div className="mt-3">
              {topRegions.length === 0 ? (
                <p className="m-0 text-sm text-cribl-muted">No location tags yet.</p>
              ) : (
                <MiniBars items={topRegions} />
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="m-0 text-sm font-semibold text-cribl-ink">Topology volume</p>
          <span className="text-xs tabular-nums text-cribl-muted">Total: {fmtGb(topoTotal)} GB/d</span>
        </div>
        <p className="m-0 mt-0.5 text-xs text-cribl-muted">
          {topoFromSummary
            ? 'From Source summary (avg daily volume).'
            : 'Falls back to the Volume table when Source summary has no daily volume yet.'}
        </p>
        <div className="mt-3">
          {topTopoVols.length === 0 ? (
            <p className="m-0 text-sm text-cribl-muted">
              {topoFromSummary ? 'No volumes in Source summary yet.' : 'No volume rows in the Volume table yet.'}
            </p>
          ) : (
            <MiniBars items={topTopoVols} suffix=" GB/d" />
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3 lg:gap-6">
        <div className="min-w-0 space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="m-0 text-sm font-semibold text-cribl-ink sm:text-base">Recent sources</h3>
            <span className="text-xs text-cribl-muted">
              {recentSrcSearchActive
                ? `${filteredRecentSources.length} match${filteredRecentSources.length === 1 ? '' : 'es'}`
                : 'Top rows you’ve started'}
            </span>
          </div>
          {nSources > 0 ? (
            <SearchInput
              id="recent-src-q"
              value={recentSrcQ}
              onChange={setRecentSrcQ}
              placeholder="Search sources by name or sourcetype…"
              ariaLabel="Filter recent sources"
            />
          ) : null}
          {nSources === 0 ? (
            <p className="m-0 rounded-xl border border-dashed border-cribl-border/90 bg-cribl-card-body px-4 py-6 text-center text-sm text-cribl-muted">
              No sources yet — use <strong>+ Add source</strong> in the left nav.
            </p>
          ) : filteredRecentSources.length === 0 ? (
            <p className="m-0 rounded-xl border border-cribl-border/80 bg-white px-4 py-5 text-center text-sm text-cribl-muted">
              No matches for “{recentSrcQ.trim()}”.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {filteredRecentSources.map((row) => (
                <li key={row.id} className="min-w-0">
                  <RecentSourceCard row={row} onOpen={() => onSelectSource(row.id)} />
                </li>
              ))}
            </ul>
          )}
          {!recentSrcSearchActive && nSources > 4 ? (
            <p className="m-0 mt-2 text-xs text-cribl-muted">+{nSources - 4} more sources in the sidebar…</p>
          ) : null}
          <div className="pt-1">
            <button
              type="button"
              onClick={onGoToSources}
              className="h-9 rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-ink shadow-ctrl hover:bg-cribl-elevate"
            >
              View all sources
            </button>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="card-axiom border-cribl-border/80 bg-cribl-card-body p-4 sm:p-5">
            <h3 className="m-0 text-sm font-semibold text-cribl-ink">Worker groups &amp; fleets</h3>
            <p className="m-0 mt-0.5 text-xs text-cribl-muted">
              Capacity and source assignment · {unassignedSources} unassigned
            </p>
            {wgStats.length > 0 ? (
              <SearchInput
                id="recent-wg-q"
                value={recentWgQ}
                onChange={setRecentWgQ}
                placeholder="Search worker groups & fleets…"
                ariaLabel="Filter worker groups and fleets"
                className="mt-3"
              />
            ) : null}
            {wgStats.length > 0 ? (
              <div className="mt-4">
                {wgSearchActive && wgPageSlice.length === 0 ? (
                  <p className="m-0 rounded-lg border border-cribl-border/80 bg-white px-3 py-4 text-center text-sm text-cribl-muted">
                    No worker groups or fleets match “{recentWgQ.trim()}”.
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-3">
                  {wgPageSlice.map((w) => {
                    const isEdge = w.kind === 'edge'
                    const volLine =
                      Number.isFinite(w.srcVolSum) && w.srcVolSum > 0
                        ? formatGbOrTbPerDayStr(w.srcVolSum)
                        : '—'
                    const inOutStr =
                      w.effIngest == null && w.effEgress == null
                        ? '—'
                        : [w.effIngest, w.effEgress]
                            .map((n) => (n == null || !Number.isFinite(n) ? '—' : formatGbOrTbPerDayStr(n)))
                            .join(' / ')
                    /**
                     * Capacity tooltip mirrors the wording on the WG /
                     * Fleet detail page so customers recognize the same
                     * "ingest / egress" Capacity card from this rollup.
                     */
                    const capacityTooltip = isEdge
                      ? 'Same as Fleet → Capacity: ingest and egress (auto or override)'
                      : 'Same as Worker group → Capacity: ingest and egress (auto or override)'
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => onOpenWorkerGroup(w.id)}
                        aria-label={`Open ${isEdge ? 'fleet' : 'worker group'} ${w.name}`}
                        className="group min-w-0 overflow-hidden rounded-xl border border-cribl-border/90 bg-white p-3.5 text-left shadow-ctrl transition hover:border-cribl-primary/50 hover:bg-cribl-elevate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cribl-primary/40"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <h4 className="m-0 text-base font-semibold leading-snug text-cribl-ink" title={w.name}>
                            {w.name}
                          </h4>
                          <span
                            className={[
                              'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                              isEdge
                                ? 'border-cribl-primary/30 bg-cribl-primary-soft text-cribl-primary-ink'
                                : 'border-cribl-border bg-cribl-card-body text-cribl-muted',
                            ].join(' ')}
                            title={isEdge ? 'Edge fleet' : 'Stream worker group'}
                          >
                            {isEdge ? 'Fleet' : 'WG'}
                          </span>
                        </div>
                        <p className="m-0 mt-1.5 text-xs leading-relaxed text-cribl-ink/85">
                          {w.sources > 0
                            ? `${w.sources} source${w.sources === 1 ? '' : 's'}`
                            : 'No sources'}
                          <span className="text-cribl-border/90"> · </span>
                          <span className="tabular-nums">Est. {volLine}</span>
                          <span className="text-cribl-border/90"> · </span>
                          <span className="text-cribl-ink/90" title={capacityTooltip}>
                            in/out {inOutStr}
                          </span>
                        </p>
                      </button>
                    )
                  })}
                </div>
                {!wgSearchActive && wgPageCount > 1 ? (
                  <div className="mt-4 flex flex-col items-stretch gap-2 border-t border-cribl-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="m-0 text-center text-xs text-cribl-muted sm:text-left">
                      Page {wgPageSafe + 1} of {wgPageCount} · {wgStats.length}{' '}
                      {wgStats.length === 1 ? 'entry' : 'entries'}
                    </p>
                    <div className="flex items-center justify-center gap-2 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => setWgPage((p) => Math.max(0, p - 1))}
                        disabled={wgPageSafe <= 0}
                        className="h-8 min-w-[4.5rem] rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-ink shadow-ctrl enabled:hover:bg-cribl-elevate disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => setWgPage((p) => Math.min(wgPageCount - 1, p + 1))}
                        disabled={wgPageSafe >= wgPageCount - 1}
                        className="h-8 min-w-[4.5rem] rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-ink shadow-ctrl enabled:hover:bg-cribl-elevate disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="m-0 mt-3 text-sm text-cribl-muted">No worker groups or fleets yet.</p>
            )}
            <div className="mt-3 flex flex-col gap-2 sm:mt-4 sm:flex-row">
              <button
                type="button"
                onClick={onGoToWorkers}
                className="w-full rounded-lg border border-cribl-border bg-white px-3 py-2 text-sm font-semibold text-cribl-ink shadow-ctrl hover:bg-cribl-elevate"
              >
                All worker groups
              </button>
              <button
                type="button"
                onClick={onGoToFleets}
                className="w-full rounded-lg border border-cribl-border bg-white px-3 py-2 text-sm font-semibold text-cribl-ink shadow-ctrl hover:bg-cribl-elevate"
              >
                All fleets
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
