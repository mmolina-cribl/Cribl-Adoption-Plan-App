import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { PlanState } from '../types/planTypes'
import { PLAN_STORAGE_KEY } from '../hooks/usePlanStorage'
import { clearImportShell } from '../lib/importShellStore'
import { isCriblLocalShell, kvSet } from '../lib/kvStore'
import {
  readImportOmitDisabledInputs,
  readImportOmitStockGroups,
  writeImportOmitDisabledInputs,
  writeImportOmitStockGroups,
} from '../lib/importHarvestOptions'
import { harvestTenantTopology } from '../lib/tenantHarvest'
import { buildTenantImportDebugPayload, topologyHarvestToPlanState, type TenantImportDebugPayload } from '../lib/topologyToPlan'
import { ConfirmImportOverwriteDialog } from './ConfirmImportOverwriteDialog'

type Props = {
  setPlan: Dispatch<SetStateAction<PlanState>>
  hasExistingPlanData: boolean
}

function isInCriblIframe(): boolean {
  return typeof window !== 'undefined' && typeof window.CRIBL_API_URL === 'string'
}

/**
 * Bootstrap plan topology from the live Cribl Leader (Stream worker groups / fleets
 * and configured **sources** from Leader inputs). App Platform only.
 */
export function TenantImportSection({ setPlan, hasExistingPlanData }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [importDebug, setImportDebug] = useState<TenantImportDebugPayload | null>(null)
  const [debugCopyOk, setDebugCopyOk] = useState(false)
  const [omitStockGroups, setOmitStockGroups] = useState(readImportOmitStockGroups)
  const [omitDisabledInputs, setOmitDisabledInputs] = useState(readImportOmitDisabledInputs)

  const runHarvest = useCallback(async () => {
    setError(null)
    setOk(null)
    setImportDebug(null)
    setDebugCopyOk(false)
    setBusy(true)
    try {
      const harvest = await harvestTenantTopology(undefined, {
        omitStockWorkerGroups: omitStockGroups,
        omitDisabledInputs,
      })
      const next = topologyHarvestToPlanState(harvest)
      const capturedAt = new Date().toISOString()
      const note =
        harvest.warnings.length > 0 ? `Harvest notes: ${harvest.warnings.join(' ')}` : undefined
      const planWithProvenance: PlanState = {
        ...next,
        planProvenance: { kind: 'tenant', capturedAt, note },
      }
      setPlan(planWithProvenance)
      // Ensure the plan reaches pack KV / localStorage before the user refreshes;
      // the global persist effect also saves, but this awaits the PUT so a quick
      // reload is less likely to race an in-flight write.
      await kvSet(PLAN_STORAGE_KEY, planWithProvenance)
      setImportDebug(buildTenantImportDebugPayload(capturedAt, harvest, planWithProvenance))
      clearImportShell()
      setOk(
        'Plan replaced with topology from your Cribl tenant. Review worker groups, fleets, and imported sources (from Leader inputs) before exporting.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tenant import failed.')
    } finally {
      setBusy(false)
    }
  }, [setPlan, omitStockGroups, omitDisabledInputs])

  if (!isInCriblIframe()) {
    return (
      <section className="rounded-xl border border-dashed border-cribl-border/90 bg-cribl-canvas/50 p-4">
        <h3 className="m-0 text-sm font-semibold text-cribl-ink">Import from live tenant</h3>
        <p className="m-0 mt-2 text-sm text-cribl-muted">
          Available when this app runs inside the Cribl App Platform (<span className="font-mono">CRIBL_API_URL</span>{' '}
          is set). For standalone use, import an <span className="font-mono">.xlsx</span> instead.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
      <ConfirmImportOverwriteDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          void runHarvest()
        }}
      />
      <h3 className="m-0 text-sm font-semibold text-cribl-ink">Import from live tenant</h3>
      <p className="m-0 mt-2 text-sm leading-relaxed text-cribl-muted">
        Discovers worker groups / fleets from <span className="font-mono">/master/groups</span> and lists{' '}
        <strong>configured sources</strong> per group from Leader{' '}
        <span className="font-mono">/m/&lt;group&gt;/system/inputs</span> (and <span className="font-mono">/inputs</span> fallback).
        Each input becomes one plan source row named by Leader input <span className="font-mono">id</span> (routing is not imported). Use the
        options below to omit built-in default groups or include disabled inputs when you need them in the plan. This replaces your current
        plan — validate in the editor before exporting.
      </p>
      <div className="mt-3 space-y-2.5 rounded-lg border border-cribl-border/70 bg-cribl-canvas/40 px-3 py-2.5">
        <p className="m-0 text-xs font-medium text-cribl-ink/90">Import options</p>
        <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-snug text-cribl-muted">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!omitDisabledInputs}
            onChange={(e) => {
              const include = e.target.checked
              const omit = !include
              setOmitDisabledInputs(omit)
              writeImportOmitDisabledInputs(omit)
            }}
          />
          <span>
            <strong className="text-cribl-ink/85">Include disabled Leader inputs.</strong> Unchecked by default — check to import inputs with{' '}
            <span className="font-mono text-cribl-ink/80">disabled: true</span> (each row gets <span className="font-mono"> disabled</span> on{' '}
            <strong className="text-cribl-ink/85">Source</strong>).
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
            <strong className="text-cribl-ink/85">Omit built-in default worker groups</strong> (
            <span className="font-mono">default</span>, <span className="font-mono">defaultHybrid</span>,{' '}
            <span className="font-mono">default_fleet</span>, <span className="font-mono">default_outpost</span>). Unchecked by default.
          </span>
        </label>
        <p className="m-0 text-[10px] leading-snug text-cribl-muted/85">These choices are saved in this browser for the next import.</p>
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
      <details className="mt-3 rounded-lg border border-cribl-border/70 bg-cribl-canvas/40 px-3 py-2">
        <summary className="cursor-pointer select-none text-sm font-medium text-cribl-ink outline-none focus-visible:ring-2 focus-visible:ring-cribl-primary/35">
          What the Leader can expose vs what this import uses
        </summary>
        <div className="mt-2 space-y-3 border-t border-cribl-border/50 pt-2 text-xs leading-relaxed text-cribl-muted">
          <p className="m-0">
            <strong className="text-cribl-ink/90">APIs we call:</strong>{' '}
            <span className="font-mono text-cribl-ink/85">GET /master/groups</span>, then for each group{' '}
            <span className="font-mono text-cribl-ink/85">GET /m/&lt;group&gt;/system/inputs</span> (fallback{' '}
            <span className="font-mono text-cribl-ink/85">/m/&lt;group&gt;/inputs</span>). We do{' '}
            <strong className="text-cribl-ink/90">not</strong> call routes, pipelines, destinations, deployments, or metrics APIs.
          </p>
          <div>
            <p className="m-0 font-medium text-cribl-ink/90">Worker groups</p>
            <ul className="m-0 mt-1 list-inside list-disc space-y-0.5">
              <li>
                <strong className="text-cribl-ink/85">Used:</strong> <span className="font-mono">id</span>,{' '}
                <span className="font-mono">description</span> (or <span className="font-mono">id</span> for the name),{' '}
                <span className="font-mono">isFleet</span>, <span className="font-mono">type</span> (e.g. outpost/edge → Edge column).
              </li>
              <li>
                <strong className="text-cribl-ink/85">Skipped entirely:</strong> Search-only groups (
                <span className="font-mono">default_search</span>, <span className="font-mono">isSearch</span>).
              </li>
              <li>
                <strong className="text-cribl-ink/85">Optional (import checkboxes):</strong> built-in default groups (
                <span className="font-mono">default</span>, …) and disabled inputs — see options above.
              </li>
              <li>
                <strong className="text-cribl-ink/85">Not imported into plan rows (today):</strong> cloud region, ingest estimates,{' '}
                <span className="font-mono">configVersion</span>, tags, provisioning flags — Leader may send them; we leave matching workbook
                fields empty unless you fill them later.
              </li>
            </ul>
          </div>
          <div>
            <p className="m-0 font-medium text-cribl-ink/90">Configured sources (Leader “inputs”)</p>
            <ul className="m-0 mt-1 list-inside list-disc space-y-0.5">
              <li>
                <strong className="text-cribl-ink/85">Used:</strong> <span className="font-mono">id</span> (plan{' '}
                <strong className="text-cribl-ink/85">Source</strong> name),{' '}
                <span className="font-mono">type</span>, <span className="font-mono">disabled</span> (when you check{' '}
                <strong className="text-cribl-ink/85">Include disabled Leader inputs</strong>, each such input becomes one plan source row with{' '}
                <span className="font-mono"> disabled</span> appended to <strong className="text-cribl-ink/85">Source</strong> for UI and Excel;
                otherwise disabled inputs are omitted).{' '}
                <span className="font-mono">description</span> is kept in import debug JSON only — not copied into the source name.
              </li>
              <li>
                <strong className="text-cribl-ink/85">Dropped (today):</strong> all collector-specific fields (ports, hosts, URLs, auth,
                TLS, etc.). They stay in the tenant but are not copied into the adoption plan model.
              </li>
              <li>
                <strong className="text-cribl-ink/85">Routing:</strong> pipeline use case and destinations are{' '}
                <strong className="text-cribl-ink/90">not</strong> imported — those fields stay blank until you edit or use Excel
                (destinations from the tenant may be supported later).
              </li>
            </ul>
          </div>
          <p className="m-0 text-cribl-ink/80">
            <strong>Full checklist</strong> (tables, “not fetched”, workbook mapping): see{' '}
            <span className="font-mono text-cribl-ink/90">docs/tenant-import-leader-data.md</span> in the Adoption Plan repository.
            After import, <strong className="text-cribl-ink/90">Import debug → Copy full JSON</strong> shows what was returned for groups and
            the normalized input list per group.
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
            if (hasExistingPlanData) {
              setConfirmOpen(true)
              return
            }
            void runHarvest()
          }}
          className="inline-flex h-10 min-w-[12rem] items-center justify-center rounded-lg bg-cribl-navy px-4 text-sm font-semibold text-white shadow-[0_1px_0_rgba(0,0,0,0.1)] transition hover:bg-cribl-navy-mid disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Reading tenant…' : 'Bootstrap from tenant'}
        </button>
      </div>
    </section>
  )
}
