import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { PlanState } from '../types/planTypes'
import {
  buildExecutiveSnapshot,
  downloadExecutiveSummaryMarkdown,
  downloadExecutiveSourcesInventoryXlsx,
} from '../lib/executiveSnapshot'
import { buildExecutiveSummaryAiContextJson } from '../lib/executiveSummaryAiContext'
import { buildExecutiveSummaryAiBoldContext } from '../lib/executiveSummaryAiMarkdownPost'
import { runExecutiveSummaryAiMarkdown } from '../lib/aiAssistantOpenAi'
import { probeOpenAiKeyPresent, isCriblLocalShell, OPENAI_KEY_AVAILABILITY_EVENT } from '../lib/kvStore'
import { AssistantMessageRich } from './AssistantMessageRich'

/** Default visible rows in Sources (full inventory); remainder shown when expanded or in print. */
const SOURCES_INVENTORY_PREVIEW_ROWS = 10

const EXEC_SUMMARY_AI_SETUP_TOOLTIP =
  'Add your OpenAI API key in Settings so Summary AI can run. It uses the same optional key as the right-rail assistant (bring your own key). In Cribl the key is stored with your app; locally it stays in this browser. Request text is sent to OpenAI — verify output against the tables on this page.'

type Props = { plan: PlanState; setPlan: Dispatch<SetStateAction<PlanState>> }

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
 * Executive readout derived from PlanState (read-only).
 * Full inventory of groups and sources; exports on this page.
 */
