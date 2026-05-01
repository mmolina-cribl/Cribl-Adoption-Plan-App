import { useEffect, useRef, useState } from 'react'
import {
  sourceLabel,
  type PlanState,
  type SourceSummaryRow,
  type WorkerGroupKind,
  type WorkerGroupRow,
} from '../types/planTypes'
import { PencilIcon } from './PencilIcon'
import type { MainView } from './navTypes'
import { formatGbOrTbPerDayStr, parseGb } from '../lib/formatRate'
import { sumAvgDailyFromSourceSummaryForWg } from '../lib/workerGroupRollup'

const itemBase =
  'w-full text-left text-sm font-medium transition rounded-lg px-3 py-2.5 border-l-2'

function ChevronToggle({
  open,
  onClick,
  label,
}: {
  open: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={open ? `Collapse ${label}` : `Expand ${label}`}
      aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
      aria-expanded={open}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent text-cribl-rail-ink hover:bg-white/70 hover:text-cribl-ink"
    >
      <svg
        viewBox="0 0 16 16"
        className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        aria-hidden="true"
      >
        <path d="M5 3l6 5-6 5V3z" fill="currentColor" />
      </svg>
    </button>
  )
}

type Props = {
  plan: PlanState
  mainView: MainView
  activeSourceId: string | null
  activeWorkerGroupId: string | null
  onSelectOverview: () => void
  onSelectWorkerGroups: () => void
  /** v2.0: navigate to the Fleets index (only shows kind === 'edge'). */
  onSelectFleets: () => void
  onSelectSources: () => void
  onSelectSettings: () => void
  onSelectWorkerGroup: (id: string) => void
  /**
   * Pass `'stream'` from the Worker Groups + button, `'edge'` from the
   * Fleets + button. Defaults to `'stream'` for any caller that doesn't
   * specify (mobile compact bar, legacy callers).
   */
  onAddWorkerGroup: (kind?: WorkerGroupKind) => void
  onRemoveWorkerGroup: (id: string) => void
  onUpdateWorkerGroupWg: (id: string, wg: string) => void
  onSelectSource: (id: string) => void
  onAddSource: () => void
  onRemoveSource: (id: string) => void
  onRenameSource: (id: string, name: string) => void
  onSelectImport: () => void
  onSelectExport: () => void
  onClearPlan: () => void
  className?: string
}

function NavButton({
  active,
  onClick,
  children,
  title,
  className = '',
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={[
        itemBase,
        active
          ? 'border-cribl-primary bg-white text-cribl-ink shadow-sm'
          : 'border-transparent text-cribl-rail-ink hover:bg-white/70 hover:text-cribl-ink',
        className,
      ].join(' ')}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </button>
  )
}

