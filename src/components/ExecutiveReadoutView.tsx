import { useState } from 'react'
import type { PlanState } from '../types/planTypes'
import {
  buildExecutiveSnapshot,
  downloadExecutiveSummaryMarkdown,
} from '../lib/executiveSnapshot'
import { downloadXlsxForPlan } from '../lib/exportWorkbook'

type Props = { plan: PlanState }

/** Wraps *phrase* segments in <strong> for light scan emphasis. */
function NarrativeEmphasis({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return (
            <strong key={i} className="font-semibold text-cribl-ink">
              {part.slice(1, -1)}
            </strong>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

/**
 * Customer summary (executive readout) derived from PlanState (read-only).
 * Full inventory of groups and sources; exports on this page.
 */
export function ExecutiveReadoutView({ plan }: Props) {
  const snap = buildExecutiveSnapshot(plan)
  const [workbookError, setWorkbookError] = useState<string | null>(null)

  return (
    <article className="exec-readout-print mx-auto max-w-5xl space-y-6 px-1 py-2 text-cribl-ink">
      <header className="border-b border-cribl-border pb-4">
        <p className="m-0 text-[10px] font-semibold tracking-wider text-cribl-muted">Summary</p>
        <h1 className="m-0 mt-1 text-2xl font-semibold tracking-tight">{snap.customerName}</h1>
        <p className="m-0 mt-1 text-sm text-cribl-muted">As of {snap.asOfLabel}</p>
        <p className="m-0 mt-3 max-w-3xl text-sm leading-relaxed text-cribl-muted">
          An <span className="font-medium text-cribl-ink/85">executive summary</span> of this adoption plan: a
          stakeholder-facing readout for alignment and discovery. The tables below list{' '}
          <span className="font-medium text-cribl-ink/85">every</span> worker group / fleet and every source row in the
          current plan (same fields as in the editor). Use the buttons at the bottom to export this summary or the full
          gold-template workbook.
        </p>
      </header>

      <section className="rounded-xl border border-cribl-border/80 bg-white p-4 shadow-ctrl">
        <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-cribl-muted">At a glance</h2>
        <ul className="m-0 mt-3 list-inside list-disc space-y-1.5 text-sm leading-relaxed text-cribl-ink/95">
          <li>
            Stream worker groups: <strong>{snap.wgStreamCount}</strong> — Edge fleets:{' '}
            <strong>{snap.wgEdgeCount}</strong>
          </li>
          <li>
            Source rows in plan: <strong>{snap.sourceCount}</strong>
          </li>
          {snap.activationTier ? (
            <li>
              PS Activation tier selected: <strong>{snap.activationTier}</strong>
            </li>
          ) : (
            <li>PS Activation tier not set yet.</li>
          )}
        </ul>
      </section>

      <section className="rounded-xl border border-cribl-border/80 bg-white p-4 shadow-ctrl">
        <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-cribl-muted">Narrative</h2>
        <div className="m-0 mt-4 space-y-6">
          {snap.narrativeSections.map((sec) => (
            <div
              key={sec.title}
              className="border-t border-cribl-border/55 pt-5 first:border-t-0 first:pt-0"
            >
              <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-cribl-primary">{sec.title}</h3>
              <div className="m-0 mt-2 space-y-2.5 text-sm leading-relaxed text-cribl-ink/95">
                {sec.paragraphs.map((para, i) => (
                  <p key={i} className="m-0">
                    <NarrativeEmphasis text={para} />
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-cribl-border/80 bg-white p-4 shadow-ctrl">
        <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-cribl-muted">Source of plan</h2>
        <p className="m-0 mt-2 text-sm font-medium text-cribl-ink">{snap.provenanceLabel}</p>
        <p className="m-0 mt-1 text-sm leading-relaxed text-cribl-muted">{snap.provenanceDetail}</p>
        {snap.caveats.length > 0 && (
          <ul className="m-0 mt-3 list-inside list-disc space-y-1 text-sm text-cribl-ink/90">
            {snap.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-cribl-border/80 bg-white p-4 shadow-ctrl">
        <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-cribl-muted">
          Groups & fleets (full inventory)
        </h2>
        {snap.workerGroups.length === 0 ? (
          <p className="m-0 mt-2 text-sm text-cribl-muted">No worker groups or fleets in the plan yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[20rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-cribl-border text-xs uppercase text-cribl-muted">
                  <th className="py-1.5 pr-3 font-medium">Worker group / fleet</th>
                  <th className="py-1.5 font-medium">Stream or Edge</th>
                </tr>
              </thead>
              <tbody>
                {snap.workerGroups.map((w) => (
                  <tr key={w.id} className="border-b border-cribl-border/60">
                    <td className="py-1.5 pr-3 align-top">{w.name}</td>
                    <td className="py-1.5 align-top text-cribl-muted">{w.kind === 'edge' ? 'Edge (fleet)' : 'Stream'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-cribl-border/80 bg-white p-4 shadow-ctrl">
        <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-cribl-muted">
          Sources (full inventory)
        </h2>
        {snap.sources.length === 0 ? (
          <p className="m-0 mt-2 text-sm text-cribl-muted">No sources in the plan yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-cribl-border text-xs uppercase text-cribl-muted">
                  <th className="py-1.5 pr-2 font-medium">Source</th>
                  <th className="py-1.5 pr-2 font-medium">GB/d</th>
                  <th className="py-1.5 pr-2 font-medium">WG / fleet</th>
                  <th className="py-1.5 pr-2 font-medium">Stream/Edge</th>
                  <th className="py-1.5 pr-2 font-medium">Tile</th>
                  <th className="py-1.5 font-medium">Blockers</th>
                </tr>
              </thead>
              <tbody>
                {snap.sources.map((s) => (
                  <tr key={s.id} className="border-b border-cribl-border/60">
                    <td className="max-w-[14rem] py-1.5 pr-2 align-top break-words">{s.name}</td>
                    <td className="py-1.5 pr-2 align-top font-mono text-xs">{s.vol}</td>
                    <td className="max-w-[12rem] py-1.5 pr-2 align-top break-words text-cribl-muted">{s.wg}</td>
                    <td className="py-1.5 pr-2 align-top text-cribl-muted">{s.streamOrEdge}</td>
                    <td className="max-w-[10rem] py-1.5 pr-2 align-top break-words text-cribl-muted">{s.sourceTile}</td>
                    <td className="max-w-[18rem] whitespace-pre-wrap py-1.5 align-top break-words text-cribl-ink/90">
                      {s.blockers}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="border-t border-cribl-border pt-4 text-xs text-cribl-muted">
        <p className="m-0 max-w-3xl leading-relaxed">
          This page is a read-only snapshot of the adoption plan in your browser.{' '}
          <span className="font-medium text-cribl-ink/80">Download summary</span> exports the same content as Markdown;{' '}
          <span className="font-medium text-cribl-ink/80">Download workbook</span> produces the full v0.9.1 Excel package
          (all sheets). The same file is available from <span className="font-medium text-cribl-ink/80">Export</span> in
          the sidebar (below <span className="font-medium text-cribl-ink/80">Import</span>).
        </p>
      </footer>

      <div className="no-print flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={() => downloadExecutiveSummaryMarkdown(snap)}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-cribl-border bg-white px-4 text-sm font-semibold text-cribl-ink shadow-ctrl hover:bg-cribl-canvas/80"
        >
          Download summary (.md)
        </button>
        <button
          type="button"
          onClick={() => {
            setWorkbookError(null)
            void (async () => {
              try {
                await downloadXlsxForPlan(plan)
              } catch (e) {
                setWorkbookError(e instanceof Error ? e.message : 'Export failed. Try again.')
              }
            })()
          }}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-cribl-navy px-4 text-sm font-semibold text-white shadow-ctrl"
        >
          Download workbook (.xlsx)
        </button>
        {workbookError && (
          <p className="m-0 w-full text-sm text-rose-700" role="alert">
            {workbookError}
          </p>
        )}
      </div>
    </article>
  )
}
