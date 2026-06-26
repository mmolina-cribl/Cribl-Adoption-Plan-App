import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { CriblEnvironmentSnapshot } from '../lib/criblEnvironmentTypes'
import { CHART_CRIBL_BLUE, CHART_CRIBL_EDGE_BLUE } from '../lib/chartColors'
import {
  buildEnvironmentMapGraph,
  environmentMapBreadcrumb,
  applyRoutingFocusHighlight,
  layoutKeyForLevel,
  mergeNodePositions,
  resolveSelectedNodeId,
  type EnvironmentFlowNodeData,
  type EnvironmentMapBreadcrumb,
  type EnvironmentMapLevel,
  type NodePositionMap,
} from '../lib/environmentFlowGraph'
import {
  clearEnvironmentMapLayout,
  readEnvironmentMapLayout,
  writeEnvironmentMapLayout,
} from '../lib/environmentMapLayout'
import { groupRoutesMissingBannerMessage, packReachabilityBannerMessage, packRoutesMissingBannerMessage } from '../lib/environmentPackEntry'
import { EnvironmentEntityDetailPanel } from './EnvironmentEntityDetailPanel'

const MAP_FADE_MS = 220
const MAP_FIT_MS = 380
const MAP_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

function packTopBadge(data: EnvironmentFlowNodeData): { label: string; badgeClass: string } {
  if (data.packReachabilityStatus === 'local_inputs_only') {
    return { label: 'Local pack', badgeClass: 'bg-indigo-100 text-indigo-800' }
  }
  return { label: 'Unassigned pack', badgeClass: 'bg-amber-100 text-amber-900' }
}

function levelKey(level: EnvironmentMapLevel): string {
  if (level.step === 'root') {
    return 'root'
  }
  if (level.step === 'kind') {
    return `kind:${level.kind}`
  }
  if (level.step === 'group') {
    return `group:${level.groupId}`
  }
  return `pack:${level.groupId}:${level.packId}`
}

