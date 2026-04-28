import { useEffect, useRef, useState } from 'react'
import { CriblMark, CriblRailBrand } from './brand/CriblLogos'
import type { PlanState, SourceSummaryRow, WorkerGroupRow } from '../types/planTypes'
import { PencilIcon } from './PencilIcon'
import type { MainView } from './navTypes'
import { formatGbOrTbPerDayStr, parseGb } from '../lib/formatRate'

const itemBase =
  'w-full text-left text-sm font-medium transition rounded-lg px-3 py-2.5 border-l-2'

const sectionLabel =
  'm-0 border-t border-cribl-border/90 px-3 pt-3 pb-1 text-xs font-semibold tracking-wider text-cribl-muted uppercase'

type Props = {
  plan: PlanState
  mainView: MainView
  activeSourceId: string | null
  activeWorkerGroupId: string | null
  onSelectOverview: () => void
  onSelectWorkerGroups: () => void
  onSelectSources: () => void
  onSelectSettings: () => void
  onSelectWorkerGroup: (id: string) => void
  onAddWorkerGroup: () => void
  onRemoveWorkerGroup: (id: string) => void
  onUpdateWorkerGroupWg: (id: string, wg: string) => void
  onSelectSource: (id: string) => void
  onAddSource: () => void
  onRemoveSource: (id: string) => void
  onUpdateSourceDisplayName: (id: string, displayName: string) => void
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
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  title?: string
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
  onSelect,
  onRemove,
  onUpdateDisplayName,
}: {
  row: SourceSummaryRow
  index: number
  isActive: boolean
  canRemove: boolean
  onSelect: () => void
  onRemove: () => void
  onUpdateDisplayName: (displayName: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const label = row.displayName?.trim() || `Source ${index + 1}`
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
            value={row.displayName}
            onChange={(e) => onUpdateDisplayName(e.target.value)}
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
          <span className="block truncate">{label}</span>
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
  const label = row.wg.trim() || `Worker group ${index + 1}`
  const sub = (row.ingestGbd || '').trim()
    ? `${row.ingestGbd} GB/d ingest`
    : null

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
            placeholder={`Worker group ${index + 1}`}
            autoComplete="off"
            aria-label="Worker group name"
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
          aria-label="Edit worker group name"
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

export function PlanSidebarRail({
  plan,
  mainView,
  activeSourceId,
  activeWorkerGroupId,
  onSelectOverview,
  onSelectWorkerGroups,
  onSelectSources,
  onSelectSettings,
  onSelectWorkerGroup,
  onAddWorkerGroup,
  onRemoveWorkerGroup,
  onUpdateWorkerGroupWg,
  onSelectSource,
  onAddSource,
  onRemoveSource,
  onUpdateSourceDisplayName,
  onSelectImport,
  onSelectExport,
  onClearPlan,
  className = '',
}: Props) {
  const wgs = plan.workerGroups
  const canRemoveWg = wgs.length > 0
  const noWgs = wgs.length === 0
  const sources = plan.sourceSummary
  const canRemove = sources.length > 0
  const noSources = sources.length === 0

  return (
    <nav
      className={`flex flex-col gap-0.5 pl-2 pr-0 pb-2 pt-0 ${className}`}
      aria-label="Plan, Worker Groups, and Sources"
    >
      <CriblRailBrand className="!mb-0" />
      <p className="m-0 px-3 pt-0 pb-1 text-xs font-semibold tracking-wider text-cribl-muted uppercase">
        Plan
      </p>
      <NavButton
        active={mainView === 'overview'}
        onClick={onSelectOverview}
      >
        Overview
      </NavButton>

      <p className={`${sectionLabel} mt-3`}>
        Worker Groups
      </p>
      <NavButton active={mainView === 'workerGroups'} onClick={onSelectWorkerGroups}>
        Overview
      </NavButton>
      {wgs.map((r, i) => {
        const isWg =
          mainView === 'workerGroup' && activeWorkerGroupId === r.id
        return (
          <WorkerGroupRowRail
            key={r.id}
            row={r}
            index={i}
            isActive={isWg}
            canRemove={canRemoveWg}
            onSelect={() => onSelectWorkerGroup(r.id)}
            onRemove={() => onRemoveWorkerGroup(r.id)}
            onUpdateWg={(wg) => onUpdateWorkerGroupWg(r.id, wg)}
          />
        )
      })}
      <div className="ml-3">
        <button
          type="button"
          onClick={onAddWorkerGroup}
          className={[
            'w-full rounded-lg border border-dashed border-cribl-border/90 bg-cribl-canvas/80 px-3 py-2 text-left text-sm font-medium text-cribl-muted transition hover:border-cribl-primary/50 hover:text-cribl-ink',
            noWgs ? 'mt-3' : 'mt-0.5',
          ].join(' ')}
        >
          + Add Worker Group
        </button>
      </div>

      <p className={`${sectionLabel} mt-3`}>
        Sources
      </p>
      <NavButton active={mainView === 'sources'} onClick={onSelectSources}>
        Overview
      </NavButton>
      {sources.map((r, i) => {
        const isSrc = mainView === 'source' && activeSourceId === r.id
        return (
          <SourceRowRail
            key={r.id}
            row={r}
            index={i}
            isActive={isSrc}
            canRemove={canRemove}
            onSelect={() => onSelectSource(r.id)}
            onRemove={() => onRemoveSource(r.id)}
            onUpdateDisplayName={(displayName) => onUpdateSourceDisplayName(r.id, displayName)}
          />
        )
      })}
      <div className="ml-3">
        <button
          type="button"
          onClick={onAddSource}
          className={[
            'w-full rounded-lg border border-dashed border-cribl-border/90 bg-cribl-canvas/80 px-3 py-2 text-left text-sm font-medium text-cribl-muted transition hover:border-cribl-primary/50 hover:text-cribl-ink',
            noSources ? 'mt-3' : 'mt-0.5',
          ].join(' ')}
        >
          + Add source
        </button>
      </div>

      <p className="m-0 mt-4 border-t border-cribl-border/80 px-3 pt-3 pb-1 text-xs font-semibold tracking-wider text-cribl-muted/90 uppercase">
        File
      </p>
      <button
        type="button"
        onClick={onSelectImport}
        className={[
          'w-full rounded-lg border px-3 py-2 text-left transition',
          'border-l-2',
          mainView === 'import'
            ? 'border-cribl-primary/70 bg-white/80 text-cribl-ink shadow-sm'
            : 'border-transparent text-cribl-rail-ink/85 hover:border-cribl-border/50 hover:bg-white/60',
        ].join(' ')}
        title="Load from an .xlsx file"
      >
        <span className="block text-xs font-medium text-cribl-ink/90">Import</span>
        <span className="mt-0.5 block text-[10px] font-normal leading-snug text-cribl-muted">From Excel</span>
      </button>
      <button
        type="button"
        onClick={onSelectExport}
        className={[
          'mt-0.5 w-full rounded-lg border px-3 py-2 text-left transition',
          'border-l-2',
          mainView === 'export'
            ? 'border-cribl-primary/70 bg-white/80 text-cribl-ink shadow-sm'
            : 'border-transparent text-cribl-rail-ink/85 hover:border-cribl-border/50 hover:bg-white/60',
        ].join(' ')}
        title="Download a file you can share"
      >
        <span className="block text-xs font-medium text-cribl-ink/90">Export</span>
        <span className="mt-0.5 block text-[10px] font-normal leading-snug text-cribl-muted">
          Download your plan
        </span>
      </button>

      <p className="m-0 mt-4 border-t border-cribl-border/80 px-3 pt-3 pb-1 text-xs font-semibold tracking-wider text-cribl-muted/90 uppercase">
        Settings
      </p>
      <NavButton active={mainView === 'settings'} onClick={onSelectSettings}>
        Preferences
      </NavButton>

      <p className="m-0 mt-4 border-t border-cribl-border/80 px-3 pt-3 pb-1 text-xs font-semibold tracking-wider text-cribl-muted/90 uppercase">
        Reset
      </p>
      <button
        type="button"
        onClick={onClearPlan}
        className="w-full rounded-lg border border-cribl-border/60 bg-cribl-canvas/40 px-3 py-2 text-left text-sm font-medium text-cribl-muted transition hover:border-cribl-border hover:bg-rose-50/60 hover:text-rose-700"
        title="Clear all data in this plan"
      >
        Clear plan…
      </button>
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
  onUpdateDisplayName,
}: {
  row: SourceSummaryRow
  index: number
  isActive: boolean
  canRemove: boolean
  onSelect: () => void
  onRemove: () => void
  onUpdateDisplayName: (displayName: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const label = row.displayName?.trim() || `S${index + 1}`

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
            value={row.displayName}
            onChange={(e) => onUpdateDisplayName(e.target.value)}
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
          title={row.displayName?.trim() || `Source ${index + 1}`}
        >
          {row.displayName?.trim() || `S${index + 1}`}
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
  const label = row.wg.trim() || `WG${index + 1}`

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
            placeholder={`WG${index + 1}`}
            autoComplete="off"
            aria-label="Worker group name"
          />
        </div>
      ) : (
        <button
          type="button"
          className={['max-w-[6.5rem] truncate', chip(isActive)].join(' ')}
          onClick={onSelect}
          title={row.wg.trim() || `Worker group ${index + 1}`}
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
          aria-label="Edit worker group name"
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
  onSelectSources: _onSelectSources,
  onSelectSettings: _onSelectSettings,
  onSelectWorkerGroup,
  onAddWorkerGroup,
  onRemoveWorkerGroup,
  onUpdateWorkerGroupWg,
  onSelectSource,
  onAddSource,
  onRemoveSource,
  onUpdateSourceDisplayName,
  onSelectImport,
  onSelectExport,
  onClearPlan: _onClearPlan,
  className = '',
}: Props) {
  void _onClearPlan
  void _onSelectSettings
  const sources = plan.sourceSummary
  const wgs = plan.workerGroups
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
      <div className="mr-0.5 flex shrink-0 items-center border-0 pr-0.5 sm:pr-1" title="Cribl">
        <CriblMark className="h-6 w-6" />
      </div>
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
      <button type="button" className={chip(mainView === 'sources')} onClick={_onSelectSources}>
        Sources
      </button>
      <button type="button" className={chip(mainView === 'settings')} onClick={_onSelectSettings}>
        Settings
      </button>
      {wgs.map((r, i) => {
        const is = mainView === 'workerGroup' && activeWorkerGroupId === r.id
        return (
          <WorkerGroupChipMobile
            key={r.id}
            row={r}
            index={i}
            isActive={is}
            canRemove={wgs.length > 0}
            onSelect={() => onSelectWorkerGroup(r.id)}
            onRemove={() => onRemoveWorkerGroup(r.id)}
            onUpdateWg={(wg) => onUpdateWorkerGroupWg(r.id, wg)}
          />
        )
      })}
      <button
        type="button"
        className="shrink-0 rounded-full border border-dashed border-cribl-border px-2 py-1.5 text-[10px] font-medium text-cribl-muted"
        onClick={onAddWorkerGroup}
        title="Add a worker group"
      >
        + Group
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
            onUpdateDisplayName={(displayName) => onUpdateSourceDisplayName(r.id, displayName)}
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
