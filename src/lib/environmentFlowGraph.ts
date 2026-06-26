import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import type { CriblEnvironmentGroup, CriblEnvironmentRoute, CriblEnvironmentScope, CriblEnvironmentSnapshot, EnvironmentScopeBadge } from './criblEnvironmentTypes'
import {
  findPackEntryReferences,
  knownPackIdsForGroup,
  packReachability,
  productScopeForGroup,
  resolveRoutePackPipelineTarget,
  resolveRoutePackTarget,
} from './environmentPackEntry'

export type EnvironmentNavAction =
  | { type: 'kind'; kind: 'stream' | 'edge' }
  | { type: 'group'; groupId: string }
  | { type: 'pack'; groupId: string; packId: string }

export type EnvironmentMapLevel =
  | { step: 'root' }
  | { step: 'kind'; kind: 'stream' | 'edge' }
  | { step: 'group'; kind: 'stream' | 'edge'; groupId: string }
  | { step: 'pack'; kind: 'stream' | 'edge'; groupId: string; packId: string }

export type EnvironmentEntityRef = {
  groupId: string
  scopeId: string
  entity: 'input' | 'route' | 'pipeline' | 'output'
  id: string
}

export type EnvironmentFlowEdgeData = {
  illustrative?: boolean
}

export type EnvironmentFlowNodeData = {
  label: string
  sublabel?: string
  disabled?: boolean
  nodeKind:
    | 'kindPicker'
    | 'group'
    | 'empty'
    | 'noSources'
    | 'noDestinations'
    | 'input'
    | 'route'
    | 'pipeline'
    | 'pack'
    | 'output'
  navAction?: EnvironmentNavAction
  entityRef?: EnvironmentEntityRef
  /** Pack id when nodeKind is pack (group map). */
  packId?: string
  /** Group map: unreferenced packs at top row; referenced packs on pipeline row. */
  packPlacement?: 'top' | 'pipeline'
  /** WG map reachability — drives top-row badge (Local pack vs Unassigned pack). */
  packReachabilityStatus?: 'referenced' | 'local_inputs_only' | 'unreferenced'
  /** Set by EnvironmentMap when a routing node is selected — dims unconnected nodes. */
  focusDimmed?: boolean
  /** Set by EnvironmentMap on the actively selected routing node. */
  focusSelected?: boolean
}

const NODE_W = 160
const NODE_H = 52
const KIND_PICKER_W = 188
const KIND_PICKER_H = 68
const GROUP_NODE_W = 176
const GROUP_NODE_H = 58
/** Max group/fleet cards per row in the kind drill-down list. */
export const GROUP_LIST_GRID_MAX_COLS = 10
const GROUP_LIST_GRID_GAP_X = 28
const GROUP_LIST_GRID_GAP_Y = 40
const GROUP_LIST_GRID_MARGIN = 24

function layoutGroupListGrid(nodes: Node<EnvironmentFlowNodeData>[]): Node<EnvironmentFlowNodeData>[] {
  const cellW = GROUP_NODE_W + GROUP_LIST_GRID_GAP_X
  const cellH = GROUP_NODE_H + GROUP_LIST_GRID_GAP_Y

  return nodes.map((node, i) => {
    const col = i % GROUP_LIST_GRID_MAX_COLS
    const row = Math.floor(i / GROUP_LIST_GRID_MAX_COLS)
    return {
      ...node,
      position: {
        x: GROUP_LIST_GRID_MARGIN + col * cellW,
        y: GROUP_LIST_GRID_MARGIN + row * cellH,
      },
    }
  })
}

function groupSummary(g: CriblEnvironmentGroup): string {
  const packCount = g.scopes.filter((s) => s.kind === 'pack').length
  const product = productScopeForGroup(g)
  const parts: string[] = []
  if (product) {
    if (product.inputs.length > 0) {
      parts.push(`${product.inputs.length} source${product.inputs.length === 1 ? '' : 's'}`)
    }
    if (product.routes.length > 0) {
      parts.push(`${product.routes.length} route${product.routes.length === 1 ? '' : 's'}`)
    }
  }
  if (packCount > 0) {
    parts.push(`${packCount} pack${packCount === 1 ? '' : 's'}`)
  }
  if (parts.length === 0) {
    return 'Routing map'
  }
  return parts.join(' · ')
}

