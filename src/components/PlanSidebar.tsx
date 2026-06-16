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
import { AnimatedCollapse } from './AnimatedCollapse'
import { tierPalette } from '../lib/psUseCaseLayout'
import {
  useDragReorder,
  type DragReorder,
  type DropPosition,
} from '../lib/useDragReorder'
import { isSourceRowAttachmentDisabled } from '../lib/sourceAttachmentDisabled'

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

const navSectionSortBtnClass =
  'inline-flex h-9 min-w-[2rem] shrink-0 items-center justify-center rounded-lg border border-cribl-border/80 bg-white/40 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-cribl-muted transition hover:border-cribl-border hover:bg-white/80 hover:text-cribl-ink'

/** A–Z / Z–A plus ingest (GB↓ heaviest first, GB↑ lightest) for a rail section header. */
function NavSectionSortButtons({
  visible,
  onAlphabetical,
  alphaAscTitle,
  alphaDescTitle,
  onIngestDesc,
  onIngestAsc,
  ingestDescTitle = 'Sort by GB/d, heaviest first',
  ingestAscTitle = 'Sort by GB/d, lightest first',
}: {
  visible: boolean
  onAlphabetical?: (order: 'asc' | 'desc') => void
  alphaAscTitle: string
  alphaDescTitle: string
  onIngestDesc?: () => void
  onIngestAsc?: () => void
  ingestDescTitle?: string
  ingestAscTitle?: string
}) {
  if (!visible || (!onAlphabetical && !onIngestDesc && !onIngestAsc)) {
    return null
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-0.5">
      {onAlphabetical ? (
        <button
          type="button"
          className={navSectionSortBtnClass}
          onClick={() => onAlphabetical('asc')}
          title={alphaAscTitle}
        >
          A–Z
        </button>
      ) : null}
      {onAlphabetical ? (
        <button
          type="button"
          className={navSectionSortBtnClass}
          onClick={() => onAlphabetical('desc')}
          title={alphaDescTitle}
        >
          Z–A
        </button>
      ) : null}
      {onIngestDesc ? (
        <button type="button" className={navSectionSortBtnClass} onClick={onIngestDesc} title={ingestDescTitle}>
          GB↓
        </button>
      ) : null}
      {onIngestAsc ? (
        <button type="button" className={navSectionSortBtnClass} onClick={onIngestAsc} title={ingestAscTitle}>
          GB↑
        </button>
      ) : null}
    </div>
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
  /** v2.0 PR C: navigate to the Activation page (PS Use Case Worksheet). */
  onSelectActivation: () => void
  /** Customer summary (executive readout, derived, read-only). */
  onSelectExecBrief: () => void
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
  /**
   * v2.0+: drag-to-reorder hooks for the left nav.
   *
   * `onReorderSources` reorders rows inside `plan.sourceSummary`; the
   * resulting order drives Excel export ordering for both per-WG/Fleet
   * sheet rows and the Stream / Edge Overview source-rows blocks.
   *
   * `onReorderWorkerGroups` reorders rows inside `plan.workerGroups`;
   * it is the caller's responsibility to ensure `fromId` and `toId`
   * share the same `kind` (the sidebar restricts drag scope to within
   * a section, so the parent reducer can no-op cross-kind drops).
   *
   * Optional **A–Z / Z–A** and **GB↓ / GB↑** sort callbacks within each rail section
   * (Edge: roots and sub-fleets each sort among peers). Ingest uses summed
   * **source summary** GB/d per row (same basis as the nav subtitle). Optional
   * on mobile chip nav — desktop rail exposes grips (drag + **Alt+↑/↓** when the
   * grip is focused) and sort buttons.
   */
  onReorderSources?: (fromId: string, toId: string, position: DropPosition) => void
  onReorderWorkerGroups?: (
    fromId: string,
    toId: string,
    position: DropPosition,
  ) => void
  /** Sort `plan.sourceSummary` by source name: `asc` = A–Z, `desc` = Z–A. */
  onSortSourcesAlphabetically?: (order: 'asc' | 'desc') => void
  /** Sort sources by **Average daily volume (GB)** on each row. */
  onSortSourcesByIngest?: (direction: 'desc' | 'asc') => void
  /** Sort Stream worker groups by display name: `asc` = A–Z, `desc` = Z–A. */
  onSortStreamWorkerGroupsAlphabetically?: (order: 'asc' | 'desc') => void
  /** Sort Stream worker groups by summed source ingest (GB/d) per group. */
  onSortStreamWorkerGroupsByIngest?: (direction: 'desc' | 'asc') => void
  /** Sort Edge fleets by name among peers: `asc` = A–Z, `desc` = Z–A (roots, then sub-fleets per parent). */
  onSortFleetWorkerGroupsAlphabetically?: (order: 'asc' | 'desc') => void
  /** Sort Edge fleets by ingest among peers (roots, then sub-fleets per parent). */
  onSortFleetWorkerGroupsByIngest?: (direction: 'desc' | 'asc') => void
  onSelectImport: () => void
  onSelectExport: () => void
  onClearPlan: () => void
  className?: string
}

/**
 * Small colored dot used on each source row in the left nav (and
 * mirrored as the source-icon dot on the Plan resource map) to signal
 * which side of the topology a source lives on:
 *
 *   - `'stream'` → cribl-primary teal
 *   - `'edge'`   → cribl-edge sky-blue
 *   - `null`     → muted grey ("not yet attached")
 */
function KindDot({
  kind,
  className = '',
  size = 'sm',
}: {
  kind: 'stream' | 'edge' | null
  className?: string
  size?: 'sm' | 'md'
}) {
  const tone =
    kind === 'edge'
      ? 'bg-cribl-edge'
      : kind === 'stream'
      ? 'bg-cribl-primary'
      : 'bg-cribl-muted/60'
  const dim = size === 'md' ? 'h-2.5 w-2.5' : 'h-2 w-2'
  return (
    <span
      aria-hidden
      className={['inline-block rounded-full', dim, tone, className]
        .filter(Boolean)
        .join(' ')}
      title={
        kind === 'edge'
          ? 'Attached to a Fleet (Edge)'
          : kind === 'stream'
          ? 'Attached to a Worker Group (Stream)'
          : 'Not yet attached to a worker group or fleet'
      }
    />
  )
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

/**
 * Drag-handle grip rendered at the leading edge of every reorderable
 * row in the desktop rail. The grip is the *only* part of the row that
 * is `draggable`, so users can still click the row's name button or
 * inline-edit the name without accidentally starting a drag. Drag
 * scope is contained to its parent section by `useDragReorder`'s
 * `canDropOn` predicate, so each section behaves like a stand-alone
 * sortable list.
 *
 * **Keyboard:** with focus on the grip, **Alt+↑** / **Alt+↓** moves the row
 * one step (same semantics as drag-before / drag-after).
 *
 * **Touch:** `pointer-coarse:` widens the grip for finger/stylus hit targets.
 * Native HTML5 D&D is still unreliable on **iOS Safari**; the mobile chip nav
 * omits grips — use **A–Z** sort or edit there.
 */
function GripHandle({
  draggable,
  onDragStart,
  onDragEnd,
  onKeyboardStep,
  ariaLabel,
  className = '',
}: {
  draggable: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  /** Alt+Arrow moves row up (−1) or down (+1) in its section list. */
  onKeyboardStep?: (delta: -1 | 1) => void
  ariaLabel: string
  className?: string
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (!onKeyboardStep || !draggable || !e.altKey) {
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      onKeyboardStep(-1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      onKeyboardStep(1)
    }
  }

  return (
    <span
      role="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      tabIndex={draggable ? 0 : -1}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      className={[
        // The grip sits as a flush-left strip on the row. Its
        // background is transparent until hovered so the rounded
        // border of the row reads cleanly when at rest, and only the
        // grip area picks up a "grab" affordance when the cursor
        // enters it. `cursor-grab` flips to `cursor-grabbing` only
        // while the parent has the dragging class — otherwise the
        // platform's own drag cursor takes over after `dragstart`.
        'flex w-5 shrink-0 items-center justify-center self-stretch border-0 border-r border-cribl-border/40 bg-transparent text-cribl-muted/60 transition',
        'cursor-grab hover:bg-cribl-elevate hover:text-cribl-ink',
        'select-none touch-manipulation',
        'focus-visible:z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cribl-primary/35',
        'pointer-coarse:min-h-11 pointer-coarse:min-w-8',
        className,
      ].join(' ')}
    >
      <svg
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5"
        aria-hidden="true"
        focusable="false"
      >
        {/*
         * Six-dot grip — a near-universal "drag to reorder" glyph.
         * Two columns × three rows of 1.4px circles keeps it readable
         * at the rail's small width without leaning on a font icon.
         */}
        <circle cx="6" cy="4" r="1.2" fill="currentColor" />
        <circle cx="10" cy="4" r="1.2" fill="currentColor" />
        <circle cx="6" cy="8" r="1.2" fill="currentColor" />
        <circle cx="10" cy="8" r="1.2" fill="currentColor" />
        <circle cx="6" cy="12" r="1.2" fill="currentColor" />
        <circle cx="10" cy="12" r="1.2" fill="currentColor" />
      </svg>
    </span>
  )
}

/**
 * Thin teal insertion line drawn directly above (`'before'`) or below
 * (`'after'`) a row that the cursor is hovering over while dragging.
 * Sits absolutely-positioned over the row container so it doesn't
 * disturb the surrounding flex layout, and so it can poke a couple of
 * pixels outside the row's rounded border without triggering a
 * reflow.
 */
function DropIndicator({ position }: { position: DropPosition }) {
  if (position === 'nest') {
    return (
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-2 right-2 flex justify-center rounded-md border border-dashed border-cribl-edge/60 bg-cribl-edge-soft py-1 text-[9px] font-semibold uppercase tracking-wide text-cribl-edge-ink"
      >
        Sub-fleet
      </span>
    )
  }
  return (
    <span
      aria-hidden
      className={[
        'pointer-events-none absolute left-0 right-0 h-0.5 rounded-full bg-cribl-primary',
        position === 'before' ? '-top-0.5' : '-bottom-0.5',
      ].join(' ')}
    />
  )
}

function SourceRowRail({
  row,
  index,
  isActive,
  canRemove,
  workerGroupName,
  workerGroupKind,
  drag,
  onKeyboardStep,
  onSelect,
  onRemove,
  onRename,
}: {
  row: SourceSummaryRow
  index: number
  isActive: boolean
  canRemove: boolean
  workerGroupName?: string
  /**
   * Kind of the WG/Fleet this source is attached to, or `null` when
   * the source is unassigned. Drives the colored dot on the left edge
   * of the row so a glance at the nav tells a CSE which side of the
   * topology each source lives on.
   *
   *   - `'stream'` → cribl-primary teal
   *   - `'edge'`   → cribl-edge sky-blue
   *   - `null`     → muted grey ("not yet attached")
   */
  workerGroupKind: 'stream' | 'edge' | null
  /**
   * Drag-and-drop wiring from `useDragReorder`. Optional — when the
   * parent doesn't pass it (e.g. a future read-only render), the row
   * simply omits the grip handle and drop targets.
   */
  drag?: DragReorder
  /** Alt+↑ / Alt+↓ on the grip — same list semantics as drag reorder. */
  onKeyboardStep?: (delta: -1 | 1) => void
  onSelect: () => void
  onRemove: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const label = sourceLabel(row, index)
  const attachmentDisabled = isSourceRowAttachmentDisabled(row)
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

  // Drag-and-drop wiring. Disabled while inline-editing the row's name
  // so the input field captures clicks/drags normally — re-enabling on
  // blur is automatic via the `editing` state flip.
  const dragEnabled = Boolean(drag) && !editing
  const handleProps = drag && dragEnabled ? drag.getHandleProps(row.id) : null
  const rowDragProps = drag ? drag.getRowProps(row.id) : null
  const isDragging = drag?.draggingId === row.id
  const isOver = drag?.overId === row.id && drag?.overPosition != null

  // Outer wrapper carries `position: relative` and the drop-indicator
  // overlay so the inner row can keep its `overflow-hidden` (needed
  // to clip the rounded corners of the inline action buttons). The
  // wrapper also owns the drag-over event handlers; HTML5 D&D will
  // fire them on whichever element is under the cursor regardless of
  // pointer-events on overlay siblings.
  return (
    <div
      className="relative ml-3"
      onDragOver={rowDragProps?.onDragOver}
      onDragLeave={rowDragProps?.onDragLeave}
      onDrop={rowDragProps?.onDrop}
    >
      {isOver && drag?.overPosition ? (
        <DropIndicator position={drag.overPosition} />
      ) : null}
      <div
        className={[
          'flex min-w-0 items-stretch overflow-hidden rounded-lg border transition',
          isActive
            ? 'border-cribl-primary bg-white shadow-sm'
            : attachmentDisabled
              ? 'border-cribl-border/60 bg-cribl-card-body/40 opacity-90'
              : 'border-cribl-border/80 bg-white/50 hover:border-cribl-border',
          isDragging ? 'opacity-50' : '',
        ].join(' ')}
      >
      {handleProps ? (
        <GripHandle
          draggable={handleProps.draggable}
          onDragStart={handleProps.onDragStart}
          onDragEnd={handleProps.onDragEnd}
          onKeyboardStep={onKeyboardStep}
          ariaLabel={`Reorder ${label}. Drag, or Alt+Up Arrow / Alt+Down Arrow to move.`}
        />
      ) : null}
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
          className={[
            'flex min-w-0 flex-1 items-start gap-2 border-0 bg-transparent px-3 py-2 text-left text-sm font-medium',
            attachmentDisabled ? 'text-cribl-muted' : 'text-cribl-ink',
          ].join(' ')}
        >
          <KindDot kind={workerGroupKind} className="mt-1.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="block truncate">{label}</span>
              {attachmentDisabled ? (
                <span className="shrink-0 rounded-md border border-cribl-border/80 bg-cribl-card-body px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cribl-muted">
                  Disabled
                </span>
              ) : null}
              {workerGroupName ? (
                <span className="ml-1.5 text-xs font-normal text-cribl-muted">
                  · {workerGroupName}
                </span>
              ) : (
                /*
                 * Make the un-attached state explicit in the nav so a
                 * customer skimming the sources list can spot the rows
                 * that still need to be wired to a Worker Group or
                 * Fleet. Italicized + muted to read as a status hint
                 * rather than a real worker-group name.
                 */
                <span className="ml-1.5 text-xs font-normal italic text-cribl-muted/80">
                  · Unassigned
                </span>
              )}
            </span>
            {showSubtitle ? (
              <span className="mt-0.5 block max-w-full truncate text-xs font-normal text-cribl-muted">
                {subtitle}
              </span>
            ) : null}
          </span>
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
  drag,
  onKeyboardStep,
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
  /**
   * Drag-and-drop wiring shared with sibling rows in the same section
   * (Stream WGs or Edge fleets, never both). Optional so callers that
   * don't need reordering — currently only the mobile chip nav — can
   * skip it without touching the row component's internals.
   */
  drag?: DragReorder
  /** Alt+↑ / Alt+↓ on the grip — same list semantics as drag reorder. */
  onKeyboardStep?: (delta: -1 | 1) => void
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

  const dragEnabled = Boolean(drag) && !editing
  const handleProps = drag && dragEnabled ? drag.getHandleProps(row.id) : null
  const rowDragProps = drag ? drag.getRowProps(row.id) : null
  const isDragging = drag?.draggingId === row.id
  const isOver = drag?.overId === row.id && drag?.overPosition != null
  const isSubFleet = row.kind === 'edge' && Boolean((row.parentFleetId ?? '').trim())

  return (
    <div
      className={isSubFleet ? 'relative ml-7' : 'relative ml-3'}
      onDragOver={rowDragProps?.onDragOver}
      onDragLeave={rowDragProps?.onDragLeave}
      onDrop={rowDragProps?.onDrop}
    >
      {isOver && drag?.overPosition ? (
        <DropIndicator position={drag.overPosition} />
      ) : null}
      <div
        className={[
          'flex min-w-0 items-stretch overflow-hidden rounded-lg border transition',
          isActive
            ? 'border-cribl-primary bg-white shadow-sm'
            : 'border-cribl-border/80 bg-white/50 hover:border-cribl-border',
          isDragging ? 'opacity-50' : '',
        ].join(' ')}
      >
      {handleProps ? (
        <GripHandle
          draggable={handleProps.draggable}
          onDragStart={handleProps.onDragStart}
          onDragEnd={handleProps.onDragEnd}
          onKeyboardStep={onKeyboardStep}
          ariaLabel={
            row.kind === 'edge'
              ? `Reorder fleet ${label}. Drag, or Alt+Up Arrow / Alt+Down Arrow to move.`
              : `Reorder worker group ${label}. Drag, or Alt+Up Arrow / Alt+Down Arrow to move.`
          }
        />
      ) : null}
      {editing ? (
        <div className="min-w-0 flex-1 py-1.5 pl-3 pr-1">
          {isSubFleet ? (
            <span className="mb-1 inline-block rounded border border-cribl-edge/40 bg-cribl-edge-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cribl-edge-ink">
              Sub fleet
            </span>
          ) : null}
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
          {isSubFleet ? (
            <span className="mb-1 block w-full">
              <span className="inline-block rounded border border-cribl-edge/40 bg-cribl-edge-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cribl-edge-ink">
                Sub fleet
              </span>
            </span>
          ) : null}
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
  onReorderWorkerGroups,
  onSortAlphabetically,
  onSortByIngest,
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
  onReorderWorkerGroups?: (
    fromId: string,
    toId: string,
    position: DropPosition,
  ) => void
  /** Sort this section by name among peers: `asc` = A–Z, `desc` = Z–A (Stream WGs or Edge fleets + sub-fleets). */
  onSortAlphabetically?: (order: 'asc' | 'desc') => void
  /** Sort this section by summed source ingest (GB/d) per row (`desc` = heaviest first). */
  onSortByIngest?: (direction: 'desc' | 'asc') => void
}) {
  const sectionTitle = kind === 'edge' ? 'Fleets' : 'Worker Groups'
  const indexView: MainView = kind === 'edge' ? 'fleets' : 'workerGroups'
  const addLabel = kind === 'edge' ? '+ Add Fleet' : '+ Add Worker Group'
  const empty = rows.length === 0
  const headerCount =
    kind === 'edge' ? rows.filter((r) => !(r.parentFleetId ?? '').trim()).length : rows.length
  // Drag-reorder is scoped to this section: a Stream WG can only be
  // dropped on another Stream WG, never on an Edge fleet (and vice
  // versa). We enforce that with a `canDropOn` predicate that checks
  // the *kind* of both rows in `plan.workerGroups`. The parent's
  // `onReorderWorkerGroups` reducer also defends against cross-kind
  // moves, but enforcing it here keeps the drop-indicator UX honest.
  const drag = useDragReorder({
    onReorder: (fromId, toId, position) => {
      onReorderWorkerGroups?.(fromId, toId, position)
    },
    canDropOn: (fromId, toId) => {
      const from = plan.workerGroups.find((w) => w.id === fromId)
      const to = plan.workerGroups.find((w) => w.id === toId)
      return Boolean(from && to && from.kind === to.kind && from.kind === kind)
    },
    nestAffinity:
      kind === 'edge'
        ? (_fromId, toId) => {
            const to = plan.workerGroups.find((w) => w.id === toId)
            return Boolean(to?.kind === 'edge' && !(to.parentFleetId ?? '').trim())
          }
        : undefined,
  })
  const dragForRows = onReorderWorkerGroups ? drag : undefined
  const keyboardRowStep =
    onReorderWorkerGroups &&
    ((id: string, delta: -1 | 1) => {
      const idx = rows.findIndex((x) => x.id === id)
      const j = idx + delta
      if (idx < 0 || j < 0 || j >= rows.length) {
        return
      }
      const neighbor = rows[j]!
      onReorderWorkerGroups(id, neighbor.id, delta === -1 ? 'before' : 'after')
    })
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
              <span className="text-xs font-normal text-cribl-muted">({headerCount})</span>
            ) : null}
          </span>
        </NavButton>
        <NavSectionSortButtons
          visible={rows.length > 1 && Boolean(onReorderWorkerGroups)}
          onAlphabetical={onSortAlphabetically}
          alphaAscTitle={`Sort ${sectionTitle} A–Z by name`}
          alphaDescTitle={`Sort ${sectionTitle} Z–A by name`}
          onIngestDesc={onSortByIngest ? () => onSortByIngest('desc') : undefined}
          onIngestAsc={onSortByIngest ? () => onSortByIngest('asc') : undefined}
          ingestDescTitle={
            kind === 'edge'
              ? 'Sort top-level fleets by summed ingest from sources on that fleet (GB/d), heaviest first; sub-fleets sort among siblings under each parent'
              : 'Sort worker groups by summed ingest from sources attached to each group (GB/d), heaviest first'
          }
          ingestAscTitle={
            kind === 'edge'
              ? 'Sort top-level fleets by summed ingest (GB/d), lightest first; sub-fleets sort among siblings under each parent'
              : 'Sort worker groups by summed ingest from attached sources (GB/d), lightest first'
          }
        />
        {rows.length > 0 ? (
          <ChevronToggle
            open={listOpen}
            onClick={() => setListOpen((v) => !v)}
            label={`${sectionTitle} list`}
          />
        ) : null}
      </div>
      <AnimatedCollapse open={listOpen}>
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
                drag={dragForRows}
                onKeyboardStep={keyboardRowStep ? (d) => keyboardRowStep(r.id, d) : undefined}
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
      </AnimatedCollapse>
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
  onSelectActivation,
  onSelectExecBrief,
  onSelectSettings,
  onSelectWorkerGroup,
  onAddWorkerGroup,
  onRemoveWorkerGroup,
  onUpdateWorkerGroupWg,
  onReorderWorkerGroups,
  onSelectSource,
  onAddSource,
  onRemoveSource,
  onRenameSource,
  onReorderSources,
  onSortSourcesAlphabetically,
  onSortSourcesByIngest,
  onSortStreamWorkerGroupsAlphabetically,
  onSortStreamWorkerGroupsByIngest,
  onSortFleetWorkerGroupsAlphabetically,
  onSortFleetWorkerGroupsByIngest,
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
  const allSources = plan.sourceSummary
  const disabledSourceCount = allSources.filter(isSourceRowAttachmentDisabled).length
  /** Left nav always omits sources disabled for attachment (see Sources index / source detail to include them). */
  const sources = allSources.filter((r) => !isSourceRowAttachmentDisabled(r))
  const canRemove = allSources.length > 0
  const noSources = allSources.length === 0
  const [wgListOpen, setWgListOpen] = useState(true)
  const [fleetListOpen, setFleetListOpen] = useState(true)
  const [sourcesListOpen, setSourcesListOpen] = useState(true)
  /** Desktop rail: when false, the indented Plan sub-items (Summary, Activation) are hidden. */
  const [planSectionOpen, setPlanSectionOpen] = useState(true)

  useEffect(() => {
    if (mainView === 'activation' || mainView === 'execBrief') {
      setPlanSectionOpen(true)
    }
  }, [mainView])

  // Sources is a single flat list, so the drag context lives at this
  // level. Per-section drag state for Stream WGs vs Edge fleets lives
  // inside each `WorkerGroupKindSection` below — a row dragged in one
  // section can't be dropped in the other.
  const sourceDrag = useDragReorder({
    onReorder: (fromId, toId, position) => {
      onReorderSources?.(fromId, toId, position)
    },
  })
  const sourceDragForRows = onReorderSources ? sourceDrag : undefined
  const sourceKeyboardStep =
    onReorderSources &&
    ((id: string, delta: -1 | 1) => {
      const idx = sources.findIndex((x) => x.id === id)
      const j = idx + delta
      if (idx < 0 || j < 0 || j >= sources.length) {
        return
      }
      const neighbor = sources[j]!
      onReorderSources(id, neighbor.id, delta === -1 ? 'before' : 'after')
    })

  return (
    <nav
      className={`flex flex-col gap-0.5 pl-2 pr-0 pb-2 pt-0 ${className}`}
      aria-label="Plan, Worker Groups, Fleets, and Sources"
    >
      <div className="mt-2 flex items-center gap-1">
        <NavButton
          active={mainView === 'overview'}
          onClick={onSelectOverview}
          className="flex-1"
        >
          Plan
        </NavButton>
        <ChevronToggle
          open={planSectionOpen}
          onClick={() => setPlanSectionOpen((v) => !v)}
          label="Plan section"
        />
      </div>
      <AnimatedCollapse open={planSectionOpen}>
        <div className="ml-2 mt-0.5 flex flex-col gap-0.5">
          <NavButton
            active={mainView === 'execBrief'}
            onClick={onSelectExecBrief}
            title="Executive summary — full inventory, narrative, exports (.md / .xlsx)"
            className="mt-0.5"
          >
            Summary
          </NavButton>
          <NavButton
            active={mainView === 'activation'}
            onClick={onSelectActivation}
            title="Cribl PS activation worksheet (tier, base scope, use cases)"
            className="mt-0.5"
          >
            <span className="flex items-center gap-2">
              <span>Activation</span>
              {plan.activation.tier ? (
                (() => {
                  const palette = tierPalette(plan.activation.tier)!
                  return (
                    <span
                      className={[
                        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                        palette.chip,
                      ].join(' ')}
                      title={`Cribl PS ${plan.activation.tier} tier`}
                    >
                      <span aria-hidden className={['h-1.5 w-1.5 rounded-full', palette.dot].join(' ')} />
                      {plan.activation.tier}
                    </span>
                  )
                })()
              ) : null}
            </span>
          </NavButton>
        </div>
      </AnimatedCollapse>

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
        onReorderWorkerGroups={onReorderWorkerGroups}
        onSortAlphabetically={onSortStreamWorkerGroupsAlphabetically}
        onSortByIngest={onSortStreamWorkerGroupsByIngest}
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
        onReorderWorkerGroups={onReorderWorkerGroups}
        onSortAlphabetically={onSortFleetWorkerGroupsAlphabetically}
        onSortByIngest={onSortFleetWorkerGroupsByIngest}
      />

      <div className="mt-3 flex items-center gap-1">
        <NavButton
          active={mainView === 'sources'}
          onClick={onSelectSources}
          className="flex-1"
        >
          <span className="flex items-center gap-2">
            <span>Sources</span>
            {allSources.length > 0 ? (
              <span className="text-xs font-normal text-cribl-muted">({allSources.length})</span>
            ) : null}
          </span>
        </NavButton>
        <NavSectionSortButtons
          visible={allSources.length > 1 && Boolean(onReorderSources)}
          onAlphabetical={onSortSourcesAlphabetically}
          alphaAscTitle="Sort sources A–Z by name"
          alphaDescTitle="Sort sources Z–A by name"
          onIngestDesc={onSortSourcesByIngest ? () => onSortSourcesByIngest('desc') : undefined}
          onIngestAsc={onSortSourcesByIngest ? () => onSortSourcesByIngest('asc') : undefined}
          ingestDescTitle="Sort sources by average daily volume (GB) on each row, heaviest first"
          ingestAscTitle="Sort sources by average daily volume (GB) on each row, lightest first"
        />
        {allSources.length > 0 ? (
          <ChevronToggle
            open={sourcesListOpen}
            onClick={() => setSourcesListOpen((v) => !v)}
            label="Sources list"
          />
        ) : null}
      </div>
      <AnimatedCollapse open={sourcesListOpen}>
        <div className="ml-2 mt-0.5 flex flex-col gap-0.5">
          {disabledSourceCount > 0 ? (
            <p
              className="m-0 mb-0.5 px-1 text-[11px] leading-snug text-cribl-muted"
              role="status"
              title="Open the Sources tab or a source detail page to show disabled sources in those views."
            >
              {disabledSourceCount} disabled source{disabledSourceCount === 1 ? '' : 's'} hidden
            </p>
          ) : null}
          {sources.length === 0 && allSources.length > 0 ? (
            <p className="m-0 px-1 py-2 text-xs leading-snug text-cribl-muted">
              Every source is disabled for attachment, so none are listed in the sidebar. Use{' '}
              <span className="font-medium text-cribl-ink/80">Show disabled sources</span> on the Sources tab or a
              source detail page to view them there.
            </p>
          ) : null}
          {sources.map((r) => {
            const isSrc = mainView === 'source' && activeSourceId === r.id
            const wg = r.workerGroupId
              ? plan.workerGroups.find((w) => w.id === r.workerGroupId)
              : null
            const wgName = wg ? wg.wg.trim() || undefined : undefined
            const wgKind: 'stream' | 'edge' | null = wg ? wg.kind : null
            const sourceIndex = allSources.findIndex((x) => x.id === r.id)
            return (
              <SourceRowRail
                key={r.id}
                row={r}
                index={sourceIndex >= 0 ? sourceIndex : 0}
                isActive={isSrc}
                canRemove={canRemove}
                workerGroupName={wgName}
                workerGroupKind={wgKind}
                drag={sourceDragForRows}
                onKeyboardStep={sourceKeyboardStep ? (d) => sourceKeyboardStep(r.id, d) : undefined}
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
      </AnimatedCollapse>

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
        Settings
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
            (row.wg.trim() ||
              (row.kind === 'edge' ? `Fleet ${index + 1}` : `Worker group ${index + 1}`)) +
            (row.kind === 'edge' && (row.parentFleetId ?? '').trim() ? ' · Sub fleet' : '')
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
  onSelectActivation: _onSelectActivation,
  onSelectExecBrief: _onSelectExecBrief,
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
  const allSources = plan.sourceSummary
  const disabledSourceCount = allSources.filter(isSourceRowAttachmentDisabled).length
  const sources = allSources.filter((r) => !isSourceRowAttachmentDisabled(r))
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
      {/*
       * Mobile chip order mirrors the desktop rail: Overview (Plan), then
       * Summary, then Activation under Plan. Keeping the same order as the
       * desktop indent preserves parity between layouts.
       */}
      <button
        type="button"
        className={chip(mainView === 'overview')}
        onClick={onSelectOverview}
      >
        Overview
      </button>
      <button
        type="button"
        className={chip(mainView === 'execBrief')}
        onClick={_onSelectExecBrief}
        title="Executive summary — full inventory, narrative, exports (.md / .xlsx)"
      >
        Summary
      </button>
      <button type="button" className={chip(mainView === 'activation')} onClick={_onSelectActivation}>
        Activation
        {plan.activation.tier
          ? (() => {
              const palette = tierPalette(plan.activation.tier)!
              return (
                <span
                  className={[
                    'ml-1.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                    palette.chip,
                  ].join(' ')}
                  title={`Cribl PS ${plan.activation.tier} tier`}
                >
                  <span aria-hidden className={['h-1.5 w-1.5 rounded-full', palette.dot].join(' ')} />
                  {plan.activation.tier}
                </span>
              )
            })()
          : null}
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
      {disabledSourceCount > 0 ? (
        <span
          className="shrink-0 rounded-full border border-cribl-border/70 bg-cribl-canvas/90 px-2 py-1 text-[10px] font-medium text-cribl-muted"
          title="Open the Sources tab or a source detail page to show disabled sources there."
          role="status"
        >
          {disabledSourceCount} disabled source{disabledSourceCount === 1 ? '' : 's'} hidden
        </span>
      ) : null}
      {sources.map((r) => {
        const is = mainView === 'source' && activeSourceId === r.id
        const sourceIndex = allSources.findIndex((x) => x.id === r.id)
        return (
          <SourceChipMobile
            key={r.id}
            row={r}
            index={sourceIndex >= 0 ? sourceIndex : 0}
            isActive={is}
            canRemove={allSources.length > 0}
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
