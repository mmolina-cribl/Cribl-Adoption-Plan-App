import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { PlanState, SourceSummaryRow } from '../types/planTypes'
import { formatGbOrTbPerDayStr, parseGb } from '../lib/formatRate'
import { PopoverButton } from './PopoverButton'

type Props = {
  plan: PlanState
  setPlan: Dispatch<SetStateAction<PlanState>>
  onOpenSource: (id: string) => void
}

const NO_CHANGE = '__nochange__'

type SortBy =
  | 'default'
  | 'name'
  | 'volume'
  | 'criticality'
  | 'compliance'
  | 'workerGroup'
  | 'sourceTile'
  | 'onboardStart'
  | 'onboardEnd'
  | 'onboardCompleted'

type SortDir = 'asc' | 'desc'

/**
 * Sort dimensions exposed in the Sort popover. `defaultDir` is the direction
 * applied automatically when the user picks a dimension — chosen so the first
 * pick lands on the most-useful order (largest volume first, HIGH criticality
 * first, alphabetical names, etc.) and a single asc/desc flip handles edge
 * cases. `label` is what shows up in the dropdown and the trigger badge.
 */
const SORT_OPTIONS: { id: SortBy; label: string; defaultDir: SortDir }[] = [
  { id: 'default', label: 'Default (added order)', defaultDir: 'asc' },
  { id: 'name', label: 'Name', defaultDir: 'asc' },
  { id: 'volume', label: 'Daily volume (GB/d)', defaultDir: 'desc' },
  { id: 'criticality', label: 'Criticality', defaultDir: 'desc' },
  { id: 'compliance', label: 'Compliance flag', defaultDir: 'desc' },
  { id: 'workerGroup', label: 'Worker group', defaultDir: 'asc' },
  { id: 'sourceTile', label: 'Source tile', defaultDir: 'asc' },
  { id: 'onboardStart', label: 'Onboarding start', defaultDir: 'asc' },
  { id: 'onboardEnd', label: 'Onboarding end', defaultDir: 'asc' },
  { id: 'onboardCompleted', label: 'Onboarding completed', defaultDir: 'desc' },
]

function critOrd(c: string): number {
  const v = (c || '').trim().toUpperCase()
  if (v === 'HIGH') return 3
  if (v === 'MEDIUM') return 2
  if (v === 'LOW') return 1
  return 0
}

function parseDate(s: string | undefined): number {
  if (!s || !s.trim()) return Number.NaN
  const t = Date.parse(s.trim())
  return Number.isFinite(t) ? t : Number.NaN
}

