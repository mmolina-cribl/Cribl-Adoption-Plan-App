import { useEffect, useMemo, useState } from 'react'
import { formatGbOrTbPerDayStr } from '../lib/formatRate'
import { CHART_CRIBL_BLUE } from '../lib/chartColors'
import { buildDashboardSnapshot } from '../lib/planDashboardStats'
import {
  effectiveIngestEgressGbdForWg,
  sumAvgDailyFromSourceSummaryForWg,
} from '../lib/workerGroupRollup'
import type { PlanState } from '../types/planTypes'

const WG_SNAPSHOT_PAGE_SIZE = 2

type Props = {
  plan: PlanState
  onGoToWorkers: () => void
  onOpenWorkerGroup: (id: string) => void
  onGoToSources: () => void
  onSelectSource: (id: string) => void
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
  const total = items.reduce((a, x) => a + x.value, 0)
  const r = 16
  const c = 2 * Math.PI * r
  let offset = 0
  const segs = items
    .filter((x) => x.value > 0)
    .map((x) => {
      const frac = total > 0 ? x.value / total : 0
      const dash = frac * c
      const seg = (
        <circle
          key={x.label}
          cx="20"
          cy="20"
          r={r}
          fill="transparent"
          stroke={x.color}
          strokeWidth="8"
          strokeDasharray={`${dash} ${c - dash}`}
          strokeDashoffset={-offset}
          strokeLinecap="butt"
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
              <div className="h-full rounded-full bg-cribl-blue" style={{ width: `${w}%` }} />
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

function ProgressMini({ pct }: { pct: number }) {
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
        className="h-full rounded-full bg-cribl-blue transition-[width] duration-500"
        style={{ width: `${w}%` }}
      />
    </div>
  )
}

export function PlanDataOverview({
  plan,
  onGoToWorkers,
  onOpenWorkerGroup,
  onGoToSources,
  onSelectSource,
}: Props) {
  const snap = useMemo(() => buildDashboardSnapshot(plan), [plan])
  const nSources = plan.sourceSummary.length
  const nWg = plan.workerGroups.length
  const customer = plan.customerName.trim()
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

  const currentCount = plan.sourceSummary.filter((s) => s.isCurrent).length
  const plannedCount = Math.max(0, nSources - currentCount)
  const critCounts = new Map<string, number>()
  for (const r of plan.sourceSummary) {
    const v = (r.dataCriticality || '').trim()
    const key =
      /^high$/i.test(v) ? 'High' : /^medium$/i.test(v) ? 'Medium' : /^low$/i.test(v) ? 'Low' : v ? 'Other' : 'Unknown'
    critCounts.set(key, (critCounts.get(key) || 0) + 1)
  }
  const vols = plan.sourceSummary
    .map((r) => ({ label: r.displayName?.trim() || 'Source', value: parseGb(r.avgDailyGb) }))
    .filter((x) => Number.isFinite(x.value) && x.value >= 0)
    .sort((a, b) => b.value - a.value)
  const topVols = vols.slice(0, 6)
  const summaryTopoVols = plan.sourceSummary
    .map((r) => ({ label: r.displayName?.trim() || r.source?.trim() || 'Source', value: parseGb(r.avgDailyGb) }))
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
    for (const reg of parseMultiValue(r.regions || '')) {
      regionCounts.set(reg, (regionCounts.get(reg) || 0) + 1)
    }
  }
  const topRegions = Array.from(regionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }))

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="overflow-hidden rounded-2xl border border-cribl-border/80 bg-gradient-to-br from-cribl-primary-soft/60 via-white to-cribl-canvas/90 px-5 py-5 shadow-card-float sm:px-8 sm:py-6">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-cribl-primary">Adoption plan</p>
        {/*
         * TODO: derive the company name from the user's Cribl account details
         * once the platform exposes that to embedded apps. For now the user
         * types their own company name into the header (it's *their* org's
         * name, since their customers will be the ones reading the plan).
         * See CRIBL_DEV_NOTES.md "User identity inside the iframe".
         */}
        <h2 className="m-0 mt-1 text-xl font-semibold leading-tight text-cribl-ink sm:text-2xl">
          {customer || 'Your Company Name'}
        </h2>
        {!customer && (
          <p className="m-0 mt-1 text-xs italic text-cribl-muted/80">
            Edit it in the field at the top right.
          </p>
        )}
        <p className="m-0 mt-2 max-w-2xl text-sm leading-relaxed text-cribl-muted">
          A quick snapshot of what you have captured so far. Open any area from the left to keep going. When you want a
          file to share, use <span className="text-cribl-ink/80">Export</span> in the sidebar.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Data sources" value={nSources} hint="Per-source summary rows" />
        <StatCard label="Worker Groups" value={nWg} hint="Capacity + specs" />
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
          <p className="m-0 mt-0.5 text-xs text-cribl-muted">Current vs planned sources</p>
          <div className="mt-3">
            <DonutChart
              items={[
                { label: 'Current', value: currentCount, color: CHART_CRIBL_BLUE },
                { label: 'Planned', value: plannedCount, color: '#94a3b8' },
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
            <p className="m-0 text-sm font-semibold text-cribl-ink">Regions</p>
            <p className="m-0 mt-0.5 text-xs text-cribl-muted">
              Counts by region tag (a source with several regions adds to each)
            </p>
            <div className="mt-3">
              {topRegions.length === 0 ? (
                <p className="m-0 text-sm text-cribl-muted">No region tags yet.</p>
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
            <div>
              <label className="sr-only" htmlFor="recent-src-q">
                Filter recent sources
              </label>
              <input
                id="recent-src-q"
                value={recentSrcQ}
                onChange={(e) => setRecentSrcQ(e.target.value)}
                placeholder="Search sources by name or sourcetype…"
                autoComplete="off"
                className="h-9 w-full"
              />
            </div>
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
                  <div className="card-axiom flex min-w-0 flex-col gap-2.5 border-cribl-border/80 bg-white p-3.5 shadow-ctrl sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-cribl-ink">{row.name}</span>
                        <span className="text-xs tabular-nums text-cribl-muted">
                          {row.pct}% · {row.filled}/{row.total} fields
                        </span>
                      </div>
                      <p className="m-0 text-xs text-cribl-muted">
                        <span className="text-cribl-ink">Source (sourcetype):</span> {row.label} ·{' '}
                        <span className="text-cribl-ink">Est. daily volume:</span> {row.volGb}{' '}
                        {row.volGb !== '—' ? 'GB' : ''}
                      </p>
                      <div className="mt-2 max-w-md">
                        <ProgressMini pct={row.pct} />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelectSource(row.id)}
                      className="h-9 shrink-0 self-stretch rounded-lg border border-cribl-border bg-cribl-canvas px-3 text-sm font-medium text-cribl-ink sm:self-center sm:px-4"
                    >
                      Open
                    </button>
                  </div>
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
            <h3 className="m-0 text-sm font-semibold text-cribl-ink">Worker groups</h3>
            <p className="m-0 mt-0.5 text-xs text-cribl-muted">
              Capacity and source assignment · {unassignedSources} unassigned
            </p>
            {wgStats.length > 0 ? (
              <div className="mt-3">
                <label className="sr-only" htmlFor="recent-wg-q">
                  Filter worker groups
                </label>
                <input
                  id="recent-wg-q"
                  value={recentWgQ}
                  onChange={(e) => setRecentWgQ(e.target.value)}
                  placeholder="Search worker groups…"
                  autoComplete="off"
                  className="h-9 w-full"
                />
              </div>
            ) : null}
            {wgStats.length > 0 ? (
              <div className="mt-4">
                {wgSearchActive && wgPageSlice.length === 0 ? (
                  <p className="m-0 rounded-lg border border-cribl-border/80 bg-white px-3 py-4 text-center text-sm text-cribl-muted">
                    No worker groups match “{recentWgQ.trim()}”.
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-3">
                  {wgPageSlice.map((w) => {
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
                    return (
                      <div
                        key={w.id}
                        className="min-w-0 overflow-hidden rounded-xl border border-cribl-border/90 bg-white p-3.5 text-left shadow-ctrl"
                      >
                        <h4 className="m-0 text-base font-semibold leading-snug text-cribl-ink" title={w.name}>
                          {w.name}
                        </h4>
                        <p className="m-0 mt-1.5 text-xs leading-relaxed text-cribl-ink/85">
                          {w.sources > 0
                            ? `${w.sources} source${w.sources === 1 ? '' : 's'}`
                            : 'No sources'}
                          <span className="text-cribl-border/90"> · </span>
                          <span className="tabular-nums">Est. {volLine}</span>
                          <span className="text-cribl-border/90"> · </span>
                          <span className="text-cribl-ink/90" title="Same as Worker group → Capacity: ingest and egress (auto or override)">
                            in/out {inOutStr}
                          </span>
                        </p>
                        <div className="mt-2.5">
                          <button
                            type="button"
                            onClick={() => onOpenWorkerGroup(w.id)}
                            className="h-8 w-full whitespace-nowrap rounded-md border border-cribl-border bg-cribl-canvas px-3 text-sm font-medium text-cribl-ink hover:bg-cribl-elevate"
                          >
                            Open
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {!wgSearchActive && wgPageCount > 1 ? (
                  <div className="mt-4 flex flex-col items-stretch gap-2 border-t border-cribl-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="m-0 text-center text-xs text-cribl-muted sm:text-left">
                      Page {wgPageSafe + 1} of {wgPageCount} · {wgStats.length} group{wgStats.length === 1 ? '' : 's'}
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
              <p className="m-0 mt-3 text-sm text-cribl-muted">No worker groups yet.</p>
            )}
            <div className="mt-3 flex flex-col gap-2 sm:mt-4 sm:flex-row">
              <button
                type="button"
                onClick={onGoToWorkers}
                className="w-full rounded-lg border border-cribl-border bg-white px-3 py-2 text-sm font-semibold text-cribl-ink shadow-ctrl hover:bg-cribl-elevate"
              >
                All worker groups
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
