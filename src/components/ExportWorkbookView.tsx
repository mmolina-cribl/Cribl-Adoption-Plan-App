import { useState } from 'react'
import type { PlanState } from '../types/planTypes'
import { xlsxSheets } from '../data/planDataMap'
import { downloadXlsxForPlan } from '../lib/exportWorkbook'

type Props = { plan: PlanState }

/**
 * Download a packaged plan file for sharing (same action as sidebar **Export**).
 */
export function ExportWorkbookView({ plan }: Props) {
  const [exportError, setExportError] = useState<string | null>(null)

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="m-0 text-lg font-semibold tracking-tight text-cribl-ink sm:text-xl">Download your plan</h2>
        <p className="m-0 mt-1.5 text-sm leading-relaxed text-cribl-muted">
          Creates a file that bundles what you entered, reference picklists, and your topology in one place so you can
          share it with Cribl and your stakeholders. The file is named{' '}
          <span className="text-cribl-ink/80">
            &lt;customer name&gt; Adoption Plan - MM-DD-YYYY.xlsx
          </span>{' '}
          using the customer name from the header and today's date.
        </p>
      </div>

      <ul className="m-0 list-inside list-disc space-y-1.5 pl-0.5 text-sm leading-relaxed text-cribl-ink/95 sm:list-outside sm:pl-1">
        {xlsxSheets.map((s) => (
          <li key={s.name}>{s.role}</li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3 pt-0.5">
        <button
          type="button"
          onClick={() => {
            setExportError(null)
            void (async () => {
              try {
                await downloadXlsxForPlan(plan)
              } catch (e) {
                setExportError(e instanceof Error ? e.message : 'Export failed. Try again.')
              }
            })()
          }}
          className="inline-flex h-10 min-w-[10rem] items-center justify-center rounded-lg bg-cribl-navy px-4 text-sm font-semibold text-white shadow-[0_1px_0_rgba(0,0,0,0.1)] transition hover:bg-cribl-navy-mid"
        >
          Download
        </button>
        {exportError && (
          <p className="m-0 w-full text-sm text-rose-700" role="alert">
            {exportError}
          </p>
        )}
        <span className="text-xs text-cribl-muted">.xlsx &middot; opens in any spreadsheet app</span>
        <p className="m-0 w-full max-w-sm text-xs leading-relaxed text-cribl-muted sm:mt-0">
          Your browser may show a download safety notice — the file is generated only on your device; nothing is
          uploaded to Cribl.
        </p>
      </div>
    </div>
  )
}
