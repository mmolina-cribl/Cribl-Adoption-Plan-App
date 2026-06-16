import { useState, useMemo, type Dispatch, type SetStateAction } from 'react'
import { WorkerGroupEditor } from './WorkerGroupEditor'
import { usePatchWorkerGroup } from '../hooks/usePatchWorkerGroup'
import { sourceLabel, type PlanState } from '../types/planTypes'
import { sourceSummaryForWg } from '../lib/workerGroupIds'
import { isSourceRowAttachmentDisabled } from '../lib/sourceAttachmentDisabled'
import { LabeledField, SectionBox } from './FormControls'
import { EditableWorkerGroupName } from './EditableWorkerGroupName'
import { HostingPicker } from './HostingPicker'
import { effectiveIngestEgressGbdForWg } from '../lib/workerGroupRollup'
import { baselineNodesForThroughput } from '../lib/sizing'
import { sourceRowProgress } from '../lib/planDashboardStats'
import { formatGbOrTbPerDayStr, parseGb } from '../lib/formatRate'
import { ConfirmRemoveWorkerGroupDialog } from './ConfirmRemoveWorkerGroupDialog'
import { getWorkerGroupDetailCardsExpanded } from '../lib/detailCardsPreference'
import { CHART_CRIBL_BLUE } from '../lib/chartColors'
import { AttachSourceCombobox } from './AttachSourceCombobox'
import { WorkerGroupResourceMap } from './WorkerGroupResourceMap'
import { getOnboardingStatusCounts, ONBOARDING_STATUS_COLORS } from '../lib/onboardingStatus'
import { useEntryAnimation } from '../lib/animationsPreference'
import { AnimatedBar } from './AnimatedBar'

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

