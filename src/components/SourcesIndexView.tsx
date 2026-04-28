import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { PlanState, SourceSummaryRow } from '../types/planTypes'
import { formatGbOrTbPerDayStr, parseGb } from '../lib/formatRate'

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
  const someVisibleSelected = visibleIds.some((id) => selected.has(id))

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

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const id of visibleIds) {
          next.delete(id)
        }
      } else {
        for (const id of visibleIds) {
          next.add(id)
        }
      }
      return next
    })
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
        // Carry the workerGroupId / wg over to the volume table by
        // joining on source name, mirroring the unassign + attach
        // handlers elsewhere in the app.
        sourceVolume: p.sourceVolume.map((v) => {
          const name = (v.source || '').trim()
          if (!name || !targetSourceNames.has(name)) {
            return v
          }
          // We only re-derive WG fields here; other patches are summary-only.
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
  }

  const selectionCount = selected.size

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="m-0 text-lg font-semibold tracking-tight text-cribl-ink sm:text-xl">Sources</h2>
          <p className="m-0 mt-1.5 text-sm text-cribl-muted">
            Browse all sources. Search by name, tile, or sourcetype. Select multiple to apply bulk actions.
          </p>
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

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-cribl-border bg-white px-3 py-2 text-sm text-cribl-ink shadow-ctrl">
          <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
          Unassigned only
        </label>
        <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-cribl-border bg-white px-3 py-2 text-sm text-cribl-ink shadow-ctrl">
          <input
            type="checkbox"
            checked={onlyHighPriority}
            onChange={(e) => setOnlyHighPriority(e.target.checked)}
          />
          High priority only
        </label>
        {visibleIds.length > 0 ? (
          <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-cribl-border bg-white px-3 py-2 text-sm text-cribl-ink shadow-ctrl">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              ref={(el) => {
                if (el) {
                  el.indeterminate = !allVisibleSelected && someVisibleSelected
                }
              }}
              onChange={toggleAllVisible}
            />
            Select {allVisibleSelected ? 'none' : 'all visible'} ({visibleIds.length})
          </label>
        ) : null}
      </div>

      {selectionCount > 0 ? (
        <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center gap-2 rounded-xl border border-cribl-primary/40 bg-cribl-primary-soft/95 px-3 py-2.5 shadow-card-float backdrop-blur sm:px-4">
          <span className="text-sm font-semibold text-cribl-primary-ink">
            {selectionCount} selected
          </span>

          <div className="ml-2 flex flex-wrap items-center gap-2">
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
              className="h-9 rounded-lg border border-cribl-border bg-white px-2 text-sm"
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
              className="h-9 rounded-lg border border-cribl-border bg-white px-2 text-sm"
              aria-label="Set criticality / priority"
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
              className="h-9 rounded-lg border border-cribl-border bg-white px-2 text-sm"
              aria-label="Set source context"
            >
              <option value={NO_CHANGE}>Set context…</option>
              <option value="On-Prem">On-Prem</option>
              <option value="Cloud/Internet">Cloud/Internet</option>
              <option value="__clear__">Not set</option>
            </select>

            <button
              type="button"
              onClick={() => bulkSetCompliance(true)}
              className="h-9 rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-ink hover:bg-cribl-elevate"
              title="Flag selected sources as compliance-related"
            >
              Mark compliance
            </button>
            <button
              type="button"
              onClick={() => bulkSetCompliance(false)}
              className="h-9 rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-muted hover:text-cribl-ink"
              title="Unflag compliance on selected sources"
            >
              Unmark compliance
            </button>

            <button
              type="button"
              onClick={bulkDelete}
              className="h-9 rounded-lg border border-rose-200 bg-rose-600 px-3 text-sm font-semibold text-white shadow-ctrl hover:bg-rose-700"
            >
              Delete…
            </button>
          </div>

          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto h-9 rounded-lg border border-cribl-border/80 bg-white px-3 text-sm font-medium text-cribl-muted hover:text-cribl-ink"
          >
            Clear selection
          </button>
        </div>
      ) : null}

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
