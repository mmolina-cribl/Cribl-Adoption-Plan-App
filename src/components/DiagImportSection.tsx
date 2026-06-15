import { useCallback, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { PlanState } from '../types/planTypes'
import { PLAN_STORAGE_KEY } from '../hooks/usePlanStorage'
import { clearImportShell } from '../lib/importShellStore'
import { kvSet } from '../lib/kvStore'
import { harvestDiagBundle } from '../lib/diagHarvest'
import {
  readImportOmitDisabledInputs,
  readImportOmitStockGroups,
  writeImportOmitDisabledInputs,
  writeImportOmitStockGroups,
} from '../lib/importHarvestOptions'
import { buildTenantImportDebugPayload, topologyHarvestToPlanState, type TenantImportDebugPayload } from '../lib/topologyToPlan'
import { ConfirmImportOverwriteDialog } from './ConfirmImportOverwriteDialog'

type Props = {
  setPlan: Dispatch<SetStateAction<PlanState>>
  hasExistingPlanData: boolean
}

/**
 * **File → Import:** bootstrap topology from an offline **Cribl diagnostic bundle**
 * (`.tar.gz` / `.tgz`). Parses bundle config in the browser — no Leader API.
 * UI: short plain-language copy; details in `docs/diag-import.md`.
 */
export function DiagImportSection({ setPlan, hasExistingPlanData }: Props) {
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<Uint8Array | null>(null)
  const [importDebug, setImportDebug] = useState<TenantImportDebugPayload | null>(null)
  const [debugCopyOk, setDebugCopyOk] = useState(false)
  const [omitStockGroups, setOmitStockGroups] = useState(readImportOmitStockGroups)
  const [skipDisabledInputs, setSkipDisabledInputs] = useState(readImportOmitDisabledInputs)

  const runImport = useCallback(
    async (bytes: Uint8Array) => {
      setError(null)
      setOk(null)
      setImportDebug(null)
      setDebugCopyOk(false)
      setBusy(true)
      try {
        const harvest = await harvestDiagBundle(bytes, {
          omitStockWorkerGroups: omitStockGroups,
          omitDisabledInputs: skipDisabledInputs,
        })
        const next = topologyHarvestToPlanState(harvest)
        const capturedAt = new Date().toISOString()
        const note =
          harvest.warnings.length > 0 ? `Diag import notes: ${harvest.warnings.join(' ')}` : undefined
        const planWithProvenance: PlanState = {
          ...next,
          planProvenance: { kind: 'diag', capturedAt, note },
        }
        setPlan(planWithProvenance)
        await kvSet(PLAN_STORAGE_KEY, planWithProvenance)
        setImportDebug(buildTenantImportDebugPayload(capturedAt, harvest, planWithProvenance))
        clearImportShell()
        setOk(
          'Plan replaced from diagnostic bundle. Review worker groups, fleets, and sources before exporting — routing is not imported.',
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Diagnostic import failed.')
      } finally {
        setBusy(false)
      }
    },
    [setPlan, omitStockGroups, skipDisabledInputs],
  )

  return (
    <section className="rounded-xl border border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
      <ConfirmImportOverwriteDialog
        open={confirmOpen}
        onCancel={() => {
          setConfirmOpen(false)
          setPendingFile(null)
        }}
        onConfirm={() => {
          const bytes = pendingFile
          setConfirmOpen(false)
          setPendingFile(null)
          if (bytes) {
            void runImport(bytes)
          }
        }}
      />
      <h3 className="m-0 text-sm font-semibold text-cribl-ink">Import from diagnostic bundle</h3>
      <p className="m-0 mt-2 text-sm leading-relaxed text-cribl-muted">
        Pick a Stream or Edge diagnostic archive (<span className="font-mono text-cribl-ink/90">.tar.gz</span> /{' '}
        <span className="font-mono text-cribl-ink/90">.tgz</span>) you already have on disk. We read configured **sources** from the bundle and
        fill worker groups / fleets in the plan — <strong className="text-cribl-ink/90">pipelines and routing are not imported.</strong> Use the
        import options below to omit built-in default group folders or disabled inputs when you want a shorter snapshot. Everything stays in your
        browser (nothing uploaded). For exact paths and limits, see <span className="font-mono text-cribl-ink/90">docs/diag-import.md</span>.
      </p>
      <div className="mt-3 space-y-2.5 rounded-lg border border-cribl-border/70 bg-cribl-canvas/40 px-3 py-2.5">
        <p className="m-0 text-xs font-medium text-cribl-ink/90">Import options</p>
        <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-snug text-cribl-muted">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={skipDisabledInputs}
            onChange={(e) => {
              const v = e.target.checked
              setSkipDisabledInputs(v)
              writeImportOmitDisabledInputs(v)
            }}
          />
          <span>
            <strong className="text-cribl-ink/85">Skip disabled inputs</strong> (on by default). Uncheck to include YAML entries with{' '}
            <span className="font-mono text-cribl-ink/80">disabled: true</span>. Those rows get <span className="font-mono"> disabled</span> appended
            to the plan <strong className="text-cribl-ink/85">Source</strong> name (UI + Excel).
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-snug text-cribl-muted">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={omitStockGroups}
            onChange={(e) => {
              const v = e.target.checked
              setOmitStockGroups(v)
              writeImportOmitStockGroups(v)
            }}
          />
          <span>
            <strong className="text-cribl-ink/85">Omit built-in default group folders</strong> (
            <span className="font-mono">default</span>, <span className="font-mono">defaultHybrid</span>,{' '}
            <span className="font-mono">default_fleet</span>, <span className="font-mono">default_outpost</span>). Off by default.
          </span>
        </label>
        <p className="m-0 text-[10px] leading-snug text-cribl-muted/85">These choices are saved in this browser for the next import.</p>
      </div>
      <p className="m-0 mt-2 rounded-lg border border-cribl-border/80 bg-cribl-canvas/50 px-3 py-2 text-sm leading-relaxed text-cribl-muted">
        <strong className="text-cribl-ink/90">Cribl.Cloud:</strong> diagnostics run from the <strong className="text-cribl-ink/90">Leader</strong>, not as
        separate <strong className="text-cribl-ink/90">per-worker / per-node</strong> bundles from the Workers UI the way you often can on self-managed
        Stream — so a file that lists every worker group’s on-disk config is harder to come by. <strong className="text-cribl-ink/90">Import from live
        tenant</strong> (when shown) is usually the better fit on Cloud.
      </p>
      <p className="m-0 mt-2 text-sm leading-relaxed text-cribl-muted">
        <strong className="text-cribl-ink/90">Self-managed:</strong> exported bundles from a Leader or Worker often work best; Worker exports
        usually give clearer per–worker-group results than Leader-only archives (which may show mostly **Leader (global)**).
      </p>
      <details className="mt-3 rounded-lg border border-cribl-border/70 bg-cribl-canvas/40 px-3 py-2">
        <summary className="cursor-pointer select-none text-sm font-medium text-cribl-ink outline-none focus-visible:ring-2 focus-visible:ring-cribl-primary/35">
          Browser requirements &amp; privacy
        </summary>
        <div className="mt-2 space-y-2 border-t border-cribl-border/50 pt-2 text-xs leading-relaxed text-cribl-muted">
          <p className="m-0">
            <strong className="text-cribl-ink/90">Decompression:</strong> uses the platform <span className="font-mono">DecompressionStream(&apos;gzip&apos;)</span>{' '}
            API. Very old browsers may not support in-tab gzip — use a current Chrome, Edge, or Firefox.
          </p>
          <p className="m-0">
            <strong className="text-cribl-ink/90">Sensitive data:</strong> diagnostic bundles can still contain hostnames, paths, or collector
            settings. Only import bundles you are allowed to handle under your customer&apos;s policy; treat the debug JSON as potentially sensitive.
          </p>
        </div>
      </details>
      {ok && (
        <p className="m-0 mt-3 rounded-lg border border-cribl-primary/30 bg-cribl-primary-soft px-3 py-2 text-sm text-cribl-primary-ink" role="status">
          {ok}
        </p>
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
            if (hasExistingPlanData) {
              setPendingFile(bytes)
              setConfirmOpen(true)
              return
            }
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
          {busy ? 'Reading bundle…' : 'Choose .tar.gz / .tgz'}
        </button>
        <label htmlFor={id + '-diag'} className="text-xs text-cribl-muted">
          Replaces the current plan (same as Excel import).
        </label>
      </div>
    </section>
  )
}
