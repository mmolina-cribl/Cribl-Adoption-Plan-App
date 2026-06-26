import { useEffect, useId } from 'react'
import type { ImportOverwriteDiff } from '../lib/importOverwriteDiff'
import type { EnvironmentGroupDiff, EnvironmentScopeDiff } from '../lib/environmentImportDiff'

const PLAN_OP_PREVIEW_LIMIT = 40

type Props = {
  open: boolean
  diff: ImportOverwriteDiff | null
  busy?: boolean
  onCancel: () => void
  onAccept: () => void
}

function formatCountDelta(before: number, after: number): string {
  if (before === after) {
    return String(after)
  }
  const delta = after - before
  const sign = delta > 0 ? '+' : ''
  return `${before} → ${after} (${sign}${delta})`
}

function ScopeCountsTable({ scopes }: { scopes: EnvironmentScopeDiff[] }) {
  if (scopes.length === 0) {
    return null
  }
  return (
    <div className="mt-1 overflow-x-auto rounded-md border border-cribl-border/70 bg-white">
      <table className="w-full min-w-[28rem] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-cribl-border/80 bg-cribl-canvas/60 text-cribl-muted">
            <th className="px-2 py-1.5 font-medium">Scope</th>
            <th className="px-2 py-1.5 font-medium">Kind</th>
            <th className="px-2 py-1.5 font-medium">Inputs</th>
            <th className="px-2 py-1.5 font-medium">Routes</th>
            <th className="px-2 py-1.5 font-medium">Pipelines</th>
            <th className="px-2 py-1.5 font-medium">Outputs</th>
          </tr>
        </thead>
        <tbody>
          {scopes.map((scope) => (
            <tr key={scope.scopeId} className="border-b border-cribl-border/40 last:border-b-0 align-top">
              <td className="px-2 py-1.5 font-mono text-cribl-ink/90">{scope.scopeId}</td>
              <td className="px-2 py-1.5 capitalize text-cribl-ink/80">{scope.scopeKind}</td>
              <td className="px-2 py-1.5 tabular-nums text-cribl-ink/80">
                {scope.before && scope.after
                  ? formatCountDelta(scope.before.inputs, scope.after.inputs)
                  : scope.after?.inputs ?? scope.before?.inputs ?? '—'}
              </td>
              <td className="px-2 py-1.5 tabular-nums text-cribl-ink/80">
                {scope.before && scope.after
                  ? formatCountDelta(scope.before.routes, scope.after.routes)
                  : scope.after?.routes ?? scope.before?.routes ?? '—'}
              </td>
              <td className="px-2 py-1.5 tabular-nums text-cribl-ink/80">
                {scope.before && scope.after
                  ? formatCountDelta(scope.before.pipelines, scope.after.pipelines)
                  : scope.after?.pipelines ?? scope.before?.pipelines ?? '—'}
              </td>
              <td className="px-2 py-1.5 tabular-nums text-cribl-ink/80">
                {scope.before && scope.after
                  ? formatCountDelta(scope.before.outputs, scope.after.outputs)
                  : scope.after?.outputs ?? scope.before?.outputs ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupDiffBlock({
  group,
  tone,
}: {
  group: EnvironmentGroupDiff
  tone: 'added' | 'removed' | 'changed'
}) {
  const toneClass =
    tone === 'added'
      ? 'border-emerald-200/90 bg-emerald-50/50'
      : tone === 'removed'
        ? 'border-rose-200/90 bg-rose-50/40'
        : 'border-cribl-border/80 bg-cribl-canvas/30'
  const label =
    tone === 'added' ? 'Added' : tone === 'removed' ? 'Removed' : 'Changed'

  return (
    <details className={`rounded-lg border px-3 py-2 ${toneClass}`} open={tone !== 'changed'}>
      <summary className="cursor-pointer text-sm font-medium text-cribl-ink">
        {label}: <span className="font-mono">{group.groupId}</span>
        {group.kind ? <span className="ml-1.5 font-normal capitalize text-cribl-muted">({group.kind})</span> : null}
      </summary>
      <ScopeCountsTable scopes={group.scopes} />
    </details>
  )
}

export function ImportOverwriteReviewDialog({ open, diff, busy, onCancel, onAccept }: Props) {
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open || !diff) {
    return null
  }

  const planOps = diff.plan.operations
  const env = diff.environment

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-cribl-ink/50 p-3 sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close dialog"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-cribl-border bg-white shadow-[0_16px_40px_rgba(10,22,40,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-cribl-border/80 px-5 py-4">
          <h2 id={titleId} className="m-0 text-base font-semibold text-cribl-ink sm:text-lg">
            Review import changes
          </h2>
          <p className="m-0 mt-1.5 text-sm leading-relaxed text-cribl-muted">
            {diff.plan.summary} {env.summary !== diff.plan.summary ? env.summary : ''}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" style={{ maxHeight: '70vh' }}>
          <section>
            <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-cribl-muted">Plan changes</h3>
            {planOps.length > 0 ? (
              <ul className="m-0 mt-2 list-disc space-y-0.5 pl-5 text-sm leading-relaxed text-cribl-ink">
                {planOps.slice(0, PLAN_OP_PREVIEW_LIMIT).map((op, i) => (
                  <li key={i}>{op}</li>
                ))}
              </ul>
            ) : (
              <p className="m-0 mt-2 text-sm text-cribl-muted">No plan changes detected.</p>
            )}
            {planOps.length > PLAN_OP_PREVIEW_LIMIT ? (
              <p className="m-0 mt-1 text-xs text-cribl-muted">
                +{planOps.length - PLAN_OP_PREVIEW_LIMIT} more operations
              </p>
            ) : null}
          </section>

          {diff.plan.activationWillReset ? (
            <p
              className="m-0 mt-3 rounded-lg border border-amber-200/90 bg-amber-50/90 px-3 py-2 text-sm text-amber-950"
              role="note"
            >
              <strong className="font-semibold">Activation reset:</strong> the PS Use Case Worksheet tracker will
              return to defaults. Export or back up activation progress first if needed.
            </p>
          ) : null}

          <section className="mt-4">
            <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-cribl-muted">
              Environment changes
            </h3>
            {env.willClear ? (
              <p className="m-0 mt-2 text-sm text-rose-900">
                Current routing snapshot ({env.snapshotTotals.before.inputs} inputs,{' '}
                {env.snapshotTotals.before.routes} routes across {env.groupsRemoved.length} group
                {env.groupsRemoved.length === 1 ? '' : 's'}) will be removed.
              </p>
            ) : null}

            {!env.willClear &&
            env.groupsAdded.length === 0 &&
            env.groupsRemoved.length === 0 &&
            env.groupsChanged.length === 0 ? (
              <p className="m-0 mt-2 text-sm text-cribl-muted">No routing snapshot changes detected.</p>
            ) : null}

            <div className="mt-2 space-y-2">
              {env.groupsRemoved.map((g) => (
                <GroupDiffBlock key={`rm-${g.groupId}`} group={g} tone="removed" />
              ))}
              {env.groupsAdded.map((g) => (
                <GroupDiffBlock key={`add-${g.groupId}`} group={g} tone="added" />
              ))}
              {env.groupsChanged.map((g) => (
                <GroupDiffBlock key={`chg-${g.groupId}`} group={g} tone="changed" />
              ))}
            </div>

            {!env.willClear && (env.currentSource || env.nextSource) ? (
              <p className="m-0 mt-3 text-xs text-cribl-muted">
                Snapshot source: {env.currentSource ?? 'none'} → {env.nextSource ?? 'none'}
                {env.capturedAtChanged ? ' · capture timestamp will update' : ''}
              </p>
            ) : null}
          </section>

          {diff.harvestWarnings && diff.harvestWarnings.length > 0 ? (
            <div className="mt-4 rounded-lg border border-amber-200/90 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-amber-900/80">Import warnings</p>
              <ul className="m-0 mt-1 list-inside list-disc space-y-0.5 text-xs">
                {diff.harvestWarnings.map((w, i) => (
                  <li key={`${i}-${w.slice(0, 48)}`}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="border-t border-cribl-border/80 px-5 py-4">
          <p className="m-0 text-xs text-cribl-muted">Nothing changes until you accept.</p>
          <div className="mt-3 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end sm:gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="h-10 flex-1 rounded-lg border border-cribl-border bg-cribl-canvas px-3 text-sm font-medium text-cribl-ink disabled:opacity-50 sm:flex-none"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onAccept}
              disabled={busy}
              className="h-10 flex-1 rounded-lg border border-amber-200 bg-amber-600 px-3 text-sm font-semibold text-white shadow-ctrl hover:bg-amber-700 disabled:opacity-50 sm:flex-none"
            >
              {busy ? 'Applying…' : 'Accept import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
