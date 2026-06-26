import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  sourceLabel,
  type PlanState,
  type SourceSummaryRow,
  type WorkerGroupKind,
  type WorkerGroupRow,
} from '../types/planTypes'
import { formatGbOrTbPerDayStr, parseGb } from '../lib/formatRate'
import { CHART_CRIBL_BLUE, CHART_CRIBL_EDGE_BLUE } from '../lib/chartColors'
import { getOnboardingStatus } from '../lib/onboardingStatus'
import { useEntryAnimation } from '../lib/animationsPreference'
import { SearchInput } from './SearchInput'
import { edgeFleetUnassignedOrphans } from '../lib/fleetHierarchy'
import { isSourceRowAttachmentDisabled } from '../lib/sourceAttachmentDisabled'

const UNASSIGNED_ID = '__unassigned__'
/**
 * Run `measure()` every animation frame for this long whenever a group is
 * toggled. Pads the CSS transition slightly so the SVG branches finish
 * tracking the layout after the cards settle.
 */
const ANIMATION_TRACK_MS = 360
const TRANSITION_DURATION_MS = 320

type Props = {
  plan: PlanState
  onOpenSource: (id: string) => void
  onOpenWorkerGroup: (id: string) => void
  /**
   * Optional. When provided, the connector branches become interactive:
   * users can drag a source's branch onto a different worker group to
   * reassign it (or onto the "Unassigned" bucket to detach), and click an
   * X overlay on a hovered branch to detach in place. Pass `null` for the
   * worker group to mean "unassigned".
   */
  onReassignSource?: (sourceId: string, newWorkerGroupId: string | null) => void
  /**
   * Optional. When provided, surface a "+ New source" action button in
   * the resource map header. Wires up to the same global "New data
   * source" dialog the left-nav "+ Add source" button opens, so the
   * source-creation flow is identical no matter where it's started.
   */
  onAddSource?: () => void
  /**
   * Optional. When provided, surface "+ New worker group" / "+ New fleet"
   * action buttons in the resource map header. Wires up to the same
   * global "New worker group" dialog the left-nav "+ Add" buttons open,
   * with `kind` plumbed through so each shortcut spawns the matching
   * resource (Stream WG vs Edge fleet). Calling without an argument
   * preserves the legacy single-button behavior (defaults to Stream).
   */
  onAddWorkerGroup?: (kind?: WorkerGroupKind) => void
  className?: string
}

type SourceLeaf = {
  id: string
  name: string
  subtitle: string
  volumeGb: number
  hasVolume: boolean
  status: 'complete' | 'current' | 'planned'
  /**
   * Trimmed `dataCriticality` value (e.g. "High" / "Medium" / "Low").
   * Empty string when unset. Drives the colored criticality badge on
   * each source row, mirroring the worker-group resource map.
   */
  criticality: string
  /** True when `complianceRelated` is set on the source row. */
  isCompliance: boolean
  /** False when the source cannot be drag-assigned (Leader-disabled / suffix). */
  allowReassignDrag: boolean
}

type WgGroup = {
  /** Stable id used for refs / branch keys. WG id, or `__unassigned__`. */
  id: string
  /** Worker group row when present, `null` for the synthetic "Unassigned" bucket. */
  wg: WorkerGroupRow | null
  name: string
  sources: SourceLeaf[]
  totalGb: number
  /** Edge parent fleets only: nested sub-fleets rendered in the same grid row. */
  subFleets?: WgGroup[]
}

function findOwningGroup(groups: WgGroup[], needle: string | null): WgGroup | null {
  if (!needle) return null
  for (const g of groups) {
    if (g.id === needle) return g
    if (g.sources.some((s) => s.id === needle)) return g
    for (const sf of g.subFleets ?? []) {
      if (sf.id === needle) return sf
      if (sf.sources.some((s) => s.id === needle)) return sf
    }
  }
  return null
}

function eachGroupDepthFirst(groups: WgGroup[], fn: (g: WgGroup) => void) {
  for (const g of groups) {
    fn(g)
    for (const sf of g.subFleets ?? []) {
      fn(sf)
    }
  }
}

type Point = { x: number; y: number }

/**
 * Drag-to-(re)assign state shared between the connector hit-strokes and
 * the per-source drag handles in the Unassigned section. `null` when no
 * drag is in flight.
 */
type DragState = {
  sourceId: string
  /**
   * The drag's origin: a worker-group id when reassigning an attached
   * source, or `UNASSIGNED_ID` when starting from a loose source's drag
   * handle in the Unassigned section.
   */
  originGroupId: string
  /** Source-side endpoint where the rubber-band stays anchored. */
  anchor: Point
  /** Cursor position in container-relative coordinates. */
  cursor: Point
  /** Worker-group id the cursor is currently over (or null). */
  overWgId: string | null
  /**
   * `true` when the cursor is currently inside the Unassigned drop
   * zone. Lets users drag an attached source onto the Unassigned
   * section to detach it (a complement to the click-X affordance).
   */
  overUnassignedZone: boolean
}

type Branch =
  | {
      kind: 'source'
      id: string
      groupId: string
      d: string
      weight: number
      /** Source-side endpoint of the cubic curve, in container coords. */
      src: Point
      /** Worker-group-side endpoint of the cubic curve, in container coords. */
      dst: Point
    }
  | {
      kind: 'summary'
      id: string
      groupId: string
      d: string
      weight: number
      src: Point
      dst: Point
    }

function buildSourceLeaf(row: SourceSummaryRow, index: number): SourceLeaf {
  const vol = parseGb(row.avgDailyGb)
  // v0.9.1 dropped Display name; the Source field is the row's identity.
  // The subtitle no longer dedupes name vs source — they're the same now.
  const subtitleBits = [row.sourceTile?.trim()].filter(Boolean) as string[]
  return {
    id: row.id,
    name: sourceLabel(row, index),
    subtitle: subtitleBits.join(' · '),
    volumeGb: Number.isFinite(vol) && vol >= 0 ? vol : 0,
    hasVolume: Number.isFinite(vol) && vol > 0,
    status: getOnboardingStatus(row),
    criticality: (row.dataCriticality || '').trim(),
    isCompliance: !!row.complianceRelated,
    allowReassignDrag: !isSourceRowAttachmentDisabled(row),
  }
}

/** Resource maps hide Leader-disabled / attachment-disabled rows unless toggled on. */
function sourceVisibleInResourceMap(row: SourceSummaryRow, showDisabled: boolean): boolean {
  return showDisabled || !isSourceRowAttachmentDisabled(row)
}

/**
 * Tailwind classes for the colored criticality badge. Mirrors the
 * worker-group resource map so the same source looks consistent in
 * both places. Returns `''` when the criticality value isn't a
 * recognized tier (in which case the caller should not render the
 * badge at all).
 */
function critToneClass(criticality: string): string {
  if (/^high$/i.test(criticality)) {
    return 'bg-rose-50 text-rose-700 border-rose-100'
  }
  if (/^medium$/i.test(criticality)) {
    return 'bg-amber-50 text-amber-700 border-amber-100'
  }
  if (/^low$/i.test(criticality)) {
    return 'bg-cribl-primary-soft text-cribl-primary-ink border-cribl-primary/30'
  }
  return ''
}

/**
 * Small colored dot used on each source row in the resource map (and
 * mirrored in the left-nav source list) to signal which side of the
 * topology the source lives on:
 *
 *   - `'stream'` → cribl-primary teal
 *   - `'edge'`   → cribl-edge sky-blue
 *   - `null`     → muted grey ("not yet attached")
 *
 * Matches the `KindDot` exported privately from `PlanSidebar.tsx`. Kept
 * as a local helper to avoid leaking a one-off styling primitive into
 * the broader UI library.
 */