/** Level 0: Worker Groups vs Fleets hub nodes. */
export function buildEnvironmentKindPickerGraph(groups: CriblEnvironmentGroup[]): {
  nodes: Node<EnvironmentFlowNodeData>[]
  edges: Edge[]
} {
  const streamCount = groups.filter((g) => g.kind === 'stream').length
  const edgeCount = groups.filter((g) => g.kind === 'edge').length

  const nodes: Node<EnvironmentFlowNodeData>[] = [
    {
      id: 'pick:stream',
      type: 'envNode',
      position: { x: 0, y: 0 },
      draggable: false,
      data: {
        label: 'Worker Groups',
        sublabel: streamCount === 1 ? '1 group' : `${streamCount} groups`,
        nodeKind: 'kindPicker',
        navAction: { type: 'kind', kind: 'stream' },
        disabled: streamCount === 0,
      },
    },
    {
      id: 'pick:edge',
      type: 'envNode',
      position: { x: 0, y: 0 },
      draggable: false,
      data: {
        label: 'Fleets',
        sublabel: edgeCount === 1 ? '1 fleet' : `${edgeCount} fleets`,
        nodeKind: 'kindPicker',
        navAction: { type: 'kind', kind: 'edge' },
        disabled: edgeCount === 0,
      },
    },
  ]

  const layoutEdges: Edge[] = [
    {
      id: 'pick:chain',
      source: 'pick:stream',
      target: 'pick:edge',
      style: { opacity: 0 },
      selectable: false,
    },
  ]

  const { nodes: laidOut } = layoutEnvironmentGraph(nodes, layoutEdges, {
    rankdir: 'LR',
    nodeWidth: KIND_PICKER_W,
    nodeHeight: KIND_PICKER_H,
    nodesep: 40,
    ranksep: 32,
  })

  return { nodes: laidOut, edges: [] }
}

/** Level 1: only worker groups or fleets for the selected kind. */
export function buildEnvironmentGroupListGraph(
  groups: CriblEnvironmentGroup[],
  kind: 'stream' | 'edge',
): { nodes: Node<EnvironmentFlowNodeData>[]; edges: Edge[] } {
  const filtered = groups.filter((g) => g.kind === kind).sort((a, b) => a.label.localeCompare(b.label))

  if (filtered.length === 0) {
    const label = kind === 'edge' ? 'No fleets in this snapshot' : 'No worker groups in this snapshot'
    return {
      nodes: [
        {
          id: 'empty:kind',
          type: 'envNode',
          position: { x: 0, y: 0 },
          draggable: false,
          data: { label, nodeKind: 'empty' },
        },
      ],
      edges: [],
    }
  }

  const nodes: Node<EnvironmentFlowNodeData>[] = filtered.map((g) => ({
    id: `grp:${g.id}`,
    type: 'envNode',
    position: { x: 0, y: 0 },
    draggable: false,
    data: {
      label: g.label,
      sublabel: groupSummary(g),
      nodeKind: 'group',
      navAction: { type: 'group', groupId: g.id },
    },
  }))

  return { nodes: layoutGroupListGrid(nodes), edges: [] }
}

const ROUTING_RANKSEP = 64
const ROUTING_TIER_GAP_X = 40
const ROUTING_MARGIN = 24
/** Extra vertical gap between unassigned pack row and source row on the group map. */
const GROUP_UNASSIGNED_PACK_GAP = 56

const ROUTING_TIER_ORDER = ['input', 'route', 'pipeline', 'output'] as const

type RoutingLayoutTier = (typeof ROUTING_TIER_ORDER)[number]

function routingLayoutTier(kind: EnvironmentFlowNodeData['nodeKind']): RoutingLayoutTier {
  if (kind === 'noSources') {
    return 'input'
  }
  if (kind === 'noDestinations') {
    return 'output'
  }
  if (kind === 'input' || kind === 'route' || kind === 'pipeline' || kind === 'output') {
    return kind
  }
  return 'pipeline'
}

const GROUP_MAP_TIER_ORDER = ['packTop', 'input', 'route', 'pipeline', 'output'] as const

type GroupMapLayoutTier = (typeof GROUP_MAP_TIER_ORDER)[number]

function groupMapLayoutTier(node: Node<EnvironmentFlowNodeData>): GroupMapLayoutTier {
  if (node.data.nodeKind === 'pack') {
    return node.data.packPlacement === 'pipeline' ? 'pipeline' : 'packTop'
  }
  return routingLayoutTier(node.data.nodeKind)
}

