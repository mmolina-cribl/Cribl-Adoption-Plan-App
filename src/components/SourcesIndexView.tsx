import { useMemo, useState } from 'react'
import type { PlanState } from '../types/planTypes'
import { formatGbOrTbPerDayStr, parseGb } from '../lib/formatRate'

type Props = {
  plan: PlanState
  onOpenSource: (id: string) => void
}

export function SourcesIndexView({ plan, onOpenSource }: Props) {
  const [q, setQ] = useState('')
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [onlyHighPriority, setOnlyHighPriority] = useState(false)
  const sources = plan.sourceSummary

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return sources
      .filter((s) => (!onlyUnassigned ? true : !s.workerGroupId))
      .filter((s) => (!onlyHighPriority ? true : /^high$/i.test((s.dataCriticality || '').trim()) || s.complianceRelated))
      .filter((s) => {
      const name = (s.displayName || '').toLowerCase()
      const src = (s.source || '').toLowerCase()
      const tile = (s.sourceTile || '').toLowerCase()
      return !needle || name.includes(needle) || src.includes(needle) || tile.includes(needle)
    })
  }, [q, sources, onlyUnassigned, onlyHighPriority])

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="m-0 text-lg font-semibold tracking-tight text-cribl-ink sm:text-xl">Sources</h2>
          <p className="m-0 mt-1.5 text-sm text-cribl-muted">Browse all sources. Search by name, tile, or sourcetype.</p>
        </div>
        <div className="w-full sm:w-80">
          <label className="sr-only" htmlFor="src-index-q">
            Search sources
          </label>
          <input
            id="src-index-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sources…"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-cribl-border bg-white px-3 py-2 text-sm text-cribl-ink shadow-ctrl">
          <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
          Unassigned only
        </label>
        <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-cribl-border bg-white px-3 py-2 text-sm text-cribl-ink shadow-ctrl">
          <input type="checkbox" checked={onlyHighPriority} onChange={(e) => setOnlyHighPriority(e.target.checked)} />
          High priority only
        </label>
      </div>

      {sources.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-cribl-border/90 bg-cribl-card-body px-4 py-6 text-center text-sm text-cribl-muted">
          No sources yet — use <strong>+ Add source</strong> in the left nav.
        </p>
      ) : filtered.length === 0 ? (
        <p className="m-0 rounded-xl border border-cribl-border/80 bg-white px-4 py-6 text-center text-sm text-cribl-muted">
          No matches for “{q.trim()}”.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => {
            const name = s.displayName?.trim() || 'Source'
            const tile = s.sourceTile?.trim()
            const src = s.source?.trim()
            const v = parseGb(s.avgDailyGb)
            const volStr = Number.isFinite(v) ? formatGbOrTbPerDayStr(v) : ''
            const subtitleBits = [tile, src].filter(Boolean)
            const subtitle = subtitleBits
              .filter((b, i) => subtitleBits.findIndex((x) => x.toLowerCase() === b.toLowerCase()) === i)
              .join(' · ')
            return (
              <li key={s.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onOpenSource(s.id)}
                  className="card-axiom w-full border-cribl-border/80 bg-white p-4 text-left shadow-ctrl hover:bg-cribl-elevate"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="m-0 min-w-0 truncate text-sm font-semibold text-cribl-ink">{name}</p>
                    {volStr ? (
                      <span className="shrink-0 text-xs tabular-nums text-cribl-muted">{volStr}</span>
                    ) : null}
                  </div>
                  {subtitle ? <p className="m-0 mt-1 text-xs text-cribl-muted">{subtitle}</p> : null}
                  <p className="m-0 mt-2 text-[11px] text-cribl-muted">Click to open</p>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

