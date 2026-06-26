import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { PlanState } from '../types/planTypes'
import type { CriblEnvironmentSnapshot } from '../lib/criblEnvironmentTypes'
import { isCriblLocalShell } from '../lib/kvStore'
import {
  readImportOmitDisabledInputs,
  readImportOmitStockGroups,
} from '../lib/importHarvestOptions'
import { hasExistingPlanData } from '../lib/hasExistingPlanData'
import { buildImportOverwriteDiff, type ImportOverwriteDiff } from '../lib/importOverwriteDiff'
import { importTenantTopology } from '../lib/importTopology'
import { applyPendingImport, type PendingImport } from '../lib/pendingImport'
import { topologyHarvestToPlanState, type TenantImportDebugPayload } from '../lib/topologyToPlan'
import { ImportHarvestOptions } from './ImportHarvestOptions'
import { ImportOverwriteReviewDialog } from './ImportOverwriteReviewDialog'

type Props = {
  plan: PlanState
  environmentSnapshot: CriblEnvironmentSnapshot | null
  setPlan: Dispatch<SetStateAction<PlanState>>
  setEnvironmentSnapshot: (s: CriblEnvironmentSnapshot | null) => void
  embedded?: boolean
  onViewEnvironment?: () => void
}

function isInCriblIframe(): boolean {
  return typeof window !== 'undefined' && typeof window.CRIBL_API_URL === 'string'
}

/**
 * Bootstrap plan topology from the live Cribl Leader (Stream worker groups / fleets
 * and configured **sources** from Leader inputs). App Platform only.
 */