function layoutGroupRoutingFlowGraph(
  nodes: Node<EnvironmentFlowNodeData>[],
  edges: Edge[],
): { nodes: Node<EnvironmentFlowNodeData>[]; edges: Edge[] } {
  if (nodes.length === 0) {
    return { nodes, edges }
  }

  const w = NODE_W
  const h = NODE_H
  const byTier = new Map<GroupMapLayoutTier, Node<EnvironmentFlowNodeData>[]>()
  for (const tier of GROUP_MAP_TIER_ORDER) {
    byTier.set(tier, [])
  }
  for (const node of nodes) {
    byTier.get(groupMapLayoutTier(node))!.push(node)
  }
  for (const tier of GROUP_MAP_TIER_ORDER) {
    const row = byTier.get(tier) ?? []
    row.sort((a, b) => a.data.label.localeCompare(b.data.label))
  }

  let maxRowW = 0
  for (const tier of GROUP_MAP_TIER_ORDER) {
    const row = byTier.get(tier) ?? []
    if (row.length > 0) {
      maxRowW = Math.max(maxRowW, row.length * w + Math.max(0, row.length - 1) * ROUTING_TIER_GAP_X)
    }
  }
  if (maxRowW === 0) {
    return { nodes, edges }
  }

  let y = ROUTING_MARGIN
  const positioned: Node<EnvironmentFlowNodeData>[] = []
  for (const tier of GROUP_MAP_TIER_ORDER) {
    const row = byTier.get(tier) ?? []
    if (row.length === 0) {
      continue
    }
    const rowW = row.length * w + Math.max(0, row.length - 1) * ROUTING_TIER_GAP_X
    let x = ROUTING_MARGIN + (maxRowW - rowW) / 2
    for (const node of row) {
      positioned.push({ ...node, position: { x, y } })
      x += w + ROUTING_TIER_GAP_X
    }
    y += h + ROUTING_RANKSEP
    if (tier === 'packTop') {
      y += GROUP_UNASSIGNED_PACK_GAP
    }
  }

  return { nodes: positioned, edges }
}

export function isCatchAllRouteFilter(filter?: string): boolean {
  return filter?.trim().toLowerCase() === 'true'
}

export type NodePositionMap = Record<string, { x: number; y: number }>

export function groupLayoutKey(groupId: string): string {
  return `group:${groupId}`
}

export function packLayoutKey(groupId: string, packId: string): string {
  return `pack:${groupId}:${packId}`
}

export function layoutKeyForLevel(level: EnvironmentMapLevel): string | null {
  if (level.step === 'group') {
    return groupLayoutKey(level.groupId)
  }
  if (level.step === 'pack') {
    return packLayoutKey(level.groupId, level.packId)
  }
  return null
}

/** @deprecated Use groupLayoutKey / packLayoutKey */
export function routingLayoutScopeKey(groupId: string, scopeId: string): string {
  return `routing:${groupId}:${scopeId}`
}

/** Apply user-dragged positions onto freshly laid-out nodes. */
export function mergeNodePositions(
  layoutNodes: Node<EnvironmentFlowNodeData>[],
  overrides: NodePositionMap,
): Node<EnvironmentFlowNodeData>[] {
  if (Object.keys(overrides).length === 0) {
    return layoutNodes
  }
  return layoutNodes.map((node) => {
    const pos = overrides[node.id]
    return pos ? { ...node, position: { x: pos.x, y: pos.y } } : node
  })
}

function layoutTieredRoutingFlowGraph(
  nodes: Node<EnvironmentFlowNodeData>[],
  edges: Edge[],
): { nodes: Node<EnvironmentFlowNodeData>[]; edges: Edge[] } {
  if (nodes.length === 0) {
    return { nodes, edges }
  }

  const w = NODE_W
  const h = NODE_H
  const byTier = new Map<RoutingLayoutTier, Node<EnvironmentFlowNodeData>[]>()
  for (const tier of ROUTING_TIER_ORDER) {
    byTier.set(tier, [])
  }
  for (const node of nodes) {
    const tier = routingLayoutTier(node.data.nodeKind)
    byTier.get(tier)!.push(node)
  }
  for (const tier of ROUTING_TIER_ORDER) {
    const row = byTier.get(tier) ?? []
    row.sort((a, b) => a.data.label.localeCompare(b.data.label))
  }

  let maxRowW = 0
  for (const tier of ROUTING_TIER_ORDER) {
    const row = byTier.get(tier) ?? []
    if (row.length > 0) {
      maxRowW = Math.max(maxRowW, row.length * w + Math.max(0, row.length - 1) * ROUTING_TIER_GAP_X)
    }
  }
  if (maxRowW === 0) {
    return { nodes, edges }
  }

  let y = ROUTING_MARGIN
  const positioned: Node<EnvironmentFlowNodeData>[] = []
  for (const tier of ROUTING_TIER_ORDER) {
    const row = byTier.get(tier) ?? []
    if (row.length === 0) {
      continue
    }
    const rowW = row.length * w + Math.max(0, row.length - 1) * ROUTING_TIER_GAP_X
    let x = ROUTING_MARGIN + (maxRowW - rowW) / 2
    for (const node of row) {
      positioned.push({ ...node, position: { x, y } })
      x += w + ROUTING_TIER_GAP_X
    }
    y += h + ROUTING_RANKSEP
  }

  return { nodes: positioned, edges }
}

/** Fixed tiers: inputs → routes → pipelines → destinations (each row horizontal). */
export function layoutRoutingFlowGraph(
  nodes: Node<EnvironmentFlowNodeData>[],
  edges: Edge[],
): { nodes: Node<EnvironmentFlowNodeData>[]; edges: Edge[] } {
  return layoutTieredRoutingFlowGraph(nodes, edges)
}

