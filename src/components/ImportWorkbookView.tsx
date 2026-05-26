import { useCallback, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { PlanState } from '../types/planTypes'
import { setImportShellFromBytes } from '../lib/importShellStore'
import { importAdoptionPlanXlsx } from '../lib/importWorkbook'
import { xlsxSheets } from '../data/planDataMap'
import { ConfirmImportOverwriteDialog } from './ConfirmImportOverwriteDialog'
import { DiagImportSection } from './DiagImportSection'
import { TenantImportSection } from './TenantImportSection'

type Props = {
  plan: PlanState
  setPlan: Dispatch<SetStateAction<PlanState>>
}

function hasAnyPlanData(plan: PlanState): boolean {
  return (
    plan.customerName.trim() !== '' ||
    plan.cseNotes.trim() !== '' ||
    plan.sourceSummary.length > 0 ||
    plan.sourceVolume.length > 0 ||
    plan.workerGroups.length > 0
  )
}

/**
 * File → Import: load a plan from an .xlsx produced by this app (or the same template).
 */
export function ImportWorkbookView({ plan, setPlan }: Props) {
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<Uint8Array | null>(null)

  const runImport = useCallback(
    (bytes: Uint8Array) => {
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
        const capturedAt = new Date().toISOString()
        setPlan({
          ...result.plan,
          planProvenance: { kind: 'xlsx', capturedAt },
        })
        setImportShellFromBytes(bytes)
        setWarnings(result.warnings)
        if (result.warnings.length) {
          setOkMsg('Plan loaded with notes above. Review your data before exporting again. Export uses the current v0.9.1 workbook format.')
        } else {
          setOkMsg('Plan loaded. Your current in-browser data was replaced; Export uses the current v0.9.1 workbook format.')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not read that file.')
      } finally {
        setBusy(false)
      }
    },
    [setPlan],
  )

  return (
    <div className="mx-auto max-w-2xl space-y-5">
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
            runImport(bytes)
          }
        }}
      />
      <div>
        <h2 className="m-0 text-lg font-semibold tracking-tight text-cribl-ink sm:text-xl">Import a plan</h2>
        <p className="m-0 mt-1.5 text-sm leading-relaxed text-cribl-muted">
          Load from an Excel workbook, a Cribl <span className="font-mono">.tar.gz</span> diagnostic bundle (most practical when you can{' '}
          <strong className="text-cribl-ink/90">export the archive from a customer-managed deployment</strong>), or bootstrap topology from your
          Cribl tenant when running inside the App Platform.
        </p>
      </div>

      <TenantImportSection setPlan={setPlan} hasExistingPlanData={hasAnyPlanData(plan)} />

      <DiagImportSection setPlan={setPlan} hasExistingPlanData={hasAnyPlanData(plan)} />

      <div className="border-t border-cribl-border pt-6">
        <h3 className="m-0 text-base font-semibold text-cribl-ink">Import from Excel</h3>
        <p className="m-0 mt-1.5 text-sm leading-relaxed text-cribl-muted">
          Load an <span className="text-cribl-ink/90">.xlsx</span> adoption plan in either the current v0.9.1 format
          or the older v0.8.6 Excel-only format. Older imports hydrate the GUI, but{' '}
          <span className="text-cribl-ink/80">Export</span> in the sidebar (or Summary → Download workbook) always writes the current v0.9.1 workbook layout.
        </p>
      </div>

      <p className="m-0 text-sm text-cribl-muted">Sheets we write on export (for reference):</p>
      <ul className="m-0 list-inside list-disc space-y-1 pl-0.5 text-sm text-cribl-ink/95 sm:list-outside sm:pl-1">
        {xlsxSheets.map((s) => (
          <li key={s.name}>{s.role}</li>
        ))}
      </ul>

      {okMsg && (
        <p className="m-0 rounded-lg border border-cribl-primary/30 bg-cribl-primary-soft px-3 py-2 text-sm text-cribl-primary-ink" role="status">
          {okMsg}
        </p>
      )}
      {error && (
        <p className="m-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">
          {error}
        </p>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200/90 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-amber-900/80">Note</p>
          <ul className="m-0 mt-1.5 list-inside list-disc space-y-1 pl-0.5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-0.5">
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
              const ab = await f.arrayBuffer()
              const bytes = new Uint8Array(ab)
              if (hasAnyPlanData(plan)) {
                setPendingFile(bytes)
                setConfirmOpen(true)
                return
              }
              runImport(bytes)
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not read that file.')
            }
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-10 min-w-[10rem] items-center justify-center rounded-lg bg-cribl-navy px-4 text-sm font-semibold text-white shadow-[0_1px_0_rgba(0,0,0,0.1)] transition hover:bg-cribl-navy-mid disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Reading…' : 'Choose .xlsx file'}
        </button>
        <label htmlFor={id + '-file'} className="text-xs text-cribl-muted">
          Import replaces the current plan (unsaved in-memory state only).
        </label>
      </div>
      <p className="m-0 max-w-lg text-xs leading-relaxed text-cribl-muted">
        Import runs entirely in your browser — the file is not uploaded to a server for this step.
      </p>
    </div>
  )
}
