import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { PlanState, WorkerGroupKind, WorkerGroupRow } from '../types/planTypes'
import { newId } from '../types/planTypes'
import { formatGbOrTbPerDayStr, parseGb } from '../lib/formatRate'
import { effectiveIngestEgressGbdForWg, sumAvgDailyFromSourceSummaryForWg } from '../lib/workerGroupRollup'
import { PopoverButton } from './PopoverButton'
import { WORKER_HOSTING_OPTIONS, classifyHosting } from '../lib/workerHosting'
import { AnimatedBar } from './AnimatedBar'
import { SearchInput } from './SearchInput'

type Props = {
  plan: PlanState
  setPlan: Dispatch<SetStateAction<PlanState>>
  onOpenGroup: (id: string) => void
  /**
   * v2.0: which kind of worker-group row this view shows. Defaults to
   * `'stream'` (the original "Worker Groups" index). Pass `'edge'` to
   * render the same UI scoped to Cribl Edge fleets — only the headline,
   * placeholder copy, and empty-state add hint change.
   */
  kind?: WorkerGroupKind
}

const COPY: Record<WorkerGroupKind, {
  pageTitle: string
  pageDescription: string
  searchPlaceholder: string
  searchAriaLabel: string
  unnamed: string
  emptyState: string
  noMatches: string
  selectedNoun: (n: number) => string
  bulkDeleteVerb: (n: number) => string
  bulkUnassignVerb: (n: number) => string
  bulkDuplicateConfirm: (n: number) => string
  bulkDeleteConfirm: (n: number, sources: string) => string
  noSelectionLine1: string
}> = {
  stream: {
    pageTitle: 'Worker Groups',
    pageDescription:
      'Browse all worker groups. Filter to narrow the list, then use Bulk Actions to apply changes across many at once.',
    searchPlaceholder: 'Search worker groups…',
    searchAriaLabel: 'Search worker groups',
    unnamed: 'Unnamed worker group',
    emptyState: 'No worker groups yet — use + Add Worker Group in the left nav.',
    noMatches: 'No worker groups match the current filters.',
    selectedNoun: (n) => `${n} selected`,
    bulkDeleteVerb: (n) => `Delete ${n}…`,
    bulkUnassignVerb: () => 'Unassign all sources…',
    bulkDuplicateConfirm: (n) => `Duplicate ${n} worker groups? Sources are not cloned.`,
    bulkDeleteConfirm: (n, sources) =>
      `Delete ${n} worker group${n === 1 ? '' : 's'}?${sources} This cannot be undone.`,
    noSelectionLine1: 'No worker groups selected',
  },
  edge: {
    pageTitle: 'Fleets',
    pageDescription:
      'Browse all Cribl Edge fleets. Filter to narrow the list, then use Bulk Actions to apply changes across many at once.',
    searchPlaceholder: 'Search fleets…',
    searchAriaLabel: 'Search fleets',
    unnamed: 'Unnamed fleet',
    emptyState: 'No fleets yet — use + Add Fleet in the left nav.',
    noMatches: 'No fleets match the current filters.',
    selectedNoun: (n) => `${n} selected`,
    bulkDeleteVerb: (n) => `Delete ${n}…`,
    bulkUnassignVerb: () => 'Unassign all sources…',
    bulkDuplicateConfirm: (n) => `Duplicate ${n} fleets? Sources are not cloned.`,
    bulkDeleteConfirm: (n, sources) =>
      `Delete ${n} fleet${n === 1 ? '' : 's'}?${sources} This cannot be undone.`,
    noSelectionLine1: 'No fleets selected',
  },
}

const NO_CHANGE = '__nochange__'
const HOSTING_FILTER_ALL = '__all__'
const HOSTING_FILTER_OTHER = '__other__'
const HOSTING_FILTER_UNSET = '__unset__'

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