const CATCH_ALL_FAN_IN_EDGE_STYLE = { opacity: 0.55, strokeWidth: 1.25 }
const ROUTING_CHAIN_EDGE_STYLE = { opacity: 0.72, strokeWidth: 1.35, stroke: '#64748b' }

export type ResolvedRouteTarget = {
  pipelineId?: string
  outputId?: string
}

function routeDestinationRaw(route: CriblEnvironmentRoute): string | undefined {
  const output = route.output?.trim()
  if (output) {
    return output
  }
  const cfg = route.config
  if (cfg && typeof cfg === 'object') {
    const dest = cfg.destination ?? cfg.dest
    if (typeof dest === 'string' && dest.trim()) {
      return dest.trim()
    }
  }
  return undefined
}

/** Split `pipeline:output` destination specifiers (e.g. default:default); pack paths use `/`. */
export function resolveRoutePipelineOutput(route: CriblEnvironmentRoute): ResolvedRouteTarget {
  let pipelineId = route.pipeline?.trim() || undefined
  let outputId = routeDestinationRaw(route)

  if (pipelineId?.toLowerCase().startsWith('pack:')) {
    return { pipelineId, outputId }
  }

  if (pipelineId && pipelineId.includes(':') && !pipelineId.includes('/')) {
    const colon = pipelineId.indexOf(':')
    const pl = pipelineId.slice(0, colon).trim()
    const out = pipelineId.slice(colon + 1).trim()
    if (pl && out) {
      return { pipelineId: pl, outputId: out }
    }
  }

  if (outputId && outputId.includes(':') && !outputId.includes('/')) {
    const colon = outputId.indexOf(':')
    const pl = outputId.slice(0, colon).trim()
    const out = outputId.slice(colon + 1).trim()
    if (pl && out) {
      return { pipelineId: pl, outputId: out }
    }
  }

  return { pipelineId, outputId }
}

/** Output node id for a WG route after parsing `default:default`-style destination fields. */
function resolveGlobalRouteOutputNodeId(route: CriblEnvironmentRoute): string | undefined {
  const raw = routeDestinationRaw(route)
  if (!raw) {
    return undefined
  }
  if (raw.includes(':') && !raw.includes('/')) {
    const colon = raw.indexOf(':')
    const pl = raw.slice(0, colon).trim()
    const out = raw.slice(colon + 1).trim()
    if (pl && out) {
      return out
    }
  }
  return raw
}

function pushRoutingChainEdge(edges: Edge[], source: string, target: string): void {
  edges.push({
    id: `e-${source}-${target}`,
    source,
    target,
    animated: false,
    style: ROUTING_CHAIN_EDGE_STYLE,
  })
}

function pushCatchAllFanInEdge(edges: Edge[], routeNodeId: string, sourceNodeId: string): void {
  edges.push({
    id: `e-${routeNodeId}-${sourceNodeId}`,
    source: sourceNodeId,
    target: routeNodeId,
    data: { illustrative: true },
    animated: false,
    style: CATCH_ALL_FAN_IN_EDGE_STYLE,
  })
}

/** Tiered routing map for one pack scope (inputs → routes → pipelines → outputs). */
export function buildEnvironmentFlowGraph(
  scope: CriblEnvironmentScope,
  group: CriblEnvironmentGroup,
): {
  nodes: Node<EnvironmentFlowNodeData>[]
  edges: Edge[]
} {
  const built = buildScopeRoutingNodesEdges(scope, group, null)
  return layoutRoutingFlowGraph(built.nodes, built.edges)
}

type ScopeRoutingBuild = {
  nodes: Node<EnvironmentFlowNodeData>[]
  edges: Edge[]
}

