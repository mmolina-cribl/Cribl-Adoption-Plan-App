import { useEffect, useState } from 'react'
import type { CriblEnvironmentSnapshot } from '../lib/criblEnvironmentTypes'
import { environmentEmptyHint, environmentPlanOutOfSync } from '../lib/environmentPlanSync'
import type { PlanProvenance } from '../types/planTypes'
import type { EnvironmentFlowNodeData } from '../lib/environmentFlowGraph'
import { EnvironmentMap } from './EnvironmentMap'

type Props = {
  snapshot: CriblEnvironmentSnapshot | null
  planProvenance?: PlanProvenance
  onGoToImport: () => void
}

export function EnvironmentView({ snapshot, planProvenance, onGoToImport }: Props) {
  const [selectedNode, setSelectedNode] = useState<EnvironmentFlowNodeData | null>(null)
  const [warningsExpanded, setWarningsExpanded] = useState(false)
  const [warningsHidden, setWarningsHidden] = useState(false)
  const [syncBannerDismissed, setSyncBannerDismissed] = useState(false)

  const snapshotKey = snapshot
    ? `${snapshot.capturedAt}:${snapshot.source}:${snapshot.groups.length}:${snapshot.warnings.length}`
    : ''

  useEffect(() => {
    setWarningsExpanded(false)
    setWarningsHidden(false)
    setSyncBannerDismissed(false)
  }, [snapshotKey])

  const outOfSync = snapshot ? environmentPlanOutOfSync(snapshot, planProvenance) : false

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h2 className="m-0 text-lg font-semibold tracking-tight text-cribl-ink sm:text-xl">Environment</h2>
        <p className="m-0 mt-1.5 text-sm text-cribl-muted">
          Visualize how data flows through the customer&apos;s Cribl environment — from sources through routes and
          pipelines to destinations. The map is built from your last tenant or diagnostic import and reflects config at
          that moment; plan edits afterward are not shown here, and this view does not change your plan.
        </p>
      </div>

      {!snapshot ? (
        <div className="rounded-xl border border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
          <p className="m-0 text-sm text-cribl-muted">
            Environment shows routing from a diagnostic bundle or live tenant import. Load topology on the Import page
            first.
          </p>
          <p className="m-0 mt-2 text-sm text-cribl-muted">{environmentEmptyHint(planProvenance)}</p>
          <div className="mt-4">
            <button
              type="button"
              onClick={onGoToImport}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-cribl-navy px-4 text-sm font-semibold text-white"
            >
              Go to Import
            </button>
          </div>
        </div>
      ) : (
        <>
          {outOfSync && !syncBannerDismissed ? (
            <div
              className="relative rounded-lg border border-amber-200/90 bg-amber-50/90 py-2 pl-3 pr-10 text-xs text-amber-950"
              role="status"
            >
              <button
                type="button"
                onClick={() => setSyncBannerDismissed(true)}
                className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-amber-800/70 transition hover:bg-amber-100 hover:text-amber-950 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                aria-label="Dismiss sync warning"
                title="Dismiss"
              >
                <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
                  <path
                    d="M3 3 L13 13 M13 3 L3 13"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </button>
              <p className="m-0">
                Plan and routing snapshot may be out of sync — re-import from{' '}
                <button type="button" onClick={onGoToImport} className="font-medium text-amber-950 underline">
                  Import
                </button>
                .
              </p>
            </div>
          ) : null}

          <p className="m-0 text-xs text-cribl-muted">
            Click <strong className="font-medium text-cribl-ink/85">Worker Groups</strong> or{' '}
            <strong className="font-medium text-cribl-ink/85">Fleets</strong>, then a group to see sources, routes,
            pipelines, and destinations. Packs referenced by a worker group route sit on the pipeline row; packs with
            pack-local sources are labeled <strong className="font-medium text-cribl-ink/85">Local pack</strong> at the
            top, and other off-path packs as <strong className="font-medium text-cribl-ink/85">Unassigned pack</strong>{' '}
            — click any pack to zoom into its internal routing. Lines are illustrative — not live traffic.
          </p>

          <EnvironmentMap snapshot={snapshot} onSelectNode={setSelectedNode} selectedNode={selectedNode} />

          <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-cribl-muted">
            <span>
              Captured {new Date(snapshot.capturedAt).toLocaleString()} · {snapshot.source} · {snapshot.groups.length}{' '}
              group(s)
            </span>
            {snapshot.warnings.length > 0 && !warningsHidden ? (
              <>
                <span aria-hidden>·</span>
                {warningsExpanded ? (
                  <button
                    type="button"
                    onClick={() => setWarningsExpanded(false)}
                    className="font-medium text-amber-900 underline decoration-amber-900/40 underline-offset-2 hover:decoration-amber-900"
                  >
                    Hide warnings
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setWarningsExpanded(true)}
                    className="font-medium text-amber-900 underline decoration-amber-900/40 underline-offset-2 hover:decoration-amber-900"
                  >
                    See warnings ({snapshot.warnings.length})
                  </button>
                )}
              </>
            ) : null}
          </p>

          {snapshot.warnings.length > 0 && warningsExpanded && !warningsHidden ? (
            <div
              className="relative rounded-lg border border-amber-200/90 bg-amber-50/90 py-2 pl-3 pr-10 text-xs text-amber-950"
              role="status"
            >
              <button
                type="button"
                onClick={() => {
                  setWarningsExpanded(false)
                  setWarningsHidden(true)
                }}
                className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-amber-800/70 transition hover:bg-amber-100 hover:text-amber-950 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                aria-label="Dismiss warnings for this snapshot"
                title="Dismiss"
              >
                <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
                  <path
                    d="M3 3 L13 13 M13 3 L3 13"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </button>
              <ul className="m-0 list-inside list-disc space-y-1">
                {snapshot.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
