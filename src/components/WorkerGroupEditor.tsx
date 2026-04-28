import { useEffect, useMemo, useState } from 'react'
import {
  reductionGbFromSourceSummaryForWg,
  sumAvgDailyFromSourceSummaryForWg,
} from '../lib/workerGroupRollup'
import { formatGbOrTbPerDayStr, parseGb } from '../lib/formatRate'
import {
  formatGbOrTb,
  gbPerVcpuPerDay,
  nodesNeeded,
  pqDiskGb,
  requiredVcpus,
  workerProcessesPerNode,
  type CpuProfile,
} from '../lib/sizing'
import type { PlanState, WorkerGroupRow } from '../types/planTypes'
import { LabeledField, NumberWithSuffix, SectionBox } from './FormControls'
import type { PatchWg } from '../hooks/usePatchWorkerGroup'

type Props = {
  plan: PlanState
  group: WorkerGroupRow
  s: PatchWg
  onRemoveGroup?: (id: string) => void
  /** e.g. intro in detail view; omit in embedded uses */
  showHeader?: boolean
  /** When showHeader=true, controls the Capacity card's default expansion. */
  defaultExpanded?: boolean
  idPrefix?: string
}

export function WorkerGroupEditor({
  plan,
  group: r,
  s,
  showHeader = true,
  defaultExpanded = false,
  idPrefix = 'wgd',
}: Props) {
  const fromSources = sumAvgDailyFromSourceSummaryForWg(plan, r.id)
  const canIngestFromSources = fromSources.count > 0

  const autoIngestGb = canIngestFromSources ? fromSources.sum : null
  const autoIngestLabel = 'Source summary'
  const reductionGb = useMemo(
    () => reductionGbFromSourceSummaryForWg(plan, r.id),
    [plan.sourceSummary, r.id],
  )

  const [cpuProfile, setCpuProfile] = useState<CpuProfile>('x86_ht')
  const [customGbPerVcpu, setCustomGbPerVcpu] = useState('200')
  const [headroomPct, setHeadroomPct] = useState('20')
  const [nMinusOne, setNMinusOne] = useState(true)
  const [vcpusPerNode, setVcpusPerNode] = useState('16')
  const [pqEnabled, setPqEnabled] = useState(false)
  const [pqDays, setPqDays] = useState('1')
  const [pqCompression, setPqCompression] = useState('8')
  const [ingestOverrideEnabled, setIngestOverrideEnabled] = useState(() => r.ingestGbd.trim() !== '')

  useEffect(() => {
    setIngestOverrideEnabled(r.ingestGbd.trim() !== '')
  }, [r.id])

  const sizing = useMemo(() => {
    const ingestGb = ingestOverrideEnabled ? parseGb(r.ingestGbd) : autoIngestGb ?? Number.NaN
    const egressOverrideGb = parseGb(r.egressGbd)
    const autoEgressGb =
      Number.isFinite(ingestGb) && ingestGb > 0 ? Math.max(0, ingestGb - (Number.isFinite(reductionGb) ? reductionGb : 0)) : null
    const egressGb = Number.isFinite(egressOverrideGb) && egressOverrideGb >= 0 ? egressOverrideGb : autoEgressGb ?? Number.NaN
    const throughputOverride = parseGb(r.throughputGbd)
    const throughput =
      Number.isFinite(throughputOverride) && throughputOverride > 0
        ? throughputOverride
        : Number.isFinite(ingestGb) && Number.isFinite(egressGb)
          ? ingestGb + egressGb
          : Number.isFinite(ingestGb)
            ? ingestGb
            : Number.isFinite(egressGb)
              ? egressGb
              : null
    const throughputStr = throughput != null ? formatGbOrTbPerDayStr(throughput) : '—'
    const gbPer = gbPerVcpuPerDay(cpuProfile, parseFloat(customGbPerVcpu))
    const headroom = parseFloat(headroomPct)
    const needV = throughput != null ? requiredVcpus({ throughputGbPerDay: throughput, gbPerVcpuPerDay: gbPer, headroomPct: headroom }) : 0
    const perNode = Math.max(1, Math.floor(parseFloat(vcpusPerNode) || 16))
    const nodes = nodesNeeded({ requiredVcpus: needV, vcpusPerNode: perNode, nMinusOne })
    const procsPerNode = workerProcessesPerNode(perNode)
    const pqDisk = pqEnabled ? pqDiskGb({ egressGbPerDay: egressGb, days: parseFloat(pqDays), compressionRatio: parseFloat(pqCompression) }) : null
    const diskOverrideGb = parseGb(r.diskOneDayGb)
    const diskOneDayGb =
      Number.isFinite(diskOverrideGb) && diskOverrideGb >= 0
        ? diskOverrideGb
        : Number.isFinite(egressGb) && egressGb >= 0
          ? egressGb / 8
          : null
    const diskPretty = diskOneDayGb != null && Number.isFinite(diskOneDayGb) ? formatGbOrTb(diskOneDayGb) : '—'

    return {
      ingestGb,
      egressGb,
      autoEgressGb,
      throughput,
      throughputStr,
      diskOneDayGb,
      diskStrPretty: diskPretty,
      gbPerVcpuPerDay: gbPer,
      requiredVcpus: needV,
      vcpusPerNode: perNode,
      nodes,
      procsPerNode,
      pqDiskGb: pqDisk,
    }
  }, [r, autoIngestGb, ingestOverrideEnabled, reductionGb, cpuProfile, customGbPerVcpu, headroomPct, vcpusPerNode, nMinusOne, pqEnabled, pqDays, pqCompression])

  const form = (
    <div
      className="grid grid-cols-1 gap-3 rounded-xl border border-cribl-border bg-white p-3 shadow-[0_1px_2px_rgba(10,22,40,0.04)] sm:grid-cols-2 lg:grid-cols-4"
    >
      <div className="sm:col-span-2 lg:col-span-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-cribl-border/80 bg-cribl-card-body p-3">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-muted">Ingest</p>
            <p className="m-0 mt-1 text-sm font-semibold tabular-nums text-cribl-ink">
              {ingestOverrideEnabled
                ? r.ingestGbd.trim()
                  ? formatGbOrTbPerDayStr(parseGb(r.ingestGbd))
                  : '—'
                : autoIngestGb != null
                  ? formatGbOrTbPerDayStr(autoIngestGb)
                  : '—'}
            </p>
            <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">
              {ingestOverrideEnabled ? 'Override' : autoIngestLabel ? `Auto (${autoIngestLabel})` : 'Auto'}
            </p>
          </div>
          <div className="rounded-lg border border-cribl-border/80 bg-cribl-card-body p-3">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-muted">Egress</p>
            <p className="m-0 mt-1 text-sm font-semibold tabular-nums text-cribl-ink">
              {r.egressGbd.trim()
                ? formatGbOrTbPerDayStr(parseGb(r.egressGbd))
                : sizing.autoEgressGb != null && Number.isFinite(sizing.autoEgressGb)
                  ? formatGbOrTbPerDayStr(sizing.autoEgressGb)
                  : '—'}
            </p>
            <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">
              {r.egressGbd.trim() ? 'Override' : sizing.autoEgressGb != null ? 'Auto (ingest − reduction)' : 'Auto'}
            </p>
          </div>
          <div className="rounded-lg border border-cribl-border/80 bg-cribl-card-body p-3">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-muted">Throughput (in+out)</p>
            <p className="m-0 mt-1 text-sm font-semibold tabular-nums text-cribl-ink">{sizing.throughputStr}</p>
            <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">{r.throughputGbd.trim() ? 'Override' : 'Auto'}</p>
          </div>
          <div className="rounded-lg border border-cribl-border/80 bg-cribl-card-body p-3">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wider text-cribl-muted">Recommended size</p>
            <p className="m-0 mt-1 text-sm font-semibold tabular-nums text-cribl-ink">
              {sizing.requiredVcpus ? `${sizing.requiredVcpus} vCPU` : '—'} → {sizing.nodes || '—'} node{sizing.nodes === 1 ? '' : 's'}
            </p>
            <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">
              {headroomPct}% headroom · {nMinusOne ? 'N-1' : 'no N-1'} · {sizing.vcpusPerNode} vCPU/node
            </p>
          </div>
        </div>

        {pqEnabled ? (
          <div className="rounded-lg border border-cribl-border/80 bg-cribl-card-body p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="m-0 text-xs font-semibold text-cribl-ink">Persistent Queue disk (estimate)</p>
              <p className="m-0 text-xs tabular-nums text-cribl-muted">
                {sizing.pqDiskGb != null ? formatGbOrTb(sizing.pqDiskGb) : '—'}
              </p>
            </div>
            <p className="m-0 mt-0.5 text-[11px] text-cribl-muted">
              Egress × {pqDays} day(s) ÷ {pqCompression} (compression)
            </p>
          </div>
        ) : null}

        <SectionBox
          id={`${idPrefix}-${r.id}-advanced`}
          kicker="Advanced"
          title="Inputs & assumptions"
          collapsible
          defaultOpen={false}
          actions={
            <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-cribl-muted">
              <input
                type="checkbox"
                checked={ingestOverrideEnabled}
                onChange={(e) => {
                  const next = e.target.checked
                  setIngestOverrideEnabled(next)
                  if (!next) {
                    s('ingestGbd', '')
                    s('egressGbd', '')
                  }
                }}
              />
              Override ingest & egress
            </label>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <LabeledField
              id={`${idPrefix}-${r.id}-1`}
              label="Ingress (GB/day)"
              hint={
                autoIngestGb != null
                  ? `Auto: ${formatGbOrTbPerDayStr(autoIngestGb)} from ${autoIngestLabel}.`
                  : 'Auto from assigned sources (avg daily GB) or the Volume table.'
              }
            >
              {ingestOverrideEnabled ? (
                <input
                  inputMode="decimal"
                  id={`${idPrefix}-${r.id}-1`}
                  value={r.ingestGbd}
                  onChange={(e) => s('ingestGbd', e.target.value)}
                  className="field-strong"
                  placeholder="Enter ingest (GB/day)"
                />
              ) : (
                <p className="m-0 text-sm font-semibold tabular-nums text-cribl-ink">
                  {autoIngestGb != null && Number.isFinite(autoIngestGb) ? formatGbOrTbPerDayStr(autoIngestGb) : '—'}
                </p>
              )}
            </LabeledField>

            <LabeledField
              id={`${idPrefix}-${r.id}-2`}
              label="Egress (GB/day)"
              hint={
                sizing.autoEgressGb != null && Number.isFinite(sizing.autoEgressGb)
                  ? `Auto: ${formatGbOrTbPerDayStr(sizing.autoEgressGb)} (ingest − reduction).`
                  : 'Auto: ingest − reduction.'
              }
            >
              {ingestOverrideEnabled ? (
                <input
                  inputMode="decimal"
                  id={`${idPrefix}-${r.id}-2`}
                  value={r.egressGbd}
                  onChange={(e) => s('egressGbd', e.target.value)}
                  className="field-strong"
                  placeholder="Enter egress (GB/day)"
                />
              ) : (
                <p className="m-0 text-sm font-semibold tabular-nums text-cribl-ink">
                  {sizing.autoEgressGb != null && Number.isFinite(sizing.autoEgressGb) ? formatGbOrTbPerDayStr(sizing.autoEgressGb) : '—'}
                </p>
              )}
            </LabeledField>

            <LabeledField
              id={`${idPrefix}-${r.id}-tput`}
              label="Throughput"
              hint={r.throughputGbd.trim() ? 'Override set.' : 'Auto (ingest + egress).'}
            >
              {r.throughputGbd.trim() ? (
                <div className="space-y-1">
                  <input
                    inputMode="decimal"
                    id={`${idPrefix}-${r.id}-tput`}
                    value={r.throughputGbd}
                    onChange={(e) => s('throughputGbd', e.target.value)}
                    className="field-strong"
                    placeholder="Enter throughput (GB/day)"
                  />
                  <button
                    type="button"
                    onClick={() => s('throughputGbd', '')}
                    className="h-8 rounded-lg border border-cribl-border/80 bg-white px-2.5 text-xs font-medium text-cribl-ink"
                    title="Return to auto throughput"
                  >
                    Clear override
                  </button>
                </div>
              ) : (
                <p className="m-0 text-sm font-semibold tabular-nums text-cribl-ink">
                  {sizing.throughput != null && Number.isFinite(sizing.throughput) ? formatGbOrTbPerDayStr(sizing.throughput) : '—'}
                </p>
              )}
            </LabeledField>

            <LabeledField id={`${idPrefix}-${r.id}-cpu`} label="CPU profile">
              <select
                id={`${idPrefix}-${r.id}-cpu`}
                value={cpuProfile}
                onChange={(e) => setCpuProfile(e.target.value as CpuProfile)}
                className="text-xs"
              >
                <option value="x86_ht">x86 (HT) — 200 GB/d per vCPU</option>
                <option value="arm">ARM — 480 GB/d per vCPU</option>
                <option value="custom">Custom</option>
              </select>
            </LabeledField>

            <LabeledField id={`${idPrefix}-${r.id}-headroom`} label="Headroom (%)">
              <input
                id={`${idPrefix}-${r.id}-headroom`}
                inputMode="decimal"
                value={headroomPct}
                onChange={(e) => setHeadroomPct(e.target.value)}
              />
            </LabeledField>

            <LabeledField id={`${idPrefix}-${r.id}-node`} label="Node size (vCPUs)">
              <select id={`${idPrefix}-${r.id}-node`} value={vcpusPerNode} onChange={(e) => setVcpusPerNode(e.target.value)}>
                <option value="8">8</option>
                <option value="16">16</option>
                <option value="32">32</option>
                <option value="48">48</option>
              </select>
            </LabeledField>

            <LabeledField id={`${idPrefix}-${r.id}-availability`} label="Availability">
              <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-cribl-ink/95">
                <input type="checkbox" checked={nMinusOne} onChange={(e) => setNMinusOne(e.target.checked)} />
                N-1 sizing
              </label>
            </LabeledField>

            {cpuProfile === 'custom' ? (
              <LabeledField id={`${idPrefix}-${r.id}-custom`} label="GB/d per vCPU">
                <input
                  id={`${idPrefix}-${r.id}-custom`}
                  inputMode="decimal"
                  value={customGbPerVcpu}
                  onChange={(e) => setCustomGbPerVcpu(e.target.value)}
                  className="field-strong"
                  placeholder="e.g. 200"
                />
              </LabeledField>
            ) : null}

            <LabeledField id={`${idPrefix}-${r.id}-pq`} label="Persistent Queue">
              <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-cribl-ink/95">
                <input type="checkbox" checked={pqEnabled} onChange={(e) => setPqEnabled(e.target.checked)} />
                Enabled
              </label>
            </LabeledField>

            {pqEnabled ? (
              <>
                <LabeledField id={`${idPrefix}-${r.id}-pqdays`} label="PQ days">
                  <input id={`${idPrefix}-${r.id}-pqdays`} inputMode="decimal" value={pqDays} onChange={(e) => setPqDays(e.target.value)} />
                </LabeledField>
                <LabeledField id={`${idPrefix}-${r.id}-pqcomp`} label="PQ compression">
                  <input
                    id={`${idPrefix}-${r.id}-pqcomp`}
                    inputMode="decimal"
                    value={pqCompression}
                    onChange={(e) => setPqCompression(e.target.value)}
                  />
                </LabeledField>
              </>
            ) : null}

            <LabeledField
              className="sm:col-span-2"
              id={`${idPrefix}-${r.id}-disk`}
              label="Disk req’d for 1 day storage (GB)"
              hint="Leave empty to use egress ÷ 8 in the workbook when egress is set."
            >
              <NumberWithSuffix
                id={`${idPrefix}-${r.id}-disk`}
                value={r.diskOneDayGb}
                onChange={(v) => s('diskOneDayGb', v)}
                suffix="GB"
                min={0}
                step={10}
                placeholder={
                  sizing.diskOneDayGb != null && Number.isFinite(sizing.diskOneDayGb)
                    ? `Auto: ${sizing.diskStrPretty}`
                    : '0'
                }
              />
              {r.diskOneDayGb.trim() !== '' ? (
                <button
                  type="button"
                  onClick={() => s('diskOneDayGb', '')}
                  className="mt-1 h-8 rounded-lg border border-cribl-border/80 bg-white px-2.5 text-xs font-medium text-cribl-ink"
                  title="Return to auto disk"
                >
                  Clear override
                </button>
              ) : null}
            </LabeledField>

          </div>
        </SectionBox>
      </div>

    </div>
  )

  if (!showHeader) {
    return form
  }

  return (
    <SectionBox
      kicker="Capacity"
      id="wg-editor"
      title="Capacity"
      collapsible
      defaultOpen={defaultExpanded}
    >
      {form}
    </SectionBox>
  )
}
