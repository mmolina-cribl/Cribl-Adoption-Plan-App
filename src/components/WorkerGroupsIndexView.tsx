import { useMemo, useState } from 'react'
import type { PlanState } from '../types/planTypes'
import { formatGbOrTbPerDayStr, parseGb } from '../lib/formatRate'
import { effectiveIngestEgressGbdForWg, sumAvgDailyFromSourceSummaryForWg } from '../lib/workerGroupRollup'

type Props = {
  plan: PlanState
  onOpenGroup: (id: string) => void
}

function fmtGb(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'
}

type WgIndexRow = {
  id: string
  name: string
  nSources: number
  volGb: number
  effIngest: number | null
  effEgress: number | null
  throughput: number
  disk: number
  hosting: string
  workers: string
  detail: string
}

export function WorkerGroupsIndexView({ plan, onOpenGroup }: Props) {
  const [q, setQ] = useState('')
  const [onlyWithSources, setOnlyWithSources] = useState(false)
  const [onlyOver1Tb, setOnlyOver1Tb] = useState(false)

  const groups = plan.workerGroups
  const rows: WgIndexRow[] = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return groups
      .map((g) => {
        const nSources = plan.sourceSummary.filter((s) => s.workerGroupId === g.id).length
        const vol = sumAvgDailyFromSourceSummaryForWg(plan, g.id).sum
        const cap = effectiveIngestEgressGbdForWg(plan, g)
        const throughput = parseGb(g.throughputGbd)
        const disk = parseGb(g.diskOneDayGb)
        return {
          id: g.id,
          name: g.wg.trim() || 'Unnamed worker group',
          nSources,
          volGb: vol,
          effIngest: cap?.ingestGb ?? null,
          effEgress: cap?.egressGb ?? null,
          throughput: Number.isFinite(throughput) ? throughput : 0,
          disk: Number.isFinite(disk) ? disk : 0,
          hosting: (g.workerHosting || '').trim(),
          workers: (g.workerCount || '').trim(),
          detail: (g.workerDetail || '').trim(),
        }
      })
      .filter((r) => (!needle ? true : r.name.toLowerCase().includes(needle)))
      .filter((r) => (!onlyWithSources ? true : r.nSources > 0))
      .filter((r) => (!onlyOver1Tb ? true : r.volGb >= 1024))
      .sort((a, b) => b.volGb - a.volGb)
  }, [groups, plan, q, onlyWithSources, onlyOver1Tb])

  const maxSources = Math.max(0, ...rows.map((r) => r.nSources))

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="m-0 text-lg font-semibold tracking-tight text-cribl-ink sm:text-xl">Worker Groups</h2>
          <p className="m-0 mt-1.5 text-sm text-cribl-muted">Browse all worker groups. Search and filter.</p>
        </div>
        <div className="w-full sm:w-80">
          <label className="sr-only" htmlFor="wg-index-q">
            Search worker groups
          </label>
          <input
            id="wg-index-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search worker groups…"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-cribl-border bg-white px-3 py-2 text-sm text-cribl-ink shadow-ctrl">
          <input type="checkbox" checked={onlyWithSources} onChange={(e) => setOnlyWithSources(e.target.checked)} />
          Only with sources
        </label>
        <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-cribl-border bg-white px-3 py-2 text-sm text-cribl-ink shadow-ctrl">
          <input type="checkbox" checked={onlyOver1Tb} onChange={(e) => setOnlyOver1Tb(e.target.checked)} />
          ≥ 1 TB/d (from sources)
        </label>
      </div>

      {groups.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-cribl-border/90 bg-cribl-card-body px-4 py-6 text-center text-sm text-cribl-muted">
          No worker groups yet — use <strong>+ Add Worker Group</strong> in the left nav.
        </p>
      ) : rows.length === 0 ? (
        <p className="m-0 rounded-xl border border-cribl-border/80 bg-white px-4 py-6 text-center text-sm text-cribl-muted">
          No matches.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-5 p-0 lg:grid-cols-2">
          {rows.map((g) => {
            const srcBarPct = maxSources > 0 ? Math.round((g.nSources / maxSources) * 100) : 0
            const volLine =
              Number.isFinite(g.volGb) && g.volGb > 0 ? formatGbOrTbPerDayStr(g.volGb) : '—'
            return (
              <li key={g.id} className="min-w-0">
                <div className="min-w-0 overflow-hidden rounded-2xl border border-cribl-border/80 bg-white p-5 text-left shadow-ctrl sm:p-6">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <h3
                      className="m-0 min-w-0 break-words text-lg font-semibold leading-snug tracking-tight text-cribl-ink"
                      id={`wg-index-title-${g.id}`}
                    >
                      {g.name}
                    </h3>
                    {g.nSources > 0 ? (
                      <span className="shrink-0 rounded-lg bg-cribl-primary-soft px-2.5 py-1 text-sm font-medium text-cribl-primary-ink">
                        {g.nSources} source{g.nSources === 1 ? '' : 's'}
                      </span>
                    ) : (
                      <span className="shrink-0 text-sm text-cribl-muted">No sources</span>
                    )}
                  </div>
                  {maxSources > 0 && g.nSources > 0 ? (
                    <div
                      className="mt-3.5"
                      title="Share of sources vs the largest group in the list (with current filters)"
                    >
                      <div className="h-2 w-full overflow-hidden rounded-full bg-cribl-border/70">
                        <div
                          className="h-full rounded-full bg-cribl-blue"
                          style={{ width: `${srcBarPct}%` }}
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="min-w-0">
                      <p className="m-0 text-[10px] font-medium uppercase tracking-wide text-cribl-muted">
                        Est. daily (sources)
                      </p>
                      <p className="m-0 font-mono text-sm tabular-nums text-cribl-ink">{volLine}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="m-0 text-[10px] font-medium uppercase tracking-wide text-cribl-muted">In / out</p>
                      <p
                        className="m-0 min-w-0 break-words font-mono text-sm tabular-nums text-cribl-ink/90"
                        title="Same as Capacity: auto from source summaries, or field overrides"
                      >
                        {g.effIngest == null && g.effEgress == null
                          ? '—'
                          : [g.effIngest, g.effEgress]
                              .map((n) =>
                                n == null || !Number.isFinite(n) ? '—' : formatGbOrTbPerDayStr(n),
                              )
                              .join(' / ')}
                      </p>
                    </div>
                    {g.throughput > 0 ? (
                      <div className="min-w-0">
                        <p className="m-0 text-[10px] font-medium uppercase tracking-wide text-cribl-muted">Throughput</p>
                        <p className="m-0 font-mono text-sm tabular-nums text-cribl-ink/90">
                          {formatGbOrTbPerDayStr(g.throughput)}
                        </p>
                      </div>
                    ) : null}
                    {g.disk > 0 ? (
                      <div className="min-w-0">
                        <p className="m-0 text-[10px] font-medium uppercase tracking-wide text-cribl-muted">
                          1-day storage (disk)
                        </p>
                        <p className="m-0 font-mono text-sm tabular-nums text-cribl-ink/90">{fmtGb(g.disk)} GB</p>
                      </div>
                    ) : null}
                  </div>

                  {g.workers || g.hosting ? (
                    <p className="m-0 mt-4 text-sm leading-relaxed text-cribl-muted">
                      {g.workers ? (
                        <>
                          <span className="text-cribl-ink/80">Workers</span> {g.workers}
                        </>
                      ) : null}
                      {g.workers && g.hosting ? ' · ' : null}
                      {g.hosting ? <span className="text-cribl-ink/80">{g.hosting}</span> : null}
                    </p>
                  ) : null}

                  {g.detail ? (
                    <p
                      className="m-0 mt-2.5 line-clamp-3 text-sm leading-relaxed text-cribl-ink/85"
                      title={g.detail}
                    >
                      {g.detail}
                    </p>
                  ) : null}

                  <div className="mt-5">
                    <button
                      type="button"
                      onClick={() => onOpenGroup(g.id)}
                      className="h-10 w-full rounded-lg border border-cribl-border bg-cribl-canvas text-sm font-semibold text-cribl-ink hover:bg-cribl-elevate"
                      aria-describedby={`wg-index-title-${g.id}`}
                    >
                      Open worker group
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
