import { useCallback, useEffect, useState } from 'react'
import { AddSourceDialog } from './components/AddSourceDialog'
import { AddWorkerGroupDialog } from './components/AddWorkerGroupDialog'
import { AddSubfleetDialog } from './components/AddSubfleetDialog'
import { HeaderCustomerName } from './components/HeaderCustomerName'
import { DataSourcesView } from './components/DataSourcesView'
import { PostAddSourceChoiceDialog } from './components/PostAddSourceChoiceDialog'
import { SourceFormWizardDialog } from './components/sourceForm/SourceFormWizardDialog'
import { ExportWorkbookView } from './components/ExportWorkbookView'
import { ExecutiveReadoutView } from './components/ExecutiveReadoutView'
import { AiAssistantPanel } from './components/AiAssistantPanel'
import { ImportWorkbookView } from './components/ImportWorkbookView'
import { EnvironmentView } from './components/EnvironmentView'
import { PlanDataOverview } from './components/PlanDataOverview'
import { WorkerGroupDetailView } from './components/WorkerGroupDetailView'
import { WorkerGroupsIndexView } from './components/WorkerGroupsIndexView'
import { SourcesIndexView } from './components/SourcesIndexView'
import { APP_VERSION } from './appVersion'
import { SettingsView } from './components/SettingsView'
import { ActivationView } from './components/ActivationView'
import { ConfirmClearDialog } from './components/ConfirmClearDialog'
import { ConfirmRemoveSourceDialog } from './components/ConfirmRemoveSourceDialog'
import { ConfirmRemoveWorkerGroupDialog } from './components/ConfirmRemoveWorkerGroupDialog'
import { defaultSourceRow, defaultWorkerGroupRow } from './lib/defaultState'
import {
  applyEdgeFleetReorder,
  normalizeEdgeFleetOrder,
  sortEdgeFleetsAlphabetically,
  sortEdgeFleetsByIngest,
  topLevelFleetIdForNewSubfleet,
} from './lib/fleetHierarchy'
import type { DropPosition } from './lib/useDragReorder'
import { deriveStreamOrEdge } from './lib/workerGroupIds'
import { parseGb } from './lib/formatRate'
import { sumAvgDailyFromSourceSummaryForWg } from './lib/workerGroupRollup'
import { isSourceRowAttachmentDisabled } from './lib/sourceAttachmentDisabled'
import type { MainView } from './components/navTypes'
import { PlanNavMobile, PlanSidebarRail } from './components/PlanSidebar'
import { useResizableRail } from './hooks/useResizableRail'
import { usePlanStorage } from './hooks/usePlanStorage'
import { useEnvironmentSnapshot } from './hooks/useEnvironmentSnapshot'
import { clearPostAddPreference, getPostAddPreference, setPostAddPreference, whenPostAddPreferenceHydrated } from './lib/postAddPreference'
import {
  newId,
  sourceLabel,
  type PlanState,
  type SourceSummaryRow,
  type WorkerGroupKind,
} from './types/planTypes'
import { fetchAdoptionPlanEmptyBufferIfMissing } from './lib/adoptionPlanTemplateExport'
import { hydrateImportShell } from './lib/importShellStore'
import {
  readShowDisabledSourcesInLists,
  writeShowDisabledSourcesInLists,
} from './lib/showDisabledSourcesPreference'

type PostAddFlow = null | { kind: 'choice'; sourceDisplayName: string } | { kind: 'wizard' }

interface AppContentProps {
  plan: PlanState
  setPlan: React.Dispatch<React.SetStateAction<PlanState>>
  reset: () => void
}

/**
 * Loading state shown while `usePlanStorage` is awaiting the initial KV read.
 * See CRIBL_DEV_NOTES.md "Decision 1": the main plan is the only thing we
 * gate the entire UI on, because flashing an empty plan to a populated one
 * is jarring. Small UI prefs (sidebar width, etc.) flash-of-default instead.
 */
function LoadingScreen() {
  return (
    <div className="flex h-svh min-h-0 flex-col items-center justify-center bg-cribl-canvas text-cribl-muted">
      <div className="text-sm">Loading…</div>
    </div>
  )
}

function App() {
  const { plan, setPlan, reset } = usePlanStorage()
  if (plan === null) {
    return <LoadingScreen />
  }
  return (
    <AppContent
      plan={plan}
      setPlan={setPlan as React.Dispatch<React.SetStateAction<PlanState>>}
      reset={reset}
    />
  )
}

