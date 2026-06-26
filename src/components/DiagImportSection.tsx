import { useCallback, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { PlanState } from '../types/planTypes'
import type { CriblEnvironmentSnapshot } from '../lib/criblEnvironmentTypes'
import { hasExistingPlanData } from '../lib/hasExistingPlanData'
import { buildImportOverwriteDiff, type ImportOverwriteDiff } from '../lib/importOverwriteDiff'
import { importDiagTopology } from '../lib/importTopology'
import {
  readImportOmitDisabledInputs,
  readImportOmitStockGroups,
} from '../lib/importHarvestOptions'
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

/**
 * **File → Import:** bootstrap topology from an offline **Cribl diagnostic bundle**
 * (`.tar.gz` / `.tgz`). Parses bundle config in the browser — no Leader API.
 * UI: short plain-language copy; details in `docs/diag-import.md`.
 */
export function DiagImportSection({
  plan,
  environmentSnapshot,
  setPlan,
  setEnvironmentSnapshot,
  embedded,
  onViewEnvironment,
}: Props) {
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
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
        setError(e instanceof Error ? e.message : 'Diagnostic import failed.')
      } finally {
        setBusy(false)
      }
    },
    [setPlan, setEnvironmentSnapshot],
  )

  const runImport = useCallback(
    async (bytes: Uint8Array) => {
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
        const { capturedAt, harvest, environment } = await importDiagTopology(bytes, options)
        const nextPlan = topologyHarvestToPlanState(harvest)

        if (hasExistingPlanData(plan)) {
          const diff = buildImportOverwriteDiff({
            importKind: 'diag',
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
            importKind: 'diag',
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
          importKind: 'diag',
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Diagnostic import failed.')
      } finally {
        setBusy(false)
      }
    },
    [applyImport, environmentSnapshot, omitDisabledInputs, omitStockGroups, plan],
  )

  const Wrapper = embedded ? 'div' : 'section'

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
      {!embedded ? <h3 className="m-0 text-sm font-semibold text-cribl-ink">Import from diagnostic bundle</h3> : null}
      <p className="m-0 mt-2 text-sm text-cribl-muted">
        Upload a Cribl diagnostic bundle (<span className="font-mono text-cribl-ink/80">.tar.gz</span>) from the
        customer&apos;s environment. We load their worker groups, fleets, and data sources into this plan, plus routing
        for the Environment page — read entirely in your browser, with no connection to their Leader.
      </p>
      <div className="mt-3">
        <ImportHarvestOptions
          omitStockGroups={omitStockGroups}
          setOmitStockGroups={setOmitStockGroups}
          omitDisabledInputs={omitDisabledInputs}
          setOmitDisabledInputs={setOmitDisabledInputs}
        />
      </div>
      <details className="mt-3 rounded-lg border border-cribl-border/70 bg-cribl-canvas/40 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-cribl-ink">Browser &amp; privacy</summary>
        <p className="m-0 mt-2 border-t border-cribl-border/50 pt-2 text-xs text-cribl-muted">
          Uses in-browser gzip decompression. Bundles may contain sensitive hostnames or paths — handle per customer policy.
        </p>
      </details>
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
              {importDebug.totals.harvestWarningCount > 0 ? ` · ${importDebug.totals.harvestWarningCount} warning(s)` : ''})
            </span>
          </summary>
          <p className="m-0 mt-2 border-t border-cribl-border/50 pt-2 text-xs leading-relaxed text-cribl-muted">
            Parsed bundle contents and mapping into this plan. Captured{' '}
            <span className="font-mono text-cribl-ink/80">{importDebug.capturedAt}</span>.
          </p>
          {importDebug.harvest.warnings.length > 0 && (
            <ul className="m-0 mt-2 list-inside list-disc space-y-0.5 border-t border-amber-200/80 pt-2 text-xs text-amber-950">
              {importDebug.harvest.warnings.map((w, i) => (
                <li key={`${i}-${w.slice(0, 48)}`}>{w}</li>
              ))}
            </ul>
          )}
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
          </div>
        </details>
      )}
      <input
        id={id + '-diag'}
        ref={fileRef}
        type="file"
        accept=".tar.gz,.tgz,application/gzip,application/x-gzip"
        className="sr-only"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) {
            return
          }
          try {
            const ab = await f.arrayBuffer()
            const bytes = new Uint8Array(ab)
            void runImport(bytes)
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not read that file.')
          }
        }}
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-10 min-w-[12rem] items-center justify-center rounded-lg bg-cribl-navy px-4 text-sm font-semibold text-white shadow-[0_1px_0_rgba(0,0,0,0.1)] transition hover:bg-cribl-navy-mid disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Reading bundle…' : 'Choose diagnostic bundle'}
        </button>
        <label htmlFor={id + '-diag'} className="text-xs text-cribl-muted">
          Shows a change summary before replacing plan data.
        </label>
      </div>
    </Wrapper>
  )
}
