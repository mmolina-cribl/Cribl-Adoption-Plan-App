import type { CriblEnvironmentConfig, CriblEnvironmentSnapshot } from '../lib/criblEnvironmentTypes'
import { environmentScopeDisplayLabel } from '../lib/criblEnvironmentTypes'
import type { EnvironmentFlowNodeData } from '../lib/environmentFlowGraph'
import { resolveEnvironmentEntity } from '../lib/environmentEntityLookup'

const KIND_LABEL: Record<string, string> = {
  input: 'Source',
  route: 'Route',
  pipeline: 'Pipeline',
  output: 'Destination',
}

function ConfigBlock({ title, config }: { title: string; config: CriblEnvironmentConfig }) {
  const keys = Object.keys(config)
  if (keys.length === 0) {
    return null
  }
  return (
    <details className="mt-2 rounded-md border border-cribl-border/70 bg-cribl-canvas/40">
      <summary className="cursor-pointer px-2.5 py-1.5 text-[11px] font-semibold text-cribl-ink">{title}</summary>
      <pre className="m-0 max-h-48 overflow-auto px-2.5 py-2 font-mono text-[10px] leading-relaxed text-cribl-muted">
        {JSON.stringify(config, null, 2)}
      </pre>
    </details>
  )
}

function ScalarGrid({ fields }: { fields: Array<{ label: string; value: string | boolean | undefined }> }) {
  const rows = fields.filter((f) => f.value !== undefined && f.value !== '')
  if (rows.length === 0) {
    return null
  }
  return (
    <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-cribl-muted">
      {rows.map((f) => (
        <div key={f.label} className="contents">
          <dt className="font-medium text-cribl-ink/80">{f.label}</dt>
          <dd className="m-0 font-mono break-all">{String(f.value)}</dd>
        </div>
      ))}
    </dl>
  )
}

type Props = {
  snapshot: CriblEnvironmentSnapshot
  node: EnvironmentFlowNodeData
  className?: string
}

export function EnvironmentEntityDetail({ snapshot, node, className }: Props) {
  const kindLabel = KIND_LABEL[node.nodeKind] ?? node.nodeKind

  if (node.entityRef) {
    const resolved = resolveEnvironmentEntity(snapshot, node.entityRef)
    if (!resolved) {
      return (
        <div className={className ?? ''}>
          <p className="m-0 text-xs text-cribl-muted">Entity not found in snapshot.</p>
        </div>
      )
    }

    const { group, scope } = resolved
    const contextLabel = `${group.label} · ${environmentScopeDisplayLabel(scope)}`

    if (resolved.kind === 'input') {
      const entity = resolved.entity
      return (
        <div className={className ?? ''}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800">
              {kindLabel}
            </span>
            <p className="m-0 text-sm font-semibold text-cribl-ink">{entity.id}</p>
            {entity.disabled ? (
              <span className="text-[10px] font-medium text-amber-800">Disabled</span>
            ) : null}
          </div>
          <p className="m-0 mt-1 text-[11px] text-cribl-muted">{contextLabel}</p>
          <ScalarGrid
            fields={[
              { label: 'Type', value: entity.type },
              { label: 'Description', value: entity.description },
              { label: 'Disabled', value: entity.disabled },
            ]}
          />
          {entity.config ? <ConfigBlock title="Full config" config={entity.config} /> : null}
        </div>
      )
    }

    if (resolved.kind === 'route') {
      const entity = resolved.entity
      return (
        <div className={className ?? ''}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800">
              {kindLabel}
            </span>
            <p className="m-0 text-sm font-semibold text-cribl-ink">{entity.name?.trim() || entity.id}</p>
            {entity.disabled ? (
              <span className="text-[10px] font-medium text-amber-800">Disabled</span>
            ) : null}
          </div>
          <p className="m-0 mt-1 text-[11px] text-cribl-muted">{contextLabel}</p>
          <ScalarGrid
            fields={[
              { label: 'ID', value: entity.id },
              { label: 'Filter', value: entity.filter },
              { label: 'Pipeline', value: entity.pipeline },
              { label: 'Output', value: entity.output },
            ]}
          />
          {entity.config ? <ConfigBlock title="Full route" config={entity.config} /> : null}
        </div>
      )
    }

    if (resolved.kind === 'pipeline') {
      const entity = resolved.entity
      return (
        <div className={className ?? ''}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
              {kindLabel}
            </span>
            <p className="m-0 text-sm font-semibold text-cribl-ink">{entity.id}</p>
            {entity.disabled ? (
              <span className="text-[10px] font-medium text-amber-800">Disabled</span>
            ) : null}
          </div>
          <p className="m-0 mt-1 text-[11px] text-cribl-muted">{contextLabel}</p>
          <ScalarGrid
            fields={[
              { label: 'Description', value: entity.description },
              { label: 'Functions', value: entity.functions?.length ? String(entity.functions.length) : undefined },
            ]}
          />
          {entity.functions && entity.functions.length > 0 ? (
            <div className="mt-3 space-y-2">
              <p className="m-0 text-[11px] font-semibold text-cribl-ink">Functions</p>
              {entity.functions.map((fn) => (
                <details
                  key={fn.id}
                  className="rounded-md border border-cribl-border/70 bg-white/80"
                  open={entity.functions!.length <= 3}
                >
                  <summary className="cursor-pointer px-2.5 py-1.5 text-[11px] font-medium text-cribl-ink">
                    {fn.id}
                    {fn.filter ? (
                      <span className="ml-2 font-mono text-[10px] font-normal text-cribl-muted">{fn.filter}</span>
                    ) : null}
                  </summary>
                  <div className="border-t border-cribl-border/60 px-2.5 py-2">
                    <ScalarGrid
                      fields={[
                        { label: 'Filter', value: fn.filter },
                        { label: 'Disabled', value: fn.disabled },
                      ]}
                    />
                    {fn.conf ? <ConfigBlock title="Function config" config={fn.conf} /> : null}
                  </div>
                </details>
              ))}
            </div>
          ) : null}
          {entity.config ? <ConfigBlock title="Pipeline config" config={entity.config} /> : null}
        </div>
      )
    }

    if (resolved.kind === 'output') {
      const entity = resolved.entity
      return (
        <div className={className ?? ''}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900">
              {kindLabel}
            </span>
            <p className="m-0 text-sm font-semibold text-cribl-ink">{entity.id}</p>
            {entity.disabled ? (
              <span className="text-[10px] font-medium text-amber-800">Disabled</span>
            ) : null}
          </div>
          <p className="m-0 mt-1 text-[11px] text-cribl-muted">{contextLabel}</p>
          <ScalarGrid
            fields={[
              { label: 'Type', value: entity.type },
              { label: 'Disabled', value: entity.disabled },
            ]}
          />
          {entity.config ? <ConfigBlock title="Full config" config={entity.config} /> : null}
        </div>
      )
    }

    return null
  }

  return (
    <div className={className ?? ''}>
      <p className="m-0 text-sm font-semibold text-cribl-ink">{node.label}</p>
      {node.sublabel ? <p className="m-0 mt-1 text-[11px] text-cribl-muted">{node.sublabel}</p> : null}
    </div>
  )
}
