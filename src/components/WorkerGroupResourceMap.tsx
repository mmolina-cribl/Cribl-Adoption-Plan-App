import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { SourceSummaryRow, WorkerGroupRow } from '../types/planTypes'
import { formatGbOrTbPerDayStr, parseGb } from '../lib/formatRate'
import { CHART_CRIBL_BLUE } from '../lib/chartColors'
import { useEntryAnimation } from '../lib/animationsPreference'
import { SearchInput } from './SearchInput'

type Props = {
  workerGroup: WorkerGroupRow
  sources: SourceSummaryRow[]
  /** Sum of avgDailyGb across the WG’s sources (parent already computes it). */
  totalVolumeGb: number
  /**
   * Sources in the plan that aren't attached to any worker group yet.
   * Rendered in a dedicated "Unassigned sources" section beneath the
   * tree, each with a drag handle the user can drop onto the WG hub
   * above to assign it (calls `onAttach`).
   */
  unassignedSources?: SourceSummaryRow[]
  /** Open the source detail page in the parent. */
  onOpenSource: (id: string) => void
  /** Detach a source from this worker group. */
  onUnassign: (id: string) => void
  /**
   * Attach a previously-unassigned source to this worker group. Wired
   * to drops landing on the WG hub during a drag from the Unassigned
   * section.
   */
  onAttach?: (id: string) => void
  /**
   * Optional. When provided, surface a "+ New source" button in the
   * resource map header. Wired to the global "New data source" dialog
   * so creating from here behaves the same as the left-nav "+ Add
   * source" flow (prompt for a name, then redirect to the source page
   * where the user can choose the wizard or manual setup).
   */
  onAddSource?: () => void
  /** Extra classes appended to the outer card (e.g. `lg:col-span-2`). */
  className?: string
}

type Point = { x: number; y: number }

type Branch = {
  id: string
  d: string
  weight: number
  /** Source-side endpoint of the cubic curve, in container coords. */
  src: Point
  /** Worker-group-side endpoint of the cubic curve, in container coords. */
  dst: Point
}

/**
 * Interactive tree map that renders every Source attached to a Worker Group
 * as a leaf, connected to a central WG hub via curved SVG branches. The
 * visualization is driven by the live plan state, so attach / unassign
 * actions update the tree immediately.
 *
 * Layout: sources column on the left, hub on the right. Cubic-bezier paths
 * are computed in a layout effect against actual DOM rects, then redrawn on
 * resize via ResizeObserver. SVG is `pointer-events: none` so source cards
 * stay fully interactive — hover state on a card highlights both the card
 * and its branch.
 */