function parsePct(v: string | undefined): number {
  if (!v || !v.trim()) return Number.NaN
  const n = parseFloat(v.replace(/%/g, '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : Number.NaN
}

function fmtCompact(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function DonutChart({
  items,
}: {
  items: { label: string; value: number; valueLabel?: string; color: string }[]
}) {
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
            <span className="shrink-0 tabular-nums text-cribl-ink/80">{x.valueLabel ?? x.value}</span>
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
  items: { label: string; value: number; color?: string }[]
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
                className={`h-full rounded-full ${it.color ? '' : 'bg-cribl-blue'}`}
                style={{
                  width: `${animated ? w : 0}%`,
                  backgroundColor: it.color,
                  transition: animEnabled
                    ? 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)'
                    : undefined,
                }}
              />
            </div>
            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-cribl-ink/80">
              {fmtCompact(it.value)}
              {suffix || ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

type Props = {
  plan: PlanState
  setPlan: Dispatch<SetStateAction<PlanState>>
  groupId: string
  onRemoveGroup: (id: string) => void
  onSelectSource: (id: string) => void
  /**
   * Open the global "New data source" dialog (same flow used by the left
   * sidebar "+ Add source" button). The resource map exposes a "+ New
   * source" action that calls this so customers can spawn new sources
   * directly from the worker-group page.
   */
  onAddSource: () => void
  /** Navigate to another worker group / fleet (used for sub-fleet chips). */
  onSelectWorkerGroup: (id: string) => void
  /**
   * Edge only: open the global new sub-fleet dialog scoped to this fleet’s
   * top-level parent (resource map + hub actions).
   */
  onRequestCreateSubfleet?: () => void
}

export function WorkerGroupDetailView({
  plan,
  setPlan,
  groupId,
  onRemoveGroup,
  onSelectSource,
  onAddSource,
  onSelectWorkerGroup,
  onRequestCreateSubfleet,
}: Props) {
  const g = plan.workerGroups.find((x) => x.id === groupId) ?? null
  const s = usePatchWorkerGroup(setPlan, groupId)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const expandByDefault = getWorkerGroupDetailCardsExpanded()
  // Must run before any early return: after remove, `groupId` can briefly
  // point at a deleted row while plan has already updated — same hook count
  // every render avoids a Rules-of-Hooks crash (blank page).
  const subFleets = useMemo(() => {
    if (!g || g.kind !== 'edge') return []
    return plan.workerGroups.filter(
      (w) => w.kind === 'edge' && (w.parentFleetId ?? '').trim() === g.id,
    )
  }, [g, plan.workerGroups])

  if (!g) {
    return (
      <p className="m-0 text-sm text-cribl-muted">
        This worker group or fleet no longer exists. Add one from the sidebar, or select another in the list.
      </p>
    )
  }

  /**
   * Kind-aware copy for the detail view. Stream worker groups and Edge
   * fleets share the same view component, but every user-visible string
   * that names the kind flips through this object so the page reads
   * naturally in both modes.
   */
  const isEdge = g.kind === 'edge'
  const copy = {
    title: isEdge ? 'Fleet' : 'Worker group',
    titleLower: isEdge ? 'fleet' : 'worker group',
    /** Header `aria-label` and editable-name placeholder. */
    headerAria: isEdge ? 'Fleet title' : 'Worker group title',
    /** Resource-map SectionBox card title. */
    resourceMapTitle: isEdge ? 'Fleet resource map' : 'Worker group resource map',
    /** Dashboard SectionBox card title. */
    dashboardTitle: isEdge ? 'Fleet dashboard' : 'Worker group dashboard',
    /** Empty-dashboard hint shown when no sources are attached. */
    emptyDashboard: isEdge
      ? 'Add sources to this fleet to see charts and rollups.'
      : 'Add sources to this worker group to see charts and rollups.',
    /** Donut/MiniBars hint copy that references "this group". */
    countsInThisGroup: isEdge ? 'Counts in this fleet' : 'Counts in this worker group',
    regionsInThisGroup: isEdge ? 'By location tag in this fleet' : 'By location tag in this group',
    /** Sources-section title (count interpolated). */
    sourcesTitle: (n: number) =>
      isEdge ? `Sources in this fleet (${n})` : `Sources in this worker group (${n})`,
    /** Empty-sources hint copy. */
    emptySources: isEdge
      ? 'No sources are assigned to this fleet yet. Use the search box above to attach an existing source, or open a Source summary page directly.'
      : 'No sources are assigned to this worker group yet. Use the search box above to attach an existing source, or open a Source summary page directly.',
    /** Per-source-card unassign-button tooltip. */
    unassignTooltip: isEdge ? 'Remove from this fleet' : 'Remove from this worker group',
    /** Topology card title and prose subject. */
    topologyTitle: isEdge ? 'Fleet topology' : 'Worker group topology',
    topologyProseSubject: isEdge ? 'fleet' : 'worker group',
    /** Destructive remove button label and confirm-dialog fallback name. */
    removeButton: isEdge ? 'Remove fleet' : 'Remove worker group',
    confirmFallbackName: isEdge ? 'Fleet' : 'Worker group',
  }

  const sources = sourceSummaryForWg(plan, g)
  const assignedCount = sources.length
  const sourcesWithIndex = sources.map((r) => ({
    row: r,
    index0: Math.max(0, plan.sourceSummary.findIndex((x) => x.id === r.id)),
  }))

  const vols = sourcesWithIndex
    .map(({ row, index0 }) => ({ label: sourceLabel(row, index0), value: parseGb(row.avgDailyGb) }))
    .filter((x) => Number.isFinite(x.value) && x.value >= 0)
    .sort((a, b) => b.value - a.value)
  const totalVol = vols.reduce((a, x) => a + x.value, 0)
  const topVols = vols.slice(0, 6)
  const maxVol = Math.max(0, ...vols.map((x) => x.value))
  const volUnit: 'GB/d' | 'TB/d' = maxVol >= 1024 ? 'TB/d' : 'GB/d'
  const volScale = volUnit === 'TB/d' ? 1 / 1024 : 1

  const reductions = sourcesWithIndex
    .map(({ row, index0 }) => {
      const avg = parseGb(row.avgDailyGb)
      const optGb = parseGb(row.dataOptGb)
      const optPct = parsePct(row.dataOptPct)
      let reducible = 0
      let basis = ''
      if (Number.isFinite(avg) && avg > 0) {
        if (Number.isFinite(optGb) && optGb > 0) {
          reducible = Math.min(avg, optGb)
          basis = `${fmtCompact(optGb)} GB/d`
        } else if (Number.isFinite(optPct) && optPct > 0) {
          reducible = Math.min(avg, avg * (optPct / 100))
          basis = `${Math.round(optPct)}%`
        }
      }
      return {
        id: row.id,
        name: sourceLabel(row, index0),
        avg,
        reducible,
        basis,
      }
    })
    .filter((x) => Number.isFinite(x.reducible) && x.reducible > 0)
    .sort((a, b) => b.reducible - a.reducible)

  const reducibleTotal = reductions.reduce((a, x) => a + x.reducible, 0)
  const afterOpt = Math.max(0, totalVol - reducibleTotal)
  const topReductions = reductions.slice(0, 6)
  const maxReduction = Math.max(0, ...topReductions.map((x) => x.reducible))
  const redUnit: 'GB/d' | 'TB/d' = maxReduction >= 1024 ? 'TB/d' : 'GB/d'
  const redScale = redUnit === 'TB/d' ? 1 / 1024 : 1

  const onboardingCounts = getOnboardingStatusCounts(sources)

  const critCounts = new Map<string, number>()
  for (const r of sources) {
    const v = (r.dataCriticality || '').trim()
    const key =
      /^high$/i.test(v) ? 'High' : /^medium$/i.test(v) ? 'Medium' : /^low$/i.test(v) ? 'Low' : v ? 'Other' : 'Unknown'
    critCounts.set(key, (critCounts.get(key) || 0) + 1)
  }

  const priorityRows = sources
    .filter((r) => /^high$/i.test((r.dataCriticality || '').trim()) || r.complianceRelated)
    .map((r) => {
      const i = plan.sourceSummary.findIndex((x) => x.id === r.id)
      return {
        id: r.id,
        name: sourceLabel(r, i >= 0 ? i : 0),
        vol: parseGb(r.avgDailyGb),
        compliance: r.complianceRelated,
        crit: (r.dataCriticality || '').trim() || 'Unknown',
      }
    })
    .sort((a, b) => {
      const av = Number.isFinite(a.vol) ? a.vol : -1
      const bv = Number.isFinite(b.vol) ? b.vol : -1
      return bv - av
    })

  const destCounts = new Map<string, number>()
  for (const r of sources) {
    for (const d of parseMultiValue(r.destinations || '')) {
      destCounts.set(d, (destCounts.get(d) || 0) + 1)
    }
  }
  const topDests = Array.from(destCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }))

  const typeOnPrem = sources.filter((r) => r.type === 'On-Prem').length
  const typeCloud = sources.filter((r) => r.type === 'Cloud/Internet').length
  const typeUnset = Math.max(0, sources.length - typeOnPrem - typeCloud)

  const regionCounts = new Map<string, number>()
  for (const r of sources) {
    for (const reg of parseMultiValue(r.physicalLocations || '')) {
      regionCounts.set(reg, (regionCounts.get(reg) || 0) + 1)
    }
  }
  const topRegions = Array.from(regionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }))

  const completionBuckets = { '0–25%': 0, '25–50%': 0, '50–75%': 0, '75–100%': 0 }
  for (const { row } of sourcesWithIndex) {
    const pct = sourceRowProgress(row).pct
    if (pct < 25) completionBuckets['0–25%'] += 1
    else if (pct < 50) completionBuckets['25–50%'] += 1
    else if (pct < 75) completionBuckets['50–75%'] += 1
    else completionBuckets['75–100%'] += 1
  }

  const unassignSource = (sourceId: string) => {
    setPlan((p) => ({
      ...p,
      sourceSummary: p.sourceSummary.map((r) =>
        // Clear streamOrEdge along with the WG id — an unattached source
        // has no Stream/Edge identity (auto-derived from WG.kind in v2.0).
        r.id === sourceId ? { ...r, workerGroupId: '', streamOrEdge: '' } : r,
      ),
      sourceVolume: p.sourceVolume.map((r) => {
        if (r.source?.trim() && r.source.trim() === (p.sourceSummary.find((x) => x.id === sourceId)?.source || '').trim()) {
          return { ...r, workerGroupId: '' }
        }
        return r
      }),
    }))
  }

  const assignSourceToThisGroup = (sourceId: string) => {
    setPlan((p) => {
      const target = p.sourceSummary.find((r) => r.id === sourceId)
      if (!target) {
        return p
      }
      if (isSourceRowAttachmentDisabled(target)) {
        return p
      }
      const sourceName = (target.source || '').trim()
      // Stamp streamOrEdge from this WG's kind ("Stream" / "Edge").
      const newStreamOrEdge = g.kind === 'edge' ? 'Edge' : 'Stream'
      return {
        ...p,
        sourceSummary: p.sourceSummary.map((r) =>
          r.id === sourceId ? { ...r, workerGroupId: g.id, streamOrEdge: newStreamOrEdge } : r,
        ),
        sourceVolume: p.sourceVolume.map((r) => {
          if (sourceName && (r.source || '').trim() === sourceName) {
            return { ...r, workerGroupId: g.id, wg: g.wg || r.wg }
          }
          return r
        }),
      }
    })
  }

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      {/*
       * Floating page heading — intentionally rendered without the
       * `SectionBox` / `card-axiom` chrome so the worker-group name
       * acts as the page title rather than yet another collapsible
       * panel. The kicker mirrors what `SectionBox` would have shown
       * so the visual rhythm with the cards below still reads.
       */}
      <header
        id="wg-header"
        className="flex min-w-0 flex-col gap-1 px-1"
        aria-label={copy.headerAria}
      >
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-cribl-primary">
          {copy.title}
        </p>
        <EditableWorkerGroupName
          groupId={g.id}
          value={g.wg}
          onChange={(v) => s('wg', v)}
          emptyLabel={copy.title}
          size="section"
        />
      </header>

      <SectionBox
        id="wg-resource-map"
        kicker="Diagram"
        title={copy.resourceMapTitle}
        defaultOpen={expandByDefault}
        allowOverflow
      >
        <WorkerGroupResourceMap
          workerGroup={g}
          sources={sources}
          totalVolumeGb={totalVol}
          childFleets={subFleets}
          unassignedSources={plan.sourceSummary.filter(
            (r) => !r.workerGroupId && !isSourceRowAttachmentDisabled(r),
          )}
          onOpenSource={onSelectSource}
          onUnassign={unassignSource}
          onAttach={assignSourceToThisGroup}
          onAddSource={onAddSource}
          onOpenChildFleet={onSelectWorkerGroup}
          onRequestCreateSubfleet={g.kind === 'edge' ? onRequestCreateSubfleet : undefined}
        />
      </SectionBox>

      <SectionBox
        id="wg-dashboard"
        kicker="Dashboard"
        title={copy.dashboardTitle}
        defaultOpen={expandByDefault}
        allowOverflow
      >
        {sources.length === 0 ? (
          <p className="m-0 text-sm text-cribl-muted">{copy.emptyDashboard}</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl">
              <p className="m-0 text-xs font-semibold text-cribl-ink">Onboarding status</p>
              <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">Complete · Current · Planned</p>
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

            <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl">
              <p className="m-0 text-xs font-semibold text-cribl-ink">Daily volume by source</p>
              <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">Top drivers</p>
              <div className="mt-3">
                {topVols.length === 0 ? (
                  <p className="m-0 text-sm text-cribl-muted">No volumes yet.</p>
                ) : (
                  <>
                    <MiniBars
                      items={topVols.map((x) => ({
                        label: x.label,
                        value: x.value * volScale,
                      }))}
                      suffix={` ${volUnit}`}
                    />
                    <p className="m-0 mt-2 text-[11px] text-cribl-muted">
                      Total with volume:{' '}
                      <span className="tabular-nums text-cribl-ink/80">{formatGbOrTbPerDayStr(totalVol)}</span>
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl">
              <p className="m-0 text-xs font-semibold text-cribl-ink">Data criticality mix</p>
              <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">{copy.countsInThisGroup}</p>
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

            <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl">
              <p className="m-0 text-xs font-semibold text-cribl-ink">Destinations mix</p>
              <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">Most common destinations</p>
              <div className="mt-3">
                {topDests.length === 0 ? (
                  <p className="m-0 text-sm text-cribl-muted">No destinations yet.</p>
                ) : (
                  <MiniBars items={topDests.map((d) => ({ label: d.label, value: d.value }))} />
                )}
              </div>
            </div>

            <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl">
              <p className="m-0 text-xs font-semibold text-cribl-ink">Source type</p>
              <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">On-Prem vs cloud vs not set</p>
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

            <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl">
              <p className="m-0 text-xs font-semibold text-cribl-ink">Physical locations</p>
              <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">{copy.regionsInThisGroup}</p>
              <div className="mt-3">
                {topRegions.length === 0 ? (
                  <p className="m-0 text-sm text-cribl-muted">No location tags yet.</p>
                ) : (
                  <MiniBars items={topRegions} />
                )}
              </div>
            </div>

            <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl lg:col-span-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="m-0 text-xs font-semibold text-cribl-ink">Optimization impact</p>
                <span className="text-[11px] tabular-nums text-cribl-muted">
                  {reductions.length} sources with estimates
                </span>
              </div>
              <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">
                Based on “Data optimization %” and “Data optimization (GB)” from your sources.
              </p>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-cribl-border/80 bg-cribl-card-body p-3">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-muted">Current</p>
                  <p className="m-0 mt-1 text-lg font-semibold tabular-nums text-cribl-ink">
                    {formatGbOrTbPerDayStr(totalVol)}
                  </p>
                </div>
                <div className="rounded-lg border border-cribl-border/80 bg-cribl-card-body p-3">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-muted">Reducible</p>
                  <p className="m-0 mt-1 text-lg font-semibold tabular-nums text-cribl-ink">
                    {formatGbOrTbPerDayStr(reducibleTotal)}
                  </p>
                </div>
                <div className="rounded-lg border border-cribl-border/80 bg-cribl-card-body p-3">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-muted">After</p>
                  <p className="m-0 mt-1 text-lg font-semibold tabular-nums text-cribl-ink">
                    {formatGbOrTbPerDayStr(afterOpt)}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="min-w-0">
                  <p className="m-0 text-xs font-semibold text-cribl-ink">Reduction by source</p>
                  <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">Top estimated savings</p>
                  <div className="mt-3">
                    {topReductions.length === 0 ? (
                      <p className="m-0 text-sm text-cribl-muted">Add optimization estimates to see impact.</p>
                    ) : (
                      <MiniBars
                        items={topReductions.map((x) => ({
                          label: x.basis ? `${x.name} (${x.basis})` : x.name,
                          value: x.reducible * redScale,
                        }))}
                        suffix={` ${redUnit}`}
                      />
                    )}
                    {reductions.length > 6 ? (
                      <p className="m-0 mt-2 text-[11px] text-cribl-muted">+{reductions.length - 6} more…</p>
                    ) : null}
                  </div>
                </div>

                <div className="min-w-0">
                  <p className="m-0 text-xs font-semibold text-cribl-ink">Reducible vs remaining</p>
                  <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">Share of volume</p>
                  <div className="mt-3">
                    <DonutChart
                      items={[
                        {
                          label: 'Reducible',
                          value: Math.round(reducibleTotal),
                          valueLabel: formatGbOrTbPerDayStr(reducibleTotal),
                          color: CHART_CRIBL_BLUE,
                        },
                        {
                          label: 'Remaining',
                          value: Math.round(afterOpt),
                          valueLabel: formatGbOrTbPerDayStr(afterOpt),
                          color: '#94a3b8',
                        },
                      ]}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl lg:col-span-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="m-0 text-xs font-semibold text-cribl-ink">High priority</p>
                <span className="text-[11px] tabular-nums text-cribl-muted">{priorityRows.length} flagged</span>
              </div>
              <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">
                High criticality sources and anything marked compliance-related.
              </p>
              <div className="mt-3">
                {priorityRows.length === 0 ? (
                  <p className="m-0 text-sm text-cribl-muted">No high-priority sources flagged yet.</p>
                ) : (
                  <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
                    {priorityRows.slice(0, 8).map((r) => (
                      <li key={r.id} className="min-w-0 rounded-lg border border-cribl-border/80 bg-cribl-card-body p-3">
                        <div className="flex min-w-0 items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-semibold text-cribl-ink" title={r.name}>
                            {r.name}
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-cribl-muted">
                            {Number.isFinite(r.vol) ? formatGbOrTbPerDayStr(r.vol) : '—'}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-cribl-muted">
                          <span className="rounded-md bg-white px-2 py-0.5 text-cribl-ink/80">
                            {/^high$/i.test(r.crit) ? 'High' : r.crit}
                          </span>
                          {r.compliance ? (
                            <span className="rounded-md bg-cribl-primary-soft px-2 py-0.5 text-cribl-primary-ink">
                              Compliance
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => onSelectSource(r.id)}
                            className="ml-auto rounded-md border border-cribl-border bg-white px-2 py-0.5 text-cribl-muted hover:text-cribl-ink"
                          >
                            Open
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {priorityRows.length > 8 ? (
                  <p className="m-0 mt-2 text-[11px] text-cribl-muted">+{priorityRows.length - 8} more…</p>
                ) : null}
              </div>
            </div>

            <div className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl lg:col-span-2">
              <p className="m-0 text-xs font-semibold text-cribl-ink">Completeness</p>
              <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">
                Percent of fields filled out on each Source summary (name, tile, destinations, volume, roadmap, value
                levers, etc.). Use it to see which sources need more detail.
              </p>
              <div className="mt-3">
                <MiniBars
                  items={Object.entries(completionBuckets)
                    .reverse()
                    .map(([label, value]) => {
                      const color =
                        label === '75–100%'
                          ? '#4ade80' // green-400 — success
                          : label === '50–75%'
                          ? '#fb923c' // orange-400
                          : label === '25–50%'
                          ? '#fbbf24' // amber-400
                          : '#f87171' // red-400 — needs attention
                      return { label, value, color }
                    })}
                />
              </div>
            </div>

          </div>
        )}
      </SectionBox>

      <SectionBox
        id="wg-sources"
        kicker="Overview"
        title={copy.sourcesTitle(sources.length)}
        defaultOpen={expandByDefault}
        allowOverflow
      >
        <AttachSourceCombobox
          className="mb-3"
          candidates={plan.sourceSummary
            .filter((r) => r.workerGroupId !== g.id && !isSourceRowAttachmentDisabled(r))
            .map((r) => {
              const wg = r.workerGroupId
                ? plan.workerGroups.find((w) => w.id === r.workerGroupId)?.wg.trim() || null
                : null
              return { row: r, currentWgName: wg }
            })}
          onAttach={assignSourceToThisGroup}
        />
        {sources.length === 0 ? (
          <p className="m-0 text-sm text-cribl-muted">{copy.emptySources}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {sources.map((r) => {
              const idx = plan.sourceSummary.findIndex((x) => x.id === r.id)
              const label = sourceLabel(r, idx >= 0 ? idx : 0)
              return (
              <li key={r.id} className="min-w-0">
                <div className="card-axiom flex min-w-0 flex-col gap-2.5 border-cribl-border/80 bg-white p-3.5 shadow-ctrl sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-semibold text-cribl-ink">
                        {label}
                      </span>
                    </div>
                    {(() => {
                      const tile = (r.sourceTile || '').trim()
                      const vol = (r.avgDailyGb || '').trim()
                      const volStr = vol ? formatGbOrTbPerDayStr(parseGb(vol)) : ''
                      const bits = [tile, volStr].filter(Boolean) as string[]
                      const subtitle = bits.join(' · ')
                      if (!subtitle) return null
                      return <p className="m-0 mt-1 text-xs text-cribl-muted">{subtitle}</p>
                    })()}
                    {(() => {
                      const v = parseGb(r.avgDailyGb)
                      if (!Number.isFinite(v) || v < 0 || maxVol <= 0) return null
                      const pct = Math.round((v / maxVol) * 100)
                      const vStr = formatGbOrTbPerDayStr(v)
                      return (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-cribl-border/70">
                            <AnimatedBar pct={pct} />
                          </div>
                          <span className="w-20 shrink-0 text-right text-xs tabular-nums text-cribl-ink/80">{vStr}</span>
                        </div>
                      )
                    })()}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 self-stretch sm:flex-row sm:self-center">
                    <button
                      type="button"
                      onClick={() => onSelectSource(r.id)}
                      className="h-9 shrink-0 rounded-lg border border-cribl-border bg-cribl-canvas px-3 text-sm font-medium text-cribl-ink sm:px-4"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => unassignSource(r.id)}
                      className="h-9 shrink-0 rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-muted hover:text-cribl-ink sm:px-4"
                      title={copy.unassignTooltip}
                    >
                      Unassign
                    </button>
                  </div>
                </div>
              </li>
              )
            })}
          </ul>
        )}
      </SectionBox>
      <WorkerGroupEditor
        plan={plan}
        group={g}
        s={s}
        onRemoveGroup={onRemoveGroup}
        defaultExpanded={expandByDefault}
      />

      <SectionBox
        id="wg-topology"
        kicker="Topology"
        title={copy.topologyTitle}
        defaultOpen={expandByDefault}
      >
        {(() => {
          const cap = effectiveIngestEgressGbdForWg(plan, g)
          const ingest = cap?.ingestGb ?? 0
          const egress = cap?.egressGb ?? 0
          const throughput = (ingest || 0) + (egress || 0)
          const baselineNodes = baselineNodesForThroughput(throughput)
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <LabeledField id={`wg-topology-hosting-${g.id}`} label="Hosting">
                  <HostingPicker
                    id={`wg-topology-hosting-${g.id}`}
                    value={g.workerHosting}
                    onChange={(v) => s('workerHosting', v)}
                  />
                </LabeledField>
                <LabeledField id={`wg-topology-count-${g.id}`} label="Worker count">
                  <input
                    type="text"
                    id={`wg-topology-count-${g.id}`}
                    value={g.workerCount}
                    onChange={(e) => s('workerCount', e.target.value)}
                    placeholder={baselineNodes ? `Auto: ${baselineNodes}` : 'e.g. 4'}
                  />
                </LabeledField>
                <LabeledField id={`wg-topology-detail-${g.id}`} label="Worker detail">
                  <input
                    type="text"
                    id={`wg-topology-detail-${g.id}`}
                    value={g.workerDetail}
                    onChange={(e) => s('workerDetail', e.target.value)}
                    placeholder="e.g. c6i.4xlarge, 16 vCPU/32 GB"
                  />
                </LabeledField>
              </div>
              <p className="m-0 text-xs text-cribl-muted">
                Topology fields describe what the {copy.topologyProseSubject} <em>is</em> (customer reality).
                Capacity numbers and sizing assumptions live in the{' '}
                <span className="text-cribl-ink">Capacity</span> card. All three fields round-trip to Excel via
                the <span className="text-cribl-ink">Worker Hosting</span> /
                <span className="text-cribl-ink"> Worker Count</span> /
                <span className="text-cribl-ink"> Worker Detail</span> columns.
              </p>
            </div>
          )
        })()}
      </SectionBox>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setConfirmRemoveOpen(true)}
          className="h-10 rounded-lg border border-rose-200 bg-rose-600 px-4 text-sm font-semibold text-white shadow-ctrl hover:bg-rose-700"
        >
          {copy.removeButton}
        </button>
      </div>

      <ConfirmRemoveWorkerGroupDialog
        open={confirmRemoveOpen}
        workerGroupName={g.wg.trim() || copy.confirmFallbackName}
        assignedSourcesCount={assignedCount}
        onCancel={() => setConfirmRemoveOpen(false)}
        onConfirm={() => {
          setConfirmRemoveOpen(false)
          onRemoveGroup(g.id)
        }}
      />
    </div>
  )
}