function SourceRowRail({
  row,
  index,
  isActive,
  canRemove,
  workerGroupName,
  onSelect,
  onRemove,
  onRename,
}: {
  row: SourceSummaryRow
  index: number
  isActive: boolean
  canRemove: boolean
  workerGroupName?: string
  onSelect: () => void
  onRemove: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const label = sourceLabel(row, index)
  const nameKey = label.trim().toLowerCase()
  const tile = row.sourceTile?.trim()
  const src = row.source?.trim()
  const volStr = row.avgDailyGb?.trim() ? formatGbOrTbPerDayStr(parseGb(row.avgDailyGb)) : ''
  const bits = [tile, src, volStr].filter(Boolean) as string[]
  const subtitle = bits
    .filter((b, i) => bits.findIndex((x) => x.toLowerCase() === b.toLowerCase()) === i)
    .filter((b) => b.toLowerCase() !== nameKey)
    .join(' · ')
  const showSubtitle = Boolean(subtitle)

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

  return (
    <div
      className={[
        'ml-3 flex min-w-0 items-stretch overflow-hidden rounded-lg border transition',
        isActive
          ? 'border-cribl-primary bg-white shadow-sm'
          : 'border-cribl-border/80 bg-white/50 hover:border-cribl-border',
      ].join(' ')}
    >
      {editing ? (
        <div className="min-w-0 flex-1 py-1.5 pl-3 pr-1">
          <input
            ref={inputRef}
            className="w-full min-w-0 max-w-full border-0 bg-transparent p-0 text-sm font-medium text-cribl-ink outline-none"
            value={row.source}
            onChange={(e) => onRename(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.currentTarget.blur()
              }
            }}
            placeholder={`Source ${index + 1}`}
            autoComplete="off"
            aria-label="Source name"
          />
          {showSubtitle ? (
            <span className="mt-0.5 block max-w-full truncate text-xs font-normal text-cribl-muted">
              {subtitle}
            </span>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-left text-sm font-medium text-cribl-ink"
        >
          <span className="block truncate">
            {label}
            {workerGroupName ? (
              <span className="ml-1.5 text-xs font-normal text-cribl-muted">
                · {workerGroupName}
              </span>
            ) : null}
          </span>
          {showSubtitle ? (
            <span className="mt-0.5 block max-w-full truncate text-xs font-normal text-cribl-muted">
              {subtitle}
            </span>
          ) : null}
        </button>
      )}
      {!editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex w-7 shrink-0 items-center justify-center border-0 border-l border-cribl-border/60 bg-transparent text-cribl-muted hover:bg-cribl-elevate hover:text-cribl-ink"
          title="Edit name"
          aria-label="Edit source name"
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </button>
      )}
      {canRemove && (
        <button
          type="button"
          className="flex w-8 shrink-0 items-center justify-center border-0 border-l border-cribl-border/60 bg-transparent text-sm text-cribl-muted hover:bg-rose-50 hover:text-rose-700"
          onClick={onRemove}
          title={`Remove ${label}`}
          aria-label={`Remove ${label}`}
        >
          ×
        </button>
      )}
    </div>
  )
}

function WorkerGroupRowRail({
  row,
  index,
  isActive,
  canRemove,
  /**
   * Total ingest summed from every Source attached to this worker group.
   * Mirrors how Source rail rows surface their avg daily volume so customers
   * see at a glance which WGs are heavy ingest vs light without leaving the
   * left nav. Computed by the parent (it has the full plan in scope).
   */
  totalSourceIngestGb,
  sourceCount,
  onSelect,
  onRemove,
  onUpdateWg,
}: {
  row: WorkerGroupRow
  /** Position within this rail section's filtered list (Stream-only or Fleet-only). */
  index: number
  isActive: boolean
  canRemove: boolean
  totalSourceIngestGb: number
  sourceCount: number
  onSelect: () => void
  onRemove: () => void
  onUpdateWg: (wg: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fallbackLabel = row.kind === 'edge' ? `Fleet ${index + 1}` : `Worker group ${index + 1}`
  const label = row.wg.trim() || fallbackLabel
  const sub =
    totalSourceIngestGb > 0
      ? `${formatGbOrTbPerDayStr(totalSourceIngestGb)} ingest · ${sourceCount} ${
          sourceCount === 1 ? 'source' : 'sources'
        }`
      : sourceCount > 0
      ? `${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'} · no volume yet`
      : 'No sources yet'

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

  return (
    <div
      className={[
        'ml-3 flex min-w-0 items-stretch overflow-hidden rounded-lg border transition',
        isActive
          ? 'border-cribl-primary bg-white shadow-sm'
          : 'border-cribl-border/80 bg-white/50 hover:border-cribl-border',
      ].join(' ')}
    >
      {editing ? (
        <div className="min-w-0 flex-1 py-1.5 pl-3 pr-1">
          <input
            ref={inputRef}
            className="w-full min-w-0 max-w-full border-0 bg-transparent p-0 text-sm font-medium text-cribl-ink outline-none"
            value={row.wg}
            onChange={(e) => onUpdateWg(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.currentTarget.blur()
              }
            }}
            placeholder={fallbackLabel}
            autoComplete="off"
            aria-label={row.kind === 'edge' ? 'Fleet name' : 'Worker group name'}
          />
          {sub ? (
            <span className="mt-0.5 block max-w-full truncate text-xs font-normal text-cribl-muted">{sub}</span>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-left text-sm font-medium text-cribl-ink"
        >
          <span className="block truncate">{label}</span>
          {sub ? (
            <span className="mt-0.5 block max-w-full truncate text-xs font-normal text-cribl-muted">{sub}</span>
          ) : null}
        </button>
      )}
      {!editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex w-7 shrink-0 items-center justify-center border-0 border-l border-cribl-border/60 bg-transparent text-cribl-muted hover:bg-cribl-elevate hover:text-cribl-ink"
          title="Edit name"
          aria-label={row.kind === 'edge' ? 'Edit fleet name' : 'Edit worker group name'}
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </button>
      )}
      {canRemove && (
        <button
          type="button"
          className="flex w-8 shrink-0 items-center justify-center border-0 border-l border-cribl-border/60 bg-transparent text-sm text-cribl-muted hover:bg-rose-50 hover:text-rose-700"
          onClick={onRemove}
          title={`Remove ${label}`}
          aria-label={`Remove ${label}`}
        >
          ×
        </button>
      )}
    </div>
  )
}

/**
 * One left-nav section for either Stream worker groups or Edge fleets.
 *
 * The two sections are visually + behaviorally identical — the section
 * header label, the empty-state add-button label, and the `kind` passed
 * back to the parent's `onAddWorkerGroup` are the only differences.
 */
function WorkerGroupKindSection({
  kind,
  plan,
  rows,
  mainView,
  activeWorkerGroupId,
  listOpen,
  setListOpen,
  canRemove,
  onSelectIndex,
  onSelectWorkerGroup,
  onAddWorkerGroup,
  onRemoveWorkerGroup,
  onUpdateWorkerGroupWg,
}: {
  kind: WorkerGroupKind
  plan: PlanState
  rows: WorkerGroupRow[]
  mainView: MainView
  activeWorkerGroupId: string | null
  listOpen: boolean
  setListOpen: (cb: (v: boolean) => boolean) => void
  canRemove: boolean
  onSelectIndex: () => void
  onSelectWorkerGroup: (id: string) => void
  onAddWorkerGroup: (kind?: WorkerGroupKind) => void
  onRemoveWorkerGroup: (id: string) => void
  onUpdateWorkerGroupWg: (id: string, wg: string) => void
}) {
  const sectionTitle = kind === 'edge' ? 'Fleets' : 'Worker Groups'
  const indexView: MainView = kind === 'edge' ? 'fleets' : 'workerGroups'
  const addLabel = kind === 'edge' ? '+ Add Fleet' : '+ Add Worker Group'
  const empty = rows.length === 0
  return (
    <>
      <div className="mt-3 flex items-center gap-1">
        <NavButton
          active={mainView === indexView}
          onClick={onSelectIndex}
          className="flex-1"
        >
          <span className="flex items-center gap-2">
            <span>{sectionTitle}</span>
            {rows.length > 0 ? (
              <span className="text-xs font-normal text-cribl-muted">({rows.length})</span>
            ) : null}
          </span>
        </NavButton>
        {rows.length > 0 ? (
          <ChevronToggle
            open={listOpen}
            onClick={() => setListOpen((v) => !v)}
            label={`${sectionTitle} list`}
          />
        ) : null}
      </div>
      {listOpen ? (
        <div className="ml-2 mt-0.5 flex flex-col gap-0.5">
          {rows.map((r, i) => {
            const isWg = mainView === 'workerGroup' && activeWorkerGroupId === r.id
            const sourceTotal = sumAvgDailyFromSourceSummaryForWg(plan, r.id)
            return (
              <WorkerGroupRowRail
                key={r.id}
                row={r}
                index={i}
                isActive={isWg}
                canRemove={canRemove}
                totalSourceIngestGb={sourceTotal.sum}
                sourceCount={sourceTotal.count}
                onSelect={() => onSelectWorkerGroup(r.id)}
                onRemove={() => onRemoveWorkerGroup(r.id)}
                onUpdateWg={(wg) => onUpdateWorkerGroupWg(r.id, wg)}
              />
            )
          })}
          <div className="ml-3">
            <button
              type="button"
              onClick={() => onAddWorkerGroup(kind)}
              className={[
                'w-full rounded-lg border border-dashed border-cribl-border/90 bg-cribl-canvas/80 px-3 py-2 text-left text-sm font-medium text-cribl-muted transition hover:border-cribl-primary/50 hover:text-cribl-ink',
                empty ? 'mt-1' : 'mt-0.5',
              ].join(' ')}
            >
              {addLabel}
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function PlanSidebarRail({
  plan,
  mainView,
  activeSourceId,
  activeWorkerGroupId,
  onSelectOverview,
  onSelectWorkerGroups,
  onSelectFleets,
  onSelectSources,
  onSelectSettings,
  onSelectWorkerGroup,
  onAddWorkerGroup,
  onRemoveWorkerGroup,
  onUpdateWorkerGroupWg,
  onSelectSource,
  onAddSource,
  onRemoveSource,
  onRenameSource,
  onSelectImport,
  onSelectExport,
  onClearPlan,
  className = '',
}: Props) {
  // v2.0: split worker-group rows into two parallel sections by `kind`. Both
  // sections look the same and use the same row component — only the labels,
  // empty-state placeholders, and the kind passed to `onAddWorkerGroup`
  // differ.
  const streamWgs = plan.workerGroups.filter((w) => w.kind === 'stream')
  const fleetWgs = plan.workerGroups.filter((w) => w.kind === 'edge')
  const canRemoveWg = plan.workerGroups.length > 0
  const sources = plan.sourceSummary
  const canRemove = sources.length > 0
  const noSources = sources.length === 0
  const [wgListOpen, setWgListOpen] = useState(true)
  const [fleetListOpen, setFleetListOpen] = useState(true)
  const [sourcesListOpen, setSourcesListOpen] = useState(true)

  return (
    <nav
      className={`flex flex-col gap-0.5 pl-2 pr-0 pb-2 pt-0 ${className}`}
      aria-label="Plan, Worker Groups, Fleets, and Sources"
    >
      <NavButton
        active={mainView === 'overview'}
        onClick={onSelectOverview}
        className="mt-2"
      >
        Plan
      </NavButton>

      <WorkerGroupKindSection
        kind="stream"
        plan={plan}
        rows={streamWgs}
        mainView={mainView}
        activeWorkerGroupId={activeWorkerGroupId}
        listOpen={wgListOpen}
        setListOpen={setWgListOpen}
        canRemove={canRemoveWg}
        onSelectIndex={onSelectWorkerGroups}
        onSelectWorkerGroup={onSelectWorkerGroup}
        onAddWorkerGroup={onAddWorkerGroup}
        onRemoveWorkerGroup={onRemoveWorkerGroup}
        onUpdateWorkerGroupWg={onUpdateWorkerGroupWg}
      />

      <WorkerGroupKindSection
        kind="edge"
        plan={plan}
        rows={fleetWgs}
        mainView={mainView}
        activeWorkerGroupId={activeWorkerGroupId}
        listOpen={fleetListOpen}
        setListOpen={setFleetListOpen}
        canRemove={canRemoveWg}
        onSelectIndex={onSelectFleets}
        onSelectWorkerGroup={onSelectWorkerGroup}
        onAddWorkerGroup={onAddWorkerGroup}
        onRemoveWorkerGroup={onRemoveWorkerGroup}
        onUpdateWorkerGroupWg={onUpdateWorkerGroupWg}
      />

      <div className="mt-3 flex items-center gap-1">
        <NavButton
          active={mainView === 'sources'}
          onClick={onSelectSources}
          className="flex-1"
        >
          <span className="flex items-center gap-2">
            <span>Sources</span>
            {sources.length > 0 ? (
              <span className="text-xs font-normal text-cribl-muted">({sources.length})</span>
            ) : null}
          </span>
        </NavButton>
        {sources.length > 0 ? (
          <ChevronToggle
            open={sourcesListOpen}
            onClick={() => setSourcesListOpen((v) => !v)}
            label="Sources list"
          />
        ) : null}
      </div>
      {sourcesListOpen ? (
        <div className="ml-2 mt-0.5 flex flex-col gap-0.5">
          {sources.map((r, i) => {
            const isSrc = mainView === 'source' && activeSourceId === r.id
            const wgName = r.workerGroupId
              ? plan.workerGroups.find((w) => w.id === r.workerGroupId)?.wg.trim() || undefined
              : undefined
            return (
              <SourceRowRail
                key={r.id}
                row={r}
                index={i}
                isActive={isSrc}
                canRemove={canRemove}
                workerGroupName={wgName}
                onSelect={() => onSelectSource(r.id)}
                onRemove={() => onRemoveSource(r.id)}
                onRename={(name) => onRenameSource(r.id, name)}
              />
            )
          })}
          <div className="ml-3">
            <button
              type="button"
              onClick={onAddSource}
              className={[
                'w-full rounded-lg border border-dashed border-cribl-border/90 bg-cribl-canvas/80 px-3 py-2 text-left text-sm font-medium text-cribl-muted transition hover:border-cribl-primary/50 hover:text-cribl-ink',
                noSources ? 'mt-1' : 'mt-0.5',
              ].join(' ')}
            >
              + Add source
            </button>
          </div>
        </div>
      ) : null}

      <NavButton
        active={mainView === 'import'}
        onClick={onSelectImport}
        title="Load from an .xlsx file"
        className="mt-3"
      >
        Import
      </NavButton>
      <NavButton
        active={mainView === 'export'}
        onClick={onSelectExport}
        title="Download a file you can share"
      >
        Export
      </NavButton>

      <NavButton
        active={mainView === 'settings'}
        onClick={onSelectSettings}
        className="mt-3"
      >
        Preferences
      </NavButton>

      <NavButton
        active={false}
        onClick={onClearPlan}
        title="Clear all data in this plan"
        className="mt-3"
      >
        Clear plan…
      </NavButton>
    </nav>
  )
}

function SourceChipMobile({
  row,
  index,
  isActive,
  canRemove,
  onSelect,
  onRemove,
  onRename,
}: {
  row: SourceSummaryRow
  index: number
  isActive: boolean
  canRemove: boolean
  onSelect: () => void
  onRemove: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const label = row.source?.trim() || `S${index + 1}`

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

  const chip = (active: boolean) =>
    [
      'shrink-0 cursor-pointer border px-2 py-1.5 text-sm font-medium transition',
      active
        ? 'border-cribl-primary bg-cribl-primary-soft text-cribl-ink'
        : 'border-cribl-border bg-white text-cribl-muted',
    ].join(' ')

  return (
    <div
      className={[
        'inline-flex min-w-0 max-w-full shrink-0 items-stretch overflow-hidden rounded-full border border-cribl-border',
        isActive ? 'ring-1 ring-cribl-primary/30' : '',
      ].join(' ')}
    >
      {editing ? (
        <div className="min-w-0 pl-2.5 pr-1">
          <input
            ref={inputRef}
            className="max-w-[10rem] min-w-[6rem] border-0 bg-transparent p-0 text-sm font-medium text-cribl-ink outline-none"
            value={row.source}
            onChange={(e) => onRename(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.currentTarget.blur()
              }
            }}
            placeholder={`S${index + 1}`}
            autoComplete="off"
            aria-label="Source name"
          />
        </div>
      ) : (
        <button
          type="button"
          className={['max-w-[8rem] truncate', chip(isActive)].join(' ')}
          onClick={onSelect}
          title={row.source?.trim() || `Source ${index + 1}`}
        >
          {row.source?.trim() || `S${index + 1}`}
        </button>
      )}
      {!editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex w-6 shrink-0 items-center justify-center border-0 border-l border-cribl-border/80 bg-white text-cribl-muted hover:bg-cribl-elevate hover:text-cribl-ink"
          title="Edit name"
          aria-label="Edit source name"
        >
          <PencilIcon className="h-3 w-3" />
        </button>
      )}
      {canRemove && (
        <button
          type="button"
          className="border-0 border-l border-cribl-border/80 bg-white px-1.5 text-cribl-muted hover:text-rose-600"
          onClick={onRemove}
          title={`Remove ${label}`}
          aria-label={`Remove ${label}`}
        >
          ×
        </button>
      )}
    </div>
  )
}

function WorkerGroupChipMobile({
  row,
  index,
  isActive,
  canRemove,
  onSelect,
  onRemove,
  onUpdateWg,
}: {
  row: WorkerGroupRow
  index: number
  isActive: boolean
  canRemove: boolean
  onSelect: () => void
  onRemove: () => void
  onUpdateWg: (wg: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fallback = row.kind === 'edge' ? `FL${index + 1}` : `WG${index + 1}`
  const label = row.wg.trim() || fallback

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

  const chip = (active: boolean) =>
    [
      'shrink-0 cursor-pointer rounded-full border px-2 py-1.5 text-sm font-medium transition',
      active
        ? 'border-cribl-primary bg-cribl-primary-soft text-cribl-ink'
        : 'border-cribl-border bg-white text-cribl-muted',
    ].join(' ')

  return (
    <div
      className={[
        'inline-flex min-w-0 max-w-full shrink-0 items-stretch overflow-hidden rounded-full border border-cribl-border/80',
        isActive ? 'ring-1 ring-cribl-primary/30' : '',
      ].join(' ')}
    >
      {editing ? (
        <div className="min-w-0 pl-2.5 pr-1">
          <input
            ref={inputRef}
            className="max-w-[10rem] min-w-[6rem] border-0 bg-transparent p-0 text-sm font-medium text-cribl-ink outline-none"
            value={row.wg}
            onChange={(e) => onUpdateWg(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.currentTarget.blur()
              }
            }}
            placeholder={fallback}
            autoComplete="off"
            aria-label={row.kind === 'edge' ? 'Fleet name' : 'Worker group name'}
          />
        </div>
      ) : (
        <button
          type="button"
          className={['max-w-[6.5rem] truncate', chip(isActive)].join(' ')}
          onClick={onSelect}
          title={
            row.wg.trim() ||
            (row.kind === 'edge' ? `Fleet ${index + 1}` : `Worker group ${index + 1}`)
          }
        >
          {label}
        </button>
      )}
      {!editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex w-6 shrink-0 items-center justify-center border-0 border-l border-cribl-border/80 bg-white text-cribl-muted hover:bg-cribl-elevate hover:text-cribl-ink"
          title="Edit name"
          aria-label={row.kind === 'edge' ? 'Edit fleet name' : 'Edit worker group name'}
        >
          <PencilIcon className="h-3 w-3" />
        </button>
      )}
      {canRemove && (
        <button
          type="button"
          className="border-0 border-l border-cribl-border/80 bg-white px-1.5 text-cribl-muted hover:text-rose-600"
          onClick={onRemove}
          title={`Remove ${label}`}
          aria-label={`Remove ${label}`}
        >
          ×
        </button>
      )}
    </div>
  )
}

/** Compact horizontal nav for small screens */
export function PlanNavMobile({
  plan,
  mainView,
  activeSourceId,
  activeWorkerGroupId,
  onSelectOverview,
  onSelectWorkerGroups: _onSelectWorkerGroups,
  onSelectFleets: _onSelectFleets,
  onSelectSources: _onSelectSources,
  onSelectSettings: _onSelectSettings,
  onSelectWorkerGroup,
  onAddWorkerGroup,
  onRemoveWorkerGroup,
  onUpdateWorkerGroupWg,
  onSelectSource,
  onAddSource,
  onRemoveSource,
  onRenameSource,
  onSelectImport,
  onSelectExport,
  onClearPlan: _onClearPlan,
  className = '',
}: Props) {
  void _onClearPlan
  void _onSelectSettings
  const sources = plan.sourceSummary
  // v2.0: keep Stream WGs and Edge fleets in separate runs of chips so each
  // row's positional fallback ("WG1" / "FL1") matches its index in its own
  // section, mirroring the desktop rail.
  const streamWgs = plan.workerGroups.filter((w) => w.kind === 'stream')
  const fleetWgs = plan.workerGroups.filter((w) => w.kind === 'edge')
  const chip = (active: boolean) =>
    [
      'shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition',
      active
        ? 'border-cribl-primary bg-cribl-primary-soft text-cribl-ink'
        : 'border-cribl-border bg-white text-cribl-muted',
    ].join(' ')

  return (
    <div
      className={`flex items-stretch gap-1.5 overflow-x-auto border-b border-cribl-border bg-white px-2 py-1.5 ${className}`}
    >
      <button
        type="button"
        className={chip(mainView === 'overview')}
        onClick={onSelectOverview}
      >
        Overview
      </button>
      <button type="button" className={chip(mainView === 'workerGroups')} onClick={_onSelectWorkerGroups}>
        Worker Groups
      </button>
      <button type="button" className={chip(mainView === 'fleets')} onClick={_onSelectFleets}>
        Fleets
      </button>
      <button type="button" className={chip(mainView === 'sources')} onClick={_onSelectSources}>
        Sources
      </button>
      <button type="button" className={chip(mainView === 'settings')} onClick={_onSelectSettings}>
        Settings
      </button>
      {streamWgs.map((r, i) => {
        const is = mainView === 'workerGroup' && activeWorkerGroupId === r.id
        return (
          <WorkerGroupChipMobile
            key={r.id}
            row={r}
            index={i}
            isActive={is}
            canRemove={plan.workerGroups.length > 0}
            onSelect={() => onSelectWorkerGroup(r.id)}
            onRemove={() => onRemoveWorkerGroup(r.id)}
            onUpdateWg={(wg) => onUpdateWorkerGroupWg(r.id, wg)}
          />
        )
      })}
      <button
        type="button"
        className="shrink-0 rounded-full border border-dashed border-cribl-border px-2 py-1.5 text-[10px] font-medium text-cribl-muted"
        onClick={() => onAddWorkerGroup('stream')}
        title="Add a worker group"
      >
        + Group
      </button>
      {fleetWgs.map((r, i) => {
        const is = mainView === 'workerGroup' && activeWorkerGroupId === r.id
        return (
          <WorkerGroupChipMobile
            key={r.id}
            row={r}
            index={i}
            isActive={is}
            canRemove={plan.workerGroups.length > 0}
            onSelect={() => onSelectWorkerGroup(r.id)}
            onRemove={() => onRemoveWorkerGroup(r.id)}
            onUpdateWg={(wg) => onUpdateWorkerGroupWg(r.id, wg)}
          />
        )
      })}
      <button
        type="button"
        className="shrink-0 rounded-full border border-dashed border-cribl-border px-2 py-1.5 text-[10px] font-medium text-cribl-muted"
        onClick={() => onAddWorkerGroup('edge')}
        title="Add a fleet"
      >
        + Fleet
      </button>
      {sources.map((r, i) => {
        const is = mainView === 'source' && activeSourceId === r.id
        return (
          <SourceChipMobile
            key={r.id}
            row={r}
            index={i}
            isActive={is}
            canRemove={sources.length > 0}
            onSelect={() => onSelectSource(r.id)}
            onRemove={() => onRemoveSource(r.id)}
            onRename={(name) => onRenameSource(r.id, name)}
          />
        )
      })}
      <button
        type="button"
        className={[
          'shrink-0 rounded-full border px-2.5 py-1.5 text-xs font-medium transition',
          mainView === 'import'
            ? 'border-cribl-primary/50 bg-cribl-primary-soft/90 text-cribl-ink'
            : 'border-cribl-border/80 bg-cribl-canvas/90 text-cribl-muted hover:border-cribl-border hover:text-cribl-ink',
        ].join(' ')}
        onClick={onSelectImport}
        title="Import from an Excel file"
      >
        Import
      </button>
      <button
        type="button"
        className={[
          'shrink-0 rounded-full border px-2.5 py-1.5 text-xs font-medium transition',
          mainView === 'export'
            ? 'border-cribl-primary/50 bg-cribl-primary-soft/90 text-cribl-ink'
            : 'border-cribl-border/80 bg-cribl-canvas/90 text-cribl-muted hover:border-cribl-border hover:text-cribl-ink',
        ].join(' ')}
        onClick={onSelectExport}
        title="Download a file you can share"
      >
        Export
      </button>
      <button
        type="button"
        className="shrink-0 rounded-full border border-dashed border-cribl-border px-2.5 py-1.5 text-sm text-cribl-muted"
        onClick={onAddSource}
        title="Add a source"
      >
        + Add
      </button>
    </div>
  )
}