function KindDot({
  kind,
  className = '',
}: {
  kind: 'stream' | 'edge' | null
  className?: string
}) {
  const tone =
    kind === 'edge'
      ? 'bg-cribl-edge'
      : kind === 'stream'
      ? 'bg-cribl-primary'
      : 'bg-cribl-muted/60'
  return (
    <span
      aria-hidden
      className={['inline-block h-2 w-2 rounded-full', tone, className]
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

/**
 * Plan-wide tree map: every Worker Group plus its attached Sources flow into
 * a single "Plan" trunk on the right. WG rows expand on demand so the plan
 * stays readable when there are dozens of sources.
 */
export function PlanResourceMap({
  plan,
  onOpenSource,
  onOpenWorkerGroup,
  onReassignSource,
  onAddSource,
  onAddWorkerGroup,
  className,
}: Props) {
  /**
   * Drives the one-shot "draw from source to worker group" entry
   * animation. Each connector path uses `pathLength={1}` plus
   * `strokeDasharray="1 0"` so the curve is a single unit-length
   * dash; `strokeDashoffset` slides from 1 → 0 to reveal the line
   * from its start (the source) to its end (the WG hub).
   *
   * `pathsDrawn` flips to `true` once the draw transition has had
   * time to finish. We need it to gracefully restore the dashed
   * `5 5` style on the *summary* branches without trampling the
   * draw effect — during the animation every branch is a solid
   * draw; after the animation summary branches switch back to the
   * dashed pattern.
   */
  const { animated: entryAnimated, enabled: animEnabled } = useEntryAnimation()
  const [pathsDrawn, setPathsDrawn] = useState<boolean>(() => !animEnabled)
  /** Hide Leader-disabled / attachment-disabled sources unless the user opts in. */
  const [showDisabledInResourceMap, setShowDisabledInResourceMap] = useState(false)
  useEffect(() => {
    if (!animEnabled) {
      // Pref turned off mid-life: settle to the post-draw state via
      // a microtask so this isn't a sync setState in the effect body.
      const t = setTimeout(() => setPathsDrawn(true), 0)
      return () => clearTimeout(t)
    }
    if (!entryAnimated) return
    // Schedule the post-draw state slightly after the 800ms
    // transition completes so summary branches don't pop into
    // dashes mid-draw.
    const t = setTimeout(() => setPathsDrawn(true), 850)
    return () => clearTimeout(t)
  }, [animEnabled, entryAnimated])
  /**
   * Real worker groups (with their attached sources) drive the tree
   * visualization. Unassigned sources are split out into a separate
   * `unassignedSources` list and rendered in their own dedicated section
   * — they never branch into a synthetic "Unassigned" WG card; the user
   * starts a connection from each source's drag handle instead.
   */
  const { groups, unassignedSources, unassignedFleets } = useMemo<{
    groups: WgGroup[]
    unassignedSources: SourceLeaf[]
    unassignedFleets: WorkerGroupRow[]
  }>(() => {
    const indexById = new Map(plan.sourceSummary.map((r, i) => [r.id, i]))

    const buildWgGroup = (wg: WorkerGroupRow): WgGroup => {
      const sources = plan.sourceSummary
        .filter(
          (r) =>
            r.workerGroupId === wg.id &&
            sourceVisibleInResourceMap(r, showDisabledInResourceMap),
        )
        .map((r) => buildSourceLeaf(r, indexById.get(r.id) ?? 0))
        .sort((a, b) => b.volumeGb - a.volumeGb)
      const totalGb = sources.reduce((acc, s) => acc + s.volumeGb, 0)
      const fallback = wg.kind === 'edge' ? 'Untitled fleet' : 'Untitled worker group'
      const base: WgGroup = {
        id: wg.id,
        wg,
        name: wg.wg.trim() || fallback,
        sources,
        totalGb,
      }
      if (wg.kind !== 'edge') {
        return base
      }
      const childRows = plan.workerGroups.filter(
        (c) => c.kind === 'edge' && (c.parentFleetId ?? '').trim() === wg.id,
      )
      if (childRows.length === 0) {
        return base
      }
      return {
        ...base,
        subFleets: childRows.map((c) => buildWgGroup(c)),
      }
    }

    const columnWgs = plan.workerGroups.filter(
      (wg) => wg.kind === 'stream' || (wg.kind === 'edge' && !(wg.parentFleetId ?? '').trim()),
    )

    const groups: WgGroup[] = columnWgs.map((wg) => buildWgGroup(wg))

    const unassignedSources = plan.sourceSummary
      .filter((r) => !r.workerGroupId && sourceVisibleInResourceMap(r, showDisabledInResourceMap))
      .map((r) => buildSourceLeaf(r, indexById.get(r.id) ?? 0))
      .sort((a, b) => b.volumeGb - a.volumeGb)

    const unassignedFleets = edgeFleetUnassignedOrphans(plan.workerGroups, plan.sourceSummary)

    return { groups, unassignedSources, unassignedFleets }
  }, [plan.workerGroups, plan.sourceSummary, showDisabledInResourceMap])

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [hovered, setHovered] = useState<string | null>(null)

  const disabledSourceCountInPlan = useMemo(
    () => plan.sourceSummary.filter(isSourceRowAttachmentDisabled).length,
    [plan.sourceSummary],
  )

  /**
   * Drag-to-reassign state. While a source branch (or unassigned drag
   * handle) is being dragged we suppress hover-driven branch highlights,
   * render a rubber-band path tracking the cursor, and outline the
   * worker-group card the cursor is currently over so the drop target
   * is unambiguous. `DragState` is hoisted to module scope so the
   * Unassigned section can also read it.
   */
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  useLayoutEffect(() => {
    dragRef.current = drag
  }, [drag])

  const interactive = !!onReassignSource

  const attachmentDisabledSourceIds = useMemo(
    () => new Set(plan.sourceSummary.filter(isSourceRowAttachmentDisabled).map((r) => r.id)),
    [plan.sourceSummary],
  )

  const containerRef = useRef<HTMLDivElement>(null)
  // These maps hold any element we measure with `getBoundingClientRect`, so
  // we widen to `HTMLElement` — the summary chip is a `<button>`, the WG and
  // source cards are `<div>`s.
  const wgRefs = useRef<Map<string, HTMLElement>>(new Map())
  const summaryRefs = useRef<Map<string, HTMLElement>>(new Map())
  const sourceRefs = useRef<Map<string, HTMLElement>>(new Map())
  /**
   * Bounding box of the Unassigned section (when present). Used as a
   * drop target during drag so users can detach an attached source by
   * dragging it onto the section, mirroring the click-X affordance.
   */
  const unassignedDropRef = useRef<HTMLDivElement | null>(null)
  const animationRafRef = useRef<number | null>(null)
  const animationStartRef = useRef<number>(0)

  const [paths, setPaths] = useState<Branch[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })

  // Ref setters defined as `useCallback`s that only touch `.current` when
  // React invokes them (element attach / detach), never during render. This
  // satisfies the `react-hooks/refs` rule.
  const setWgRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      wgRefs.current.set(id, el)
    } else {
      wgRefs.current.delete(id)
    }
  }, [])
  const setSummaryRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      summaryRefs.current.set(id, el)
    } else {
      summaryRefs.current.delete(id)
    }
  }, [])
  const setSourceRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      sourceRefs.current.set(id, el)
    } else {
      sourceRefs.current.delete(id)
    }
  }, [])

  const totalSources = useMemo(() => {
    let n = 0
    eachGroupDepthFirst(groups, (g) => {
      n += g.sources.length
    })
    return n
  }, [groups])
  const totalGb = useMemo(() => {
    let t = 0
    eachGroupDepthFirst(groups, (g) => {
      t += g.totalGb
    })
    return t
  }, [groups])
  const maxSourceVolGb = useMemo(() => {
    let m = 0
    eachGroupDepthFirst(groups, (g) => {
      for (const s of g.sources) {
        if (s.volumeGb > m) m = s.volumeGb
      }
    })
    return Math.max(0.0001, m)
  }, [groups])
  const maxGroupVolGb = useMemo(() => {
    let m = 0.0001
    eachGroupDepthFirst(groups, (g) => {
      m = Math.max(m, g.totalGb)
    })
    return Math.max(0.0001, m)
  }, [groups])

  /**
   * O(1) lookup from `groupId` → WG kind so the SVG render loop can
   * pick the right connector color (Stream teal vs. Edge sky-blue) per
   * branch without re-finding the WG row each frame.
   */
  const groupKindById = useMemo(() => {
    const m = new Map<string, 'stream' | 'edge'>()
    eachGroupDepthFirst(groups, (g) => {
      if (g.wg) {
        m.set(g.id, g.wg.kind)
      }
    })
    return m
  }, [groups])

  const measure = useCallback(() => {
    const c = containerRef.current
    if (!c) return

    const cb = c.getBoundingClientRect()
    const w = cb.width
    const h = cb.height

    // Stacked / narrow layout — when the grid collapses to a single column
    // every WG card sits flush against the container's left edge. Skip path
    // drawing in that case so we don't render lines that don't make sense.
    const firstWgEl = groups.length > 0 ? wgRefs.current.get(groups[0].id) : null
    if (firstWgEl) {
      const firstLeft = firstWgEl.getBoundingClientRect().left - cb.left
      if (firstLeft <= 24) {
        setPaths([])
        setSize({ w, h })
        return
      }
    }

    const newPaths: Branch[] = []

    const measureOne = (g: WgGroup) => {
      const wgEl = wgRefs.current.get(g.id)
      if (!wgEl) return
      const wb = wgEl.getBoundingClientRect()
      const wgLeftX = wb.left - cb.left
      const wgY = wb.top - cb.top + wb.height / 2

      // Source-side branches: either a single summary chip when collapsed,
      // or one per source when expanded.
      const isExpanded = expanded.has(g.id)
      if (g.sources.length === 0) {
        // Nothing to draw on the source side for empty groups.
      } else if (!isExpanded) {
        const summaryEl = summaryRefs.current.get(g.id)
        if (summaryEl) {
          const sb = summaryEl.getBoundingClientRect()
          const x1 = sb.right - cb.left
          const y1 = sb.top - cb.top + sb.height / 2
          const x2 = wgLeftX
          const y2 = wgY
          if (x2 - x1 >= 24) {
            const dx = Math.max(40, (x2 - x1) * 0.55)
            const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
            const weight =
              g.totalGb > 0
                ? Math.max(1.8, Math.min(6, (g.totalGb / maxGroupVolGb) * 4.5 + 2))
                : 1.8
            newPaths.push({
              kind: 'summary',
              id: g.id,
              groupId: g.id,
              d,
              weight,
              src: { x: x1, y: y1 },
              dst: { x: x2, y: y2 },
            })
          }
        }
      } else {
        for (const s of g.sources) {
          const el = sourceRefs.current.get(s.id)
          if (!el) continue
          const sb = el.getBoundingClientRect()
          const x1 = sb.right - cb.left
          const y1 = sb.top - cb.top + sb.height / 2
          const x2 = wgLeftX
          const y2 = wgY
          if (x2 - x1 < 24) continue
          const dx = Math.max(40, (x2 - x1) * 0.55)
          const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
          const weight = s.hasVolume
            ? Math.max(1.6, Math.min(6, (s.volumeGb / maxSourceVolGb) * 4.5 + 1.4))
            : 1.6
          newPaths.push({
            kind: 'source',
            id: s.id,
            groupId: g.id,
            d,
            weight,
            src: { x: x1, y: y1 },
            dst: { x: x2, y: y2 },
          })
        }
      }
    }

    for (const g of groups) {
      measureOne(g)
      for (const sf of g.subFleets ?? []) {
        measureOne(sf)
      }
    }

    setPaths(newPaths)
    setSize({ w, h })
  }, [groups, expanded, maxGroupVolGb, maxSourceVolGb])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  /**
   * `measure` closes over `expanded` (and other deps), so any callback that
   * captured it earlier — most importantly the RAF tick scheduled inside
   * `toggleGroup` — would otherwise see the *previous* `expanded` set and
   * keep computing collapsed-style summary branches even after the user
   * just expanded a group. Routing through a ref means the RAF loop and
   * the ResizeObserver always invoke the latest closure.
   */
  const measureRef = useRef(measure)
  useLayoutEffect(() => {
    measureRef.current = measure
  }, [measure])

  useEffect(() => {
    // Re-subscribed whenever the set of observed elements can change
    // (new groups, expand/collapse adding source rows, etc.). The
    // observer always reads through `measureRef` so it never invokes
    // a stale `measure` closure.
    const ro = new ResizeObserver(() => measureRef.current())
    if (containerRef.current) ro.observe(containerRef.current)
    wgRefs.current.forEach((el) => ro.observe(el))
    summaryRefs.current.forEach((el) => ro.observe(el))
    sourceRefs.current.forEach((el) => ro.observe(el))
    const onResize = () => measureRef.current()
    window.addEventListener('resize', onResize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [groups, expanded])

  useEffect(() => {
    return () => {
      if (animationRafRef.current !== null) {
        cancelAnimationFrame(animationRafRef.current)
        animationRafRef.current = null
      }
    }
  }, [])

  const beginAnimationLoop = useCallback(() => {
    // Drives `measure()` once per frame for the duration of the CSS
    // transition so the SVG branches stay glued to the moving cards.
    // Reads through `measureRef` so each tick uses the *latest* closure
    // (which sees the freshly-toggled `expanded` set) instead of a stale
    // one captured at click time.
    animationStartRef.current = performance.now()
    if (animationRafRef.current !== null) {
      cancelAnimationFrame(animationRafRef.current)
    }
    const tick = () => {
      measureRef.current()
      const elapsed = performance.now() - animationStartRef.current
      if (elapsed < ANIMATION_TRACK_MS) {
        animationRafRef.current = requestAnimationFrame(tick)
      } else {
        animationRafRef.current = null
      }
    }
    animationRafRef.current = requestAnimationFrame(tick)
  }, [])

  const toggleGroup = useCallback(
    (id: string) => {
      setExpanded((cur) => {
        const next = new Set(cur)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return next
      })
      beginAnimationLoop()
    },
    [beginAnimationLoop],
  )

  const expandAll = useCallback(() => {
    const ids: string[] = []
    eachGroupDepthFirst(groups, (g) => {
      if (g.sources.length > 0) {
        ids.push(g.id)
      }
    })
    setExpanded(new Set(ids))
    beginAnimationLoop()
  }, [groups, beginAnimationLoop])

  const collapseAll = useCallback(() => {
    setExpanded(new Set())
    beginAnimationLoop()
  }, [beginAnimationLoop])

  /**
   * Generic "begin a drag" — used both by the connector hit-stroke and
   * by the per-source drag handle in the Unassigned section. The caller
   * supplies the anchor point in container-relative coordinates so the
   * rubber-band can spring from wherever the user grabbed.
   */
  const beginDragFromAnchor = useCallback(
    (sourceId: string, originGroupId: string, anchor: Point) => {
      if (!interactive) return
      if (attachmentDisabledSourceIds.has(sourceId)) return
      setDrag({
        sourceId,
        originGroupId,
        anchor,
        cursor: anchor,
        overWgId: null,
        overUnassignedZone: false,
      })
    },
    [interactive, attachmentDisabledSourceIds],
  )

  const beginDrag = useCallback(
    (branch: Branch) => {
      if (!interactive || branch.kind !== 'source') return
      if (attachmentDisabledSourceIds.has(branch.id)) return
      beginDragFromAnchor(branch.id, branch.groupId, branch.src)
    },
    [interactive, attachmentDisabledSourceIds, beginDragFromAnchor],
  )

  /**
   * Computes a container-relative anchor point for a drag-handle press
   * (or any other element) by intersecting its bounding rect with the
   * containerRef. Returns `null` when the container isn't measured yet.
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

  /**
   * Window-level pointer listeners that drive the active drag. Attached
   * only while a drag is in flight (`isDragging`) so non-dragging users
   * don't pay the listener cost. The closure reads/writes the drag state
   * via `dragRef`/`setDrag` so it never goes stale even when state
   * updates shift `drag.cursor`/`drag.overWgId` every move.
   */
  const isDragging = drag !== null
  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: PointerEvent) => {
      const c = containerRef.current
      if (!c) return
      const cb = c.getBoundingClientRect()
      const cursor = { x: e.clientX - cb.left, y: e.clientY - cb.top }
      let overWgId: string | null = null
      wgRefs.current.forEach((el, id) => {
        const rb = el.getBoundingClientRect()
        if (
          e.clientX >= rb.left &&
          e.clientX <= rb.right &&
          e.clientY >= rb.top &&
          e.clientY <= rb.bottom
        ) {
          overWgId = id
        }
      })
      let overUnassignedZone = false
      const uz = unassignedDropRef.current
      if (uz) {
        const rb = uz.getBoundingClientRect()
        if (
          e.clientX >= rb.left &&
          e.clientX <= rb.right &&
          e.clientY >= rb.top &&
          e.clientY <= rb.bottom
        ) {
          overUnassignedZone = true
        }
      }
      setDrag((cur) =>
        cur ? { ...cur, cursor, overWgId, overUnassignedZone } : cur,
      )
    }
    const onUp = () => {
      const cur = dragRef.current
      if (cur) {
        const overWg = cur.overWgId
        // Priority 1: dropped over a worker-group card → assign the source
        // to it (no-op when it's already the source's group).
        if (overWg && overWg !== cur.originGroupId) {
          onReassignSource?.(cur.sourceId, overWg)
          setExpanded((prev) => {
            if (prev.has(overWg)) return prev
            const next = new Set(prev)
            next.add(overWg)
            return next
          })
          beginAnimationLoop()
        }
        // Priority 2: dropped on the Unassigned section while the source
        // currently belongs to a worker group → detach it. Mirrors the
        // click-X affordance for users who prefer drag gestures.
        else if (
          cur.overUnassignedZone &&
          cur.originGroupId !== UNASSIGNED_ID
        ) {
          onReassignSource?.(cur.sourceId, null)
          beginAnimationLoop()
        }
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
  }, [isDragging, onReassignSource, beginAnimationLoop])

  // Lock the page cursor + suppress text selection for the duration of
  // a drag so the experience feels native to the user's pointer.
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
   * Resolve which group, if any, the currently hovered element belongs to.
   * Returns the group id whether the hovered element is the WG card itself
   * or one of its source leaves. Used by the highlight + dim-fade logic so
   * hovering a single leaf lights up its sibling branches instead of dimming
   * them (which previously made the tree look like it was glitching out).
   */
  const hoveredGroupId = useMemo(() => {
    if (!hovered) return null
    const owning = findOwningGroup(groups, hovered)
    return owning?.id ?? null
  }, [hovered, groups])

  /**
   * Cooldown before the WG-card "↦ source" panel collapses after the
   * last connector / leaf leaves the user's pointer. Without this,
   * swiping the cursor between two adjacent sources (which always
   * passes through a tiny "no-hover" gap) makes the panel stutter
   * closed and re-open.
   */
  const HOVER_CLOSE_COOLDOWN_MS = 220

  /**
   * Delayed mirror of `hovered`. Mirrors `hovered` 1:1 while it's
   * non-null, then lingers on its previous value for
   * `HOVER_CLOSE_COOLDOWN_MS` after `hovered` flips to `null`. The
   * per-WG-card "↦ source" reveal reads from `delayedHovered` (and
   * its derived group id) so quick connector swaps never trigger
   * a close. The connector tree itself keeps reading from the
   * immediate `hovered` so highlight / dim transitions stay crisp.
   */
  const [delayedHovered, setDelayedHovered] = useState<string | null>(null)
  useEffect(() => {
    if (hovered !== null) {
      if (delayedHovered === hovered) return
      // Microtask defer keeps this out of the effect body (lint
      // rule react-hooks/set-state-in-effect) but still flushes
      // before the next paint, so opening still feels instant.
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

  /**
   * Group-id derived from `delayedHovered`. Drives the per-WG-card
   * panel's open state so the panel keeps its shape during the
   * cooldown window.
   */
  const delayedHoveredGroupId = useMemo(() => {
    if (!delayedHovered) return null
    const owning = findOwningGroup(groups, delayedHovered)
    return owning?.id ?? null
  }, [delayedHovered, groups])

  /**
   * Per-group sticky source name. Surfaces an animated "↦ {source}"
   * strip inside each WG card while one of its source connectors is
   * being hovered. Keyed by group id so each WG card animates closed
   * with its OWN previous label still visible (no flicker to a stale
   * neighbor's source). Updates only when `hovered` resolves to a real
   * source row, so the closing animation has a stable name to render.
   */
  const [stickySourceByGroup, setStickySourceByGroup] = useState<
    Record<string, string>
  >({})
  useEffect(() => {
    if (!hovered) return
    const owning = findOwningGroup(groups, hovered)
    if (!owning) return
    if (owning.id === hovered) return
    const src = owning.sources.find((s) => s.id === hovered)
    if (!src) return
    setStickySourceByGroup((prev) =>
      prev[owning.id] === src.name ? prev : { ...prev, [owning.id]: src.name },
    )
  }, [hovered, groups])

  const isHighlighted = useCallback(
    (branch: Branch): boolean => {
      if (!hovered) return false
      // A hovered branch / element lights up every source + summary branch
      // in the same group, so a single leaf hover surfaces the full group's
      // tree (matching how a WG-card hover already behaved).
      if (hoveredGroupId && branch.groupId === hoveredGroupId) return true
      return false
    },
    [hovered, hoveredGroupId],
  )

  if (groups.length === 0 && unassignedSources.length === 0 && unassignedFleets.length === 0) {
    return (
      <div
        className={[
          'card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 text-sm font-semibold text-cribl-ink">Resource map</p>
          <div className="flex flex-wrap items-center gap-2">
            {onAddWorkerGroup ? (
              <button
                type="button"
                onClick={() => onAddWorkerGroup('stream')}
                title="Create a new worker group"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-cribl-primary/60 bg-white px-2.5 text-[11px] font-semibold text-cribl-primary-ink shadow-ctrl transition hover:border-cribl-primary hover:bg-cribl-primary-soft"
              >
                <span aria-hidden className="text-[13px] leading-none">＋</span>
                <span>New worker group</span>
              </button>
            ) : null}
            {onAddWorkerGroup ? (
              <button
                type="button"
                onClick={() => onAddWorkerGroup('edge')}
                title="Create a new fleet"
                className="inline-flex h-7 items-center gap-1 rounded-md border border-cribl-edge/60 bg-white px-2.5 text-[11px] font-semibold text-cribl-edge-ink shadow-ctrl transition hover:border-cribl-edge hover:bg-cribl-edge-soft"
              >
                <span aria-hidden className="text-[13px] leading-none">＋</span>
                <span>New fleet</span>
              </button>
            ) : null}
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
        <p className="m-0 mt-2 rounded-lg border border-dashed border-cribl-border/80 bg-cribl-card-body p-4 text-sm text-cribl-muted">
          Add a worker group or fleet and a source to see the plan-wide topology branch out here.
        </p>
      </div>
    )
  }

  return (
    <div
      // Allow the SVG and any future popovers to escape the rounded-card mask.
      style={{ overflow: 'visible' }}
      className={[
        'card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="m-0 text-sm font-semibold text-cribl-ink">Resource map</p>
          <p className="m-0 mt-0.5 text-xs text-cribl-muted">
            Sources branch into the worker groups and fleets they feed. Click a row to expand its sources.
            {interactive ? (
              <>
                {' '}
                <span className="text-cribl-ink/80">
                  Drag a connector onto a different worker group or fleet to reassign, or click the{' '}
                  <span
                    aria-hidden
                    className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-red-500 align-[-2px] text-[9px] font-bold leading-none text-red-500"
                  >
                    ×
                  </span>{' '}
                  on a hovered connector to detach. Unassigned sources have a{' '}
                  <span
                    aria-hidden
                    className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-cribl-primary/60 bg-white align-[-1px]"
                  >
                    <span className="block h-1.5 w-1.5 rounded-full bg-cribl-primary" />
                  </span>{' '}
                  handle on their right edge — drag it to a worker group or fleet to assign.
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] tabular-nums text-cribl-muted">
          <span>
            {(() => {
              const nWg = groups.filter((g) => g.wg?.kind !== 'edge').length
              const nFleet = groups.filter((g) => g.wg?.kind === 'edge').length
              const wgLabel = `${nWg} ${nWg === 1 ? 'worker group' : 'worker groups'}`
              const fleetLabel = `${nFleet} ${nFleet === 1 ? 'fleet' : 'fleets'}`
              const groupSummary =
                nWg > 0 && nFleet > 0
                  ? `${wgLabel} · ${fleetLabel}`
                  : nFleet > 0
                  ? fleetLabel
                  : wgLabel
              return (
                <>
                  {groupSummary} · {totalSources}{' '}
                  {totalSources === 1 ? 'source' : 'sources'} · {formatGbOrTbPerDayStr(totalGb)}
                </>
              )
            })()}
          </span>
          <button
            type="button"
            onClick={expandAll}
            className="h-7 rounded-md border border-cribl-border bg-white px-2 text-[11px] font-medium text-cribl-muted hover:border-cribl-primary/40 hover:text-cribl-primary-ink"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="h-7 rounded-md border border-cribl-border bg-white px-2 text-[11px] font-medium text-cribl-muted hover:border-cribl-primary/40 hover:text-cribl-primary-ink"
          >
            Collapse all
          </button>
          {disabledSourceCountInPlan > 0 ? (
            <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-cribl-border bg-white px-2 text-[11px] text-cribl-ink/90">
              <input
                type="checkbox"
                className="size-3.5 rounded border-cribl-border text-cribl-primary"
                checked={showDisabledInResourceMap}
                onChange={(e) => setShowDisabledInResourceMap(e.target.checked)}
              />
              <span>Show disabled</span>
              {!showDisabledInResourceMap ? (
                <span className="text-cribl-muted">({disabledSourceCountInPlan} hidden)</span>
              ) : null}
            </label>
          ) : null}
          {onAddWorkerGroup ? (
            <button
              type="button"
              onClick={() => onAddWorkerGroup('stream')}
              title="Create a new worker group"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-cribl-primary/60 bg-white px-2.5 text-[11px] font-semibold text-cribl-primary-ink shadow-ctrl transition hover:border-cribl-primary hover:bg-cribl-primary-soft"
            >
              <span aria-hidden className="text-[13px] leading-none">＋</span>
              <span>New worker group</span>
            </button>
          ) : null}
          {onAddWorkerGroup ? (
            <button
              type="button"
              onClick={() => onAddWorkerGroup('edge')}
              title="Create a new fleet"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-cribl-edge/60 bg-white px-2.5 text-[11px] font-semibold text-cribl-edge-ink shadow-ctrl transition hover:border-cribl-edge hover:bg-cribl-edge-soft"
            >
              <span aria-hidden className="text-[13px] leading-none">＋</span>
              <span>New fleet</span>
            </button>
          ) : null}
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
          // Note: the SVG root intentionally does NOT use
          // `pointer-events-none`. Instead each visible path opts out
          // (`pointerEvents: 'none'`) and each interactive element opts
          // in (`pointerEvents: 'stroke' | 'auto'`). With no fill on the
          // root, empty pixels of the SVG are transparent to hit-testing
          // and pass through to the cards behind, so this doesn't block
          // any existing card interactions.
          //
          // The SVG spans the *entire* container (grid + Unassigned
          // section) so the rubber-band path during a drag-from-handle
          // can extend down into the Unassigned area without clipping.
          className="absolute inset-0"
          width={size.w || 0}
          height={size.h || 0}
          viewBox={`0 0 ${Math.max(1, size.w)} ${Math.max(1, size.h)}`}
          aria-hidden
        >
          {/*
           * Flat-colored connectors. The previous gradient (0.35 →
           * 0.85 along the path) was almost invisible at the source
           * end for thin / no-volume branches — especially once the
           * branch was also "faded by other group" — which made
           * connectors for sources without reported GB/d look
           * missing entirely. A solid color + explicit `opacity`
           * makes the line thickness and dasharray the only
           * visibility levers, so even an unmeasured source still
           * shows a clear thin dash to its WG/fleet.
           */}
          {paths.map((b) => {
            const lit = isHighlighted(b)
            // Only fade out branches that belong to a *different* group than
            // the one currently being hovered. Branches in the same group as
            // the hovered element stay at the default visibility so an
            // expanded group's full tree never appears to vanish on hover.
            const fadedByOtherGroup =
              hoveredGroupId !== null && b.groupId !== hoveredGroupId
            // Branch color follows the destination WG/Fleet so Stream and
            // Edge are visually distinct end-to-end: connectors ending at
            // an Edge fleet wear the lighter sky-blue Edge accent, while
            // Stream connectors keep the brand teal. Solid color (no
            // gradient) — the gradient's 0.35-opacity left edge used to
            // make thin no-volume connectors disappear when another
            // group was hovered.
            const isEdgeBranch = groupKindById.get(b.groupId) === 'edge'
            const stroke = isEdgeBranch ? CHART_CRIBL_EDGE_BLUE : CHART_CRIBL_BLUE
            const isSummaryBranch = b.kind === 'summary'
            // While the draw animation is running every branch uses
            // the standard SVG dash-offset draw-on technique:
            // `pathLength=1` + `strokeDasharray="1 1"` (one full-
            // length dash, one full-length gap) + animated
            // `strokeDashoffset` slides 1 → 0 to reveal the curve
            // source → WG. Once the draw completes summary branches
            // restore their `5 5` dashed style.
            const inDrawPhase = animEnabled && !pathsDrawn
            const dash = inDrawPhase
              ? '1 1'
              : isSummaryBranch
              ? '5 5'
              : undefined
            const isInteractiveSource =
              interactive &&
              b.kind === 'source' &&
              !attachmentDisabledSourceIds.has(b.id)
            const branchHovered =
              b.kind === 'source' && (hovered === b.id || delayedHovered === b.id)
            // The X badge appears whenever the user is "looking at" this
            // exact source branch — leaf card, connector, or detach hit zone.
            // `delayedHovered` keeps the X visible briefly when the pointer
            // leaves the card toward the badge (see HOVER_CLOSE_COOLDOWN_MS).
            const showDetachX =
              interactive && b.kind === 'source' && branchHovered && !isDragging
            // X badge sits flush against the source's right edge — the
            // curve's source-side tangent is horizontal, so a small
            // x-offset off `b.src` keeps it centered on the connector
            // line without drifting toward the worker group. This makes
            // "click here to detach *this* source" unambiguous.
            const detachX = b.src.x + 14
            const detachY = b.src.y
            // Hide the original branch while dragging it — the rubber-band
            // takes over as the visual.
            const beingDragged =
              isDragging && drag?.sourceId === b.id && b.kind === 'source'
            // Wide invisible "hit-stroke" on top of the visible curve,
            // so the user has a generous target to hover or grab the
            // connector even when the visible stroke is thin.
            const hitWidth = Math.max(20, b.weight + 18)
            return (
              <g
                key={`${b.kind}:${b.id}`}
                onPointerEnter={() => {
                  if (isDragging) return
                  if (b.kind === 'source') setHovered(b.id)
                  else setHovered(b.groupId)
                }}
                onPointerLeave={() => {
                  if (isDragging) return
                  const target = b.kind === 'source' ? b.id : b.groupId
                  setHovered((cur) => (cur === target ? null : cur))
                }}
              >
                <path
                  d={b.d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={lit ? b.weight + 1.4 : b.weight}
                  // `pathLength=1` is only set during the draw phase
                  // so summary branches' `5 5` dashes go back to
                  // user-space units afterwards.
                  pathLength={inDrawPhase ? 1 : undefined}
                  strokeDasharray={dash}
                  strokeDashoffset={animEnabled && !entryAnimated ? 1 : 0}
                  strokeLinecap="round"
                  opacity={beingDragged ? 0 : lit ? 1 : fadedByOtherGroup ? 0.55 : 0.85}
                  style={{
                    pointerEvents: 'none',
                    transition: animEnabled
                      ? 'stroke-dashoffset 800ms cubic-bezier(0.22, 1, 0.36, 1), opacity 120ms ease, stroke-width 120ms ease'
                      : 'opacity 120ms ease, stroke-width 120ms ease',
                  }}
                />
                {isInteractiveSource ? (
                  <path
                    d={b.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={hitWidth}
                    strokeLinecap="round"
                    style={{
                      pointerEvents: 'stroke',
                      cursor: isDragging ? 'grabbing' : 'grab',
                    }}
                    onPointerDown={(e) => {
                      // Left-button only; let middle/right-click do their
                      // default things (e.g., open in new tab on links).
                      if (e.button !== 0) return
                      e.preventDefault()
                      e.stopPropagation()
                      beginDrag(b)
                    }}
                  />
                ) : interactive && b.kind === 'source' ? (
                  <path
                    d={b.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={hitWidth}
                    strokeLinecap="round"
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  />
                ) : null}
                {interactive && b.kind === 'source' ? (
                  <circle
                    cx={detachX}
                    cy={detachY}
                    r={14}
                    fill="transparent"
                    style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                    aria-hidden
                  />
                ) : null}
                {showDetachX ? (
                  <g
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onReassignSource?.(b.id, null)
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
                      <title>Unassign source from worker group / fleet</title>
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
        {drag ? (() => {
          // Rubber-band tints to the *destination* WG/Fleet's color so
          // the user gets a clear "you're about to drop on a Fleet"
          // signal mid-drag. Falls back to the brand teal when the
          // cursor isn't currently over a target.
          const overKind = drag.overWgId ? groupKindById.get(drag.overWgId) : undefined
          const dragColor = overKind === 'edge' ? CHART_CRIBL_EDGE_BLUE : CHART_CRIBL_BLUE
          return (
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
                stroke={dragColor}
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
                stroke={dragColor}
                strokeWidth={2}
              />
            </svg>
          )
        })() : null}

        <div className="grid items-center gap-x-10 gap-y-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
        {groups.map((g, i) => {
          const isExpanded = expanded.has(g.id)
          // `isUnassigned` no longer fires here because the synthetic
          // "Unassigned" group has been split out into its own section,
          // but the variable is still referenced below for shared card
          // styling — leave it computed for now (it's always `false`).
          const isUnassigned = g.id === UNASSIGNED_ID
          const isWgHovered = hovered === g.id
          // Drop-target visuals during an active drag. A WG card becomes
          // the active drop target whenever the cursor is currently over
          // it AND it isn't the source's origin group. Other (non-origin)
          // WG cards get a softer "candidate" outline so the user knows
          // where they can drop.
          const isDropTarget =
            !!drag &&
            drag.overWgId === g.id &&
            drag.originGroupId !== g.id
          const isDropCandidate =
            !!drag && drag.originGroupId !== g.id && drag.overWgId !== g.id
          // Edge fleets get a lighter sky-blue tone so customers can
          // visually tell Stream WGs and Edge fleets apart at a glance
          // in the resource map. Stream stays on the strong cribl-primary
          // teal (the brand default).
          const isEdgeKind = g.wg?.kind === 'edge'
          return (
            <Fragment key={g.id}>
              <div
                className="relative z-10 mr-auto flex w-full min-w-0 max-w-[360px] flex-col"
                style={{ gridColumn: 1, gridRow: i + 1 }}
              >
                {g.sources.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-cribl-border/80 bg-cribl-card-body px-3 py-2 text-[11px] text-cribl-muted">
                    No sources attached yet.
                  </div>
                ) : (
                  <>
                    {/*
                     * Single chip that morphs between "expand" and "collapse"
                     * states via just a chevron rotation. Keeps the chip in
                     * the DOM at all times so:
                     *   1. The summary→WG branch can keep using `summaryRef`
                     *      while the source list animates open/closed.
                     *   2. There is no element swap (mount/unmount) flicker.
                     */}
                    <button
                      type="button"
                      ref={(el) => setSummaryRef(g.id, el)}
                      onClick={() => toggleGroup(g.id)}
                      onMouseEnter={() => {
                        if (isDragging) return
                        setHovered(g.id)
                      }}
                      onMouseLeave={() => {
                        if (isDragging) return
                        setHovered((cur) => (cur === g.id ? null : cur))
                      }}
                      onFocus={() => {
                        if (isDragging) return
                        setHovered(g.id)
                      }}
                      onBlur={() => {
                        if (isDragging) return
                        setHovered((cur) => (cur === g.id ? null : cur))
                      }}
                      className={[
                        'group flex min-w-0 items-center gap-3 rounded-xl border bg-white px-3 py-2.5 text-left shadow-ctrl transition',
                        isWgHovered
                          ? isEdgeKind
                            ? 'border-cribl-edge/60 ring-2 ring-cribl-edge/30 -translate-y-0.5'
                            : 'border-cribl-primary/60 ring-2 ring-cribl-primary/30 -translate-y-0.5'
                          : isExpanded
                          ? isEdgeKind
                            ? 'border-cribl-edge/30'
                            : 'border-cribl-primary/30'
                          : isEdgeKind
                          ? 'border-cribl-border/80 hover:border-cribl-edge/40'
                          : 'border-cribl-border/80 hover:border-cribl-primary/40',
                      ].join(' ')}
                      aria-expanded={isExpanded}
                      title={isExpanded ? 'Collapse sources' : 'Expand sources'}
                    >
                      <span
                        aria-hidden
                        className={[
                          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition',
                          isWgHovered || isExpanded
                            ? isEdgeKind
                              ? 'bg-cribl-edge text-white'
                              : 'bg-cribl-primary text-white'
                            : isEdgeKind
                            ? 'bg-cribl-edge-soft text-cribl-edge-ink'
                            : 'bg-cribl-primary-soft text-cribl-primary-ink',
                        ].join(' ')}
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path d="M3.5 5h13a.75.75 0 0 1 0 1.5h-13a.75.75 0 0 1 0-1.5Zm0 4h13a.75.75 0 0 1 0 1.5h-13a.75.75 0 0 1 0-1.5Zm0 4h13a.75.75 0 0 1 0 1.5h-13a.75.75 0 0 1 0-1.5Z" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-cribl-ink">
                          {g.sources.length} {g.sources.length === 1 ? 'source' : 'sources'}
                        </span>
                        <span className="block truncate text-[11px] text-cribl-muted">
                          {g.totalGb > 0 ? formatGbOrTbPerDayStr(g.totalGb) : 'No volume yet'}
                          {' · '}
                          {isExpanded ? 'click to collapse' : 'expand to view'}
                        </span>
                      </span>
                      <ChevronCue open={isExpanded} />
                    </button>

                    {/*
                     * The source list panel is always mounted; we animate
                     * `max-height`, `opacity`, and `margin-top` between the
                     * collapsed (0) and expanded (full) states. The RAF loop
                     * inside `toggleGroup` redraws SVG branches every frame
                     * for ~360 ms after each toggle so the leaves' branches
                     * feel glued to the moving cards.
                     */}
                    {/*
                     * Indent the expanded source leaves under the summary
                     * chip via a left margin (`ml-6` = 24px). The expansion
                     * itself uses the modern `grid-template-rows: 0fr → 1fr`
                     * pattern: the CSS engine animates between the actual
                     * content's intrinsic height and zero, so opens / closes
                     * feel proportional regardless of how many sources are
                     * in the group (instead of the old `max-height: 4000px`
                     * cap, which made the curve effectively non-linear for
                     * small groups and caused a noticeable delay before the
                     * collapse animation visibly started).
                     *
                     * Required structure for the trick to work cleanly:
                     *   1. Outer div is a single-row grid; we transition
                     *      `grid-template-rows`, `opacity`, and `margin-top`.
                     *   2. The intermediate `min-h-0 overflow-hidden` div
                     *      lets the grid track shrink below its content's
                     *      natural size and clips overflow during the
                     *      transition.
                     *   3. Inner `flex flex-col gap-2` carries the leaf
                     *      list and owns the inter-row gap (`gap-2`).
                     *
                     * SVG branches read positions through
                     * `getBoundingClientRect`, so the per-frame `measure()`
                     * loop in `beginAnimationLoop()` keeps connectors glued
                     * to the moving cards throughout the transition.
                     */}
                    <div
                      aria-hidden={!isExpanded}
                      className="ml-6 grid"
                      style={{
                        gridTemplateRows: isExpanded ? '1fr' : '0fr',
                        opacity: isExpanded ? 1 : 0,
                        marginTop: isExpanded ? 8 : 0,
                        pointerEvents: isExpanded ? undefined : 'none',
                        transitionProperty:
                          'grid-template-rows, opacity, margin-top',
                        transitionDuration: `${TRANSITION_DURATION_MS}ms`,
                        transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                      }}
                    >
                      <div className="min-h-0 overflow-hidden">
                        <div className="flex flex-col gap-2">
                      {g.sources.map((s) => {
                        const isHovered = hovered === s.id
                        const volStr = s.hasVolume
                          ? formatGbOrTbPerDayStr(s.volumeGb)
                          : '—'
                        return (
                          <div
                            key={s.id}
                            ref={(el) => setSourceRef(s.id, el)}
                            role="button"
                            tabIndex={isExpanded ? 0 : -1}
                            onClick={() => onOpenSource(s.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                onOpenSource(s.id)
                              }
                            }}
                            onMouseEnter={() => {
                              if (isDragging) return
                              setHovered(s.id)
                            }}
                            onMouseLeave={() => {
                              if (isDragging) return
                              setHovered((cur) => (cur === s.id ? null : cur))
                            }}
                            onFocus={() => {
                              if (isDragging) return
                              setHovered(s.id)
                            }}
                            onBlur={() => {
                              if (isDragging) return
                              setHovered((cur) => (cur === s.id ? null : cur))
                            }}
                            title="Open source detail"
                            aria-label={`Open ${s.name}`}
                            className={[
                              // Whole-card click target (matches the
                              // unassigned section + the worker-group
                              // resource map). The connector × badge
                              // is rendered as a real <button> in the
                              // SVG layer, so we don't have a button
                              // nested inside this <div role="button">.
                              'flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border bg-white px-2.5 py-2 text-left shadow-ctrl transition focus-visible:ring-2 focus-visible:ring-cribl-primary/40 focus-visible:outline-none',
                              isHovered
                                ? 'border-cribl-primary/60 ring-2 ring-cribl-primary/30'
                                : 'border-cribl-border/80',
                            ].join(' ')}
                          >
                            <KindDot
                              kind={isEdgeKind ? 'edge' : 'stream'}
                              className="shrink-0"
                            />
                            <div className="flex min-w-0 flex-1 flex-col items-start gap-0">
                              <span className="block max-w-full truncate text-[13px] font-semibold text-cribl-ink">
                                {s.name}
                              </span>
                              {s.subtitle ? (
                                <span className="block max-w-full truncate text-[11px] text-cribl-muted">
                                  {s.subtitle}
                                </span>
                              ) : null}
                              {/*
                               * Criticality + compliance badges, matching the
                               * worker-group resource map. Renders only when
                               * the underlying source row has values, so the
                               * card height stays compact for the common case.
                               */}
                              {(s.criticality && critToneClass(s.criticality)) || s.isCompliance ? (
                                <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                                  {s.criticality && critToneClass(s.criticality) ? (
                                    <span className={`rounded-md border px-1.5 py-0.5 ${critToneClass(s.criticality)}`}>
                                      {s.criticality}
                                    </span>
                                  ) : null}
                                  {s.isCompliance ? (
                                    <span className="rounded-md border border-cribl-primary/30 bg-cribl-primary-soft px-1.5 py-0.5 text-cribl-primary-ink">
                                      Compliance
                                    </span>
                                  ) : null}
                                </span>
                              ) : null}
                            </div>
                            <span className="shrink-0 rounded-md bg-cribl-card-body px-1.5 py-0.5 text-[11px] tabular-nums text-cribl-ink/80">
                              {volStr}
                            </span>
                          </div>
                        )
                      })}
                        </div>
                      </div>
                    </div>
                  </>
                )}
                {(g.subFleets ?? []).map((sf) => {
                  const sfExpanded = expanded.has(sf.id)
                  const sfWgHovered = hovered === sf.id
                  return (
                    <div key={sf.id} className="mt-4 border-l-2 border-cribl-edge/40 pl-3">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-cribl-edge-ink">
                        Sub-fleet · {sf.name}
                      </p>
                      {sf.sources.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-cribl-border/80 bg-cribl-card-body px-3 py-2 text-[11px] text-cribl-muted">
                          No sources attached yet.
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            ref={(el) => setSummaryRef(sf.id, el)}
                            onClick={() => toggleGroup(sf.id)}
                            onMouseEnter={() => {
                              if (isDragging) return
                              setHovered(sf.id)
                            }}
                            onMouseLeave={() => {
                              if (isDragging) return
                              setHovered((cur) => (cur === sf.id ? null : cur))
                            }}
                            onFocus={() => {
                              if (isDragging) return
                              setHovered(sf.id)
                            }}
                            onBlur={() => {
                              if (isDragging) return
                              setHovered((cur) => (cur === sf.id ? null : cur))
                            }}
                            className={[
                              'group flex min-w-0 items-center gap-3 rounded-xl border bg-white px-3 py-2.5 text-left shadow-ctrl transition',
                              sfWgHovered
                                ? 'border-cribl-edge/60 ring-2 ring-cribl-edge/30 -translate-y-0.5'
                                : sfExpanded
                                ? 'border-cribl-edge/30'
                                : 'border-cribl-border/80 hover:border-cribl-edge/40',
                            ].join(' ')}
                            aria-expanded={sfExpanded}
                            title={sfExpanded ? 'Collapse sources' : 'Expand sources'}
                          >
                            <span
                              aria-hidden
                              className={[
                                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition',
                                sfWgHovered || sfExpanded
                                  ? 'bg-cribl-edge text-white'
                                  : 'bg-cribl-edge-soft text-cribl-edge-ink',
                              ].join(' ')}
                            >
                              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                                <path d="M3.5 5h13a.75.75 0 0 1 0 1.5h-13a.75.75 0 0 1 0-1.5Zm0 4h13a.75.75 0 0 1 0 1.5h-13a.75.75 0 0 1 0-1.5Zm0 4h13a.75.75 0 0 1 0 1.5h-13a.75.75 0 0 1 0-1.5Z" />
                              </svg>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-cribl-ink">
                                {sf.sources.length} {sf.sources.length === 1 ? 'source' : 'sources'}
                              </span>
                              <span className="block truncate text-[11px] text-cribl-muted">
                                {sf.totalGb > 0 ? formatGbOrTbPerDayStr(sf.totalGb) : 'No volume yet'}
                                {' · '}
                                {sfExpanded ? 'click to collapse' : 'expand to view'}
                              </span>
                            </span>
                            <ChevronCue open={sfExpanded} />
                          </button>
                          <div
                            aria-hidden={!sfExpanded}
                            className="ml-6 grid"
                            style={{
                              gridTemplateRows: sfExpanded ? '1fr' : '0fr',
                              opacity: sfExpanded ? 1 : 0,
                              marginTop: sfExpanded ? 8 : 0,
                              pointerEvents: sfExpanded ? undefined : 'none',
                              transitionProperty: 'grid-template-rows, opacity, margin-top',
                              transitionDuration: `${TRANSITION_DURATION_MS}ms`,
                              transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                            }}
                          >
                            <div className="min-h-0 overflow-hidden">
                              <div className="flex flex-col gap-2">
                                {sf.sources.map((s) => {
                                  const isHovered = hovered === s.id
                                  const volStr = s.hasVolume
                                    ? formatGbOrTbPerDayStr(s.volumeGb)
                                    : '—'
                                  return (
                                    <div
                                      key={s.id}
                                      ref={(el) => setSourceRef(s.id, el)}
                                      role="button"
                                      tabIndex={sfExpanded ? 0 : -1}
                                      onClick={() => onOpenSource(s.id)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault()
                                          onOpenSource(s.id)
                                        }
                                      }}
                                      onMouseEnter={() => {
                                        if (isDragging) return
                                        setHovered(s.id)
                                      }}
                                      onMouseLeave={() => {
                                        if (isDragging) return
                                        setHovered((cur) => (cur === s.id ? null : cur))
                                      }}
                                      onFocus={() => {
                                        if (isDragging) return
                                        setHovered(s.id)
                                      }}
                                      onBlur={() => {
                                        if (isDragging) return
                                        setHovered((cur) => (cur === s.id ? null : cur))
                                      }}
                                      title="Open source detail"
                                      aria-label={`Open ${s.name}`}
                                      className={[
                                        'flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border bg-white px-2.5 py-2 text-left shadow-ctrl transition focus-visible:ring-2 focus-visible:ring-cribl-primary/40 focus-visible:outline-none',
                                        isHovered
                                          ? 'border-cribl-primary/60 ring-2 ring-cribl-primary/30'
                                          : 'border-cribl-border/80',
                                      ].join(' ')}
                                    >
                                      <KindDot kind="edge" className="shrink-0" />
                                      <div className="flex min-w-0 flex-1 flex-col items-start gap-0">
                                        <span className="block max-w-full truncate text-[13px] font-semibold text-cribl-ink">
                                          {s.name}
                                        </span>
                                        {s.subtitle ? (
                                          <span className="block max-w-full truncate text-[11px] text-cribl-muted">
                                            {s.subtitle}
                                          </span>
                                        ) : null}
                                        {(s.criticality && critToneClass(s.criticality)) || s.isCompliance ? (
                                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                                            {s.criticality && critToneClass(s.criticality) ? (
                                              <span
                                                className={`rounded-md border px-1.5 py-0.5 ${critToneClass(s.criticality)}`}
                                              >
                                                {s.criticality}
                                              </span>
                                            ) : null}
                                            {s.isCompliance ? (
                                              <span className="rounded-md border border-cribl-primary/30 bg-cribl-primary-soft px-1.5 py-0.5 text-cribl-primary-ink">
                                                Compliance
                                              </span>
                                            ) : null}
                                          </span>
                                        ) : null}
                                      </div>
                                      <span className="shrink-0 rounded-md bg-cribl-card-body px-1.5 py-0.5 text-[11px] tabular-nums text-cribl-ink/80">
                                        {volStr}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>

              <div
                className="relative z-10 flex min-w-0 flex-col gap-3"
                style={{ gridColumn: 2, gridRow: i + 1 }}
              >
              <div
                ref={(el) => setWgRef(g.id, el)}
                {...(!isUnassigned && g.wg
                  ? {
                      role: 'button' as const,
                      tabIndex: 0,
                      onClick: () => onOpenWorkerGroup(g.id),
                      onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onOpenWorkerGroup(g.id)
                        }
                      },
                      title: `Open ${g.name}`,
                      'aria-label': `Open ${g.name}`,
                    }
                  : {})}
                onMouseEnter={() => {
                  // Don't shuffle the highlight while dragging — the drag
                  // effect tracks `overWgId` itself and the visible state
                  // shouldn't fight that.
                  if (isDragging) return
                  setHovered(g.id)
                }}
                onMouseLeave={() => {
                  if (isDragging) return
                  setHovered((cur) => (cur === g.id ? null : cur))
                }}
                onFocus={() => {
                  if (isDragging) return
                  setHovered(g.id)
                }}
                onBlur={() => {
                  if (isDragging) return
                  setHovered((cur) => (cur === g.id ? null : cur))
                }}
                className={[
                  // The whole WG card is the click target now (no
                  // separate "Open" pill). The Unassigned bucket has
                  // no WG to navigate to, so we only enable the
                  // role="button" + click/keyboard handlers when the
                  // card represents a real worker group.
                  'relative z-10 flex min-w-0 flex-col gap-1.5 rounded-xl border px-3 py-3 shadow-ctrl transition focus-visible:ring-2 focus-visible:ring-cribl-primary/40 focus-visible:outline-none',
                  !isUnassigned && g.wg ? 'cursor-pointer' : '',
                  isUnassigned
                    ? 'border-dashed border-cribl-border/80 bg-cribl-card-body'
                    : isEdgeKind
                    ? 'border-cribl-edge/40 bg-cribl-edge-soft'
                    : 'border-cribl-primary/40 bg-cribl-primary-soft',
                  isDropTarget
                    ? isEdgeKind
                      ? 'ring-4 ring-cribl-edge/70 ring-offset-2 ring-offset-white scale-[1.015]'
                      : 'ring-4 ring-cribl-primary/70 ring-offset-2 ring-offset-white scale-[1.015]'
                    : isDropCandidate
                    ? isEdgeKind
                      ? 'ring-2 ring-cribl-edge/20'
                      : 'ring-2 ring-cribl-primary/20'
                    : isWgHovered
                    ? isEdgeKind
                      ? 'ring-2 ring-cribl-edge/40'
                      : 'ring-2 ring-cribl-primary/40'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {/*
                 * Drop-here indicator. Appears on the left edge of
                 * every WG card the moment a drag starts, *except*
                 * the source's origin group (you can't drop a source
                 * back onto its current WG). The dot grows + brightens
                 * when the cursor is currently over this card so the
                 * user gets clear "release to attach" feedback.
                 */}
                {drag && drag.originGroupId !== g.id ? (
                  <span
                    aria-hidden
                    className={[
                      'pointer-events-none absolute left-0 top-1/2 z-20',
                      '-translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150 ease-out',
                      isDropTarget
                        ? isEdgeKind
                          ? 'h-4 w-4 bg-cribl-edge ring-4 ring-cribl-edge/35'
                          : 'h-4 w-4 bg-cribl-primary ring-4 ring-cribl-primary/35'
                        : isEdgeKind
                        ? 'h-3 w-3 bg-cribl-edge/70 ring-4 ring-cribl-edge/15'
                        : 'h-3 w-3 bg-cribl-primary/70 ring-4 ring-cribl-primary/15',
                    ].join(' ')}
                    title="Drop here to attach"
                  />
                ) : null}
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={[
                      'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-ctrl',
                      isUnassigned
                        ? 'bg-white text-cribl-muted'
                        : isEdgeKind
                        ? 'bg-cribl-edge text-white'
                        : 'bg-cribl-primary text-white',
                    ].join(' ')}
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v2A1.5 1.5 0 0 1 15.5 8h-11A1.5 1.5 0 0 1 3 6.5v-2Zm0 5A1.5 1.5 0 0 1 4.5 8h11A1.5 1.5 0 0 1 17 9.5v2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 11.5v-2Zm0 5A1.5 1.5 0 0 1 4.5 13h11a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-2Z" />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <p
                      className={[
                        'm-0 text-[10px] font-semibold uppercase tracking-wider',
                        isUnassigned
                          ? 'text-cribl-muted'
                          : isEdgeKind
                          ? 'text-cribl-edge-ink'
                          : 'text-cribl-primary-ink',
                      ].join(' ')}
                    >
                      {isUnassigned
                        ? 'Unassigned'
                        : isEdgeKind
                        ? 'Fleet'
                        : 'Worker group'}
                    </p>
                    <p className="m-0 max-w-full truncate text-sm font-semibold text-cribl-ink">
                      {g.name}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-cribl-muted">
                  <span className="rounded-md bg-white/60 px-1.5 py-0.5 tabular-nums text-cribl-ink/80">
                    {g.sources.length} {g.sources.length === 1 ? 'src' : 'srcs'}
                  </span>
                  <span className="rounded-md bg-white/60 px-1.5 py-0.5 tabular-nums text-cribl-ink/80">
                    {g.totalGb > 0 ? formatGbOrTbPerDayStr(g.totalGb) : '—'}
                  </span>
                  {g.wg && g.wg.workerCount?.trim() ? (
                    <span className="rounded-md bg-white/60 px-1.5 py-0.5 tabular-nums text-cribl-ink/80">
                      {g.wg.workerCount.trim()}{' '}
                      {Number(g.wg.workerCount.trim()) === 1 ? 'wkr' : 'wkrs'}
                    </span>
                  ) : null}
                </div>
                {/*
                 * Animated "↦ {source}" strip — opens whenever one of
                 * this group's source connectors is hovered, mirroring
                 * the worker-group resource map's hub. We render a
                 * stable `<div>` and animate `max-height` / `opacity` /
                 * `margin-top` so the WG card grows / shrinks smoothly
                 * instead of jumping. The label uses the per-group
                 * sticky name so the panel collapses without flashing
                 * to a generic placeholder. Only mounted when there's
                 * a sticky name to show, so brand-new pages don't pay
                 * the layout cost.
                 */}
                {stickySourceByGroup[g.id] ? (
                  (() => {
                    // Use the *delayed* hover state so quick swipes
                    // between connectors don't slam the panel
                    // closed mid-transition. `delayedHoveredGroupId`
                    // lingers on its previous value for the cooldown
                    // window after the user leaves a connector.
                    const showSourceName =
                      delayedHoveredGroupId === g.id && delayedHovered !== g.id
                    return (
                      <div
                        aria-hidden={!showSourceName}
                        className="overflow-hidden"
                        style={{
                          maxHeight: showSourceName ? 32 : 0,
                          opacity: showSourceName ? 1 : 0,
                          marginTop: showSourceName ? 6 : 0,
                          transitionProperty: 'max-height, opacity, margin-top',
                          transitionDuration: '220ms',
                          transitionTimingFunction:
                            'cubic-bezier(0.22, 1, 0.36, 1)',
                        }}
                      >
                        <p
                          className={[
                            'm-0 truncate rounded-md bg-white/70 px-2 py-1 text-[11px]',
                            isEdgeKind ? 'text-cribl-edge-ink' : 'text-cribl-primary-ink',
                          ].join(' ')}
                        >
                          ↦ {stickySourceByGroup[g.id]}
                        </p>
                      </div>
                    )
                  })()
                ) : null}
              </div>
                {(g.subFleets ?? []).map((sf) => {
                  const sfWgHovered = hovered === sf.id
                  const sfIsDropTarget =
                    !!drag && drag.overWgId === sf.id && drag.originGroupId !== sf.id
                  const sfIsDropCandidate =
                    !!drag && drag.originGroupId !== sf.id && drag.overWgId !== sf.id
                  return (
                    <div
                      key={sf.id}
                      ref={(el) => setWgRef(sf.id, el)}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenWorkerGroup(sf.id)}
                      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onOpenWorkerGroup(sf.id)
                        }
                      }}
                      title={`Open ${sf.name}`}
                      aria-label={`Open ${sf.name}`}
                      onMouseEnter={() => {
                        if (isDragging) return
                        setHovered(sf.id)
                      }}
                      onMouseLeave={() => {
                        if (isDragging) return
                        setHovered((cur) => (cur === sf.id ? null : cur))
                      }}
                      onFocus={() => {
                        if (isDragging) return
                        setHovered(sf.id)
                      }}
                      onBlur={() => {
                        if (isDragging) return
                        setHovered((cur) => (cur === sf.id ? null : cur))
                      }}
                      className={[
                        'relative z-10 flex min-w-0 cursor-pointer flex-col gap-1 rounded-xl border px-3 py-2.5 shadow-ctrl transition focus-visible:ring-2 focus-visible:ring-cribl-edge/40 focus-visible:outline-none',
                        'border-cribl-edge/50 bg-white/90',
                        sfIsDropTarget
                          ? 'ring-4 ring-cribl-edge/70 ring-offset-2 ring-offset-white scale-[1.015]'
                          : sfIsDropCandidate
                          ? 'ring-2 ring-cribl-edge/20'
                          : sfWgHovered
                          ? 'ring-2 ring-cribl-edge/35'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {drag && drag.originGroupId !== sf.id ? (
                        <span
                          aria-hidden
                          className={[
                            'pointer-events-none absolute left-0 top-1/2 z-20',
                            '-translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150 ease-out',
                            sfIsDropTarget
                              ? 'h-4 w-4 bg-cribl-edge ring-4 ring-cribl-edge/35'
                              : 'h-3 w-3 bg-cribl-edge/70 ring-4 ring-cribl-edge/15',
                          ].join(' ')}
                          title="Drop here to attach"
                        />
                      ) : null}
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cribl-edge text-white shadow-ctrl"
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                            <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v2A1.5 1.5 0 0 1 15.5 8h-11A1.5 1.5 0 0 1 3 6.5v-2Zm0 5A1.5 1.5 0 0 1 4.5 8h11A1.5 1.5 0 0 1 17 9.5v2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 11.5v-2Zm0 5A1.5 1.5 0 0 1 4.5 13h11a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-2Z" />
                          </svg>
                        </span>
                        <div className="min-w-0">
                          <p className="m-0 text-[9px] font-semibold uppercase tracking-wide text-cribl-edge-ink">
                            Sub fleet
                          </p>
                          <p className="m-0 max-w-full truncate text-[13px] font-semibold text-cribl-ink">
                            {sf.name}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-cribl-muted">
                        <span className="rounded-md bg-white/70 px-1.5 py-0.5 tabular-nums text-cribl-ink/80">
                          {sf.sources.length} {sf.sources.length === 1 ? 'src' : 'srcs'}
                        </span>
                        <span className="rounded-md bg-white/70 px-1.5 py-0.5 tabular-nums text-cribl-ink/80">
                          {sf.totalGb > 0 ? formatGbOrTbPerDayStr(sf.totalGb) : '—'}
                        </span>
                      </div>
                      {stickySourceByGroup[sf.id] ? (
                        (() => {
                          const showSourceName =
                            delayedHoveredGroupId === sf.id && delayedHovered !== sf.id
                          return (
                            <div
                              aria-hidden={!showSourceName}
                              className="overflow-hidden"
                              style={{
                                maxHeight: showSourceName ? 28 : 0,
                                opacity: showSourceName ? 1 : 0,
                                marginTop: showSourceName ? 4 : 0,
                                transitionProperty: 'max-height, opacity, margin-top',
                                transitionDuration: '220ms',
                                transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                              }}
                            >
                              <p className="m-0 truncate rounded-md bg-white/70 px-2 py-0.5 text-[10px] text-cribl-edge-ink">
                                ↦ {stickySourceByGroup[sf.id]}
                              </p>
                            </div>
                          )
                        })()
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </Fragment>
          )
        })}
        </div>

        {unassignedSources.length > 0 || unassignedFleets.length > 0 ? (
          <UnassignedSection
            sources={unassignedSources}
            orphanFleets={unassignedFleets}
            interactive={interactive}
            isDragging={isDragging}
            drag={drag}
            hovered={hovered}
            onOpenSource={onOpenSource}
            onOpenWorkerGroup={onOpenWorkerGroup}
            setHovered={setHovered}
            onBeginDrag={(sourceId, anchorEl) => {
              const anchor = containerRelativeCenter(anchorEl)
              if (!anchor) return
              beginDragFromAnchor(sourceId, UNASSIGNED_ID, anchor)
            }}
            sectionRef={unassignedDropRef}
          />
        ) : null}
      </div>

      <p className="m-0 mt-4 text-[11px] text-cribl-muted">
        Branch thickness scales with daily volume. Source-side branches are dashed when a worker
        group or fleet is collapsed (the chip stands in for the entire group). Tree only renders
        on wider screens; on narrow viewports rows stack vertically.
      </p>
    </div>
  )
}

/**
 * Loose Sources that aren't attached to any Worker Group yet. They live
 * in their own "section" beneath the main tree, intentionally without
 * any connector lines (they have nowhere to point to). Each card sports
 * a small drag handle on its right edge — pressing and dragging it
 * conjures a rubber-band into the SVG above and lets the user drop the
 * source onto a worker-group card to assign it.
 */
type UnassignedSectionProps = {
  sources: SourceLeaf[]
  /** Top-level Edge fleets with no sources and no sub-fleets — same bucket as loose sources. */
  orphanFleets: WorkerGroupRow[]
  interactive: boolean
  isDragging: boolean
  drag: DragState | null
  hovered: string | null
  onOpenSource: (id: string) => void
  onOpenWorkerGroup: (id: string) => void
  setHovered: React.Dispatch<React.SetStateAction<string | null>>
  /** Begin a drag from the press location of the given handle element. */
  onBeginDrag: (sourceId: string, anchorEl: HTMLElement) => void
  sectionRef: React.RefObject<HTMLDivElement | null>
}

function UnassignedSection({
  sources,
  orphanFleets,
  interactive,
  isDragging,
  drag,
  hovered,
  onOpenSource,
  onOpenWorkerGroup,
  setHovered,
  onBeginDrag,
  sectionRef,
}: UnassignedSectionProps) {
  /**
   * Free-text filter over the unassigned bucket. Matches case-insensitively
   * against display name, source tile, source kind, status, and volume so
   * customers can quickly home in on a specific source even when the bucket
   * is large.
   */
  const [query, setQuery] = useState('')
  const trimmed = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!trimmed) return sources
    return sources.filter((s) => {
      const haystack = [
        s.name,
        s.subtitle,
        s.status,
        s.volumeGb,
        s.criticality,
        s.isCompliance ? 'compliance' : '',
      ]
        .map((v) => (v ?? '').toString().toLowerCase())
        .join(' ')
      return haystack.includes(trimmed)
    })
  }, [sources, trimmed])
  // The section becomes a "live" drop target only while an *attached*
  // source is being dragged — i.e., the drag's origin is a real worker
  // group, not the unassigned bucket itself (you can't drop something
  // onto where it already is).
  const isLiveDropTarget =
    !!drag && drag.originGroupId !== UNASSIGNED_ID && drag.overUnassignedZone
  const isDropArmed =
    !!drag && drag.originGroupId !== UNASSIGNED_ID && !drag.overUnassignedZone
  return (
    <div
      ref={sectionRef}
      className={[
        'relative z-10 mt-6 rounded-2xl border-2 border-dashed px-4 py-4 transition',
        isLiveDropTarget
          ? 'border-cribl-primary bg-cribl-primary-soft/50 shadow-[0_0_0_4px_rgba(0,204,204,0.15)]'
          : isDropArmed
          ? 'border-cribl-primary/50 bg-cribl-card-body/70'
          : 'border-cribl-border/80 bg-cribl-card-body/60',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-cribl-muted">
            Unassigned sources & fleets
          </p>
          <p className="m-0 mt-0.5 text-xs text-cribl-muted">
            {interactive
              ? 'Drag a source’s handle onto a worker group or fleet above to assign it. Fleets listed below have no sources yet — nest them under a parent fleet from the left nav (bottom drop band) to form a sub-fleet.'
              : 'These sources and fleets aren’t wired into the topology above yet.'}
          </p>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-cribl-muted">
          {trimmed ? `${filtered.length} of ${sources.length}` : sources.length}{' '}
          {sources.length === 1 ? 'source' : 'sources'}
          {orphanFleets.length > 0 ? (
            <>
              {' · '}
              {orphanFleets.length} {orphanFleets.length === 1 ? 'fleet' : 'fleets'}
            </>
          ) : null}
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
        sources.length > 0 ? (
          <p className="m-0 mt-3 rounded-lg border border-dashed border-cribl-border/70 bg-white/60 px-3 py-4 text-center text-[12px] text-cribl-muted">
            No unassigned sources match “{query}”.
          </p>
        ) : null
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((s) => {
          const isHovered = hovered === s.id
          const isDragSubject = drag?.sourceId === s.id
          const volStr = s.hasVolume ? formatGbOrTbPerDayStr(s.volumeGb) : '—'
          return (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenSource(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpenSource(s.id)
                }
              }}
              onMouseEnter={() => {
                if (isDragging) return
                setHovered(s.id)
              }}
              onMouseLeave={() => {
                if (isDragging) return
                setHovered((cur) => (cur === s.id ? null : cur))
              }}
              title="Open source detail"
              aria-label={`Open ${s.name}`}
              className={[
                // Whole-card click target. The drag handle on the
                // right is a real <button> with stopPropagation so
                // press-and-drag never falls through to "open".
                'relative flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border bg-white px-2.5 py-2 pr-9 text-left shadow-ctrl transition focus-visible:ring-2 focus-visible:ring-cribl-primary/40 focus-visible:outline-none',
                isHovered
                  ? 'border-cribl-primary/60 ring-2 ring-cribl-primary/30'
                  : 'border-cribl-border/80',
                isDragSubject ? 'opacity-50' : '',
              ].join(' ')}
            >
              <KindDot kind={null} className="shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col items-start gap-0">
                <span className="block max-w-full truncate text-[13px] font-semibold text-cribl-ink">
                  {s.name}
                </span>
                {s.subtitle ? (
                  <span className="block max-w-full truncate text-[11px] text-cribl-muted">
                    {s.subtitle}
                  </span>
                ) : null}
                {(s.criticality && critToneClass(s.criticality)) || s.isCompliance ? (
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {s.criticality && critToneClass(s.criticality) ? (
                      <span className={`rounded-md border px-1.5 py-0.5 ${critToneClass(s.criticality)}`}>
                        {s.criticality}
                      </span>
                    ) : null}
                    {s.isCompliance ? (
                      <span className="rounded-md border border-cribl-primary/30 bg-cribl-primary-soft px-1.5 py-0.5 text-cribl-primary-ink">
                        Compliance
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
              <span className="shrink-0 rounded-md bg-cribl-card-body px-1.5 py-0.5 text-[11px] tabular-nums text-cribl-ink/80">
                {volStr}
              </span>
              {interactive && s.allowReassignDrag ? (
                <button
                  type="button"
                  aria-label="Drag to a worker group or fleet to assign this source"
                  title="Drag to a worker group or fleet to assign"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.preventDefault()
                    e.stopPropagation()
                    onBeginDrag(s.id, e.currentTarget)
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
      {orphanFleets.length > 0 ? (
        <div className="mt-5 border-t border-cribl-border/60 pt-4">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-cribl-edge-ink">
            Unassigned fleets
          </p>
          <p className="m-0 mt-1 text-xs text-cribl-muted">
            No sources yet — drag under a top-level fleet in the left nav (use the bottom “Sub-fleet”
            drop band) to nest.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {orphanFleets.map((f) => {
              const label = f.wg.trim() || 'Untitled fleet'
              const isHovered = hovered === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onOpenWorkerGroup(f.id)}
                  onMouseEnter={() => {
                    if (isDragging) return
                    setHovered(f.id)
                  }}
                  onMouseLeave={() => {
                    if (isDragging) return
                    setHovered((cur) => (cur === f.id ? null : cur))
                  }}
                  className={[
                    'flex min-w-0 cursor-pointer flex-col items-start gap-1 rounded-lg border bg-white px-3 py-2.5 text-left shadow-ctrl transition focus-visible:ring-2 focus-visible:ring-cribl-edge/40 focus-visible:outline-none',
                    isHovered
                      ? 'border-cribl-edge/60 ring-2 ring-cribl-edge/25'
                      : 'border-cribl-border/80',
                  ].join(' ')}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-cribl-edge-ink">
                    Fleet · sub-fleet eligible
                  </span>
                  <span className="block w-full truncate text-[13px] font-semibold text-cribl-ink">
                    {label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ChevronCue({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={[
        'h-3.5 w-3.5 shrink-0 text-cribl-muted transition-transform',
        open ? 'rotate-90' : '',
      ].join(' ')}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M7.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 1 1-1.06-1.06L10.94 10 7.22 6.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  )
}