export function WorkerGroupsIndexView({ plan, setPlan, onOpenGroup, kind = 'stream' }: Props) {
  const copy = COPY[kind]
  const [q, setQ] = useState('')
  const [onlyWithSources, setOnlyWithSources] = useState(false)
  const [onlyEmpty, setOnlyEmpty] = useState(false)
  const [onlyOver1Tb, setOnlyOver1Tb] = useState(false)
  const [hostingFilter, setHostingFilter] = useState<string>(HOSTING_FILTER_ALL)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [filterOpen, setFilterOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)

  // Only show rows for this section's kind. Using `useMemo` keeps the
  // reference stable while the underlying plan stays put — important for the
  // selection-cleanup `useEffect` below, which would otherwise treat every
  // re-render as a topology change and rebuild the selection set.
  const groups = useMemo(
    () => plan.workerGroups.filter((g) => g.kind === kind),
    [plan.workerGroups, kind],
  )

  // Drop selections that no longer exist (after a bulk delete or external edit).
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<string>()
      const valid = new Set(groups.map((g) => g.id))
      for (const id of prev) {
        if (valid.has(id)) {
          next.add(id)
        }
      }
      return next.size === prev.size ? prev : next
    })
  }, [groups])

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
          name: g.wg.trim() || copy.unnamed,
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
      .filter((r) => (!onlyEmpty ? true : r.nSources === 0))
      .filter((r) => (!onlyOver1Tb ? true : r.volGb >= 1024))
      .filter((r) => {
        if (hostingFilter === HOSTING_FILTER_ALL) {
          return true
        }
        const c = classifyHosting(r.hosting)
        if (hostingFilter === HOSTING_FILTER_UNSET) {
          return c.kind === 'unset'
        }
        if (hostingFilter === HOSTING_FILTER_OTHER) {
          return c.kind === 'other'
        }
        return c.kind === 'canonical' && c.value === hostingFilter
      })
      .sort((a, b) => b.volGb - a.volGb)
  }, [groups, plan, q, onlyWithSources, onlyEmpty, onlyOver1Tb, hostingFilter, copy.unnamed])

  const maxSources = Math.max(0, ...rows.map((r) => r.nSources))

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows])
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))

  const activeFilterCount =
    (onlyWithSources ? 1 : 0) +
    (onlyEmpty ? 1 : 0) +
    (onlyOver1Tb ? 1 : 0) +
    (hostingFilter !== HOSTING_FILTER_ALL ? 1 : 0) +
    (q.trim() ? 1 : 0)

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
    setOnlyWithSources(false)
    setOnlyEmpty(false)
    setOnlyOver1Tb(false)
    setHostingFilter(HOSTING_FILTER_ALL)
    setQ('')
  }

  const clearSelection = () => setSelected(new Set())

  const bulkPatchGroups = (patch: (g: WorkerGroupRow) => WorkerGroupRow) => {
    setPlan((p) => ({
      ...p,
      workerGroups: p.workerGroups.map((g) => (selected.has(g.id) ? patch(g) : g)),
    }))
  }

  const bulkSetHosting = (value: string) => {
    bulkPatchGroups((g) => ({ ...g, workerHosting: value }))
  }

  const bulkClearOverrides = () => {
    bulkPatchGroups((g) => ({
      ...g,
      ingestGbd: '',
      egressGbd: '',
      throughputGbd: '',
      diskOneDayGb: '',
    }))
  }

  const bulkUnassignSources = () => {
    const count = selected.size
    if (count === 0) {
      return
    }
    const noun = kind === 'edge' ? 'fleet' : 'worker group'
    const plural = count === 1 ? '' : 's'
    const ok = window.confirm(
      `Unassign every source from ${count} ${noun}${plural}? The ${noun}${plural} will remain; sources will go back to the unassigned pool.`,
    )
    if (!ok) {
      return
    }
    setPlan((p) => ({
      ...p,
      sourceSummary: p.sourceSummary.map((r) =>
        selected.has(r.workerGroupId) ? { ...r, workerGroupId: '' } : r,
      ),
      sourceVolume: p.sourceVolume.map((v) =>
        selected.has(v.workerGroupId) ? { ...v, workerGroupId: '', wg: '' } : v,
      ),
    }))
    setActionsOpen(false)
  }

  const bulkDuplicate = () => {
    const count = selected.size
    if (count === 0) {
      return
    }
    if (count > 5) {
      const ok = window.confirm(copy.bulkDuplicateConfirm(count))
      if (!ok) {
        return
      }
    }
    setPlan((p) => {
      const targets = p.workerGroups.filter((g) => selected.has(g.id))
      const copies: WorkerGroupRow[] = targets.map((g) => ({
        ...g,
        id: newId(),
        // Each duplicate inherits the source row's `kind`, so cloning a
        // Stream WG never accidentally creates a Fleet (or vice versa).
        kind: g.kind,
        wg: `${(g.wg || copy.unnamed).trim()} (copy)`,
      }))
      return { ...p, workerGroups: [...p.workerGroups, ...copies] }
    })
    setActionsOpen(false)
  }

  const bulkDelete = () => {
    const count = selected.size
    if (count === 0) {
      return
    }
    const sourcesAffected = plan.sourceSummary.filter((r) => selected.has(r.workerGroupId)).length
    const sourceLine = sourcesAffected
      ? ` ${sourcesAffected} assigned source${sourcesAffected === 1 ? '' : 's'} will be unassigned (not deleted).`
      : ''
    const ok = window.confirm(copy.bulkDeleteConfirm(count, sourceLine))
    if (!ok) {
      return
    }
    setPlan((p) => ({
      ...p,
      workerGroups: p.workerGroups.filter((g) => !selected.has(g.id)),
      sourceSummary: p.sourceSummary.map((r) =>
        selected.has(r.workerGroupId) ? { ...r, workerGroupId: '' } : r,
      ),
      sourceVolume: p.sourceVolume.map((v) =>
        selected.has(v.workerGroupId) ? { ...v, workerGroupId: '', wg: '' } : v,
      ),
    }))
    setSelected(new Set())
    setActionsOpen(false)
  }

  const selectionCount = selected.size

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="m-0 text-lg font-semibold tracking-tight text-cribl-ink sm:text-xl">{copy.pageTitle}</h2>
          <p className="m-0 mt-1.5 text-sm text-cribl-muted">{copy.pageDescription}</p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:shrink-0">
          <SearchInput
            id={kind === 'edge' ? 'fleet-index-q' : 'wg-index-q'}
            value={q}
            onChange={setQ}
            placeholder={copy.searchPlaceholder}
            ariaLabel={copy.searchAriaLabel}
            className="w-full sm:w-72"
          />
          <div className="flex items-center gap-2 self-end">
            <PopoverButton
              label="Filter"
              badge={activeFilterCount}
              open={filterOpen}
              onToggle={() => {
                setFilterOpen((v) => !v)
                setActionsOpen(false)
              }}
            >
              <div className="space-y-3">
                <p className="m-0 text-xs font-semibold uppercase tracking-wider text-cribl-muted">Filters</p>
                <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-cribl-ink">
                  <input
                    type="checkbox"
                    checked={onlyWithSources}
                    onChange={(e) => {
                      setOnlyWithSources(e.target.checked)
                      if (e.target.checked) {
                        setOnlyEmpty(false)
                      }
                    }}
                  />
                  Only with sources
                </label>
                <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-cribl-ink">
                  <input
                    type="checkbox"
                    checked={onlyEmpty}
                    onChange={(e) => {
                      setOnlyEmpty(e.target.checked)
                      if (e.target.checked) {
                        setOnlyWithSources(false)
                      }
                    }}
                  />
                  Empty (no sources) only
                </label>
                <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-cribl-ink">
                  <input
                    type="checkbox"
                    checked={onlyOver1Tb}
                    onChange={(e) => setOnlyOver1Tb(e.target.checked)}
                  />
                  ≥ 1 TB/d (from sources)
                </label>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-cribl-muted" htmlFor="wg-hosting-filter">
                    Hosting
                  </label>
                  <select
                    id="wg-hosting-filter"
                    value={hostingFilter}
                    onChange={(e) => setHostingFilter(e.target.value)}
                    className="h-9 w-full rounded-lg border border-cribl-border bg-white px-2 text-sm"
                  >
                    <option value={HOSTING_FILTER_ALL}>All</option>
                    {WORKER_HOSTING_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                    <option value={HOSTING_FILTER_OTHER}>Other (free-text)</option>
                    <option value={HOSTING_FILTER_UNSET}>Not set</option>
                  </select>
                </div>
                {q.trim() ? (
                  <p className="m-0 rounded-md bg-cribl-card-body px-2 py-1.5 text-xs text-cribl-muted">
                    Search filter active: <span className="text-cribl-ink">“{q.trim()}”</span>
                  </p>
                ) : null}
                <div className="border-t border-cribl-border/70 pt-3">
                  <p className="m-0 text-xs text-cribl-muted">
                    {visibleIds.length} of {groups.length} match{visibleIds.length === 1 ? '' : 'es'}
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
              label="Bulk Actions"
              badge={selectionCount}
              open={actionsOpen}
              onToggle={() => {
                setActionsOpen((v) => !v)
                setFilterOpen(false)
              }}
              panelClassName="min-w-[20rem]"
            >
              {selectionCount === 0 ? (
                <div className="space-y-2 text-sm text-cribl-muted">
                  <p className="m-0 font-medium text-cribl-ink">{copy.noSelectionLine1}</p>
                  <p className="m-0">
                    Tick the checkbox on a {kind === 'edge' ? 'fleet' : 'worker group'} card, or open{' '}
                    <span className="text-cribl-ink">Filter</span> →
                    <span className="text-cribl-ink"> Select all matching</span>.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="m-0 text-sm font-semibold text-cribl-ink">{selectionCount} selected</p>
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
                        bulkSetHosting(v === '__clear__' ? '' : v)
                        e.currentTarget.value = NO_CHANGE
                      }}
                      className="h-9 w-full rounded-lg border border-cribl-border bg-white px-2 text-sm"
                      aria-label="Set hosting"
                    >
                      <option value={NO_CHANGE}>Set hosting…</option>
                      {WORKER_HOSTING_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                      <option value="__clear__">Clear (Not set)</option>
                    </select>
                  </div>

                  <div className="flex flex-wrap gap-2 border-t border-cribl-border/70 pt-3">
                    <button
                      type="button"
                      onClick={bulkClearOverrides}
                      className="h-9 flex-1 rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-ink hover:bg-cribl-elevate"
                      title="Blank ingest, egress, throughput, and 1-day disk so values auto-derive from assigned sources"
                    >
                      Clear capacity overrides
                    </button>
                    <button
                      type="button"
                      onClick={bulkDuplicate}
                      className="h-9 flex-1 rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-ink hover:bg-cribl-elevate"
                      title={
                        kind === 'edge'
                          ? 'Clone each selected fleet with a (copy) suffix; sources are not cloned'
                          : 'Clone each selected worker group with a (copy) suffix; sources are not cloned'
                      }
                    >
                      Duplicate
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={bulkUnassignSources}
                      className="h-9 w-full rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm font-medium text-amber-900 hover:bg-amber-100"
                      title={
                        kind === 'edge'
                          ? 'Detach every source from the selected fleets; the fleets remain'
                          : 'Detach every source from the selected worker groups; the worker groups remain'
                      }
                    >
                      {copy.bulkUnassignVerb(selectionCount)}
                    </button>
                  </div>

                  <div className="border-t border-cribl-border/70 pt-3">
                    <button
                      type="button"
                      onClick={bulkDelete}
                      className="h-9 w-full rounded-lg border border-rose-200 bg-rose-600 px-3 text-sm font-semibold text-white shadow-ctrl hover:bg-rose-700"
                    >
                      {copy.bulkDeleteVerb(selectionCount)}
                    </button>
                  </div>
                </div>
              )}
            </PopoverButton>
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-cribl-border/90 bg-cribl-card-body px-4 py-6 text-center text-sm text-cribl-muted">
          {kind === 'edge' ? (
            <>No fleets yet — use <strong>+ Add Fleet</strong> in the left nav.</>
          ) : (
            <>No worker groups yet — use <strong>+ Add Worker Group</strong> in the left nav.</>
          )}
        </p>
      ) : rows.length === 0 ? (
        <p className="m-0 rounded-xl border border-cribl-border/80 bg-white px-4 py-6 text-center text-sm text-cribl-muted">
          {copy.noMatches}
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
        <ul className="m-0 grid list-none gap-5 p-0 lg:grid-cols-2">
          {rows.map((g) => {
            const srcBarPct = maxSources > 0 ? Math.round((g.nSources / maxSources) * 100) : 0
            const volLine =
              Number.isFinite(g.volGb) && g.volGb > 0 ? formatGbOrTbPerDayStr(g.volGb) : '—'
            const isSelected = selected.has(g.id)
            return (
              <li key={g.id} className="min-w-0">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenGroup(g.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpenGroup(g.id)
                    }
                  }}
                  aria-labelledby={`wg-index-title-${g.id}`}
                  title={`Open ${g.name}`}
                  className={[
                    // The whole card is the click target now (no
                    // separate "Open worker group" pill at the
                    // bottom). Bulk-action checkbox at the top is a
                    // real <input> with stopPropagation so toggling
                    // selection never falls through to "open".
                    'block min-w-0 cursor-pointer overflow-hidden rounded-2xl border border-cribl-border/80 bg-white p-5 text-left shadow-ctrl transition hover:border-cribl-primary/60 hover:shadow-md focus-visible:border-cribl-primary/60 focus-visible:ring-2 focus-visible:ring-cribl-primary/40 focus-visible:outline-none sm:p-6',
                    isSelected ? 'ring-2 ring-cribl-primary/60' : '',
                  ].join(' ')}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <label
                        className="flex shrink-0 cursor-pointer select-none items-center pt-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleOne(g.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${g.name}`}
                        />
                      </label>
                      <h3
                        className="m-0 min-w-0 break-words text-lg font-semibold leading-snug tracking-tight text-cribl-ink"
                        id={`wg-index-title-${g.id}`}
                      >
                        {g.name}
                      </h3>
                    </div>
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
                      className="mt-3.5 flex items-center gap-3"
                      title="Share of sources vs the largest group in the list (with current filters)"
                    >
                      {/*
                       * Bar fills the remaining row width; the
                       * "Est. daily (sources)" stat sits flush right
                       * so the volume number reads as a label for
                       * the bar's "share of sources" visualization.
                       */}
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-cribl-border/70">
                        <AnimatedBar pct={srcBarPct} />
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="m-0 text-[10px] font-medium uppercase tracking-wide text-cribl-muted">
                          Est. daily (sources)
                        </p>
                        <p className="m-0 font-mono text-sm tabular-nums text-cribl-ink">{volLine}</p>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/*
                     * Fallback placement for "Est. daily (sources)":
                     * only shown when the bar is hidden (the group
                     * has no sources, or no group in the filtered
                     * list does). Otherwise the label/value live up
                     * next to the bar above.
                     */}
                    {!(maxSources > 0 && g.nSources > 0) ? (
                      <div className="min-w-0">
                        <p className="m-0 text-[10px] font-medium uppercase tracking-wide text-cribl-muted">
                          Est. daily (sources)
                        </p>
                        <p className="m-0 font-mono text-sm tabular-nums text-cribl-ink">{volLine}</p>
                      </div>
                    ) : null}
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
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