export function WorkerGroupResourceMap({
  workerGroup,
  sources,
  totalVolumeGb,
  unassignedSources = [],
  onOpenSource,
  onUnassign,
  onAttach,
  onAddSource,
  className,
}: Props) {
  /**
   * One-shot fade-in for the connector tree when the resource map
   * first renders (e.g. when the user lands on the worker group
   * page or expands the Resource Map card). The wrapping `<g>`
   * carries the entry opacity transition so individual `<path>`
   * hover styles continue to work.
   */
  const { animated: entryAnimated, enabled: animEnabled } = useEntryAnimation()
  const containerRef = useRef<HTMLDivElement>(null)
  const hubRef = useRef<HTMLDivElement>(null)
  const sourceRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [branches, setBranches] = useState<Branch[]>([])
  const [hovered, setHovered] = useState<string | null>(null)

  /**
   * Drag-to-attach state. `null` while idle. Activated when the user
   * presses on a drag handle in the Unassigned section; the rubber-band
   * path follows the cursor until they drop on the WG hub (assign) or
   * release elsewhere (cancel).
   */
  type DragState = {
    sourceId: string
    /** Anchor point in container-relative coords (drag handle center). */
    anchor: Point
    /** Cursor position in container-relative coords. */
    cursor: Point
    /** True while the cursor is over this WG hub (the only drop target). */
    overHub: boolean
  }
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  useLayoutEffect(() => {
    dragRef.current = drag
  }, [drag])
  const isDragging = drag !== null
  const interactive = !!onAttach

  /**
   * Container-relative center of an element — used to anchor the
   * rubber-band path on the drag handle the user just pressed.
   */
  const containerRelativeCenter = useCallback(
    (el: HTMLElement): Point | null => {
      const c = containerRef.current
      if (!c) return null
      const rb = el.getBoundingClientRect()
      const cb = c.getBoundingClientRect()
      return {
        x: rb.left + rb.width / 2 - cb.left,
        y: rb.top + rb.height / 2 - cb.top,
      }
    },
    [],
  )

  const beginDragFromAnchor = useCallback(
    (sourceId: string, anchor: Point) => {
      if (!interactive) return
      setDrag({ sourceId, anchor, cursor: anchor, overHub: false })
    },
    [interactive],
  )

  const setSourceRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      sourceRefs.current.set(id, el)
    } else {
      sourceRefs.current.delete(id)
    }
  }, [])

  const sourceNodes = useMemo(
    () =>
      sources.map((r) => {
        const vol = parseGb(r.avgDailyGb)
        return {
          id: r.id,
          name: r.displayName?.trim() || 'Source',
          subtitle: [r.sourceTile?.trim(), r.source?.trim()]
            .filter(Boolean)
            .filter((b, i, arr) => arr.findIndex((x) => x.toLowerCase() === b.toLowerCase()) === i)
            .join(' · '),
          volumeGb: Number.isFinite(vol) && vol >= 0 ? vol : 0,
          hasVolume: Number.isFinite(vol) && vol > 0,
          isCompliance: r.complianceRelated,
          criticality: (r.dataCriticality || '').trim(),
        }
      }),
    [sources],
  )

  const measure = useCallback(() => {
    const c = containerRef.current
    const hub = hubRef.current
    if (!c || !hub) {
      return
    }
    const cb = c.getBoundingClientRect()
    const hb = hub.getBoundingClientRect()
    const w = cb.width
    const h = cb.height
    const hubLeft = hb.left - cb.left
    const hubY = hb.top - cb.top + hb.height / 2

    // Tree only makes visual sense when the hub sits to the right of the
    // sources column. On stacked (small-screen) layouts skip the branches.
    const stacked = hubLeft <= 24

    const maxVol = Math.max(
      0.0001,
      ...sourceNodes.map((s) => s.volumeGb),
    )

    const buildBranch = (id: string, el: HTMLElement, weightHint: number): Branch | null => {
      const rb = el.getBoundingClientRect()
      const x1 = rb.right - cb.left
      const y1 = rb.top - cb.top + rb.height / 2
      const x2 = hubLeft
      const y2 = hubY
      if (x2 - x1 < 24) {
        return null
      }
      const dx = Math.max(40, (x2 - x1) * 0.55)
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
      return {
        id,
        d,
        weight: weightHint,
        src: { x: x1, y: y1 },
        dst: { x: x2, y: y2 },
      }
    }

    if (stacked) {
      setBranches([])
      setSize({ w, h })
      return
    }

    const newBranches: Branch[] = []
    for (const s of sourceNodes) {
      const el = sourceRefs.current.get(s.id)
      if (!el) {
        continue
      }
      const weight = s.hasVolume
        ? Math.max(1.5, Math.min(7, (s.volumeGb / maxVol) * 5.5 + 1.6))
        : 1.4
      const br = buildBranch(s.id, el, weight)
      if (br) {
        newBranches.push(br)
      }
    }

    setBranches(newBranches)
    setSize({ w, h })
  }, [sourceNodes])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const ro = new ResizeObserver(() => measure())
    if (containerRef.current) {
      ro.observe(containerRef.current)
    }
    if (hubRef.current) {
      ro.observe(hubRef.current)
    }
    sourceRefs.current.forEach((el) => ro.observe(el))
    const onWindowResize = () => measure()
    window.addEventListener('resize', onWindowResize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onWindowResize)
    }
  }, [measure, sourceNodes])

  /**
   * Window-level pointer listeners that drive the active drag. Attached
   * only while a drag is in flight so non-dragging users don't pay the
   * listener cost. Reads/writes drag state via `dragRef`/`setDrag`, so
   * the closure never goes stale even though `cursor`/`overHub` update
   * on every move.
   */
  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: PointerEvent) => {
      const c = containerRef.current
      if (!c) return
      const cb = c.getBoundingClientRect()
      const cursor = { x: e.clientX - cb.left, y: e.clientY - cb.top }
      let overHub = false
      const hub = hubRef.current
      if (hub) {
        const rb = hub.getBoundingClientRect()
        if (
          e.clientX >= rb.left &&
          e.clientX <= rb.right &&
          e.clientY >= rb.top &&
          e.clientY <= rb.bottom
        ) {
          overHub = true
        }
      }
      setDrag((cur) => (cur ? { ...cur, cursor, overHub } : cur))
    }
    const onUp = () => {
      const cur = dragRef.current
      if (cur && cur.overHub) {
        onAttach?.(cur.sourceId)
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [isDragging, onAttach])

  // Lock the page cursor + suppress text selection during a drag so
  // the gesture feels native to the user's pointer.
  useEffect(() => {
    if (!isDragging) return
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
    }
  }, [isDragging])

  /**
   * Cooldown before the hub box collapses after the last connector
   * leaves the user's pointer. Without this, swiping between two
   * adjacent connectors (which briefly leaves an "in-between" gap
   * with no hovered branch) makes the hub stutter closed/open. With
   * the cooldown the next connector's hover cancels the pending
   * close so the box stays open and just retargets its label.
   */
  const HOVER_CLOSE_COOLDOWN_MS = 220

  /**
   * Delayed mirror of `hovered`. Tracks `hovered` 1:1 while it's
   * non-null, then lingers on its previous value for
   * `HOVER_CLOSE_COOLDOWN_MS` after `hovered` flips to `null`. The
   * hub's "open" state and the source-name reveal both read from
   * `delayedHovered` so a quick swipe between connectors never
   * starts a close transition. Per-branch hover styling continues
   * to use the immediate `hovered` so visual highlighting feels
   * crisp.
   */
  const [delayedHovered, setDelayedHovered] = useState<string | null>(null)
  useEffect(() => {
    if (hovered !== null) {
      if (delayedHovered === hovered) return
      // Defer to a microtask so this stays out of the effect body
      // (avoids the react-hooks/set-state-in-effect lint warning).
      // Microtasks flush before the next paint, so the panel still
      // opens on the same frame the user starts hovering.
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) setDelayedHovered(hovered)
      })
      return () => {
        cancelled = true
      }
    }
    if (delayedHovered === null) return
    const t = setTimeout(() => setDelayedHovered(null), HOVER_CLOSE_COOLDOWN_MS)
    return () => clearTimeout(t)
  }, [hovered, delayedHovered])

  const hubBranchHover = delayedHovered !== null

  /**
   * "Sticky" source name shown inside the hub during a connector / leaf
   * hover. Updates whenever `hovered` resolves to a real source so the
   * panel can fade/slide in with the right name. Crucially, we keep the
   * previous name AS-IS while `hovered === null` so the closing
   * animation collapses the panel without flickering its label to a
   * generic placeholder.
   */
  const [hoveredSourceName, setHoveredSourceName] = useState<string | null>(null)
  useEffect(() => {
    if (!hovered) return
    const name = sourceNodes.find((s) => s.id === hovered)?.name ?? null
    if (name) {
      setHoveredSourceName(name)
    }
  }, [hovered, sourceNodes])

  return (
    <div
      // `card-axiom` ships with `overflow: hidden`, which clips the
      // attach-source dropdown rendered inside the tree. Override via
      // inline style so the popover can escape the card.
      style={{ overflow: 'visible' }}
      className={[
        'card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="m-0 text-xs font-semibold text-cribl-ink">Resource map</p>
          <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">
            Sources branching into <span className="text-cribl-ink/80">{workerGroup.wg.trim() || 'this worker group'}</span>
            . Hover a leaf or its connector to highlight, click the{' '}
            <span
              aria-hidden
              className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-red-500 align-[-1px] text-[8px] font-bold leading-none text-red-500"
            >
              ×
            </span>{' '}
            on a hovered connector to detach.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] tabular-nums text-cribl-muted">
            {sources.length} {sources.length === 1 ? 'source' : 'sources'}
            {totalVolumeGb > 0 ? <> · {formatGbOrTbPerDayStr(totalVolumeGb)}</> : null}
          </span>
          {onAddSource ? (
            <button
              type="button"
              onClick={onAddSource}
              title="Create a new data source"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-cribl-primary/50 bg-cribl-primary px-2.5 text-[11px] font-semibold text-white shadow-ctrl transition hover:bg-cribl-primary-hover"
            >
              <span aria-hidden className="text-[13px] leading-none">＋</span>
              <span>New source</span>
            </button>
          ) : null}
        </div>
      </div>

      <div ref={containerRef} className="relative mt-4">
        <svg
          // The SVG root intentionally does NOT use `pointer-events-none`.
          // Each visible path opts out (`pointerEvents: 'none'`) and each
          // interactive element opts in (`pointerEvents: 'stroke' | 'auto'`).
          // With no fill on the root, empty pixels of the SVG are
          // transparent to hit-testing and pass through to the cards
          // behind, so this doesn't block any existing card interactions.
          className="absolute inset-0"
          width={size.w || 0}
          height={size.h || 0}
          viewBox={`0 0 ${Math.max(1, size.w)} ${Math.max(1, size.h)}`}
          aria-hidden
        >
          <defs>
            <linearGradient id="wg-branch-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={CHART_CRIBL_BLUE} stopOpacity="0.35" />
              <stop offset="100%" stopColor={CHART_CRIBL_BLUE} stopOpacity="0.85" />
            </linearGradient>
          </defs>
          {branches.map((b) => {
            const isHovered = hovered === b.id
            // Wide invisible "hit-stroke" sits on top of each visible
            // curve so users can hover or tap the connector itself, not
            // just the source card or the WG hub.
            const hitWidth = Math.max(20, b.weight + 18)
            // X badge hugs the source's right edge — the curve's source-
            // side tangent is horizontal, so a small x-offset off `b.src`
            // keeps the badge centered on the connector line without
            // drifting toward the WG hub.
            const detachX = b.src.x + 14
            const detachY = b.src.y
            return (
              <g
                key={b.id}
                onPointerEnter={() => setHovered(b.id)}
                onPointerLeave={() =>
                  setHovered((cur) => (cur === b.id ? null : cur))
                }
              >
                <path
                  d={b.d}
                  fill="none"
                  stroke={isHovered ? CHART_CRIBL_BLUE : 'url(#wg-branch-gradient)'}
                  strokeWidth={isHovered ? b.weight + 1.4 : b.weight}
                  strokeLinecap="round"
                  opacity={isHovered ? 1 : hovered ? 0.35 : 0.85}
                  // Source → worker-group draw animation, standard SVG
                  // dash-offset technique:
                  //   - `pathLength={1}` normalizes the curve to a
                  //     unit length so dash math is path-relative
                  //     regardless of the actual rendered length.
                  //   - `strokeDasharray={1}` (which the spec expands
                  //     to `"1 1"` — one full-length dash, one full-
                  //     length gap) gives us a "drawn" half and a
                  //     "blank" half exactly the size of the curve.
                  //   - `strokeDashoffset` slides from 1 (gap on top
                  //     of the path → invisible) to 0 (dash on top
                  //     of the path → fully drawn), revealing the
                  //     line from its start (source endpoint) to its
                  //     end (WG hub).
                  //
                  // Earlier versions used `"1 0"` (zero gap) which
                  // some browsers treat as solid regardless of offset,
                  // so the animation didn't play and adjacent paths
                  // could blink out from the rendering quirk.
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={animEnabled && !entryAnimated ? 1 : 0}
                  style={{
                    pointerEvents: 'none',
                    transition: animEnabled
                      ? 'stroke-dashoffset 800ms cubic-bezier(0.22, 1, 0.36, 1), opacity 120ms ease, stroke-width 120ms ease'
                      : 'opacity 120ms ease, stroke-width 120ms ease',
                  }}
                />
                <path
                  d={b.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={hitWidth}
                  strokeLinecap="round"
                  style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                />
                {isHovered ? (
                  <g
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onUnassign(b.id)
                    }}
                  >
                    <circle
                      cx={detachX}
                      cy={detachY}
                      r={9}
                      fill="#ffffff"
                      stroke="#ef4444"
                      strokeWidth={1.6}
                      style={{ pointerEvents: 'auto' }}
                    >
                      <title>Unassign source from this worker group</title>
                    </circle>
                    <path
                      d={`M ${detachX - 3.2} ${detachY - 3.2} L ${detachX + 3.2} ${detachY + 3.2} M ${detachX - 3.2} ${detachY + 3.2} L ${detachX + 3.2} ${detachY - 3.2}`}
                      stroke="#ef4444"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      style={{ pointerEvents: 'none' }}
                    />
                  </g>
                ) : null}
              </g>
            )
          })}
        </svg>

        {/*
         * Drag overlay SVG: rendered ABOVE every card in the resource
         * map (z-30, vs the cards' z-10). Sits at the same `inset-0` as
         * the main SVG and shares its `viewBox` so the same container-
         * relative coordinates produce the same pixel positions. The
         * overlay carries `pointerEvents: 'none'` so cards underneath
         * keep getting their own clicks while the rubber-band tracks
         * the cursor on top of them.
         */}
        {drag ? (
          <svg
            className="pointer-events-none absolute inset-0 z-30"
            width={size.w || 0}
            height={size.h || 0}
            viewBox={`0 0 ${Math.max(1, size.w)} ${Math.max(1, size.h)}`}
            aria-hidden
          >
            <path
              d={(() => {
                const { x: x1, y: y1 } = drag.anchor
                const { x: x2, y: y2 } = drag.cursor
                const dx = Math.max(40, Math.abs(x2 - x1) * 0.55)
                return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
              })()}
              fill="none"
              stroke={CHART_CRIBL_BLUE}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray="6 6"
              opacity={0.95}
            />
            <circle
              cx={drag.cursor.x}
              cy={drag.cursor.y}
              r={5.5}
              fill="#ffffff"
              stroke={CHART_CRIBL_BLUE}
              strokeWidth={2}
            />
          </svg>
        ) : null}

        <div className="grid items-center gap-x-8 gap-y-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,260px)]">

        <div className="relative z-10 mr-auto flex w-full min-w-0 max-w-[360px] flex-col gap-2">
          {sourceNodes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-cribl-border bg-cribl-card-body p-4 text-center text-sm text-cribl-muted">
              No sources are attached to this worker group yet — use the attach control below
              to add your first source.
            </div>
          ) : (
            sourceNodes.map((s) => {
              const isHovered = hovered === s.id
              const volStr = s.hasVolume ? formatGbOrTbPerDayStr(s.volumeGb) : '—'
              const critTone =
                /^high$/i.test(s.criticality)
                  ? 'bg-rose-50 text-rose-700 border-rose-100'
                  : /^medium$/i.test(s.criticality)
                  ? 'bg-amber-50 text-amber-700 border-amber-100'
                  : /^low$/i.test(s.criticality)
                  ? 'bg-cribl-primary-soft text-cribl-primary-ink border-cribl-primary/30'
                  : ''
              return (
                <div
                  key={s.id}
                  ref={(el) => setSourceRef(s.id, el)}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenSource(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpenSource(s.id)
                    }
                  }}
                  onMouseEnter={() => setHovered(s.id)}
                  onMouseLeave={() => setHovered((cur) => (cur === s.id ? null : cur))}
                  onFocus={() => setHovered(s.id)}
                  onBlur={() => setHovered((cur) => (cur === s.id ? null : cur))}
                  title="Open source detail"
                  aria-label={`Open ${s.name}`}
                  className={[
                    // The whole widget is the click target now (no
                    // separate "Open" pill below the title), matching
                    // how the Plan resource map presents source rows.
                    // We keep `role="button"` on a <div> rather than
                    // using <button> because the connector-X badge
                    // and (in the unassigned section) drag-handle are
                    // real <button>s; nested <button>s would be
                    // invalid HTML.
                    'card-axiom relative flex min-w-0 cursor-pointer items-center gap-3 border-cribl-border/80 bg-white px-3 py-2.5 text-left shadow-ctrl transition focus-visible:ring-2 focus-visible:ring-cribl-primary/50 focus-visible:outline-none',
                    isHovered
                      ? 'ring-2 ring-cribl-primary/40 border-cribl-primary/60'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span
                    aria-hidden
                    className={[
                      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition',
                      isHovered
                        ? 'bg-cribl-primary text-white'
                        : 'bg-cribl-primary-soft text-cribl-primary-ink',
                    ].join(' ')}
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path d="M10 2.5c-3.59 0-6.5 2.91-6.5 6.5 0 4.5 6.5 8.5 6.5 8.5s6.5-4 6.5-8.5c0-3.59-2.91-6.5-6.5-6.5Zm0 9a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" />
                    </svg>
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                    <span className="block max-w-full truncate text-sm font-semibold text-cribl-ink">
                      {s.name}
                    </span>
                    {s.subtitle ? (
                      <span className="block max-w-full truncate text-[11px] text-cribl-muted">
                        {s.subtitle}
                      </span>
                    ) : null}
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="rounded-md bg-cribl-card-body px-2 py-0.5 tabular-nums text-cribl-ink/80">
                        {volStr}
                      </span>
                      {s.criticality && critTone ? (
                        <span className={`rounded-md border px-2 py-0.5 ${critTone}`}>
                          {s.criticality}
                        </span>
                      ) : null}
                      {s.isCompliance ? (
                        <span className="rounded-md border border-cribl-primary/30 bg-cribl-primary-soft px-2 py-0.5 text-cribl-primary-ink">
                          Compliance
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="relative z-10 flex min-w-0 justify-start sm:justify-end">
          {/*
           * Wrapper exists purely so we can hang the "drop here" dot
           * absolutely on the left edge of the hub card. The hub
           * itself uses `card-axiom` (which sets `overflow: hidden`),
           * so the dot can't live inside it without being clipped.
           */}
          <div className="relative">
            {drag ? (
              <span
                aria-hidden
                className={[
                  'pointer-events-none absolute left-0 top-1/2 z-20',
                  '-translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150 ease-out',
                  drag.overHub
                    ? 'h-4 w-4 bg-cribl-primary ring-4 ring-cribl-primary/35'
                    : 'h-3 w-3 bg-cribl-primary/70 ring-4 ring-cribl-primary/15',
                ].join(' ')}
                title="Drop here to attach"
              />
            ) : null}
          <div
            ref={hubRef}
            className={[
              'card-axiom flex min-w-0 max-w-full flex-col gap-2 border-cribl-primary/40 bg-cribl-primary-soft p-4 shadow-ctrl transition',
              // Active drop target — cursor is currently over the hub
              // during a drag from the Unassigned section.
              drag && drag.overHub
                ? 'ring-4 ring-cribl-primary/70 ring-offset-2 ring-offset-white scale-[1.015]'
                : drag
                ? 'ring-2 ring-cribl-primary/30'
                : hubBranchHover
                ? 'ring-2 ring-cribl-primary/40'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cribl-primary text-white shadow-ctrl"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v2A1.5 1.5 0 0 1 15.5 8h-11A1.5 1.5 0 0 1 3 6.5v-2Zm0 5A1.5 1.5 0 0 1 4.5 8h11A1.5 1.5 0 0 1 17 9.5v2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 11.5v-2Zm0 5A1.5 1.5 0 0 1 4.5 13h11a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-2Z" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-primary-ink">
                  Worker group
                </p>
                <p className="m-0 max-w-full truncate text-base font-semibold text-cribl-ink">
                  {workerGroup.wg.trim() || 'Untitled'}
                </p>
              </div>
            </div>
            <ul className="m-0 flex flex-col gap-1 list-none p-0 text-[11px] text-cribl-muted">
              <li>
                <span className="text-cribl-ink/80 tabular-nums">{sources.length}</span>{' '}
                {sources.length === 1 ? 'source attached' : 'sources attached'}
              </li>
              <li>
                Total{' '}
                <span className="text-cribl-ink/80 tabular-nums">
                  {formatGbOrTbPerDayStr(totalVolumeGb)}
                </span>
              </li>
              {workerGroup.workerCount?.trim() ? (
                <li>
                  <span className="text-cribl-ink/80 tabular-nums">
                    {workerGroup.workerCount.trim()}
                  </span>{' '}
                  {Number(workerGroup.workerCount.trim()) === 1 ? 'worker' : 'workers'}
                  {workerGroup.workerHosting?.trim() ? (
                    <> · {workerGroup.workerHosting.trim()}</>
                  ) : null}
                </li>
              ) : workerGroup.workerHosting?.trim() ? (
                <li>{workerGroup.workerHosting.trim()}</li>
              ) : null}
            </ul>
            {/*
             * Always-mounted source-name reveal. Animating
             * `max-height` + `opacity` + `margin-top` means the hub
             * box smoothly grows / shrinks instead of jumping when the
             * user moves between connectors. `aria-hidden` keeps
             * screen readers quiet while the panel is collapsed.
             */}
            <div
              aria-hidden={!delayedHovered}
              className="overflow-hidden"
              style={{
                maxHeight: delayedHovered ? 32 : 0,
                opacity: delayedHovered ? 1 : 0,
                marginTop: delayedHovered ? 8 : 0,
                transitionProperty: 'max-height, opacity, margin-top',
                transitionDuration: '220ms',
                transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <p className="m-0 truncate rounded-md bg-white/70 px-2 py-1 text-[11px] text-cribl-primary-ink">
                ↦ {hoveredSourceName ?? 'Source'}
              </p>
            </div>
          </div>
          </div>
        </div>
        </div>

        {unassignedSources.length > 0 ? (
          <UnassignedSection
            sources={unassignedSources}
            interactive={interactive}
            isDragging={isDragging}
            draggedSourceId={drag?.sourceId ?? null}
            workerGroupName={workerGroup.wg.trim() || 'this worker group'}
            onOpenSource={onOpenSource}
            onBeginDrag={(sourceId, anchorEl) => {
              const anchor = containerRelativeCenter(anchorEl)
              if (!anchor) return
              beginDragFromAnchor(sourceId, anchor)
            }}
          />
        ) : null}
      </div>

      <p className="m-0 mt-4 text-[11px] text-cribl-muted">
        Branch thickness scales with each source’s daily volume. Tree only renders on wider
        screens; on narrow viewports the cards stack vertically.
      </p>
    </div>
  )
}

/**
 * "Unassigned sources" panel rendered below the tree in the single-WG
 * resource map. Each card sports a drag handle on its right edge —
 * pressing it kicks off a rubber-band drag, dropping on the WG hub
 * above attaches the source to this worker group.
 */
type UnassignedSectionProps = {
  sources: SourceSummaryRow[]
  interactive: boolean
  isDragging: boolean
  draggedSourceId: string | null
  workerGroupName: string
  onOpenSource: (id: string) => void
  onBeginDrag: (sourceId: string, anchorEl: HTMLElement) => void
}

function UnassignedSection({
  sources,
  interactive,
  isDragging,
  draggedSourceId,
  workerGroupName,
  onOpenSource,
  onBeginDrag,
}: UnassignedSectionProps) {
  /**
   * Free-text filter applied across name, source tile, source kind, and
   * worker-group columns so customers can quickly locate a single source
   * inside large unassigned lists. Match is case-insensitive substring.
   */
  const [query, setQuery] = useState('')
  const trimmed = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!trimmed) return sources
    return sources.filter((r) => {
      const haystack = [
        r.displayName,
        r.sourceTile,
        r.source,
        r.avgDailyGb,
      ]
        .map((v) => (v ?? '').toString().toLowerCase())
        .join(' ')
      return haystack.includes(trimmed)
    })
  }, [sources, trimmed])
  return (
    <div
      className={[
        'relative z-10 mt-6 rounded-2xl border-2 border-dashed px-4 py-4 transition',
        isDragging
          ? 'border-cribl-primary/40 bg-cribl-card-body/70'
          : 'border-cribl-border/80 bg-cribl-card-body/60',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-cribl-muted">
            Unassigned sources
          </p>
          <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">
            {interactive
              ? `Drag the dot on the right edge of any source onto ${workerGroupName} above to attach it.`
              : 'Sources without a worker group yet.'}
          </p>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-cribl-muted">
          {trimmed ? `${filtered.length} of ${sources.length}` : sources.length}{' '}
          {sources.length === 1 ? 'source' : 'sources'}
        </span>
      </div>
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search unassigned sources…"
        ariaLabel="Filter unassigned sources"
        size="sm"
        className="mt-3"
      />
      {filtered.length === 0 ? (
        <p className="m-0 mt-3 rounded-lg border border-dashed border-cribl-border/70 bg-white/60 px-3 py-4 text-center text-[12px] text-cribl-muted">
          No unassigned sources match “{query}”.
        </p>
      ) : (
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {filtered.map((r) => {
          const vol = parseGb(r.avgDailyGb)
          const hasVol = Number.isFinite(vol) && vol > 0
          const name = r.displayName?.trim() || 'Source'
          const subtitle = [r.sourceTile?.trim(), r.source?.trim()]
            .filter(Boolean)
            .filter(
              (b, i, arr) =>
                arr.findIndex((x) => x.toLowerCase() === b.toLowerCase()) === i,
            )
            .join(' · ')
          const volStr = hasVol ? formatGbOrTbPerDayStr(vol) : '—'
          const isDragSubject = draggedSourceId === r.id
          return (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenSource(r.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpenSource(r.id)
                }
              }}
              title="Open source detail"
              aria-label={`Open ${name}`}
              className={[
                // Whole-card click target. The drag handle on the
                // right is a real <button> with stopPropagation so a
                // press-and-drag never falls through to "open".
                'relative flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border bg-white px-2.5 py-2 pr-9 text-left shadow-ctrl transition hover:border-cribl-primary/60 hover:ring-2 hover:ring-cribl-primary/30 focus-visible:border-cribl-primary/60 focus-visible:ring-2 focus-visible:ring-cribl-primary/40 focus-visible:outline-none',
                isDragSubject
                  ? 'border-cribl-primary opacity-50'
                  : 'border-cribl-border/80',
              ].join(' ')}
            >
              <div className="flex min-w-0 flex-1 flex-col items-start gap-0">
                <span className="block max-w-full truncate text-[13px] font-semibold text-cribl-ink">
                  {name}
                </span>
                {subtitle ? (
                  <span className="block max-w-full truncate text-[11px] text-cribl-muted">
                    {subtitle}
                  </span>
                ) : null}
              </div>
              <span className="shrink-0 rounded-md bg-cribl-card-body px-1.5 py-0.5 text-[11px] tabular-nums text-cribl-ink/80">
                {volStr}
              </span>
              {interactive ? (
                <button
                  type="button"
                  aria-label={`Drag onto ${workerGroupName} to attach this source`}
                  title={`Drag onto ${workerGroupName} to attach`}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.preventDefault()
                    e.stopPropagation()
                    onBeginDrag(r.id, e.currentTarget)
                  }}
                  className={[
                    'absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border bg-white shadow-ctrl transition',
                    isDragSubject
                      ? 'border-cribl-primary'
                      : 'border-cribl-primary/50 hover:border-cribl-primary hover:bg-cribl-primary-soft',
                  ].join(' ')}
                  style={{
                    cursor: isDragSubject ? 'grabbing' : 'grab',
                    touchAction: 'none',
                  }}
                >
                  <span
                    aria-hidden
                    className="block h-2.5 w-2.5 rounded-full bg-cribl-primary"
                  />
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}