function buildScopeRoutingNodesEdges(
  scope: CriblEnvironmentScope,
  group: CriblEnvironmentGroup,
  knownPackIds: Set<string> | null,
): ScopeRoutingBuild {
  const nodes: Node<EnvironmentFlowNodeData>[] = []
  const edges: Edge[] = []
  const sid = scope.id
  const groupId = group.id
  const routeToPack = knownPackIds !== null

  const entityRef = (
    entity: EnvironmentEntityRef['entity'],
    id: string,
  ): EnvironmentEntityRef => ({ groupId, scopeId: sid, entity, id })

  const hasRoutingBelowInputs =
    scope.routes.length > 0 || scope.pipelines.length > 0 || scope.outputs.length > 0

  for (const input of scope.inputs) {
    const id = `in:${input.id}`
    nodes.push({
      id,
      type: 'envNode',
      position: { x: 0, y: 0 },
      draggable: true,
      data: {
        label: input.id,
        sublabel: input.type,
        disabled: input.disabled,
        nodeKind: 'input',
        entityRef: entityRef('input', input.id),
      },
    })
  }

  if (scope.inputs.length === 0 && hasRoutingBelowInputs) {
    nodes.push({
      id: `no-sources:${sid}`,
      type: 'envNode',
      position: { x: 0, y: 0 },
      draggable: false,
      data: {
        label: 'No sources configured',
        nodeKind: 'noSources',
      },
    })
  }

  for (const route of scope.routes) {
    const id = `rt:${route.id}`
    const packPipelineTarget = routeToPack ? resolveRoutePackPipelineTarget(route, knownPackIds) : null
    const packTarget = routeToPack ? resolveRoutePackTarget(route, knownPackIds) : null
    const routeTarget = packTarget ? null : resolveRoutePipelineOutput(route)
    const pipelineId = routeTarget?.pipelineId
    let outputId = routeTarget?.outputId
    if (packPipelineTarget) {
      outputId = resolveGlobalRouteOutputNodeId(route)
    }
    const filterShort =
      route.filter && route.filter.length > 28 ? `${route.filter.slice(0, 25)}…` : route.filter
    let sublabel = filterShort
    if (packTarget) {
      sublabel = sublabel ? `${sublabel} · → pack: ${packTarget}` : `→ pack: ${packTarget}`
    }

    nodes.push({
      id,
      type: 'envNode',
      position: { x: 0, y: 0 },
      draggable: true,
      data: {
        label: route.name?.trim() || route.id,
        sublabel,
        disabled: route.disabled,
        nodeKind: 'route',
        entityRef: entityRef('route', route.id),
      },
    })

    if (isCatchAllRouteFilter(route.filter)) {
      for (const input of scope.inputs) {
        pushCatchAllFanInEdge(edges, id, `in:${input.id}`)
      }
    }

    if (packTarget) {
      const packNodeId = `pack:${packTarget}`
      if (!nodes.some((n) => n.id === packNodeId)) {
        const refs = findPackEntryReferences(group, packTarget)
        const reach = packReachability(
          group,
          group.scopes.find((s) => s.id === packTarget)!,
        )
        let packSublabel = 'Not assigned · click to review'
        if (reach.status === 'referenced') {
          packSublabel = `${refs.length} WG route${refs.length === 1 ? '' : 's'} · click to open`
        } else if (reach.status === 'local_inputs_only') {
          packSublabel = 'Pack sources only · click to open'
        }
        nodes.push({
          id: packNodeId,
          type: 'envNode',
          position: { x: 0, y: 0 },
          draggable: true,
          data: {
            label: packTarget,
            sublabel: packSublabel,
            nodeKind: 'pack',
            packId: packTarget,
            packPlacement: 'pipeline',
            packReachabilityStatus: reach.status,
            navAction: { type: 'pack', groupId: group.id, packId: packTarget },
          },
        })
      }
      pushRoutingChainEdge(edges, id, packNodeId)
    } else if (pipelineId) {
      const pid = `pl:${pipelineId}`
      if (!nodes.some((n) => n.id === pid)) {
        const pl = scope.pipelines.find((p) => p.id === pipelineId)
        nodes.push({
          id: pid,
          type: 'envNode',
          position: { x: 0, y: 0 },
          draggable: true,
          data: {
            label: pipelineId,
            nodeKind: 'pipeline',
            disabled: pl?.disabled,
            entityRef: entityRef('pipeline', pipelineId),
          },
        })
      }
      pushRoutingChainEdge(edges, id, pid)
    }

    if (outputId && (!packTarget || packPipelineTarget)) {
      const oid = `out:${outputId}`
      if (!nodes.some((n) => n.id === oid)) {
        const out = scope.outputs.find((o) => o.id === outputId)
        nodes.push({
          id: oid,
          type: 'envNode',
          position: { x: 0, y: 0 },
          draggable: true,
          data: {
            label: outputId,
            sublabel: out?.type ?? (outputId === 'default' ? 'default destination' : undefined),
            disabled: out?.disabled,
            nodeKind: 'output',
            entityRef: entityRef('output', outputId),
          },
        })
      }
      const from = packPipelineTarget
        ? `pack:${packPipelineTarget}`
        : pipelineId
          ? `pl:${pipelineId}`
          : id
      pushRoutingChainEdge(edges, from, oid)
    }
  }

  for (const pipeline of scope.pipelines) {
    const pid = `pl:${pipeline.id}`
    if (!nodes.some((n) => n.id === pid)) {
      nodes.push({
        id: pid,
        type: 'envNode',
        position: { x: 0, y: 0 },
        draggable: true,
        data: {
          label: pipeline.id,
          sublabel: pipeline.description,
          disabled: pipeline.disabled,
          nodeKind: 'pipeline',
          entityRef: entityRef('pipeline', pipeline.id),
        },
      })
    }
  }

  for (const output of scope.outputs) {
    const oid = `out:${output.id}`
    if (!nodes.some((n) => n.id === oid)) {
      nodes.push({
        id: oid,
        type: 'envNode',
        position: { x: 0, y: 0 },
        draggable: true,
        data: {
          label: output.id,
          sublabel: output.type,
          disabled: output.disabled,
          nodeKind: 'output',
          entityRef: entityRef('output', output.id),
        },
      })
    }
  }

  const hasRoutingAboveOutputs =
    scope.routes.length > 0 || scope.pipelines.length > 0 || scope.inputs.length > 0
  const hasOutputNodes = nodes.some((n) => n.data.nodeKind === 'output')
  if (!hasOutputNodes && hasRoutingAboveOutputs) {
    nodes.push({
      id: `no-destinations:${sid}`,
      type: 'envNode',
      position: { x: 0, y: 0 },
      draggable: false,
      data: {
        label: 'No destinations configured',
        nodeKind: 'noDestinations',
      },
    })
  }

  return { nodes, edges }
}