export function SourcesIndexView({ plan, setPlan, onOpenSource }: Props) {
  const [q, setQ] = useState('')
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [onlyHighPriority, setOnlyHighPriority] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [filterOpen, setFilterOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [sortBy, setSortBy] = useState<SortBy>('default')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const sources = plan.sourceSummary

  // Prune selection when sources change (e.g. after a bulk delete or
  // an external edit). Cheaper than wrapping every state mutation.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<string>()
      const valid = new Set(sources.map((s) => s.id))
      for (const id of prev) {
        if (valid.has(id)) {
          next.add(id)
        }
      }
      return next.size === prev.size ? prev : next
    })
  }, [sources])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return sources
      .filter((s) => (!onlyUnassigned ? true : !s.workerGroupId))
      .filter(
        (s) => (!onlyHighPriority ? true : /^high$/i.test((s.dataCriticality || '').trim()) || s.complianceRelated),
      )
      .filter((s) => {
        const name = (s.displayName || '').toLowerCase()
        const src = (s.source || '').toLowerCase()
        const tile = (s.sourceTile || '').toLowerCase()
        return !needle || name.includes(needle) || src.includes(needle) || tile.includes(needle)
      })
  }, [q, sources, onlyUnassigned, onlyHighPriority])

  const visibleIds = useMemo(() => filtered.map((s) => s.id), [filtered])
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))

  /**
   * Max GB/d across the *currently visible* set, used to scale the per-card volume bar.
   * Mirrors how `WorkerGroupsIndexView` scales its blue bar against `maxSources` —
   * relative-to-the-current-view rather than relative-to-the-whole-plan, so users
   * can drill into a subset (e.g. "only unassigned") and still get useful contrast.
   */
  const maxVol = useMemo(() => {
    let m = 0
    for (const s of filtered) {
      const v = parseGb(s.avgDailyGb)
      if (Number.isFinite(v) && v > m) m = v
    }
    return m
  }, [filtered])

  const collator = useMemo(
    () => new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }),
    [],
  )

  /**
   * Sorted view of `filtered` for the card grid. Sorting is layered on top of
   * the existing filter pipeline (it never changes set membership), so
   * `maxVol`, `visibleIds`, the empty state, and Select-all-matching all stay
   * unchanged whether sort is active or not.
   *
   * Missing values (NaN volume, unparseable dates) always sort *last* regardless
   * of asc/desc so the user never has to scroll past empty rows to find data.
   * That's why the missing-check happens before the `dir` multiplier.
   */
  const sorted = useMemo(() => {
    if (sortBy === 'default') return filtered
    const dir = sortDir === 'asc' ? 1 : -1
    const wgNameById = new Map(plan.workerGroups.map((g) => [g.id, g.wg.trim()]))

    const numericMissingLast = (
      a: SourceSummaryRow,
      b: SourceSummaryRow,
      get: (r: SourceSummaryRow) => number,
    ): number => {
      const va = get(a)
      const vb = get(b)
      const aFin = Number.isFinite(va)
      const bFin = Number.isFinite(vb)
      if (!aFin && !bFin) return 0
      if (!aFin) return 1
      if (!bFin) return -1
      return dir * (va - vb)
    }

    const cmp = (a: SourceSummaryRow, b: SourceSummaryRow): number => {
      switch (sortBy) {
        case 'name':
          return dir * collator.compare(a.displayName || '', b.displayName || '')
        case 'volume':
          return numericMissingLast(a, b, (r) => parseGb(r.avgDailyGb))
        case 'criticality':
          return dir * (critOrd(a.dataCriticality) - critOrd(b.dataCriticality))
        case 'compliance':
          return dir * (Number(a.complianceRelated) - Number(b.complianceRelated))
        case 'workerGroup': {
          const aName = a.workerGroupId ? wgNameById.get(a.workerGroupId) || '' : ''
          const bName = b.workerGroupId ? wgNameById.get(b.workerGroupId) || '' : ''
          return dir * collator.compare(aName, bName)
        }
        case 'sourceTile':
          return dir * collator.compare(a.sourceTile || '', b.sourceTile || '')
        case 'onboardStart':
          return numericMissingLast(a, b, (r) => parseDate(r.targetOnboardStart))
        case 'onboardEnd':
          return numericMissingLast(a, b, (r) => parseDate(r.targetOnboardEnd))
        case 'onboardCompleted':
          return numericMissingLast(a, b, (r) => parseDate(r.onboardingCompletedOn))
        default:
          return 0
      }
    }

    return [...filtered].sort(cmp)
  }, [filtered, sortBy, sortDir, plan.workerGroups, collator])

  const sortLabel = SORT_OPTIONS.find((o) => o.id === sortBy)?.label ?? 'Default'
  const sortBadge = sortBy === 'default' ? 0 : 1

  const activeFilterCount =
    (onlyUnassigned ? 1 : 0) + (onlyHighPriority ? 1 : 0) + (q.trim() ? 1 : 0)

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const selectAllMatching = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of visibleIds) {
        next.add(id)
      }
      return next
    })
    setFilterOpen(false)
  }

  const clearFilters = () => {
    setOnlyUnassigned(false)
    setOnlyHighPriority(false)
    setQ('')
  }

  const clearSelection = () => setSelected(new Set())

  const bulkPatch = (patch: (row: SourceSummaryRow) => SourceSummaryRow) => {
    setPlan((p) => {
      const targetIds = selected
      const targetSourceNames = new Set(
        p.sourceSummary
          .filter((r) => targetIds.has(r.id))
          .map((r) => (r.source || '').trim())
          .filter(Boolean),
      )
      return {
        ...p,
        sourceSummary: p.sourceSummary.map((r) => (targetIds.has(r.id) ? patch(r) : r)),
        sourceVolume: p.sourceVolume.map((v) => {
          const name = (v.source || '').trim()
          if (!name || !targetSourceNames.has(name)) {
            return v
          }
          const sample = p.sourceSummary.find((r) => targetIds.has(r.id) && (r.source || '').trim() === name)
          if (!sample) {
            return v
          }
          const next = patch(sample)
          if (next.workerGroupId !== sample.workerGroupId) {
            const wgName =
              p.workerGroups.find((w) => w.id === next.workerGroupId)?.wg.trim() || (next.workerGroupId ? v.wg : '')
            return { ...v, workerGroupId: next.workerGroupId, wg: wgName }
          }
          return v
        }),
      }
    })
  }

  const bulkAssignWg = (workerGroupId: string) => {
    bulkPatch((r) => ({ ...r, workerGroupId }))
  }

  const bulkSetCriticality = (value: string) => {
    bulkPatch((r) => ({ ...r, dataCriticality: value }))
  }

  const bulkSetCompliance = (value: boolean) => {
    bulkPatch((r) => ({ ...r, complianceRelated: value }))
  }

  const bulkSetType = (value: SourceSummaryRow['type']) => {
    bulkPatch((r) => ({ ...r, type: value }))
  }

  const bulkDelete = () => {
    const count = selected.size
    if (count === 0) {
      return
    }
    const ok = window.confirm(
      `Delete ${count} source${count === 1 ? '' : 's'}? This cannot be undone (you can re-import from Excel).`,
    )
    if (!ok) {
      return
    }
    setPlan((p) => ({
      ...p,
      sourceSummary: p.sourceSummary.filter((r) => !selected.has(r.id)),
    }))
    setSelected(new Set())
    setActionsOpen(false)
  }

  const selectionCount = selected.size

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="m-0 text-lg font-semibold tracking-tight text-cribl-ink sm:text-xl">Sources</h2>
          <p className="m-0 mt-1.5 text-sm text-cribl-muted">
            Browse all sources. Filter to narrow the list, then use Bulk Actions to apply changes across many at
            once.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:shrink-0">
          <div className="w-full sm:w-72">
            <label className="sr-only" htmlFor="src-index-q">
              Search sources
            </label>
            <input
              id="src-index-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search sources…"
              autoComplete="off"
              className="h-9 w-full"
            />
          </div>
          <div className="flex items-center gap-2 self-end">
            <PopoverButton
              label="Filter"
              badge={activeFilterCount}
              open={filterOpen}
              onToggle={() => {
                setFilterOpen((v) => !v)
                setActionsOpen(false)
                setSortOpen(false)
              }}
            >
              <div className="space-y-3">
                <p className="m-0 text-xs font-semibold uppercase tracking-wider text-cribl-muted">Filters</p>
                <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-cribl-ink">
                  <input
                    type="checkbox"
                    checked={onlyUnassigned}
                    onChange={(e) => setOnlyUnassigned(e.target.checked)}
                  />
                  Unassigned only
                </label>
                <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-cribl-ink">
                  <input
                    type="checkbox"
                    checked={onlyHighPriority}
                    onChange={(e) => setOnlyHighPriority(e.target.checked)}
                  />
                  High priority only
                </label>
                {q.trim() ? (
                  <p className="m-0 rounded-md bg-cribl-card-body px-2 py-1.5 text-xs text-cribl-muted">
                    Search filter active: <span className="text-cribl-ink">“{q.trim()}”</span>
                  </p>
                ) : null}
                <div className="border-t border-cribl-border/70 pt-3">
                  <p className="m-0 text-xs text-cribl-muted">
                    {visibleIds.length} of {sources.length} match{visibleIds.length === 1 ? '' : 'es'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={selectAllMatching}
                      disabled={visibleIds.length === 0 || allVisibleSelected}
                      className="h-9 flex-1 rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-ink shadow-ctrl enabled:hover:bg-cribl-elevate disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {allVisibleSelected
                        ? 'All matching selected'
                        : `Select all ${visibleIds.length} matching`}
                    </button>
                    {activeFilterCount > 0 ? (
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="h-9 rounded-lg border border-cribl-border/80 bg-white px-3 text-sm font-medium text-cribl-muted hover:text-cribl-ink"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </PopoverButton>

            <PopoverButton
              label="Sort"
              badge={sortBadge}
              open={sortOpen}
              onToggle={() => {
                setSortOpen((v) => !v)
                setFilterOpen(false)
                setActionsOpen(false)
              }}
              panelClassName="min-w-[18rem]"
            >
              <div className="space-y-3">
                <p className="m-0 text-xs font-semibold uppercase tracking-wider text-cribl-muted">
                  Sort by
                </p>
                <select
                  value={sortBy}
                  onChange={(e) => {
                    const next = e.target.value as SortBy
                    setSortBy(next)
                    const opt = SORT_OPTIONS.find((o) => o.id === next)
                    if (opt) {
                      setSortDir(opt.defaultDir)
                    }
                  }}
                  className="h-9 w-full rounded-lg border border-cribl-border bg-white px-2 text-sm"
                  aria-label="Sort dimension"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>

                <div>
                  <p className="m-0 mb-1.5 text-xs font-semibold uppercase tracking-wider text-cribl-muted">
                    Direction
                  </p>
                  <div className="flex overflow-hidden rounded-lg border border-cribl-border">
                    <button
                      type="button"
                      onClick={() => setSortDir('asc')}
                      disabled={sortBy === 'default'}
                      className={[
                        'h-9 flex-1 px-3 text-sm font-medium',
                        sortBy === 'default'
                          ? 'cursor-not-allowed text-cribl-muted/60'
                          : sortDir === 'asc'
                            ? 'bg-cribl-primary text-white'
                            : 'bg-white text-cribl-ink hover:bg-cribl-elevate',
                      ].join(' ')}
                      aria-pressed={sortDir === 'asc'}
                    >
                      Ascending
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortDir('desc')}
                      disabled={sortBy === 'default'}
                      className={[
                        'h-9 flex-1 border-l border-cribl-border px-3 text-sm font-medium',
                        sortBy === 'default'
                          ? 'cursor-not-allowed text-cribl-muted/60'
                          : sortDir === 'desc'
                            ? 'bg-cribl-primary text-white'
                            : 'bg-white text-cribl-ink hover:bg-cribl-elevate',
                      ].join(' ')}
                      aria-pressed={sortDir === 'desc'}
                    >
                      Descending
                    </button>
                  </div>
                  {sortBy === 'default' ? (
                    <p className="m-0 mt-1.5 text-xs text-cribl-muted">
                      Sorted by added order. Pick a dimension above to enable direction.
                    </p>
                  ) : null}
                </div>

                {sortBy !== 'default' ? (
                  <div className="border-t border-cribl-border/70 pt-3">
                    <p className="m-0 mb-2 text-xs text-cribl-muted">
                      Sorted by <span className="text-cribl-ink">{sortLabel}</span>{' '}
                      ({sortDir === 'asc' ? 'A → Z / low → high' : 'Z → A / high → low'}).
                      Missing values always sort last.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSortBy('default')
                        setSortDir('asc')
                      }}
                      className="h-9 w-full rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-ink hover:bg-cribl-elevate"
                    >
                      Reset to default order
                    </button>
                  </div>
                ) : null}
              </div>
            </PopoverButton>

            <PopoverButton
              label="Bulk Actions"
              badge={selectionCount}
              open={actionsOpen}
              onToggle={() => {
                setActionsOpen((v) => !v)
                setFilterOpen(false)
                setSortOpen(false)
              }}
              panelClassName="min-w-[20rem]"
            >
              {selectionCount === 0 ? (
                <div className="space-y-2 text-sm text-cribl-muted">
                  <p className="m-0 font-medium text-cribl-ink">No sources selected</p>
                  <p className="m-0">
                    Tick the checkbox on a source card, or open <span className="text-cribl-ink">Filter</span> →
                    <span className="text-cribl-ink"> Select all matching</span>.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="m-0 text-sm font-semibold text-cribl-ink">
                      {selectionCount} selected
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        clearSelection()
                        setActionsOpen(false)
                      }}
                      className="text-xs font-medium text-cribl-muted hover:text-cribl-ink"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="space-y-2">
                    <select
                      defaultValue={NO_CHANGE}
                      onChange={(e) => {
                        const v = e.target.value
                        if (v === NO_CHANGE) {
                          return
                        }
                        bulkAssignWg(v === '__none__' ? '' : v)
                        e.currentTarget.value = NO_CHANGE
                      }}
                      className="h-9 w-full rounded-lg border border-cribl-border bg-white px-2 text-sm"
                      aria-label="Assign worker group"
                    >
                      <option value={NO_CHANGE}>Assign worker group…</option>
                      <option value="__none__">— Unassign —</option>
                      {plan.workerGroups.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.wg.trim() || 'Unnamed worker group'}
                        </option>
                      ))}
                    </select>

                    <select
                      defaultValue={NO_CHANGE}
                      onChange={(e) => {
                        const v = e.target.value
                        if (v === NO_CHANGE) {
                          return
                        }
                        bulkSetCriticality(v === '__clear__' ? '' : v)
                        e.currentTarget.value = NO_CHANGE
                      }}
                      className="h-9 w-full rounded-lg border border-cribl-border bg-white px-2 text-sm"
                      aria-label="Set criticality"
                    >
                      <option value={NO_CHANGE}>Set criticality…</option>
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                      <option value="__clear__">Clear</option>
                    </select>

                    <select
                      defaultValue={NO_CHANGE}
                      onChange={(e) => {
                        const v = e.target.value
                        if (v === NO_CHANGE) {
                          return
                        }
                        if (v === 'On-Prem' || v === 'Cloud/Internet') {
                          bulkSetType(v)
                        } else {
                          bulkSetType('')
                        }
                        e.currentTarget.value = NO_CHANGE
                      }}
                      className="h-9 w-full rounded-lg border border-cribl-border bg-white px-2 text-sm"
                      aria-label="Set source context"
                    >
                      <option value={NO_CHANGE}>Set context…</option>
                      <option value="On-Prem">On-Prem</option>
                      <option value="Cloud/Internet">Cloud/Internet</option>
                      <option value="__clear__">Not set</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap gap-2 border-t border-cribl-border/70 pt-3">
                    <button
                      type="button"
                      onClick={() => bulkSetCompliance(true)}
                      className="h-9 flex-1 rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-ink hover:bg-cribl-elevate"
                    >
                      Mark compliance
                    </button>
                    <button
                      type="button"
                      onClick={() => bulkSetCompliance(false)}
                      className="h-9 flex-1 rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-muted hover:text-cribl-ink"
                    >
                      Unmark compliance
                    </button>
                  </div>

                  <div className="border-t border-cribl-border/70 pt-3">
                    <button
                      type="button"
                      onClick={bulkDelete}
                      className="h-9 w-full rounded-lg border border-rose-200 bg-rose-600 px-3 text-sm font-semibold text-white shadow-ctrl hover:bg-rose-700"
                    >
                      Delete {selectionCount}…
                    </button>
                  </div>
                </div>
              )}
            </PopoverButton>
          </div>
        </div>
      </div>

      {sources.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-cribl-border/90 bg-cribl-card-body px-4 py-6 text-center text-sm text-cribl-muted">
          No sources yet — use <strong>+ Add source</strong> in the left nav.
        </p>
      ) : filtered.length === 0 ? (
        <p className="m-0 rounded-xl border border-cribl-border/80 bg-white px-4 py-6 text-center text-sm text-cribl-muted">
          No sources match the current filters.
          {activeFilterCount > 0 ? (
            <>
              {' '}
              <button
                type="button"
                onClick={clearFilters}
                className="font-medium text-cribl-ink underline"
              >
                Clear filters
              </button>
              .
            </>
          ) : null}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((s) => {
            const name = s.displayName?.trim() || 'Source'
            const tile = s.sourceTile?.trim()
            const src = s.source?.trim()
            const v = parseGb(s.avgDailyGb)
            const volStr = Number.isFinite(v) ? formatGbOrTbPerDayStr(v) : ''
            const subtitleBits = [tile, src].filter(Boolean) as string[]
            const subtitle = subtitleBits
              .filter((b, i) => subtitleBits.findIndex((x) => x.toLowerCase() === b.toLowerCase()) === i)
              .join(' · ')
            const isSelected = selected.has(s.id)
            // Render the bar track for any row that has a numeric GB value, even tiny
            // sub-GB ones (e.g. 0.5 GB next to a 1 TB peer rounds to 0% but the empty
            // track is still useful — it tells the CSE "this row participates in the
            // ranking, it's just small"). The track is hidden only when the field is
            // truly missing or non-numeric.
            const hasVol = Number.isFinite(v) && v >= 0
            const volBarPct =
              hasVol && maxVol > 0 ? Math.round((v / maxVol) * 100) : 0
            return (
              <li key={s.id} className="min-w-0">
                <div
                  className={[
                    'card-axiom flex min-w-0 items-stretch gap-2 border-cribl-border/80 bg-white p-3 shadow-ctrl',
                    isSelected ? 'ring-2 ring-cribl-primary/60' : '',
                  ].join(' ')}
                >
                  <label className="flex shrink-0 cursor-pointer select-none items-start pt-1.5 pl-1">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(s.id)}
                      aria-label={`Select ${name}`}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => onOpenSource(s.id)}
                    className="min-w-0 flex-1 border-0 bg-transparent p-1 text-left hover:bg-cribl-elevate/70"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="m-0 min-w-0 truncate text-sm font-semibold text-cribl-ink">{name}</p>
                      {volStr ? (
                        <span className="shrink-0 text-xs tabular-nums text-cribl-muted">{volStr}</span>
                      ) : null}
                    </div>
                    {subtitle ? <p className="m-0 mt-1 text-xs text-cribl-muted">{subtitle}</p> : null}
                    {hasVol ? (
                      <div
                        className="mt-2.5"
                        title={`Share of GB/d vs the largest source in the list (with current filters): ${volStr || '0 GB/d'}`}
                      >
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-cribl-border/70">
                          <div
                            className="h-full rounded-full bg-cribl-blue"
                            style={{ width: `${volBarPct}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                    <p className="m-0 mt-2 text-[11px] text-cribl-muted">Click to open</p>
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