function EnvFlowNode({ data }: NodeProps<Node<EnvironmentFlowNodeData>>) {
  const kind = data.nodeKind
  const isNav =
    (kind === 'kindPicker' || kind === 'group' || kind === 'pack') && !data.disabled
  const isPlaceholder = kind === 'noSources' || kind === 'noDestinations'
  const isEmpty = kind === 'empty' || isPlaceholder
  const isDimmed = data.focusDimmed && !data.focusSelected

  let border = 'border-cribl-border'
  let bg = 'bg-white/80 backdrop-blur-sm'
  if (kind === 'kindPicker') {
    border = data.navAction?.type === 'kind' && data.navAction.kind === 'edge' ? 'border-sky-400' : 'border-teal-400'
    bg = 'bg-white'
  } else if (kind === 'group') {
    border = 'border-cribl-primary/40'
    bg = 'bg-white'
  } else if (kind === 'pack') {
    if (data.packPlacement === 'pipeline' || data.packReachabilityStatus === 'local_inputs_only') {
      border = 'border-indigo-400'
      bg = 'bg-white'
    } else {
      border = 'border-dashed border-amber-400'
      bg = 'bg-white'
    }
  } else if (kind === 'empty' || isPlaceholder) {
    border = isPlaceholder ? 'border-dashed border-cribl-border/70' : 'border-cribl-border'
    bg = 'bg-cribl-canvas/40'
  } else if (kind === 'input') {
    border = 'border-sky-300'
  } else if (kind === 'route') {
    border = 'border-violet-300'
  } else if (kind === 'pipeline') {
    border = 'border-amber-300'
  } else if (kind === 'output') {
    border = 'border-emerald-300'
  }

  const minW =
    kind === 'kindPicker' ? 'min-w-[11rem]' : kind === 'group' || kind === 'pack' ? 'min-w-[10rem]' : 'min-w-[9rem]'
  const maxW =
    kind === 'kindPicker' ? 'max-w-[12rem]' : kind === 'group' || kind === 'pack' ? 'max-w-[11rem]' : 'max-w-[11rem]'

  const isPipelinePack = kind === 'pack' && data.packPlacement === 'pipeline'
  const packBadge = kind === 'pack' && data.packPlacement === 'top' ? packTopBadge(data) : null
  const isRouting =
    !isEmpty && kind !== 'kindPicker' && kind !== 'group' && (kind !== 'pack' || isPipelinePack)
  const targetPos = isRouting ? Position.Top : Position.Left
  const sourcePos = isRouting ? Position.Bottom : Position.Right

  return (
    <div
      className={[
        maxW,
        minW,
        'rounded-lg border px-2.5 py-2 shadow-sm transition-[opacity,filter,box-shadow] duration-200',
        border,
        bg,
        data.disabled ? 'cursor-not-allowed opacity-50' : '',
        isDimmed ? 'opacity-[0.28] grayscale' : '',
        data.focusSelected ? 'ring-2 ring-cribl-primary/55 shadow-md' : '',
        isNav ? 'cursor-pointer hover:shadow-md' : '',
        isEmpty ? (isPlaceholder ? 'max-w-[11rem] text-center' : 'max-w-md text-center') : '',
      ].join(' ')}
      style={
        kind === 'kindPicker' && data.navAction?.type === 'kind'
          ? { borderLeftWidth: 4, borderLeftColor: data.navAction.kind === 'edge' ? CHART_CRIBL_EDGE_BLUE : CHART_CRIBL_BLUE }
          : kind === 'pack'
            ? {
                borderLeftWidth: 4,
                borderLeftColor:
                  data.packPlacement === 'top' && data.packReachabilityStatus !== 'local_inputs_only'
                    ? '#f59e0b'
                    : '#818cf8',
              }
            : undefined
      }
    >
      {!isEmpty && kind !== 'kindPicker' && kind !== 'group' && (kind !== 'pack' || isPipelinePack) ? (
        <Handle type="target" position={targetPos} className="!h-2 !w-2 !bg-cribl-muted" />
      ) : null}
      {kind === 'pack' ? (
        <span
          className={[
            'mb-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
            data.packPlacement === 'top'
              ? (packBadge?.badgeClass ?? 'bg-amber-100 text-amber-900')
              : 'bg-indigo-100 text-indigo-800',
          ].join(' ')}
        >
          {data.packPlacement === 'top' ? (packBadge?.label ?? 'Unassigned pack') : 'Pack'}
        </span>
      ) : null}
      <p
        className={`m-0 truncate text-xs font-semibold ${isPlaceholder ? 'font-medium text-cribl-muted' : 'text-cribl-ink'} ${kind === 'kindPicker' ? 'text-sm' : ''}`}
        title={data.label}
      >
        {data.label}
      </p>
      {data.sublabel ? (
        <p className="m-0 mt-0.5 truncate font-mono text-[10px] text-cribl-muted" title={data.sublabel}>
          {data.sublabel}
        </p>
      ) : null}
      {isNav ? (
        <p className="m-0 mt-1 text-[10px] font-medium text-cribl-primary">
          {kind === 'pack'
            ? data.packPlacement === 'top'
              ? data.packReachabilityStatus === 'local_inputs_only'
                ? 'Pack-local sources'
                : 'Not on a WG route'
              : 'Click to zoom in'
            : 'Click to open'}
        </p>
      ) : null}
      {!isEmpty && kind !== 'kindPicker' && kind !== 'group' && (kind !== 'pack' || isPipelinePack) ? (
        <Handle type="source" position={sourcePos} className="!h-2 !w-2 !bg-cribl-muted" />
      ) : null}
    </div>
  )
}

const nodeTypes = { envNode: memo(EnvFlowNode) }

function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path fill="currentColor" d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4M2 2l4 4M14 2l-4 4M14 14l-4-4M2 14l4-4" />
    </svg>
  )
}

function CollapseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path fill="currentColor" d="M5 2h6v2H7v4H5V2zm0 10v2h6v-2H9V8H5v4zM2 5h2v6H2V5zm10 0h2v6h-2V5z" />
    </svg>
  )
}

type Props = {
  snapshot: CriblEnvironmentSnapshot
  onSelectNode?: (data: EnvironmentFlowNodeData | null) => void
  selectedNode?: EnvironmentFlowNodeData | null
}

