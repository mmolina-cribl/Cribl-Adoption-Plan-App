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

export function SourcesIndexView({ plan, setPlan, onOpenSource }: Props) {
  const [q, setQ] = useState('')
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [onlyHighPriority, setOnlyHighPriority] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [filterOpen, setFilterOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
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
          {filtered.map((s) => {
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