function AppContent({ plan, setPlan, reset }: AppContentProps) {
  const { snapshot: environmentSnapshot, setSnapshot: setEnvironmentSnapshot } = useEnvironmentSnapshot()
  const { width: railW, beginResize, collapsed: railCollapsed, toggleCollapse: toggleRail, minW } =
    useResizableRail()
  // First-load lands on the Plan dashboard — the topology + resource
  // map are the highest-density introduction to what a customer is
  // looking at. Summary and Activation sit as sub-entries under Plan
  // in the left nav (Summary first), and the dashboard surfaces a
  // "Plan in shape? Activate it." nudge that points at Activation directly,
  // so a CSE / customer who lands here still has an obvious next step
  // without us pre-empting the plan view.
  const [mainView, setMainView] = useState<MainView>('overview')

  const goToEnvironment = useCallback(() => {
    setMainView('environment')
  }, [])

  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [activeWorkerGroupId, setActiveWorkerGroupId] = useState<string | null>(null)
  const [addSourceOpen, setAddSourceOpen] = useState(false)
  // v2.0: a worker-group row is either a Stream worker group or an Edge
  // fleet, surfaced under separate left-nav sections. Tracking the in-flight
  // kind keeps the AddWorkerGroupDialog's copy / placeholder / next-id in
  // sync with which "+" the user clicked.
  const [addWorkerGroupOpen, setAddWorkerGroupOpen] = useState<null | WorkerGroupKind>(null)
  const [addSubfleetOpen, setAddSubfleetOpen] = useState<null | { initialParentFleetId: string | null }>(null)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const [confirmRemoveWorkerGroupId, setConfirmRemoveWorkerGroupId] = useState<string | null>(null)
  const [confirmRemoveSourceId, setConfirmRemoveSourceId] = useState<string | null>(null)
  const [postAdd, setPostAdd] = useState<PostAddFlow>(null)
  const [showDisabledSourcesInLists, setShowDisabledSourcesInListsState] = useState(
    readShowDisabledSourcesInLists,
  )

  const setShowDisabledSourcesInLists = useCallback((show: boolean) => {
    setShowDisabledSourcesInListsState(show)
    writeShowDisabledSourcesInLists(show)
  }, [])

  useEffect(() => {
    void hydrateImportShell()
  }, [])

  useEffect(() => {
    void fetchAdoptionPlanEmptyBufferIfMissing()
  }, [])

  const nextSourcePlaceholder = `Source ${plan.sourceSummary.length + 1}`
  // Per-kind running counters: "Worker group N" stays scoped to Stream
  // entries, "Fleet N" stays scoped to Edge entries. Mixing them would make
  // the placeholder less useful as soon as you have one of each kind.
  const streamCount = plan.workerGroups.filter((w) => w.kind === 'stream').length
  const fleetCount = plan.workerGroups.filter((w) => w.kind === 'edge').length
  const subFleetCount = plan.workerGroups.filter(
    (w) => w.kind === 'edge' && Boolean((w.parentFleetId ?? '').trim()),
  ).length
  const nextSubfleetPlaceholder = `Sub-fleet ${subFleetCount + 1}`
  const nextWorkerGroupPlaceholder =
    addWorkerGroupOpen === 'edge' ? `Fleet ${fleetCount + 1}` : `Worker group ${streamCount + 1}`

  useEffect(() => {
    if (plan.sourceSummary.length === 0) {
      setActiveSourceId(null)
      return
    }
    const first = plan.sourceSummary[0]!.id
    setActiveSourceId((cur) => {
      if (cur && plan.sourceSummary.some((r) => r.id === cur)) {
        return cur
      }
      return first
    })
  }, [plan.sourceSummary])

  useEffect(() => {
    if (plan.workerGroups.length === 0) {
      setActiveWorkerGroupId(null)
      return
    }
    setActiveWorkerGroupId((cur) => {
      if (cur && plan.workerGroups.some((w) => w.id === cur)) {
        return cur
      }
      return plan.workerGroups[0]!.id
    })
  }, [plan.workerGroups])

  const openAddSource = () => setAddSourceOpen(true)
  const openAddWorkerGroup = (kind: WorkerGroupKind = 'stream') =>
    setAddWorkerGroupOpen(kind)

  const addSourceWithName = (name: string) => {
    const id = newId()
    setPlan((p) => {
      const s = defaultSourceRow(p.sourceSummary.length, '')
      s.id = id
      // v0.9.1 dropped the dedicated Display name column — the Source field
      // is the row's identity. Users can rename it later via the inline pencil
      // in the source detail view, which writes back to `source` directly.
      s.source = name
      return { ...p, sourceSummary: [...p.sourceSummary, s] }
    })
    setActiveSourceId(id)
    setMainView('source')
    void whenPostAddPreferenceHydrated().then(() => {
      const pref = getPostAddPreference()
      if (pref === 'wizard') {
        setPostAdd({ kind: 'wizard' })
      } else if (pref === 'manual') {
        setPostAdd(null)
      } else {
        setPostAdd({ kind: 'choice', sourceDisplayName: name })
      }
    })
  }

  const removeSource = (id: string) => {
    setPlan((p) => {
      const next = p.sourceSummary.filter((r) => r.id !== id)
      if (id === activeSourceId) {
        if (next.length === 0) {
          queueMicrotask(() => setActiveSourceId(null))
        } else {
          const idx = p.sourceSummary.findIndex((r) => r.id === id)
          const pick = next[idx - 1] ?? next[0]!
          queueMicrotask(() => setActiveSourceId(pick.id))
        }
      }
      return { ...p, sourceSummary: next }
    })
  }

  /**
   * Reassign (or unassign) a single Source's worker group from anywhere in
   * the app — currently driven by the interactive Plan resource map's
   * drag-to-reassign and click-to-unassign affordances. Pass `null` to
   * detach the source. Also keeps `sourceVolume` rows that share the same
   * Source name aligned, mirroring `WorkerGroupDetailView.unassignSource`
   * / `assignSourceToThisGroup`.
   */
  const reassignSourceWorkerGroup = (
    id: string,
    newWorkerGroupId: string | null,
  ) => {
    setPlan((p) => {
      const target = p.sourceSummary.find((r) => r.id === id)
      if (!target) {
        return p
      }
      if (isSourceRowAttachmentDisabled(target)) {
        const wantAttachOrMove =
          newWorkerGroupId != null && String(newWorkerGroupId).trim() !== ''
        if (wantAttachOrMove) {
          return p
        }
      }
      const newId = newWorkerGroupId ?? ''
      if ((target.workerGroupId || '') === newId) {
        return p
      }
      // Auto-derive streamOrEdge from the new WG attachment so the v0.9.1
      // Excel column always matches reality. v2.0 dropped the wizard step
      // for this field — see workerGroupIds.deriveStreamOrEdge.
      const newStreamOrEdge = deriveStreamOrEdge(newId, p.workerGroups)
      const sourceName = (target.source || '').trim()
      return {
        ...p,
        sourceSummary: p.sourceSummary.map((r) =>
          r.id === id ? { ...r, workerGroupId: newId, streamOrEdge: newStreamOrEdge } : r,
        ),
        sourceVolume: sourceName
          ? p.sourceVolume.map((r) =>
              (r.source || '').trim() === sourceName
                ? { ...r, workerGroupId: newId }
                : r,
            )
          : p.sourceVolume,
      }
    })
  }

  /**
   * Renames a source. v0.9.1 dropped the Display name column — `source` is
   * now the row's identity, so this writes directly to that field.
   */
  const updateSourceName = (id: string, name: string) => {
    setPlan((p) => ({
      ...p,
      sourceSummary: p.sourceSummary.map((r) => (r.id === id ? { ...r, source: name } : r)),
    }))
  }

  const updateWorkerGroupWg = (id: string, wg: string) => {
    setPlan((p) => ({
      ...p,
      workerGroups: p.workerGroups.map((r) => (r.id === id ? { ...r, wg } : r)),
    }))
  }

  /**
   * Move `fromId` to land before/after `toId` inside a typed array. Returns
   * the original array if the move is a no-op (same id, missing id, or
   * resulting position identical to the current one). Pure — caller wraps
   * in `setPlan`.
   */
  const reorderById = <T extends { id: string }>(
    arr: T[],
    fromId: string,
    toId: string,
    position: 'before' | 'after',
  ): T[] => {
    if (fromId === toId) {
      return arr
    }
    const fromIdx = arr.findIndex((r) => r.id === fromId)
    const toIdx = arr.findIndex((r) => r.id === toId)
    if (fromIdx < 0 || toIdx < 0) {
      return arr
    }
    const next = arr.slice()
    const [moved] = next.splice(fromIdx, 1)
    if (!moved) {
      return arr
    }
    // After splice, indices >= fromIdx have shifted by -1. Recompute the
    // target's new index, then offset by `position`.
    const adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx
    const insertAt = position === 'before' ? adjustedTo : adjustedTo + 1
    if (insertAt === fromIdx) {
      return arr
    }
    next.splice(insertAt, 0, moved)
    return next
  }

  /**
   * Reorder a source row in `plan.sourceSummary`. The new order also
   * drives Excel export ordering (per-WG sheets read sources from
   * `plan.sourceSummary.filter(...)` in plan order, and overview
   * source rows follow the same order — see v091ExportWorkbook).
   */
  const reorderSources = (
    fromId: string,
    toId: string,
    position: DropPosition,
  ) => {
    if (position === 'nest') {
      return
    }
    setPlan((p) => {
      const next = reorderById(p.sourceSummary, fromId, toId, position)
      return next === p.sourceSummary ? p : { ...p, sourceSummary: next }
    })
  }

  /**
   * Reorder a worker group / fleet row in `plan.workerGroups`. The
   * caller (left nav) only allows drops within the same `kind`
   * section, but we still defensively no-op cross-kind moves so a
   * future caller can't shuffle Stream and Edge rows together. The
   * new order drives `wg-*` / `fl-*` sheet/tab order and the
   * Stream/Edge Overview bottom-table rows on export.
   */
  const reorderWorkerGroups = (
    fromId: string,
    toId: string,
    position: DropPosition,
  ) => {
    setPlan((p) => {
      const from = p.workerGroups.find((w) => w.id === fromId)
      const to = p.workerGroups.find((w) => w.id === toId)
      if (!from || !to || from.kind !== to.kind) {
        return p
      }
      if (from.kind === 'stream') {
        if (position === 'nest') {
          return p
        }
        const streams = p.workerGroups.filter((w) => w.kind !== 'edge')
        const edges = p.workerGroups.filter((w) => w.kind === 'edge')
        const nextStreams = reorderById(streams, fromId, toId, position)
        if (nextStreams === streams) {
          return p
        }
        return { ...p, workerGroups: [...nextStreams, ...edges] }
      }
      const streams = p.workerGroups.filter((w) => w.kind !== 'edge')
      const edges = p.workerGroups.filter((w) => w.kind === 'edge')
      const nextEdges = applyEdgeFleetReorder(edges, fromId, toId, position)
      return { ...p, workerGroups: [...streams, ...nextEdges] }
    })
  }

  const sortSourcesAlphabetically = useCallback((order: 'asc' | 'desc') => {
    setPlan((p) => {
      if (p.sourceSummary.length <= 1) {
        return p
      }
      const next = [...p.sourceSummary].sort((a, b) => {
        const la = (a.source?.trim() || '').toLowerCase()
        const lb = (b.source?.trim() || '').toLowerCase()
        const c = la.localeCompare(lb, undefined, { sensitivity: 'base' })
        const primary = order === 'asc' ? c : -c
        if (primary !== 0) {
          return primary > 0 ? 1 : -1
        }
        return a.id.localeCompare(b.id)
      })
      if (next.every((r, i) => r.id === p.sourceSummary[i]!.id)) {
        return p
      }
      return { ...p, sourceSummary: next }
    })
  }, [setPlan])

  const sortStreamWorkerGroupsAlphabetically = useCallback((order: 'asc' | 'desc') => {
    setPlan((p) => {
      const streams = p.workerGroups.filter((w) => w.kind !== 'edge')
      if (streams.length <= 1) {
        return p
      }
      const coll = (a: (typeof streams)[number], b: (typeof streams)[number]) => {
        const la = (a.wg.trim() || a.id).toLowerCase()
        const lb = (b.wg.trim() || b.id).toLowerCase()
        const c = la.localeCompare(lb, undefined, { sensitivity: 'base' })
        const primary = order === 'asc' ? c : -c
        if (primary !== 0) {
          return primary > 0 ? 1 : -1
        }
        return a.id.localeCompare(b.id)
      }
      const sorted = [...streams].sort(coll)
      const edges = p.workerGroups.filter((w) => w.kind === 'edge')
      const next = [...sorted, ...edges]
      if (next.every((r, i) => r.id === p.workerGroups[i]!.id)) {
        return p
      }
      return { ...p, workerGroups: next }
    })
  }, [setPlan])

  const sortEdgeFleetsAlphabeticallyInPlan = useCallback((order: 'asc' | 'desc') => {
    setPlan((p) => {
      const streams = p.workerGroups.filter((w) => w.kind !== 'edge')
      const edges = p.workerGroups.filter((w) => w.kind === 'edge')
      if (edges.length <= 1) {
        return p
      }
      const sorted = sortEdgeFleetsAlphabetically(edges, order)
      if (sorted.every((r, i) => r.id === edges[i]!.id)) {
        return p
      }
      return { ...p, workerGroups: [...streams, ...sorted] }
    })
  }, [setPlan])

  const sortSourcesByIngest = useCallback((direction: 'desc' | 'asc') => {
    setPlan((p) => {
      if (p.sourceSummary.length <= 1) {
        return p
      }
      const next = [...p.sourceSummary].sort((a, b) => {
        const ga = parseGb(a.avgDailyGb)
        const gb = parseGb(b.avgDailyGb)
        const va = Number.isFinite(ga) && ga >= 0 ? ga : 0
        const vb = Number.isFinite(gb) && gb >= 0 ? gb : 0
        const primary = direction === 'desc' ? vb - va : va - vb
        if (primary !== 0) {
          return primary > 0 ? 1 : -1
        }
        return a.id.localeCompare(b.id)
      })
      if (next.every((r, i) => r.id === p.sourceSummary[i]!.id)) {
        return p
      }
      return { ...p, sourceSummary: next }
    })
  }, [setPlan])

  const sortStreamWorkerGroupsByIngest = useCallback((direction: 'desc' | 'asc') => {
    setPlan((p) => {
      const streams = p.workerGroups.filter((w) => w.kind !== 'edge')
      if (streams.length <= 1) {
        return p
      }
      const sorted = [...streams].sort((a, b) => {
        const va = sumAvgDailyFromSourceSummaryForWg(p, a.id).sum
        const vb = sumAvgDailyFromSourceSummaryForWg(p, b.id).sum
        const primary = direction === 'desc' ? vb - va : va - vb
        if (primary !== 0) {
          return primary > 0 ? 1 : -1
        }
        return a.id.localeCompare(b.id)
      })
      const edges = p.workerGroups.filter((w) => w.kind === 'edge')
      const next = [...sorted, ...edges]
      if (next.every((r, i) => r.id === p.workerGroups[i]!.id)) {
        return p
      }
      return { ...p, workerGroups: next }
    })
  }, [setPlan])

  const sortEdgeFleetsByIngestInPlan = useCallback((direction: 'desc' | 'asc') => {
    setPlan((p) => {
      const streams = p.workerGroups.filter((w) => w.kind !== 'edge')
      const edges = p.workerGroups.filter((w) => w.kind === 'edge')
      if (edges.length <= 1) {
        return p
      }
      const sorted = sortEdgeFleetsByIngest(edges, p, direction)
      if (sorted.every((r, i) => r.id === edges[i]!.id)) {
        return p
      }
      return { ...p, workerGroups: [...streams, ...sorted] }
    })
  }, [setPlan])

  const addWorkerGroupWithName = (wg: string, kind: WorkerGroupKind = 'stream') => {
    const id = newId()
    setPlan((p) => {
      const w = defaultWorkerGroupRow(kind)
      w.id = id
      w.wg = wg
      if (p.workerGroups.length > 0) {
        return { ...p, workerGroups: [...p.workerGroups, w] }
      }
      return { ...p, workerGroups: [w] }
    })
    setActiveWorkerGroupId(id)
    setMainView('workerGroup')
  }

  const addSubfleetWithName = (name: string, topLevelParentId: string) => {
    const parent = plan.workerGroups.find((e) => e.id === topLevelParentId)
    if (!parent || parent.kind !== 'edge' || (parent.parentFleetId ?? '').trim()) {
      return
    }
    const id = newId()
    setPlan((p) => {
      const streams = p.workerGroups.filter((w) => w.kind !== 'edge')
      const edges = p.workerGroups.filter((w) => w.kind === 'edge')
      const w = defaultWorkerGroupRow('edge')
      w.id = id
      w.wg = name
      w.parentFleetId = topLevelParentId
      const nextEdges = normalizeEdgeFleetOrder([...edges, w])
      return { ...p, workerGroups: [...streams, ...nextEdges] }
    })
    setActiveWorkerGroupId(id)
    setMainView('workerGroup')
  }

  const removeWorkerGroup = (id: string) => {
    setPlan((p) => {
      if (!p.workerGroups.some((w) => w.id === id)) {
        return p
      }
      const rest = p.workerGroups
        .filter((w) => w.id !== id)
        .map((w) => ((w.parentFleetId ?? '').trim() === id ? { ...w, parentFleetId: '' } : w))
      queueMicrotask(() => {
        setActiveWorkerGroupId((c) => (c === id ? (rest[0]?.id ?? null) : c))
      })
      return {
        ...p,
        workerGroups: rest,
        sourceVolume: p.sourceVolume.map((v) =>
          v.workerGroupId === id ? { ...v, workerGroupId: '', wg: v.wg } : v,
        ),
        sourceSummary: p.sourceSummary.map((r) =>
          // Detach + clear streamOrEdge: an unattached source has no
          // Stream/Edge identity (auto-derived from WG.kind).
          r.workerGroupId === id ? { ...r, workerGroupId: '', streamOrEdge: '' } : r,
        ),
      }
    })
  }

  const activeRow = plan.sourceSummary.find((r) => r.id === activeSourceId) ?? null
  const sourceIndex = activeRow
    ? plan.sourceSummary.findIndex((r) => r.id === activeRow.id)
    : 0

  const patchSourceRow = useCallback(
    (id: string) => (k: keyof SourceSummaryRow, v: string | boolean) => {
      setPlan((p) => {
        const cur = p.sourceSummary.find((r) => r.id === id)
        if (!cur) {
          return p
        }
        if (k === 'workerGroupId' && isSourceRowAttachmentDisabled(cur)) {
          const nextId = typeof v === 'string' ? v.trim() : ''
          const curId = (cur.workerGroupId || '').trim()
          if (nextId !== '' && nextId !== curId) {
            return p
          }
        }
        return {
          ...p,
          sourceSummary: p.sourceSummary.map((r) => {
            if (r.id !== id) return r
            const patch = { ...r, [k]: v } as SourceSummaryRow
            if (
              k === 'workerGroupId' &&
              isSourceRowAttachmentDisabled(cur) &&
              typeof v === 'string' &&
              v.trim() === ''
            ) {
              return { ...patch, streamOrEdge: '' }
            }
            return patch
          }),
        }
      })
    },
    [setPlan],
  )

  return (
    <div className="adoption-app-shell relative flex h-svh min-h-0 flex-col overflow-hidden text-cribl-ink">
      <ConfirmClearDialog
        open={confirmClearOpen}
        onCancel={() => setConfirmClearOpen(false)}
        onConfirm={() => {
          setConfirmClearOpen(false)
          setPostAdd(null)
          clearPostAddPreference()
          setEnvironmentSnapshot(null)
          reset()
        }}
      />
      <ConfirmRemoveWorkerGroupDialog
        open={confirmRemoveWorkerGroupId != null}
        workerGroupName={
          confirmRemoveWorkerGroupId
            ? plan.workerGroups.find((w) => w.id === confirmRemoveWorkerGroupId)?.wg ?? 'Worker group'
            : 'Worker group'
        }
        assignedSourcesCount={
          confirmRemoveWorkerGroupId
            ? plan.sourceSummary.filter((s) => s.workerGroupId === confirmRemoveWorkerGroupId).length
            : 0
        }
        onCancel={() => setConfirmRemoveWorkerGroupId(null)}
        onConfirm={() => {
          const id = confirmRemoveWorkerGroupId
          setConfirmRemoveWorkerGroupId(null)
          if (id) {
            removeWorkerGroup(id)
          }
        }}
      />
      <ConfirmRemoveSourceDialog
        open={confirmRemoveSourceId != null}
        sourceName={(() => {
          if (!confirmRemoveSourceId) return 'Source'
          const i = plan.sourceSummary.findIndex((s) => s.id === confirmRemoveSourceId)
          return i >= 0 ? sourceLabel(plan.sourceSummary[i]!, i) : 'Source'
        })()}
        onCancel={() => setConfirmRemoveSourceId(null)}
        onConfirm={() => {
          const id = confirmRemoveSourceId
          setConfirmRemoveSourceId(null)
          if (id) {
            removeSource(id)
          }
        }}
      />
      {addSourceOpen && (
        <AddSourceDialog
          nextLabel={nextSourcePlaceholder}
          onCancel={() => setAddSourceOpen(false)}
          onConfirm={(name) => {
            addSourceWithName(name)
            setAddSourceOpen(false)
          }}
        />
      )}
      {addWorkerGroupOpen && (
        <AddWorkerGroupDialog
          kind={addWorkerGroupOpen}
          nextLabel={nextWorkerGroupPlaceholder}
          onCancel={() => setAddWorkerGroupOpen(null)}
          onConfirm={(name) => {
            addWorkerGroupWithName(name, addWorkerGroupOpen)
            setAddWorkerGroupOpen(null)
          }}
        />
      )}
      {addSubfleetOpen && (
        <AddSubfleetDialog
          plan={plan}
          initialParentFleetId={addSubfleetOpen.initialParentFleetId}
          nextLabel={nextSubfleetPlaceholder}
          onCancel={() => setAddSubfleetOpen(null)}
          onConfirm={(name, parentId) => {
            setAddSubfleetOpen(null)
            addSubfleetWithName(name, parentId)
          }}
        />
      )}
      <PostAddSourceChoiceDialog
        open={postAdd?.kind === 'choice'}
        sourceDisplayName={postAdd?.kind === 'choice' ? postAdd.sourceDisplayName : ''}
        onChoose={(choice, remember) => {
          if (remember) {
            setPostAddPreference(choice)
          }
          if (choice === 'wizard') {
            setPostAdd({ kind: 'wizard' })
          } else {
            setPostAdd(null)
          }
        }}
      />
      {activeRow && postAdd?.kind === 'wizard' && (
        <SourceFormWizardDialog
          open
          row={activeRow}
          s={patchSourceRow(activeRow.id)}
          onClose={() => setPostAdd(null)}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          className="group/rail relative hidden min-h-0 shrink-0 self-stretch flex-col border-r border-cribl-border/90 bg-cribl-rail print:hidden lg:flex"
          style={
            railCollapsed
              ? { width: '2.2rem', minWidth: '2.2rem' }
              : { width: railW, minWidth: minW }
          }
          aria-label="Plan, Worker Groups, and Sources"
        >
          {railCollapsed ? (
            <div className="flex h-full min-h-0 flex-col items-center border-b-0 py-2">
              <button
                type="button"
                title="Expand sidebar"
                aria-label="Expand sidebar"
                onClick={toggleRail}
                className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cribl-border/80 bg-white/80 text-cribl-muted transition hover:border-cribl-border hover:text-cribl-ink"
                aria-expanded="false"
              >
                <span className="text-xs font-semibold" aria-hidden>
                  »
                </span>
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-end gap-1 border-b border-cribl-border/50 px-2 py-1.5">
                <button
                  type="button"
                  title="Collapse sidebar"
                  onClick={toggleRail}
                  className="inline-flex h-7 items-center justify-center rounded-md px-1.5 text-xs font-medium text-cribl-muted hover:bg-white/60 hover:text-cribl-ink"
                  aria-expanded="true"
                >
                  <span className="sr-only">Collapse sidebar</span>
                  <span aria-hidden>«</span>
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-0 pb-4 pr-0">
                <PlanSidebarRail
                  plan={plan}
                  mainView={mainView}
                  activeSourceId={activeSourceId}
                  activeWorkerGroupId={activeWorkerGroupId}
                  onSelectOverview={() => setMainView('overview')}
                  onSelectWorkerGroups={() => setMainView('workerGroups')}
                  onSelectFleets={() => setMainView('fleets')}
                  onSelectSources={() => setMainView('sources')}
                  onSelectActivation={() => setMainView('activation')}
                  onSelectExecBrief={() => setMainView('execBrief')}
                  onSelectSettings={() => setMainView('settings')}
                  onSelectWorkerGroup={(id) => {
                    setActiveWorkerGroupId(id)
                    setMainView('workerGroup')
                  }}
                  onAddWorkerGroup={(kind) => openAddWorkerGroup(kind ?? 'stream')}
                  onRemoveWorkerGroup={(id) => setConfirmRemoveWorkerGroupId(id)}
                  onUpdateWorkerGroupWg={updateWorkerGroupWg}
                  onReorderWorkerGroups={reorderWorkerGroups}
                  onSelectSource={(id) => {
                    setActiveSourceId(id)
                    setMainView('source')
                  }}
                  onAddSource={openAddSource}
                  onRemoveSource={(id) => setConfirmRemoveSourceId(id)}
                  onRenameSource={updateSourceName}
                  onReorderSources={reorderSources}
                  onSortSourcesAlphabetically={sortSourcesAlphabetically}
                  onSortSourcesByIngest={sortSourcesByIngest}
                  onSortStreamWorkerGroupsAlphabetically={sortStreamWorkerGroupsAlphabetically}
                  onSortStreamWorkerGroupsByIngest={sortStreamWorkerGroupsByIngest}
                  onSortFleetWorkerGroupsAlphabetically={sortEdgeFleetsAlphabeticallyInPlan}
                  onSortFleetWorkerGroupsByIngest={sortEdgeFleetsByIngestInPlan}
                  onSelectImport={() => setMainView('import')}
                  onSelectEnvironment={() => goToEnvironment()}
                  onSelectExport={() => setMainView('export')}
                  onClearPlan={() => setConfirmClearOpen(true)}
                />
              </div>
            </>
          )}
          {!railCollapsed && (
            <div
              role="separator"
              title="Drag to resize sidebar"
              onPointerDown={beginResize}
              className="absolute right-0 top-0 z-20 h-full w-2 cursor-ew-resize select-none border-r border-transparent hover:border-cribl-primary/20 hover:bg-cribl-primary/5 group-hover/rail:bg-cribl-primary/5"
              aria-label="Resize sidebar"
            />
          )}
        </aside>

        <div className="adoption-app-main-column relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-cribl-canvas">
          {/* overflow-x-hidden: wide headers (e.g. Activation PS tier) must not paint under the AI rail */}
          <div className="adoption-app-main-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            <header className="relative z-30 w-full border-b border-cribl-border bg-white">
              {/* Full width of main (not the overview max-w) so Customer aligns to the true top-right of this panel. */}
              <div className="w-full px-4 py-3 sm:px-6 sm:py-3.5">
                <div className="relative w-full min-h-14 sm:min-h-16 max-md:pb-0.5">
                  <div
                    className="flex w-full flex-col items-center max-md:justify-center
                    md:absolute md:left-1/2 md:top-1/2 md:z-0
                    md:w-[min(28rem,calc(100%-22rem))] md:max-w-full
                    md:-translate-x-1/2 md:-translate-y-1/2
                    md:items-center md:justify-center
                  "
                  >
                    <h1 className="m-0 text-center text-xl font-semibold tracking-wide text-cribl-ink sm:text-2xl md:text-3xl">
                      Adoption Plan
                    </h1>
                    <p
                      className="m-0 mt-0.5 text-center font-mono text-[10px] font-normal tracking-wide text-cribl-muted/45"
                      title={`Version ${APP_VERSION}`}
                    >
                      v{APP_VERSION}
                    </p>
                  </div>
                  <div
                    className="mt-2.5 w-full min-[480px]:mt-0 min-[480px]:flex min-[480px]:justify-end
                    md:mt-0
                    md:absolute md:right-4 md:top-1/2 md:z-10 md:mt-0 lg:right-8
                    md:w-80 md:max-w-full
                    md:-translate-y-1/2
                  "
                  >
                    <HeaderCustomerName
                      className="min-w-0 w-full max-w-full"
                      value={plan.customerName}
                      onChange={(v) => setPlan((p) => ({ ...p, customerName: v }))}
                    />
                  </div>
                </div>
              </div>
            </header>

            <div className="adoption-app-mobile-nav sticky top-0 z-40 border-b border-cribl-border bg-cribl-canvas print:hidden lg:hidden">
              <PlanNavMobile
                plan={plan}
                mainView={mainView}
                activeSourceId={activeSourceId}
                activeWorkerGroupId={activeWorkerGroupId}
                onSelectOverview={() => setMainView('overview')}
                onSelectWorkerGroups={() => setMainView('workerGroups')}
                onSelectFleets={() => setMainView('fleets')}
                onSelectSources={() => setMainView('sources')}
                onSelectActivation={() => setMainView('activation')}
                onSelectExecBrief={() => setMainView('execBrief')}
                onSelectSettings={() => setMainView('settings')}
                onSelectWorkerGroup={(id) => {
                  setActiveWorkerGroupId(id)
                  setMainView('workerGroup')
                }}
                onAddWorkerGroup={(kind) => openAddWorkerGroup(kind ?? 'stream')}
                onRemoveWorkerGroup={(id) => setConfirmRemoveWorkerGroupId(id)}
                onUpdateWorkerGroupWg={updateWorkerGroupWg}
                onReorderWorkerGroups={reorderWorkerGroups}
                onSelectSource={(id) => {
                  setActiveSourceId(id)
                  setMainView('source')
                }}
                onAddSource={openAddSource}
                onRemoveSource={(id) => setConfirmRemoveSourceId(id)}
                onRenameSource={updateSourceName}
                onReorderSources={reorderSources}
                onSelectImport={() => setMainView('import')}
                onSelectEnvironment={() => goToEnvironment()}
                onSelectExport={() => setMainView('export')}
                onClearPlan={() => setConfirmClearOpen(true)}
              />
            </div>

            <main className="mx-auto min-w-0 w-full max-w-[min(100%,80rem)] overflow-x-hidden px-4 py-5 sm:px-8 sm:py-7">
              {mainView === 'overview' && (
                <PlanDataOverview
                  plan={plan}
                  onGoToWorkers={() => {
                    setMainView('workerGroups')
                  }}
                  onGoToFleets={() => {
                    setMainView('fleets')
                  }}
                  onOpenWorkerGroup={(id) => {
                    setActiveWorkerGroupId(id)
                    setMainView('workerGroup')
                  }}
                  onGoToSources={() => setMainView('sources')}
                  onSelectSource={(id) => {
                    setActiveSourceId(id)
                    setMainView('source')
                  }}
                  onReassignSource={reassignSourceWorkerGroup}
                  onAddSource={openAddSource}
                  onAddWorkerGroup={openAddWorkerGroup}
                  onGoToActivation={() => setMainView('activation')}
                  onChangeCustomerName={(v) => setPlan((p) => ({ ...p, customerName: v }))}
                />
              )}

              {mainView === 'execBrief' && <ExecutiveReadoutView plan={plan} setPlan={setPlan} />}

              {mainView === 'workerGroups' && (
                <WorkerGroupsIndexView
                  plan={plan}
                  setPlan={setPlan}
                  kind="stream"
                  onOpenGroup={(id) => {
                    setActiveWorkerGroupId(id)
                    setMainView('workerGroup')
                  }}
                  onCreateTopLevel={() => setAddWorkerGroupOpen('stream')}
                />
              )}

              {mainView === 'fleets' && (
                <WorkerGroupsIndexView
                  plan={plan}
                  setPlan={setPlan}
                  kind="edge"
                  onOpenGroup={(id) => {
                    setActiveWorkerGroupId(id)
                    setMainView('workerGroup')
                  }}
                  onCreateTopLevel={() => setAddWorkerGroupOpen('edge')}
                  onAddSubfleetFromCard={(edgeId) => {
                    const tid = topLevelFleetIdForNewSubfleet(plan.workerGroups, edgeId)
                    if (tid) {
                      setAddSubfleetOpen({ initialParentFleetId: tid })
                    }
                  }}
                />
              )}

              {mainView === 'sources' && (
                <SourcesIndexView
                  plan={plan}
                  setPlan={setPlan}
                  showDisabledSourcesInLists={showDisabledSourcesInLists}
                  onShowDisabledSourcesInListsChange={setShowDisabledSourcesInLists}
                  onOpenSource={(id) => {
                    setActiveSourceId(id)
                    setMainView('source')
                  }}
                  onAddSource={openAddSource}
                />
              )}

              {mainView === 'activation' && <ActivationView plan={plan} setPlan={setPlan} />}

              {mainView === 'settings' && <SettingsView />}

              {mainView === 'source' && activeRow && (
                <DataSourcesView
                  plan={plan}
                  setPlan={setPlan}
                  row={activeRow}
                  sourceIndex={sourceIndex >= 0 ? sourceIndex : 0}
                  showDisabledSourcesInLists={showDisabledSourcesInLists}
                  onShowDisabledSourcesInListsChange={setShowDisabledSourcesInLists}
                  onOpenGuidedTour={() => setPostAdd({ kind: 'wizard' })}
                  guidedEntryOpen={postAdd?.kind === 'wizard'}
                  onExitGuidedEntry={() => setPostAdd(null)}
                />
              )}

              {mainView === 'source' && !activeRow && (
                <p className="m-0 text-sm text-cribl-muted">
                  {plan.sourceSummary.length === 0
                    ? 'No data sources yet. Use + Add source in the sidebar to add one.'
                    : 'Select a data source in the sidebar.'}
                </p>
              )}

              {mainView === 'workerGroup' && activeWorkerGroupId && (
                <WorkerGroupDetailView
                  plan={plan}
                  setPlan={setPlan}
                  groupId={activeWorkerGroupId}
                  onRemoveGroup={removeWorkerGroup}
                  onSelectSource={(id) => {
                    setActiveSourceId(id)
                    setMainView('source')
                  }}
                  onAddSource={openAddSource}
                  onSelectWorkerGroup={(wid) => {
                    setActiveWorkerGroupId(wid)
                    setMainView('workerGroup')
                  }}
                  onRequestCreateSubfleet={() => {
                    const tid = topLevelFleetIdForNewSubfleet(plan.workerGroups, activeWorkerGroupId ?? '')
                    if (tid) {
                      setAddSubfleetOpen({ initialParentFleetId: tid })
                    }
                  }}
                />
              )}

              {mainView === 'workerGroup' && !activeWorkerGroupId && (
                <p className="m-0 text-sm text-cribl-muted">
                  {plan.workerGroups.length === 0
                    ? 'No worker groups yet. Use + Add Worker Group in the sidebar to add one.'
                    : 'Select a worker group in the sidebar.'}
                </p>
              )}

              {mainView === 'import' && (
                <ImportWorkbookView
                  plan={plan}
                  environmentSnapshot={environmentSnapshot}
                  setPlan={setPlan}
                  setEnvironmentSnapshot={setEnvironmentSnapshot}
                  onViewEnvironment={goToEnvironment}
                />
              )}

              {mainView === 'environment' && (
                <EnvironmentView
                  snapshot={environmentSnapshot}
                  planProvenance={plan.planProvenance}
                  onGoToImport={() => setMainView('import')}
                />
              )}

              {mainView === 'export' && <ExportWorkbookView plan={plan} />}
              <footer className="mt-8 text-center text-xs text-cribl-muted/80">
                <p className="m-0">Built for Cribl field adoption planning.</p>
                <p className="m-0 mt-1 font-mono text-[10px] text-cribl-muted/50">Adoption Plan v{APP_VERSION}</p>
              </footer>
            </main>
          </div>

          <AiAssistantPanel plan={plan} setPlan={setPlan} />
        </div>
      </div>
    </div>
  )
}

export default App