function MapBreadcrumb({
  crumbs,
  currentIndex,
  onNavigate,
}: {
  crumbs: EnvironmentMapBreadcrumb[]
  currentIndex: number
  onNavigate: (level: EnvironmentMapLevel) => void
}) {
  return (
    <nav aria-label="Map location" className="flex flex-wrap items-center gap-1 text-[11px]">
      {crumbs.map((c, i) => (
        <span key={`${c.label}-${i}`} className="inline-flex items-center gap-1">
          {i > 0 ? <span className="text-cribl-muted/60">›</span> : null}
          {i < currentIndex ? (
            <button
              type="button"
              onClick={() => onNavigate(c.target)}
              className="inline-flex items-center gap-1 font-medium text-cribl-primary hover:underline"
            >
              {c.scopeBadge === 'Pack' ? (
                <span className="rounded bg-indigo-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-800">
                  Pack
                </span>
              ) : null}
              {c.label}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold text-cribl-ink">
              {c.scopeBadge === 'Pack' ? (
                <span className="rounded bg-indigo-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-800">
                  Pack
                </span>
              ) : null}
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}

type EnvironmentMapFlowControls = {
  fitView: () => void
  resetLayout: () => void
}

type FlowCanvasProps = {
  snapshot: CriblEnvironmentSnapshot
  level: EnvironmentMapLevel
  mapFullscreen: boolean
  snapshotKey: string
  selectedNode?: EnvironmentFlowNodeData | null
  onSelectNode?: (data: EnvironmentFlowNodeData | null) => void
  onNavigateLevel: (level: EnvironmentMapLevel) => void
  controlsRef?: MutableRefObject<EnvironmentMapFlowControls | null>
}

function EnvironmentMapFlowCanvas({
  snapshot,
  level,
  mapFullscreen,
  snapshotKey,
  selectedNode,
  onSelectNode,
  onNavigateLevel,
  controlsRef,
}: FlowCanvasProps) {
  const { fitView } = useReactFlow()
  const [displayLevel, setDisplayLevel] = useState(level)
  const [mapOpacity, setMapOpacity] = useState(1)
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [positionOverrides, setPositionOverrides] = useState<NodePositionMap>({})
  const fadeTimerRef = useRef<number | null>(null)
  const fitTimerRef = useRef<number | null>(null)
  const prevStructuralKeyRef = useRef<string | null>(null)

  const persistLayoutKey = layoutKeyForLevel(displayLevel)
  const isDraggableLevel = displayLevel.step === 'group' || displayLevel.step === 'pack'
  const fitPadding = mapFullscreen ? 0.12 : 0.2

  useEffect(() => {
    if (persistLayoutKey) {
      setPositionOverrides(readEnvironmentMapLayout(persistLayoutKey))
    } else {
      setPositionOverrides({})
    }
    setLayoutRevision(0)
  }, [persistLayoutKey])

  const layoutGraph = useMemo(() => {
    const built = buildEnvironmentMapGraph(displayLevel, snapshot)
    if (isDraggableLevel && Object.keys(positionOverrides).length > 0) {
      return { ...built, nodes: mergeNodePositions(built.nodes, positionOverrides) }
    }
    return built
  }, [displayLevel, snapshot, positionOverrides, isDraggableLevel])

  const selectedNodeId = useMemo(
    () => resolveSelectedNodeId(layoutGraph.nodes, selectedNode),
    [layoutGraph.nodes, selectedNode],
  )

  const focusedGraph = useMemo(
    () => applyRoutingFocusHighlight(layoutGraph.nodes, layoutGraph.edges, selectedNodeId),
    [layoutGraph, selectedNodeId],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(focusedGraph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(focusedGraph.edges)

  const structuralKey = `${levelKey(displayLevel)}:${layoutRevision}:${snapshotKey}`

  useEffect(() => {
    const isStructural = prevStructuralKeyRef.current !== structuralKey
    if (isStructural || prevStructuralKeyRef.current === null) {
      setNodes(focusedGraph.nodes)
      setEdges(focusedGraph.edges)
      prevStructuralKeyRef.current = structuralKey
      return
    }
    setNodes((prev) => {
      const posById = new Map(prev.map((n) => [n.id, n.position]))
      return focusedGraph.nodes.map((n) => ({
        ...n,
        position: posById.get(n.id) ?? n.position,
      }))
    })
    setEdges(focusedGraph.edges)
  }, [focusedGraph, structuralKey, setNodes, setEdges])

  const handleFitView = useCallback(() => {
    void fitView({ duration: MAP_FIT_MS, padding: fitPadding })
  }, [fitView, fitPadding])

  const handleResetLayout = useCallback(() => {
    if (persistLayoutKey) {
      clearEnvironmentMapLayout(persistLayoutKey)
    }
    setPositionOverrides({})
    setLayoutRevision((r) => r + 1)
    onSelectNode?.(null)
    window.setTimeout(() => {
      void fitView({ duration: MAP_FIT_MS, padding: fitPadding })
    }, 40)
  }, [persistLayoutKey, onSelectNode, fitView, fitPadding])

  useEffect(() => {
    if (!controlsRef) {
      return
    }
    controlsRef.current = { fitView: handleFitView, resetLayout: handleResetLayout }
    return () => {
      controlsRef.current = null
    }
  }, [controlsRef, handleFitView, handleResetLayout])

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node<EnvironmentFlowNodeData>) => {
      if (!isDraggableLevel || !persistLayoutKey) {
        return
      }
      setPositionOverrides((prev) => {
        const next = { ...prev, [node.id]: { x: node.position.x, y: node.position.y } }
        writeEnvironmentMapLayout(persistLayoutKey, next)
        return next
      })
    },
    [isDraggableLevel, persistLayoutKey],
  )

  useEffect(() => {
    if (fadeTimerRef.current != null) {
      window.clearTimeout(fadeTimerRef.current)
      fadeTimerRef.current = null
    }
    if (fitTimerRef.current != null) {
      window.clearTimeout(fitTimerRef.current)
      fitTimerRef.current = null
    }

    const nextKey = levelKey(level)
    const currentKey = levelKey(displayLevel)
    if (nextKey === currentKey) {
      return
    }

    setMapOpacity(0)
    fadeTimerRef.current = window.setTimeout(() => {
      setDisplayLevel(level)
      requestAnimationFrame(() => {
        setMapOpacity(1)
        fitTimerRef.current = window.setTimeout(() => {
          void fitView({
            duration: MAP_FIT_MS,
            padding: mapFullscreen ? 0.12 : 0.2,
          })
        }, MAP_FADE_MS)
      })
    }, MAP_FADE_MS)

    return () => {
      if (fadeTimerRef.current != null) {
        window.clearTimeout(fadeTimerRef.current)
      }
      if (fitTimerRef.current != null) {
        window.clearTimeout(fitTimerRef.current)
      }
    }
  }, [level, displayLevel, fitView, mapFullscreen])

  useEffect(() => {
    setDisplayLevel({ step: 'root' })
    setMapOpacity(1)
    const t = window.setTimeout(() => {
      void fitView({
        duration: MAP_FIT_MS,
        padding: mapFullscreen ? 0.12 : 0.2,
      })
    }, 40)
    return () => window.clearTimeout(t)
  }, [snapshotKey, fitView, mapFullscreen])

  useEffect(() => {
    if (mapOpacity < 1) {
      return
    }
    const t = window.setTimeout(() => {
      void fitView({
        duration: MAP_FIT_MS,
        padding: mapFullscreen ? 0.12 : 0.2,
      })
    }, 40)
    return () => window.clearTimeout(t)
  }, [mapFullscreen, mapOpacity, fitView])

  const handleNodeClick = useCallback(
    (_: unknown, node: Node<EnvironmentFlowNodeData>) => {
      const { navAction, nodeKind, disabled } = node.data
      if (disabled) {
        return
      }
      if (navAction?.type === 'kind') {
        onNavigateLevel({ step: 'kind', kind: navAction.kind })
        onSelectNode?.(null)
        return
      }
      if (navAction?.type === 'group') {
        const g = snapshot.groups.find((x) => x.id === navAction.groupId)
        onNavigateLevel({
          step: 'group',
          kind: g?.kind ?? 'stream',
          groupId: navAction.groupId,
        })
        onSelectNode?.(null)
        return
      }
      if (navAction?.type === 'pack') {
        const g = snapshot.groups.find((x) => x.id === navAction.groupId)
        onNavigateLevel({
          step: 'pack',
          kind: g?.kind ?? 'stream',
          groupId: navAction.groupId,
          packId: navAction.packId,
        })
        onSelectNode?.(null)
        return
      }
      if (nodeKind === 'empty' || nodeKind === 'noSources' || nodeKind === 'noDestinations' || nodeKind === 'kindPicker' || nodeKind === 'group' || nodeKind === 'pack') {
        return
      }
      onSelectNode?.(node.data)
    },
    [onNavigateLevel, onSelectNode, snapshot.groups],
  )

  return (
    <div
      className="environment-map-flow h-full w-full"
      style={{
        opacity: mapOpacity,
        transition: `opacity ${MAP_FADE_MS}ms ${MAP_EASE}`,
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        nodesDraggable={isDraggableLevel}
        onNodeDragStop={handleNodeDragStop}
        nodesConnectable={false}
        edgesFocusable={false}
        defaultEdgeOptions={{ selectable: false, focusable: false }}
        elementsSelectable
        onNodeClick={handleNodeClick}
        onPaneClick={() => onSelectNode?.(null)}
        proOptions={{ hideAttribution: true }}
        style={{ width: '100%', height: '100%' }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export function EnvironmentMap({ snapshot, onSelectNode, selectedNode }: Props) {
  const [level, setLevel] = useState<EnvironmentMapLevel>({ step: 'root' })
  const [mapFullscreen, setMapFullscreen] = useState(false)
  const mapSurfaceRef = useRef<HTMLDivElement>(null)
  const flowControlsRef = useRef<EnvironmentMapFlowControls | null>(null)

  const snapshotKey = `${snapshot.capturedAt}:${snapshot.groups.length}`
  const isDraggableLevel = level.step === 'group' || level.step === 'pack'

  useEffect(() => {
    setLevel({ step: 'root' })
    setMapFullscreen(false)
    onSelectNode?.(null)
  }, [snapshotKey])

  const crumbs = useMemo(() => environmentMapBreadcrumb(level, snapshot), [level, snapshot])
  const currentCrumbIndex = crumbs.length - 1

  const packBanners = useMemo(() => {
    if (level.step !== 'pack') {
      return []
    }
    const g = snapshot.groups.find((x) => x.id === level.groupId)
    const packScope = g?.scopes.find((s) => s.id === level.packId && s.kind === 'pack')
    if (!g || !packScope) {
      return []
    }
    const banners: { tone: 'amber' | 'neutral' | 'teal'; message: string }[] = []
    const routesMissing = packRoutesMissingBannerMessage(packScope, snapshot.source)
    if (routesMissing) {
      banners.push(routesMissing)
    }
    banners.push(packReachabilityBannerMessage(g, packScope))
    return banners
  }, [level, snapshot.groups, snapshot.source])

  const groupBanner = useMemo(() => {
    if (level.step !== 'group') {
      return null
    }
    const g = snapshot.groups.find((x) => x.id === level.groupId)
    if (!g) {
      return null
    }
    return groupRoutesMissingBannerMessage(g, snapshot.source)
  }, [level, snapshot.groups, snapshot.source])

  const mapBanners = packBanners.length > 0 ? packBanners : groupBanner ? [groupBanner] : []

  const mapTitle = useMemo(() => {
    if (level.step === 'root') {
      return 'Environment'
    }
    if (level.step === 'kind') {
      return level.kind === 'edge' ? 'Fleets' : 'Worker Groups'
    }
    if (level.step === 'group') {
      const g = snapshot.groups.find((x) => x.id === level.groupId)
      return g?.label ?? level.groupId
    }
    return `Pack: ${level.packId}`
  }, [level, snapshot.groups])

  const navigateLevel = useCallback((target: EnvironmentMapLevel) => {
    setLevel(target)
    onSelectNode?.(null)
  }, [onSelectNode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return
      }
      if (selectedNode) {
        onSelectNode?.(null)
        return
      }
      if (mapFullscreen) {
        setMapFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedNode, mapFullscreen, onSelectNode])

  const detailPanel =
    selectedNode ? (
      <EnvironmentEntityDetailPanel
        snapshot={snapshot}
        node={selectedNode}
        containerRef={mapSurfaceRef}
        onClose={() => onSelectNode?.(null)}
      />
    ) : null

  useEffect(() => {
    if (!mapFullscreen) {
      return
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mapFullscreen])

  const toolbar = (
    <div className="pointer-events-none absolute left-2 right-2 top-2 z-10 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="pointer-events-auto max-w-[70%] rounded-md border border-cribl-border/80 bg-white/95 px-2.5 py-1.5 shadow-ctrl backdrop-blur-sm">
          <MapBreadcrumb crumbs={crumbs} currentIndex={currentCrumbIndex} onNavigate={navigateLevel} />
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
          {isDraggableLevel ? (
            <>
              <button
                type="button"
                onClick={() => flowControlsRef.current?.fitView()}
                className="inline-flex h-8 items-center rounded-md border border-cribl-border bg-white/95 px-2.5 text-[11px] font-semibold text-cribl-ink shadow-ctrl backdrop-blur-sm hover:bg-white"
                title="Fit map to view"
              >
                Fit view
              </button>
              <button
                type="button"
                onClick={() => flowControlsRef.current?.resetLayout()}
                className="inline-flex h-8 items-center rounded-md border border-cribl-border bg-white/95 px-2.5 text-[11px] font-semibold text-cribl-ink shadow-ctrl backdrop-blur-sm hover:bg-white"
                title="Restore default node positions"
              >
                Reset layout
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setMapFullscreen((v) => !v)}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-cribl-border bg-white/95 px-2.5 text-[11px] font-semibold text-cribl-ink shadow-ctrl backdrop-blur-sm hover:bg-white"
            title={mapFullscreen ? 'Exit full screen' : 'Full screen map'}
          >
            {mapFullscreen ? <CollapseIcon className="h-3 w-3" /> : <ExpandIcon className="h-3 w-3" />}
            {mapFullscreen ? 'Exit' : 'Full screen'}
          </button>
        </div>
      </div>
      {mapBanners.length > 0 ? (
        <div className="pointer-events-auto flex max-w-full flex-col gap-1.5">
          {mapBanners.map((banner) => (
            <div
              key={banner.message}
              className={[
                'rounded-md border px-2.5 py-1.5 text-[11px] shadow-ctrl backdrop-blur-sm',
                banner.tone === 'amber'
                  ? 'border-amber-200/90 bg-amber-50/95 text-amber-950'
                  : banner.tone === 'teal'
                    ? 'border-teal-200/90 bg-teal-50/95 text-teal-950'
                    : 'border-cribl-border/80 bg-white/95 text-cribl-muted',
              ].join(' ')}
              role="status"
            >
              {banner.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )

  const flow = (
    <ReactFlowProvider>
      <EnvironmentMapFlowCanvas
        snapshot={snapshot}
        level={level}
        mapFullscreen={mapFullscreen}
        snapshotKey={snapshotKey}
        selectedNode={selectedNode}
        onSelectNode={onSelectNode}
        onNavigateLevel={navigateLevel}
        controlsRef={flowControlsRef}
      />
    </ReactFlowProvider>
  )

  const surfacePad = mapBanners.length > 0 ? 'pt-20' : 'pt-12'

  if (mapFullscreen) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col bg-cribl-canvas"
        role="dialog"
        aria-modal="true"
        aria-label={`Environment map: ${mapTitle}`}
      >
        <div ref={mapSurfaceRef} className={`relative min-h-0 flex-1 ${mapBanners.length > 0 ? 'pt-24' : 'pt-12'}`}>
          {toolbar}
          {flow}
          {detailPanel}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={mapSurfaceRef}
      className={`relative h-[min(28rem,60vh)] w-full rounded-lg border border-cribl-border/80 bg-cribl-canvas/30 ${surfacePad}`}
    >
      {toolbar}
      {flow}
      {detailPanel}
    </div>
  )
}