/** Unified worker-group map: product routing + pack nodes (top or pipeline row). */
export function buildEnvironmentGroupRoutingGraph(group: CriblEnvironmentGroup): {
  nodes: Node<EnvironmentFlowNodeData>[]
  edges: Edge[]
} {
  const productScope = productScopeForGroup(group)
  if (!productScope) {
    return {
      nodes: [
        {
          id: 'empty:group',
          type: 'envNode',
          position: { x: 0, y: 0 },
          draggable: false,
          data: { label: `No routing config for ${group.label}`, nodeKind: 'empty' },
        },
      ],
      edges: [],
    }
  }

  const knownPackIds = knownPackIdsForGroup(group)
  const { nodes, edges } = buildScopeRoutingNodesEdges(productScope, group, knownPackIds)

  for (const packScope of group.scopes.filter((s) => s.kind === 'pack')) {
    const packNodeId = `pack:${packScope.id}`
    if (nodes.some((n) => n.id === packNodeId)) {
      continue
    }
    const reach = packReachability(group, packScope)
    let sublabel = 'Not assigned · click to review'
    let packPlacement: 'top' | 'pipeline' = 'top'
    if (reach.status === 'referenced') {
      sublabel = `${reach.references.length} WG route${reach.references.length === 1 ? '' : 's'} · click to open`
      packPlacement = 'pipeline'
    } else if (reach.status === 'local_inputs_only') {
      sublabel = 'Pack sources only · click to open'
    }
    nodes.push({
      id: packNodeId,
      type: 'envNode',
      position: { x: 0, y: 0 },
      draggable: true,
      data: {
        label: packScope.id,
        sublabel,
        nodeKind: 'pack',
        packId: packScope.id,
        packPlacement,
        packReachabilityStatus: reach.status,
        navAction: { type: 'pack', groupId: group.id, packId: packScope.id },
      },
    })
  }

  if (
    productScope.inputs.length === 0 &&
    !nodes.some((n) => n.data.nodeKind === 'noSources' || n.data.nodeKind === 'input') &&
    nodes.length > 0
  ) {
    nodes.push({
      id: `no-sources:${productScope.id}`,
      type: 'envNode',
      position: { x: 0, y: 0 },
      draggable: false,
      data: {
        label: 'No sources configured',
        nodeKind: 'noSources',
      },
    })
  }

  if (
    productScope.outputs.length === 0 &&
    !nodes.some((n) => n.data.nodeKind === 'output' || n.data.nodeKind === 'noDestinations') &&
    nodes.length > 0
  ) {
    nodes.push({
      id: `no-destinations:${productScope.id}`,
      type: 'envNode',
      position: { x: 0, y: 0 },
      draggable: false,
      data: {
        label: 'No destinations configured',
        nodeKind: 'noDestinations',
      },
    })
  }

  if (
    nodes.length === 0 &&
    group.scopes.filter((s) => s.kind === 'pack').length === 0
  ) {
    return {
      nodes: [
        {
          id: 'empty:routing',
          type: 'envNode',
          position: { x: 0, y: 0 },
          draggable: false,
          data: { label: `No routing config in ${group.label}`, nodeKind: 'empty' },
        },
      ],
      edges: [],
    }
  }

  return layoutGroupRoutingFlowGraph(nodes, edges)
}

