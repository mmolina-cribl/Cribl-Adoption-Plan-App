import { useCallback, useId, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react'
import type { PlanState } from '../types/planTypes'
import type { CriblEnvironmentSnapshot } from '../lib/criblEnvironmentTypes'
import { importAdoptionPlanXlsx } from '../lib/importWorkbook'
import { xlsxSheets } from '../data/planDataMap'
import { criblApiBase } from '../lib/leaderApi'
import { hasExistingPlanData } from '../lib/hasExistingPlanData'
import { buildImportOverwriteDiff, type ImportOverwriteDiff } from '../lib/importOverwriteDiff'
import { applyPendingImport, type PendingImport } from '../lib/pendingImport'
import { ImportOverwriteReviewDialog } from './ImportOverwriteReviewDialog'
import { DiagImportSection } from './DiagImportSection'
import { TenantImportSection } from './TenantImportSection'

type Props = {
  plan: PlanState
  environmentSnapshot: CriblEnvironmentSnapshot | null
  setPlan: Dispatch<SetStateAction<PlanState>>
  setEnvironmentSnapshot: (s: CriblEnvironmentSnapshot | null) => void
  onViewEnvironment?: () => void
}

type ImportTabId = 'tenant' | 'diag' | 'excel'

function ImportTabBar({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: ReadonlyArray<{ id: ImportTabId; label: string }>
  activeTab: ImportTabId
  onChange: (id: ImportTabId) => void
}) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
      return
    }
    e.preventDefault()
    const next =
      e.key === 'ArrowLeft'
        ? (idx - 1 + tabs.length) % tabs.length
        : (idx + 1) % tabs.length
    onChange(tabs[next]!.id)
  }

  return (
    <div
      role="tablist"
      aria-label="Import source"
      className="flex w-full gap-1 overflow-x-auto rounded-xl border border-cribl-border bg-cribl-canvas p-1 shadow-ctrl"
    >
      {tabs.map((t, i) => {
        const isActive = activeTab === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={[
              'min-w-0 flex-1 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cribl-primary/40',
              isActive ? 'bg-white text-cribl-ink shadow-ctrl' : 'text-cribl-muted hover:bg-white/60 hover:text-cribl-ink',
            ].join(' ')}
          >
            <span className="block truncate">{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function ImportWorkbookView({
  plan,
  environmentSnapshot,
  setPlan,
  setEnvironmentSnapshot,
  onViewEnvironment,
}: Props) {
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const tenantAvailable = criblApiBase() != null
  const tabs = useMemo(() => {
    const t: Array<{ id: ImportTabId; label: string }> = []
    if (tenantAvailable) {
      t.push({ id: 'tenant', label: 'Live tenant' })
    }
    t.push({ id: 'diag', label: 'Diagnostic bundle' })
    t.push({ id: 'excel', label: 'Excel workbook' })
    return t
  }, [tenantAvailable])

  const [activeTab, setActiveTab] = useState<ImportTabId>(tabs[0]!.id)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [importDiff, setImportDiff] = useState<ImportOverwriteDiff | null>(null)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)

  const clearReview = useCallback(() => {
    setReviewOpen(false)
    setImportDiff(null)
    setPendingImport(null)
  }, [])

  const applyImport = useCallback(
    async (pending: PendingImport) => {
      setError(null)
      setOkMsg(null)
      setWarnings([])
      setBusy(true)
      try {
        const result = await applyPendingImport(pending, { setPlan, setEnvironmentSnapshot })
        setWarnings(result.warnings)
        setOkMsg(result.message)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Import failed.')
      } finally {
        setBusy(false)
      }
    },
    [setPlan, setEnvironmentSnapshot],
  )

  const runImport = useCallback(
    async (bytes: Uint8Array) => {
      setError(null)
      setOkMsg(null)
      setWarnings([])
      setBusy(true)
      try {
        const result = importAdoptionPlanXlsx(bytes)
        if (!result.ok) {
          setError(result.error)
          return
        }

        if (hasExistingPlanData(plan)) {
          const diff = buildImportOverwriteDiff({
            importKind: 'xlsx',
            currentPlan: plan,
            nextPlan: result.plan,
            currentEnvironment: environmentSnapshot,
            nextEnvironment: null,
            harvestWarnings: result.warnings,
          })
          setPendingImport({
            kind: 'xlsx',
            plan: result.plan,
            warnings: result.warnings,
            shellBytes: bytes,
          })
          setImportDiff(diff)
          setReviewOpen(true)
          return
        }

        await applyImport({
          kind: 'xlsx',
          plan: result.plan,
          warnings: result.warnings,
          shellBytes: bytes,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not read that file.')
      } finally {
        setBusy(false)
      }
    },
    [applyImport, environmentSnapshot, plan],
  )

  return (
    <div className="mx-auto max-w-2xl space-y-5">
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

      <div>
        <h2 className="m-0 text-lg font-semibold tracking-tight text-cribl-ink sm:text-xl">Import a plan</h2>
        <p className="m-0 mt-1.5 text-sm text-cribl-muted">
          Choose how to load your adoption plan. Everything runs in your browser.
        </p>
      </div>

      <ImportTabBar tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="rounded-xl border border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
        {activeTab === 'tenant' && tenantAvailable ? (
          <TenantImportSection
            embedded
            plan={plan}
            environmentSnapshot={environmentSnapshot}
            setPlan={setPlan}
            setEnvironmentSnapshot={setEnvironmentSnapshot}
            onViewEnvironment={onViewEnvironment}
          />
        ) : null}

        {activeTab === 'diag' ? (
          <DiagImportSection
            embedded
            plan={plan}
            environmentSnapshot={environmentSnapshot}
            setPlan={setPlan}
            setEnvironmentSnapshot={setEnvironmentSnapshot}
            onViewEnvironment={onViewEnvironment}
          />
        ) : null}

        {activeTab === 'excel' ? (
          <div className="space-y-4">
            <p className="m-0 text-sm text-cribl-muted">
              Load a v0.9.1 (or v0.8.6) workbook. Export always writes v0.9.1.
            </p>
            <details className="rounded-lg border border-cribl-border/70 bg-cribl-canvas/40 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-cribl-ink">Workbook sheets</summary>
              <ul className="m-0 mt-2 list-inside list-disc space-y-1 text-xs text-cribl-muted">
                {xlsxSheets.map((s) => (
                  <li key={s.name}>{s.role}</li>
                ))}
              </ul>
            </details>
            <div className="flex flex-wrap items-center gap-3">
              <input
                id={id + '-file'}
                ref={fileRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) {
                    return
                  }
                  try {
                    const bytes = new Uint8Array(await f.arrayBuffer())
                    void runImport(bytes)
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not read that file.')
                  }
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-10 min-w-[10rem] items-center justify-center rounded-lg bg-cribl-navy px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? 'Reading…' : 'Choose .xlsx file'}
              </button>
              <span className="text-xs text-cribl-muted">Shows a change summary before replacing plan data.</span>
            </div>
          </div>
        ) : null}
      </div>

      {okMsg ? (
        <p className="m-0 rounded-lg border border-cribl-primary/30 bg-cribl-primary-soft px-3 py-2 text-sm text-cribl-primary-ink" role="status">
          {okMsg}
        </p>
      ) : null}
      {error ? (
        <p className="m-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">
          {error}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-200/90 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-amber-900/80">Note</p>
          <ul className="m-0 mt-1.5 list-inside list-disc space-y-1">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
