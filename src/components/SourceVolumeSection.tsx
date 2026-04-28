import { useId, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { sourceTypes } from '../data/referenceData'
import { defaultVolumeRow } from '../lib/defaultState'
import { sourceLinkOptionsFromPlan } from '../lib/inheritTopology'
import type { PlanState, SourceVolumeRow } from '../types/planTypes'
import { newId } from '../types/planTypes'
import { LabeledField, SectionBox, SelectWithEmpty } from './FormControls'

type Props = {
  plan: PlanState
  setPlan: Dispatch<SetStateAction<PlanState>>
}

function VolumeRowCard({
  r,
  plan,
  setPlan,
  onRemove,
  canRemove,
}: {
  r: SourceVolumeRow
  plan: PlanState
  setPlan: Dispatch<SetStateAction<PlanState>>
  onRemove: () => void
  canRemove: boolean
}) {
  const linkId = useId()
  const [fillFromId, setFillFromId] = useState('')
  const options = useMemo(() => sourceLinkOptionsFromPlan(plan), [plan])

  const s =
    (id: string) =>
    (k: keyof SourceVolumeRow, v: string) => {
        if (k === 'wg') {
        setPlan((p) => {
          const wgid =
            p.workerGroups.find((w) => w.wg.trim().toLowerCase() === v.trim().toLowerCase())?.id ?? ''
          return {
            ...p,
            sourceVolume: p.sourceVolume.map((x) =>
              x.id === id ? { ...x, wg: v, workerGroupId: wgid } : x,
            ),
          }
        })
        return
      }
      setPlan((p) => {
        const cur = p.sourceVolume.find((x) => x.id === id)
        if (!cur) {
          return p
        }
        return {
          ...p,
          sourceVolume: p.sourceVolume.map((x) => (x.id === id ? { ...x, [k]: v } : x)),
        }
      })
    }

  const applyFromDataSource = () => {
    if (!fillFromId) {
      return
    }
    const row = plan.sourceSummary.find((x) => x.id === fillFromId)
    if (!row) {
      return
    }
    setPlan((p) => ({
      ...p,
      sourceVolume: p.sourceVolume.map((x) =>
        x.id === r.id
          ? {
              ...x,
              source: (row.source ?? '').trim() || x.source,
              dailyVolumeGb: (row.avgDailyGb ?? '').trim() || x.dailyVolumeGb,
              destinations: (row.destinations ?? '').trim() || x.destinations,
            }
          : x,
      ),
    }))
  }

  const patch = s(r.id)

  return (
    <li
      className="grid grid-cols-1 gap-3 rounded-xl border border-cribl-border bg-white p-3 shadow-[0_1px_2px_rgba(10,22,40,0.04)] md:grid-cols-4 lg:grid-cols-5"
    >
      <div className="md:col-span-2 lg:col-span-5 flex min-w-0 flex-wrap items-end gap-2 rounded-lg border border-dashed border-cribl-border/80 bg-cribl-canvas/50 px-2.5 py-2">
        <LabeledField
          id={linkId}
          className="min-w-[8rem] flex-1"
          label="Fill from data source"
          hint="Copy sourcetype, est. daily volume, and destinations from a Source summary row"
        >
          <select
            id={linkId}
            className="w-full min-w-0 max-w-sm border-cribl-border"
            value={fillFromId}
            onChange={(e) => setFillFromId(e.target.value)}
          >
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </LabeledField>
        <button
          type="button"
          disabled={!fillFromId || options.length < 1}
          onClick={applyFromDataSource}
          className="h-9 shrink-0 rounded-lg border border-cribl-border bg-white px-3 text-sm font-medium text-cribl-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apply
        </button>
      </div>
      <LabeledField
        id={`v-${r.id}-1`}
        label="Source"
      >
        <input
          type="text"
          id={`v-${r.id}-1`}
          value={r.source}
          onChange={(e) => patch('source', e.target.value)}
        />
      </LabeledField>
      <LabeledField
        id={`v-${r.id}-2`}
        label="Daily volume (GB/d)"
      >
        <input
          inputMode="decimal"
          id={`v-${r.id}-2`}
          value={r.dailyVolumeGb}
          onChange={(e) => patch('dailyVolumeGb', e.target.value)}
        />
      </LabeledField>
      <LabeledField
        id={`v-${r.id}-3`}
        label="Type"
      >
        <SelectWithEmpty
          value={r.type}
          onChange={(v) => patch('type', v)}
          id={`v-${r.id}-3`}
          options={[...sourceTypes] as string[]}
          allowEmpty
          placeholder="On-prem / cloud"
        />
      </LabeledField>
      <LabeledField
        id={`v-${r.id}-4`}
        label="Region(s)"
      >
        <input
          type="text"
          id={`v-${r.id}-4`}
          value={r.region}
          onChange={(e) => patch('region', e.target.value)}
        />
      </LabeledField>
      <LabeledField
        id={`v-${r.id}-5`}
        label="Current collection"
      >
        <input
          type="text"
          id={`v-${r.id}-5`}
          value={r.currentCollection}
          onChange={(e) => patch('currentCollection', e.target.value)}
        />
      </LabeledField>
      <LabeledField
        id={`v-${r.id}-6`}
        label="Cribl collection"
      >
        <input
          type="text"
          id={`v-${r.id}-6`}
          value={r.criblCollection}
          onChange={(e) => patch('criblCollection', e.target.value)}
        />
      </LabeledField>
      <LabeledField
        id={`v-${r.id}-7`}
        label="Worker group"
      >
        <input
          type="text"
          id={`v-${r.id}-7`}
          value={r.wg}
          onChange={(e) => patch('wg', e.target.value)}
        />
      </LabeledField>
      <LabeledField
        id={`v-${r.id}-8`}
        label="Use case(s)"
      >
        <input
          type="text"
          id={`v-${r.id}-8`}
          value={r.useCases}
          onChange={(e) => patch('useCases', e.target.value)}
        />
      </LabeledField>
      <LabeledField
        id={`v-${r.id}-9`}
        label="Destination(s)"
      >
        <input
          type="text"
          id={`v-${r.id}-9`}
          value={r.destinations}
          onChange={(e) => patch('destinations', e.target.value)}
        />
      </LabeledField>
      <LabeledField
        className="md:col-span-2"
        id={`v-${r.id}-0`}
        label="Notes"
      >
        <input
          type="text"
          id={`v-${r.id}-0`}
          value={r.notes}
          onChange={(e) => patch('notes', e.target.value)}
        />
      </LabeledField>
      <div className="md:col-span-4 flex items-end justify-end lg:col-span-1">
        {canRemove && (
          <button
            type="button"
            className="text-xs text-cribl-muted hover:text-rose-600"
            onClick={onRemove}
          >
            Remove row
          </button>
        )}
      </div>
    </li>
  )
}

export function SourceVolumeSection({ plan, setPlan }: Props) {
  const addSrc = () =>
    setPlan((p) => {
      const wgid = p.workerGroups[0]?.id ?? ''
      const row = defaultVolumeRow(wgid)
      row.id = newId()
      return { ...p, sourceVolume: [...p.sourceVolume, row] }
    })

  const remSrc = (id: string) =>
    setPlan((p) => ({
      ...p,
      sourceVolume: p.sourceVolume.filter((r) => r.id !== id),
    }))

  return (
    <div className="flex flex-col gap-6">
      <SectionBox
        kicker="Topology"
        id="volume"
        title="Sources, volume, region"
        actions={
          <button
            type="button"
            onClick={addSrc}
            className="h-8 rounded-lg border border-cribl-border bg-cribl-canvas px-2.5 text-sm font-medium text-cribl-ink"
          >
            + Add
          </button>
        }
      >
        <p className="m-0 mb-4 text-sm text-cribl-muted">
          One row per physical or logical data source. Use <strong>Fill from data source</strong> to pull sourcetype,
          estimated daily volume, and destinations from a detailed data source you already set up in the list.
        </p>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {plan.sourceVolume.map((r) => (
            <VolumeRowCard
              key={r.id}
              r={r}
              plan={plan}
              setPlan={setPlan}
              canRemove={plan.sourceVolume.length > 0}
              onRemove={() => remSrc(r.id)}
            />
          ))}
        </ul>
      </SectionBox>
    </div>
  )
}