export function ExecutiveReadoutView({ plan, setPlan }: Props) {
  const snap = buildExecutiveSnapshot(plan)
  const [exportError, setExportError] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiErr, setAiErr] = useState<string | null>(null)
  const [openAiKeyPresent, setOpenAiKeyPresent] = useState<boolean | null>(null)
  const [criblLocalShell, setCriblLocalShell] = useState(() => isCriblLocalShell())
  const [sourcesInventoryExpanded, setSourcesInventoryExpanded] = useState(false)
  const [provenanceDetailsOpen, setProvenanceDetailsOpen] = useState(false)

  const refreshKeyState = useCallback(() => {
    const local = isCriblLocalShell()
    setCriblLocalShell(local)
    if (local) {
      setOpenAiKeyPresent(false)
      return
    }
    void probeOpenAiKeyPresent().then(setOpenAiKeyPresent)
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = () => {
      if (cancelled) return
      refreshKeyState()
    }
    run()
    const tid = window.setTimeout(run, 800)
    const onKeyAvailability = () => run()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') run()
    }
    window.addEventListener(OPENAI_KEY_AVAILABILITY_EVENT, onKeyAvailability)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.clearTimeout(tid)
      window.removeEventListener(OPENAI_KEY_AVAILABILITY_EVENT, onKeyAvailability)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshKeyState])

  const aiGenerateDisabled =
    aiBusy || criblLocalShell || openAiKeyPresent === false || openAiKeyPresent === null

  const onGenerateAi = async () => {
    if (aiGenerateDisabled) return
    setAiErr(null)
    setAiBusy(true)
    try {
      const ctx = buildExecutiveSummaryAiContextJson(plan, snap)
      const boldCtx = buildExecutiveSummaryAiBoldContext(plan, snap)
      const { markdown, model } = await runExecutiveSummaryAiMarkdown(ctx, boldCtx)
      const generatedAt = new Date().toISOString()
      setPlan((p) => ({ ...p, executiveSummaryAi: { markdown, generatedAt, model } }))
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : 'Request failed. Check your API key in Settings and try again.'
      setAiErr(msg)
    } finally {
      setAiBusy(false)
    }
  }

  const onClearAi = () => {
    setAiErr(null)
    setPlan((p) => {
      const next = { ...p }
      delete next.executiveSummaryAi
      return next
    })
  }

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
          current plan (same fields as in the editor; sources are sorted by average daily GB, largest first). Use the
          buttons at the bottom to export this summary or the full gold-template workbook.
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-cribl-muted">
            AI-assisted talking points
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={aiGenerateDisabled}
              title={aiGenerateDisabled ? EXEC_SUMMARY_AI_SETUP_TOOLTIP : undefined}
              onClick={() => void onGenerateAi()}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-cribl-navy px-4 text-sm font-semibold text-white shadow-ctrl disabled:cursor-not-allowed disabled:opacity-50"
            >
              {plan.executiveSummaryAi ? 'Regenerate' : 'Generate'}
            </button>
            {plan.executiveSummaryAi && (
              <button
                type="button"
                disabled={aiBusy}
                onClick={onClearAi}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-cribl-border bg-white px-4 text-sm font-semibold text-cribl-ink shadow-ctrl hover:bg-cribl-canvas/80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <p className="m-0 mt-2 max-w-3xl text-sm leading-relaxed text-cribl-muted">
          Optional Markdown from OpenAI using a capped JSON snapshot of this plan (same API key as the right-rail
          assistant). Anyone with access to this plan can generate or view this block. It is not a substitute for the
          inventory tables — verify before sharing outside your team.
        </p>
        {criblLocalShell && (
          <p className="m-0 mt-2 text-sm text-cribl-muted" role="status">
            OpenAI is unavailable in the Cribl <span className="font-mono">__local__</span> shell. Use a deployed app
            and configure the key in Settings.
          </p>
        )}
        {!criblLocalShell && openAiKeyPresent === false && (
          <p className="m-0 mt-2 text-sm text-cribl-muted" role="status">
            Add an OpenAI API key in Settings to enable generation.
          </p>
        )}
        {aiBusy && (
          <p className="m-0 mt-3 text-sm font-medium text-cribl-primary" role="status" aria-live="polite">
            Generating
            <span className="ai-thinking-dots" aria-hidden>
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </p>
        )}
        {aiErr && (
          <p className="m-0 mt-2 text-sm text-rose-700" role="alert">
            {aiErr.slice(0, 400)}
          </p>
        )}
        {plan.executiveSummaryAi && !aiBusy && (
          <div className="mt-4 rounded-lg border border-cribl-border/70 bg-cribl-canvas/40 p-3">
            <p className="m-0 text-xs text-cribl-muted">
              Generated {plan.executiveSummaryAi.generatedAt}
              {plan.executiveSummaryAi.model ? ` · ${plan.executiveSummaryAi.model}` : ''}
            </p>
            <AssistantMessageRich
              text={plan.executiveSummaryAi.markdown}
              className="m-0 mt-2 text-sm leading-relaxed text-cribl-ink/95"
              linkifyPlainUrls
            />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-cribl-border/80 bg-white p-4 shadow-ctrl">
        <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-cribl-muted">Source of plan</h2>
        <p className="m-0 mt-2 text-sm font-medium text-cribl-ink">{snap.provenanceLabel}</p>
        <div className="no-print mt-2">
          <button
            type="button"
            aria-expanded={provenanceDetailsOpen}
            onClick={() => setProvenanceDetailsOpen((o) => !o)}
            className="m-0 cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-semibold text-cribl-primary underline decoration-cribl-primary/40 underline-offset-2 hover:decoration-cribl-primary"
          >
            {provenanceDetailsOpen ? 'Hide details' : 'Learn what this means'}
          </button>
        </div>
        <div
          className={
            provenanceDetailsOpen
              ? 'mt-3 space-y-3 border-l-2 border-cribl-border/80 pl-3 text-sm'
              : 'mt-3 hidden space-y-3 border-l-2 border-cribl-border/80 pl-3 text-sm print:!block'
          }
        >
          <AssistantMessageRich
            text={snap.provenanceDetail}
            className="m-0 leading-relaxed text-cribl-ink/90"
            linkifyPlainUrls
          />
          {snap.caveats.length > 0 && (
            <>
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-cribl-muted">What to keep in mind</p>
              <ul className="m-0 list-disc space-y-2 pl-5 text-cribl-ink/90">
                {snap.caveats.map((c, i) => (
                  <li key={i} className="leading-relaxed">
                    <AssistantMessageRich text={c} linkifyPlainUrls />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
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
          <>
            {snap.sources.length > SOURCES_INVENTORY_PREVIEW_ROWS && !sourcesInventoryExpanded && (
              <p className="m-0 mt-2 text-sm text-cribl-muted" role="status">
                Showing the {SOURCES_INVENTORY_PREVIEW_ROWS} largest average-daily-GB rows of {snap.sources.length}{' '}
                (table is sorted high → low). Expand to see the full list (print includes all rows).
              </p>
            )}
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-cribl-border text-xs uppercase text-cribl-muted">
                    <th className="py-1.5 pr-2 font-medium">Source</th>
                    <th className="py-1.5 pr-2 font-medium">Tile</th>
                    <th className="py-1.5 pr-2 font-medium">State</th>
                    <th className="py-1.5 pr-2 font-medium">GB/d</th>
                    <th className="py-1.5 pr-2 font-medium">WG / fleet</th>
                    <th className="py-1.5 pr-2 font-medium">Stream/Edge</th>
                    <th className="py-1.5 font-medium">Blockers</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.sources.map((s, i) => {
                    const collapsedPastPreview =
                      snap.sources.length > SOURCES_INVENTORY_PREVIEW_ROWS &&
                      !sourcesInventoryExpanded &&
                      i >= SOURCES_INVENTORY_PREVIEW_ROWS
                    return (
                      <tr
                        key={s.id}
                        className={
                          collapsedPastPreview
                            ? 'hidden border-b border-cribl-border/60 print:!table-row'
                            : 'border-b border-cribl-border/60'
                        }
                      >
                        <td className="max-w-[14rem] py-1.5 pr-2 align-top break-words">{s.name}</td>
                        <td className="max-w-[10rem] py-1.5 pr-2 align-top break-words text-cribl-muted">{s.sourceTile}</td>
                        <td className="py-1.5 pr-2 align-top text-cribl-muted">{s.state}</td>
                        <td className="py-1.5 pr-2 align-top font-mono text-xs">{s.vol}</td>
                        <td className="max-w-[12rem] py-1.5 pr-2 align-top break-words text-cribl-muted">{s.wg}</td>
                        <td className="py-1.5 pr-2 align-top text-cribl-muted">{s.streamOrEdge}</td>
                        <td className="max-w-[18rem] whitespace-pre-wrap py-1.5 align-top break-words text-cribl-ink/90">
                          {s.blockers}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {snap.sources.length > SOURCES_INVENTORY_PREVIEW_ROWS && (
              <div className="no-print mt-3">
                <button
                  type="button"
                  onClick={() => setSourcesInventoryExpanded((v) => !v)}
                  className="text-sm font-semibold text-cribl-primary underline decoration-cribl-primary/40 underline-offset-2 hover:decoration-cribl-primary"
                >
                  {sourcesInventoryExpanded
                    ? `Show first ${SOURCES_INVENTORY_PREVIEW_ROWS} only`
                    : `Show all ${snap.sources.length} sources`}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <footer className="border-t border-cribl-border pt-4 text-xs text-cribl-muted">
        <p className="m-0 max-w-3xl leading-relaxed">
          This page is a read-only snapshot of the adoption plan in your browser.{' '}
          <span className="font-medium text-cribl-ink/80">Download summary</span> exports the narrative and tables as Markdown;{' '}
          <span className="font-medium text-cribl-ink/80">Download sources inventory</span> exports the source table
          above as a single Excel sheet. The full v0.9.1 adoption-plan workbook is available from{' '}
          <span className="font-medium text-cribl-ink/80">Export</span> in the sidebar (below{' '}
          <span className="font-medium text-cribl-ink/80">Import</span>).
        </p>
      </footer>

      <div className="no-print flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          onClick={() => downloadExecutiveSummaryMarkdown(snap, plan.executiveSummaryAi)}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-cribl-border bg-white px-4 text-sm font-semibold text-cribl-ink shadow-ctrl hover:bg-cribl-canvas/80"
        >
          Download summary (.md)
        </button>
        <button
          type="button"
          onClick={() => {
            setExportError(null)
            try {
              downloadExecutiveSourcesInventoryXlsx(snap)
            } catch (e) {
              setExportError(e instanceof Error ? e.message : 'Export failed. Try again.')
            }
          }}
          className="inline-flex h-9 items-center justify-center rounded-lg bg-cribl-navy px-4 text-sm font-semibold text-white shadow-ctrl"
        >
          Download sources inventory (.xlsx)
        </button>
        {exportError && (
          <p className="m-0 w-full text-sm text-rose-700" role="alert">
            {exportError}
          </p>
        )}
      </div>
    </article>
  )
}