export function TenantImportSection({
  plan,
  environmentSnapshot,
  setPlan,
  setEnvironmentSnapshot,
  embedded,
  onViewEnvironment,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [importDiff, setImportDiff] = useState<ImportOverwriteDiff | null>(null)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [importDebug, setImportDebug] = useState<TenantImportDebugPayload | null>(null)
  const [debugCopyOk, setDebugCopyOk] = useState(false)
  const [omitStockGroups, setOmitStockGroups] = useState(readImportOmitStockGroups)
  const [omitDisabledInputs, setOmitDisabledInputs] = useState(readImportOmitDisabledInputs)

  const clearReview = useCallback(() => {
    setReviewOpen(false)
    setImportDiff(null)
    setPendingImport(null)
  }, [])

  const applyImport = useCallback(
    async (pending: PendingImport) => {
      setError(null)
      setOk(null)
      setImportDebug(null)
      setDebugCopyOk(false)
      setBusy(true)
      try {
        const result = await applyPendingImport(pending, { setPlan, setEnvironmentSnapshot })
        if (result.importDebug) {
          setImportDebug(result.importDebug)
        }
        setOk(result.message)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Tenant import failed.')
      } finally {
        setBusy(false)
      }
    },
    [setPlan, setEnvironmentSnapshot],
  )

  const runHarvest = useCallback(async () => {
    setError(null)
    setOk(null)
    setImportDebug(null)
    setDebugCopyOk(false)
    setBusy(true)
    try {
      const options = {
        omitStockWorkerGroups: omitStockGroups,
        omitDisabledInputs,
      }
      const { capturedAt, harvest, environment } = await importTenantTopology(options)
      const nextPlan = topologyHarvestToPlanState(harvest)

      if (hasExistingPlanData(plan)) {
        const diff = buildImportOverwriteDiff({
          importKind: 'tenant',
          currentPlan: plan,
          nextPlan,
          currentEnvironment: environmentSnapshot,
          nextEnvironment: environment,
          harvestWarnings: harvest.warnings,
        })
        setPendingImport({
          kind: 'topology',
          plan: nextPlan,
          environment,
          capturedAt,
          harvest,
          harvestWarnings: harvest.warnings,
          importKind: 'tenant',
        })
        setImportDiff(diff)
        setReviewOpen(true)
        return
      }

      await applyImport({
        kind: 'topology',
        plan: nextPlan,
        environment,
        capturedAt,
        harvest,
        harvestWarnings: harvest.warnings,
        importKind: 'tenant',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tenant import failed.')
    } finally {
      setBusy(false)
    }
  }, [applyImport, environmentSnapshot, omitDisabledInputs, omitStockGroups, plan])

  if (!isInCriblIframe()) {
    return null
  }

  const shell = embedded ? 'div' : 'section'
  const Wrapper = shell as 'div'

  return (
    <Wrapper className={embedded ? undefined : 'rounded-xl border border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5'}>
      <ImportOverwriteReviewDialog
        open={reviewOpen}
        diff={importDiff}
        busy={busy}
        onCancel={clearReview}
        onAccept={() => {
          const pending = pendingImport
          clearReview()
          if (pending) {
            void applyImport(pending)
          }
        }}
      />
      {!embedded ? (
        <h3 className="m-0 text-sm font-semibold text-cribl-ink">Import from live tenant</h3>
      ) : null}
      <p className="m-0 mt-2 text-sm text-cribl-muted">
        Pull worker groups, fleets, and configured sources from this Leader. Routing is available on the Environment page after import.
      </p>
      <div className="mt-3">
        <ImportHarvestOptions
          omitStockGroups={omitStockGroups}
          setOmitStockGroups={setOmitStockGroups}
          omitDisabledInputs={omitDisabledInputs}
          setOmitDisabledInputs={setOmitDisabledInputs}
        />
      </div>
      {isCriblLocalShell() ? (
        <p
          className="m-0 mt-2 rounded-lg border border-amber-200/90 bg-amber-50/90 px-3 py-2 text-xs leading-relaxed text-amber-950"
          role="note"
        >
          <strong className="font-semibold">Dev shell:</strong> the Cribl <span className="font-mono">__local__</span>{' '}
          context has no pack KV, and the plan may not reload after a full page refresh. Use a{' '}
          <strong className="font-semibold">deployed</strong> installed pack to verify persistence, or export an{' '}
          <span className="font-mono">.xlsx</span> as your snapshot (see <span className="font-mono">CRIBL_DEV_NOTES.md</span>).
        </p>
      ) : null}
      {ok && (
        <div className="m-0 mt-3 space-y-2">
          <p className="m-0 rounded-lg border border-cribl-primary/30 bg-cribl-primary-soft px-3 py-2 text-sm text-cribl-primary-ink" role="status">
            {ok}
          </p>
          {onViewEnvironment ? (
            <button
              type="button"
              className="text-sm font-medium text-cribl-primary hover:underline"
              onClick={() => onViewEnvironment()}
            >
              View routing in Environment →
            </button>
          ) : null}
        </div>
      )}
      {error && (
        <p className="m-0 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">
          {error}
        </p>
      )}
      {importDebug && (
        <details className="mt-3 rounded-lg border border-cribl-border/80 bg-cribl-canvas/40 px-3 py-2">
          <summary className="cursor-pointer select-none text-sm font-medium text-cribl-ink outline-none focus-visible:ring-2 focus-visible:ring-cribl-primary/35">
            Import debug
            <span className="ml-1.5 font-normal text-cribl-muted">
              ({importDebug.totals.workerGroupsInPlan} groups · {importDebug.totals.syntheticSourcesInPlan} synthetic sources
              {importDebug.totals.harvestWarningCount > 0
                ? ` · ${importDebug.totals.harvestWarningCount} warning(s)`
                : ''}
              )
            </span>
          </summary>
          <p className="m-0 mt-2 border-t border-cribl-border/50 pt-2 text-xs leading-relaxed text-cribl-muted">
            What the Leader returned and how it mapped into this plan. May include internal input ids or collector types — only share
            when appropriate. Captured <span className="font-mono text-cribl-ink/80">{importDebug.capturedAt}</span>.
          </p>
          {importDebug.harvest.warnings.length > 0 && (
            <ul className="m-0 mt-2 list-inside list-disc space-y-0.5 border-t border-amber-200/80 pt-2 text-xs text-amber-950">
              {importDebug.harvest.warnings.map((w, i) => (
                <li key={`${i}-${w.slice(0, 48)}`}>{w}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 overflow-x-auto rounded-md border border-cribl-border/70 bg-white">
            <table className="w-full min-w-[28rem] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-cribl-border/80 bg-cribl-canvas/60 text-cribl-muted">
                  <th className="px-2 py-1.5 font-medium">Group id</th>
                  <th className="px-2 py-1.5 font-medium">Label</th>
                  <th className="px-2 py-1.5 font-medium">Kind</th>
                  <th className="px-2 py-1.5 font-medium">Inputs</th>
                  <th className="px-2 py-1.5 font-medium">Source rows</th>
                </tr>
              </thead>
              <tbody>
                {importDebug.perGroup.map((row) => (
                  <tr key={row.criblGroupId} className="border-b border-cribl-border/40 last:border-b-0">
                    <td className="px-2 py-1.5 font-mono text-cribl-ink/90">{row.criblGroupId}</td>
                    <td className="max-w-[10rem] truncate px-2 py-1.5 text-cribl-ink/90" title={row.displayLabel}>
                      {row.displayLabel}
                    </td>
                    <td className="px-2 py-1.5 capitalize text-cribl-ink/80">{row.kind}</td>
                    <td className="px-2 py-1.5 tabular-nums text-cribl-ink/80">{row.leaderInputsFetched}</td>
                    <td className="px-2 py-1.5 tabular-nums text-cribl-ink/80">{row.sourceRowsImported}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 mt-3 text-xs font-medium text-cribl-ink">Imported sources (plan rows)</p>
          <div className="mt-1 overflow-x-auto rounded-md border border-cribl-border/70 bg-white">
            <table className="w-full min-w-[40rem] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-cribl-border/80 bg-cribl-canvas/60 text-cribl-muted">
                  <th className="px-2 py-1.5 font-medium">Leader group</th>
                  <th className="px-2 py-1.5 font-medium">Worker group</th>
                  <th className="px-2 py-1.5 font-medium">Source label</th>
                  <th className="px-2 py-1.5 font-medium">Collector type</th>
                  <th className="px-2 py-1.5 font-medium">Source tile</th>
                  <th className="px-2 py-1.5 font-medium">Stream/Edge</th>
                  <th className="px-2 py-1.5 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {importDebug.syntheticSourceDetails.map((row, i) => (
                  <tr key={`${row.source}-${i}`} className="border-b border-cribl-border/40 last:border-b-0 align-top">
                    <td className="px-2 py-1.5 font-mono text-cribl-ink/90">{row.criblGroupId ?? '—'}</td>
                    <td className="max-w-[8rem] truncate px-2 py-1.5 text-cribl-ink/90" title={row.workerGroupLabel}>
                      {row.workerGroupLabel}
                    </td>
                    <td className="max-w-[14rem] truncate px-2 py-1.5 text-cribl-ink/90" title={row.source}>
                      {row.source}
                    </td>
                    <td className="max-w-[10rem] truncate px-2 py-1.5 font-mono text-[11px] text-cribl-ink/85" title={row.collectorType}>
                      {row.collectorType || '—'}
                    </td>
                    <td className="max-w-[10rem] truncate px-2 py-1.5 text-cribl-ink/85" title={row.sourceTile}>
                      {row.sourceTile || '—'}
                    </td>
                    <td className="px-2 py-1.5 text-cribl-ink/80">{row.streamOrEdge || '—'}</td>
                    <td className="max-w-[10rem] truncate px-2 py-1.5 text-cribl-muted" title={row.additionalNotes}>
                      {row.additionalNotes ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex h-8 items-center justify-center rounded-md border border-cribl-border bg-white px-3 text-xs font-semibold text-cribl-ink hover:bg-cribl-canvas/60"
              onClick={() => {
                const text = JSON.stringify(importDebug, null, 2)
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(text)
                    setDebugCopyOk(true)
                    window.setTimeout(() => setDebugCopyOk(false), 2000)
                  } catch {
                    setDebugCopyOk(false)
                  }
                })()
              }}
            >
              {debugCopyOk ? 'Copied' : 'Copy full JSON'}
            </button>
            {debugCopyOk && (
              <span className="text-xs text-emerald-800" role="status">
                Payload copied to clipboard.
              </span>
            )}
          </div>
          <details className="mt-2 rounded-md border border-cribl-border/60 bg-white/80">
            <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium text-cribl-ink">Raw JSON preview</summary>
            <pre className="m-0 max-h-64 overflow-auto border-t border-cribl-border/50 p-2 font-mono text-[11px] leading-snug text-cribl-ink/90">
              {JSON.stringify(importDebug, null, 2)}
            </pre>
          </details>
        </details>
      )}
      <div className="mt-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void runHarvest()
          }}
          className="inline-flex h-10 min-w-[12rem] items-center justify-center rounded-lg bg-cribl-navy px-4 text-sm font-semibold text-white shadow-[0_1px_0_rgba(0,0,0,0.1)] transition hover:bg-cribl-navy-mid disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Reading tenant…' : 'Bootstrap from tenant'}
        </button>
      </div>
    </Wrapper>
  )
}