/** Pick graph for the current drill-down level. */
export function buildEnvironmentMapGraph(
  level: EnvironmentMapLevel,
  snapshot: CriblEnvironmentSnapshot,
): { nodes: Node<EnvironmentFlowNodeData>[]; edges: Edge[] } {
  if (level.step === 'root') {
    return buildEnvironmentKindPickerGraph(snapshot.groups)
  }
  if (level.step === 'kind') {
    return buildEnvironmentGroupListGraph(snapshot.groups, level.kind)
  }
  const group = snapshot.groups.find((g) => g.id === level.groupId)
  if (!group) {
    return {
      nodes: [
        {
          id: 'empty:group',
          type: 'envNode',
          position: { x: 0, y: 0 },
          draggable: false,
          data: { label: 'Group not found in snapshot', nodeKind: 'empty' },
        },
      ],
      edges: [],
    }
  }
  if (level.step === 'group') {
    return buildEnvironmentGroupRoutingGraph(group)
  }
  if (level.step === 'pack') {
    const packScope = group.scopes.find((s) => s.id === level.packId && s.kind === 'pack')
    if (!packScope) {
      return {
        nodes: [
          {
            id: 'empty:pack',
            type: 'envNode',
            position: { x: 0, y: 0 },
            draggable: false,
            data: { label: 'Pack not found in snapshot', nodeKind: 'empty' },
          },
        ],
        edges: [],
      }
    }
    if (
      packScope.routes.length === 0 &&
      packScope.inputs.length === 0 &&
      packScope.pipelines.length === 0
    ) {
      return {
        nodes: [
          {
            id: 'empty:routing',
            type: 'envNode',
            position: { x: 0, y: 0 },
            draggable: false,
            data: {
              label: `No routing config in pack ${packScope.id}`,
              nodeKind: 'empty',
            },
          },
        ],
        edges: [],
      }
    }
    return buildEnvironmentFlowGraph(packScope, group)
  }
  return { nodes: [], edges: [] }
}

export type EnvironmentMapBreadcrumb = {
  label: string
  target: EnvironmentMapLevel
  scopeBadge?: EnvironmentScopeBadge
}

export function environmentMapBreadcrumb(
  level: EnvironmentMapLevel,
  snapshot: CriblEnvironmentSnapshot,
): EnvironmentMapBreadcrumb[] {
  const crumbs: EnvironmentMapBreadcrumb[] = [
    { label: 'Environment', target: { step: 'root' } },
  ]
  if (level.step === 'kind' || level.step === 'group' || level.step === 'pack') {
    crumbs.push({
      label: level.kind === 'edge' ? 'Fleets' : 'Worker Groups',
      target: { step: 'kind', kind: level.kind },
    })
  }
  if (level.step === 'group' || level.step === 'pack') {
    const g = snapshot.groups.find((x) => x.id === level.groupId)
    crumbs.push({
      label: g?.label ?? level.groupId,
      target: { step: 'group', kind: level.kind, groupId: level.groupId },
    })
  }
  if (level.step === 'pack') {
    crumbs.push({
      label: level.packId,
      target: level,
      scopeBadge: 'Pack',
    })
  }
  return crumbs
}

type LayoutOpts = {
  rankdir?: 'LR' | 'TB'
  nodeWidth?: number
  nodeHeight?: number
  nodesep?: number
  ranksep?: number
}

export function layoutEnvironmentGraph(
  nodes: Node<EnvironmentFlowNodeData>[],
  edges: Edge[],
  opts?: LayoutOpts,
): { nodes: Node<EnvironmentFlowNodeData>[]; edges: Edge[] } {
  if (nodes.length === 0) {
    return { nodes, edges }
  }
  const w = opts?.nodeWidth ?? NODE_W
  const h = opts?.nodeHeight ?? NODE_H
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: opts?.rankdir ?? 'LR',
    nodesep: opts?.nodesep ?? 36,
    ranksep: opts?.ranksep ?? 56,
    marginx: 24,
    marginy: 24,
  })

  for (const node of nodes) {
    const nw = node.data.nodeKind === 'kindPicker' ? KIND_PICKER_W : w
    const nh = node.data.nodeKind === 'kindPicker' ? KIND_PICKER_H : h
    g.setNode(node.id, { width: nw, height: nh })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  const laidOut = nodes.map((node) => {
    const pos = g.node(node.id)
    const nw = node.data.nodeKind === 'kindPicker' ? KIND_PICKER_W : w
    const nh = node.data.nodeKind === 'kindPicker' ? KIND_PICKER_H : h
    return {
      ...node,
      position: {
        x: pos.x - nw / 2,
        y: pos.y - nh / 2,
      },
    }
  })

  return { nodes: laidOut, edges }
}

/** Undirected connected component — legacy; prefer {@link focusedRoutingNodeIds}. */
export function connectedNodeIds(nodeId: string, edges: Edge[]): Set<string> {
  const adj = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (!adj.has(edge.source)) {
      adj.set(edge.source, new Set())
    }
    if (!adj.has(edge.target)) {
      adj.set(edge.target, new Set())
    }
    adj.get(edge.source)!.add(edge.target)
    adj.get(edge.target)!.add(edge.source)
  }

  const visited = new Set<string>([nodeId])
  const queue = [nodeId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const next of adj.get(cur) ?? []) {
      if (!visited.has(next)) {
        visited.add(next)
        queue.push(next)
      }
    }
  }
  return visited
}

function isIllustrativeInputEdge(
  edge: Edge,
  nodesById: Map<string, Node<EnvironmentFlowNodeData>>,
): boolean {
  const data = edge.data as EnvironmentFlowEdgeData | undefined
  if (data?.illustrative === true) {
    return true
  }
  const source = nodesById.get(edge.source)
  const target = nodesById.get(edge.target)
  const sourceKind = source?.data.nodeKind
  return sourceKind === 'input' && target?.data.nodeKind === 'route'
}

type Adjacency = Map<string, Array<{ neighbor: string; edge: Edge }>>

function buildAdjacency(edges: Edge[]): { forward: Adjacency; reverse: Adjacency } {
  const forward: Adjacency = new Map()
  const reverse: Adjacency = new Map()
  for (const edge of edges) {
    if (!forward.has(edge.source)) {
      forward.set(edge.source, [])
    }
    forward.get(edge.source)!.push({ neighbor: edge.target, edge })
    if (!reverse.has(edge.target)) {
      reverse.set(edge.target, [])
    }
    reverse.get(edge.target)!.push({ neighbor: edge.source, edge })
  }
  return { forward, reverse }
}

function walkUpstream(
  startId: string,
  reverse: Adjacency,
  nodesById: Map<string, Node<EnvironmentFlowNodeData>>,
): Set<string> {
  const visited = new Set<string>([startId])
  const queue = [startId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const { neighbor, edge } of reverse.get(cur) ?? []) {
      if (isIllustrativeInputEdge(edge, nodesById)) {
        continue
      }
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        queue.push(neighbor)
      }
    }
  }
  return visited
}

function walkDownstream(
  startId: string,
  forward: Adjacency,
  nodesById: Map<string, Node<EnvironmentFlowNodeData>>,
): Set<string> {
  const visited = new Set<string>([startId])
  const queue = [startId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const curKind = nodesById.get(cur)?.data.nodeKind
    for (const { neighbor, edge } of forward.get(cur) ?? []) {
      if (isIllustrativeInputEdge(edge, nodesById) && curKind !== 'input') {
        continue
      }
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        queue.push(neighbor)
      }
    }
  }
  return visited
}

/** Directed routing path focus: selected node plus upstream/downstream chain (inputs only when selected). */
export function focusedRoutingNodeIds(
  selectedId: string,
  nodes: Node<EnvironmentFlowNodeData>[],
  edges: Edge[],
): Set<string> {
  const nodesById = new Map(nodes.map((n) => [n.id, n]))
  const { forward, reverse } = buildAdjacency(edges)
  const upstream = walkUpstream(selectedId, reverse, nodesById)
  const downstream = walkDownstream(selectedId, forward, nodesById)
  return new Set([...upstream, ...downstream])
}

export function resolveSelectedNodeId(
  nodes: Node<EnvironmentFlowNodeData>[],
  selected: EnvironmentFlowNodeData | null | undefined,
): string | null {
  if (!selected?.entityRef) {
    return null
  }
  const { groupId, scopeId, entity, id } = selected.entityRef
  const match = nodes.find(
    (n) =>
      n.data.entityRef?.groupId === groupId &&
      n.data.entityRef?.scopeId === scopeId &&
      n.data.entityRef?.entity === entity &&
      n.data.entityRef?.id === id &&
      n.data.nodeKind === selected.nodeKind,
  )
  return match?.id ?? null
}

export function applyRoutingFocusHighlight(
  nodes: Node<EnvironmentFlowNodeData>[],
  edges: Edge[],
  selectedNodeId: string | null,
): { nodes: Node<EnvironmentFlowNodeData>[]; edges: Edge[] } {
  if (!selectedNodeId) {
    return {
      nodes: nodes.map((n) => ({
        ...n,
        data: { ...n.data, focusDimmed: false, focusSelected: false },
      })),
      edges,
    }
  }

  const connected = focusedRoutingNodeIds(selectedNodeId, nodes, edges)
  return {
    nodes: nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        focusDimmed: !connected.has(n.id),
        focusSelected: n.id === selectedNodeId,
      },
    })),
    edges: edges.map((e) => {
      const highlighted = connected.has(e.source) && connected.has(e.target)
      const baseOpacity = typeof e.style?.opacity === 'number' ? e.style.opacity : 1
      const illustrative = (e.data as EnvironmentFlowEdgeData | undefined)?.illustrative === true
      if (!highlighted) {
        return {
          ...e,
          style: {
            ...e.style,
            opacity: 0.12,
            strokeWidth: 1,
          },
        }
      }
      return {
        ...e,
        style: {
          ...e.style,
          opacity: illustrative ? 0.72 : Math.max(baseOpacity, 1),
          stroke: '#1e3a5f',
          strokeWidth: 1.7,
        },
      }
    }),
  }
}
