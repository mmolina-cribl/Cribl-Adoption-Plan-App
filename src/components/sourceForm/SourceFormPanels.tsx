import { useEffect, useRef, useState } from 'react'
import {
  inputData,
  securityDataTypes,
  sourceTileSearchAliases,
  sourceTypes,
} from '../../data/referenceData'
import { PencilIcon } from '../PencilIcon'
import { AssistantMessageRich } from '../AssistantMessageRich'
import { type PlanState, type SourceSummaryRow } from '../../types/planTypes'
import { isSourceRowAttachmentDisabled, sourceDisplayLabel, stripAttachmentDisabledNameSuffix } from '../../lib/sourceAttachmentDisabled'
import {
  CheckboxLabeled,
  ComboboxText,
  LabeledField,
  MultiComboboxChips,
  NumberWithSuffix,
  RetentionDials,
  SectionBox,
  SelectWithEmpty,
} from '../FormControls'
import { getSourceDetailCardsExpanded, ensureDetailCardsPreferenceHydrated } from '../../lib/detailCardsPreference'

export type SourceSummaryFieldPatch = (k: keyof SourceSummaryRow, v: string | boolean) => void

type Base = {
  row: SourceSummaryRow
  s: SourceSummaryFieldPatch
}

/**
 * Read-only "Stream" / "Edge" / "Unassigned" badge. v2.0 dropped the
 * editable Stream-or-Edge select on every source — the field is now
 * auto-derived from the WG / Fleet this source is attached to (see
 * `lib/workerGroupIds.deriveStreamOrEdge`). The badge keeps the value
 * visible in both the wizard's full-form view and on the data-source
 * detail card so customers can confirm at a glance which side of the
 * topology a source lives on.
 */
function StreamOrEdgeBadge({ value }: { value: string }) {
  const v = (value || '').trim()
  const isEdge = /^edge$/i.test(v)
  const isStream = /^stream$/i.test(v)
  const label = isEdge ? 'Edge' : isStream ? 'Stream' : 'Unassigned'
  const tone = isEdge
    ? 'border-cribl-primary/30 bg-cribl-primary-soft text-cribl-primary-ink'
    : isStream
    ? 'border-cribl-border bg-cribl-card-body text-cribl-ink'
    : 'border-dashed border-cribl-border/80 bg-cribl-canvas text-cribl-muted'
  return (
    <span
      className={[
        'inline-flex h-9 items-center gap-1.5 self-start rounded-md border px-2.5 text-sm font-medium',
        tone,
      ].join(' ')}
      title={
        isEdge
          ? 'This source is attached to a Fleet (Edge).'
          : isStream
          ? 'This source is attached to a Worker Group (Stream).'
          : 'Not yet attached to a worker group or fleet.'
      }
    >
      <span
        aria-hidden
        className={[
          'inline-block h-2 w-2 rounded-full',
          isEdge ? 'bg-cribl-primary' : isStream ? 'bg-cribl-ink' : 'bg-cribl-muted/60',
        ].join(' ')}
      />
      {label}
    </span>
  )
}

/** PRIMARY DATA POINTS */
export function PrimaryDataPointsBlock({ row, s }: Base) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <LabeledField
        id={`s-${row.id}-src`}
        label="Source"
        hint="Implied from the source name you set when you created this row."
      >
        <input
          id={`s-${row.id}-src`}
          value={stripAttachmentDisabledNameSuffix(row.source) || row.source}
          disabled
          className="cursor-not-allowed bg-cribl-canvas"
        />
      </LabeledField>
      <LabeledField
        id={`s-${row.id}-so`}
        label="Security or Observability or both data?"
      >
        <SelectWithEmpty
          id={`s-${row.id}-so`}
          value={row.securityOrObs}
          onChange={(v) => s('securityOrObs', v)}
          options={[...securityDataTypes]}
          placeholder="Choose…"
        />
      </LabeledField>
      <LabeledField
        id={`s-${row.id}-se`}
        label="Stream or Edge?"
        hint="Auto-derived from the worker group / fleet this source is attached to."
      >
        <StreamOrEdgeBadge value={row.streamOrEdge} />
      </LabeledField>
      <LabeledField id={`s-${row.id}-type`} label="Type">
        <SelectWithEmpty
          id={`s-${row.id}-type`}
          value={row.type}
          onChange={(v) => s('type', v)}
          options={[...sourceTypes]}
          allowEmpty
          placeholder="On-Prem or Cloud/Internet"
        />
      </LabeledField>
      <LabeledField
        id={`s-${row.id}-loc`}
        label="Physical location(s)"
        hint="Free text — region, data center, or host range. Press Enter to bubble a value, or use commas."
      >
        <MultiComboboxChips
          id={`s-${row.id}-loc`}
          value={row.physicalLocations}
          onChange={(v) => s('physicalLocations', v)}
          options={[]}
          showSuggestions={false}
          placeholder="e.g. us-east-1, DC4 / Stockholm…"
        />
      </LabeledField>
      <LabeledField
        id={`s-${row.id}-cc`}
        label="Current collection (optional)"
        hint="Only if this data is already collected somewhere today (agents, forwarders, syslog). Skip for net-new feeds. Press Enter to bubble a value, or use commas. Column C on each v0.9.1 per-WG / per-Fleet sheet when populated."
      >
        <MultiComboboxChips
          id={`s-${row.id}-cc`}
          value={row.currentCollection}
          onChange={(v) => s('currentCollection', v)}
          options={[]}
          showSuggestions={false}
          placeholder="e.g. Splunk UF, syslog-ng, Datadog Agent"
        />
      </LabeledField>
      <LabeledField id={`s-${row.id}-tile`} label="Source tile">
        <ComboboxText
          id={`s-${row.id}-tile`}
          value={row.sourceTile}
          onChange={(v) => s('sourceTile', v)}
          options={inputData.techTiles}
          optionAliases={sourceTileSearchAliases}
          alwaysShowOptions
          placeholder="Scroll the list or type to filter…"
        />
      </LabeledField>
      <LabeledField id={`s-${row.id}-pipe`} label="Pipeline usecase">
        <MultiComboboxChips
          id={`s-${row.id}-pipe`}
          value={row.pipelineUsecase}
          onChange={(v) => s('pipelineUsecase', v)}
          options={inputData.pipeline}
          placeholder="e.g. Aggregation, Passthru, Cleanup"
        />
      </LabeledField>
      <LabeledField id={`s-${row.id}-dest`} label="Destinations">
        <MultiComboboxChips
          id={`s-${row.id}-dest`}
          value={row.destinations}
          onChange={(v) => s('destinations', v)}
          options={inputData.destTiles}
          allowCustom={false}
          alwaysShowOptions
          placeholder="Search tiles, then pick from the list…"
        />
      </LabeledField>
      <LabeledField
        id={`s-${row.id}-ret`}
        label="Retention"
        hint="Set a number and a unit."
      >
        <RetentionDials
          idBase={`s-${row.id}-ret`}
          value={row.retention}
          onChange={(v) => s('retention', v)}
        />
      </LabeledField>
    </div>
  )
}

/** VOLUME & PRIORITY */
export function VolumePriorityBlock({ row, s }: Base) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <LabeledField
        id={`s-${row.id}-gb`}
        label="Average Daily Volume? (GB)"
        hint="Numeric value; GB is implied."
      >
        <NumberWithSuffix
          id={`s-${row.id}-gb`}
          value={row.avgDailyGb}
          onChange={(v) => s('avgDailyGb', v)}
          suffix="GB"
          min={0}
          step={1}
          placeholder="0"
        />
      </LabeledField>
      <LabeledField id={`s-${row.id}-cpl`} label="Compliance">
        <CheckboxLabeled
          id={`s-${row.id}-cpl-cb`}
          label="Compliance related?"
          checked={row.complianceRelated}
          onChange={(b) => s('complianceRelated', b)}
        />
      </LabeledField>
      <LabeledField id={`s-${row.id}-cri`} label="Data criticality">
        <SelectWithEmpty
          id={`s-${row.id}-cri`}
          value={row.dataCriticality}
          onChange={(v) => s('dataCriticality', v)}
          options={[...inputData.criticality] as string[]}
          allowEmpty
          placeholder="e.g. HIGH, MEDIUM, LOW"
        />
      </LabeledField>
      <LabeledField
        id={`s-${row.id}-st`}
        label="Stakeholder(s) (team / line of business)"
        className="md:col-span-2 lg:col-span-3"
      >
        <textarea
          id={`s-${row.id}-st`}
          className="field-strong min-h-10 resize-y"
          value={row.stakeholders}
          onChange={(e) => s('stakeholders', e.target.value)}
          rows={2}
        />
      </LabeledField>
    </div>
  )
}

/** Phase & roadmap */
export function PhaseRoadmapBlock({ row, s }: Base) {
  const dateFields = [
    {
      key: 'targetOnboardStart' as const,
      label: 'Target Onboarding Start',
      id: `s-${row.id}-a`,
      disabled: row.isCurrent,
      hint: undefined,
    },
    {
      key: 'targetOnboardEnd' as const,
      label: 'Target Onboarding End',
      id: `s-${row.id}-b`,
      disabled: false,
      hint: undefined,
    },
    {
      key: 'onboardingCompletedOn' as const,
      label: 'Onboarding Completed On',
      id: `s-${row.id}-c`,
      disabled: false,
      hint: undefined,
    },
  ] as const
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col justify-end gap-1">
        <p className="m-0 text-xs font-medium tracking-wide text-cribl-muted uppercase">Status</p>
        <CheckboxLabeled
          id={`s-${row.id}-is`}
          label="Current?"
          checked={row.isCurrent}
          onChange={(b) => s('isCurrent', b)}
        />
      </div>
      {dateFields.map(({ key, label, id: eid, disabled, hint }) => (
        <LabeledField
          key={key}
          id={eid}
          label={label}
          className={disabled ? 'opacity-60' : undefined}
          hint={hint}
        >
          <input
            id={eid}
            type="date"
            value={row[key] as string}
            onChange={(e) => s(key, e.target.value)}
            disabled={disabled}
            className={disabled ? 'cursor-not-allowed bg-cribl-canvas' : undefined}
            title={disabled ? 'Clear “Current?” to set a target start date' : undefined}
          />
        </LabeledField>
      ))}
      <div className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-2 lg:col-span-2">
        <LabeledField id={`s-${row.id}-dop`} label="Data optimization %">
          <NumberWithSuffix
            id={`s-${row.id}-dop`}
            value={row.dataOptPct}
            onChange={(v) => s('dataOptPct', v)}
            suffix="%"
            min={0}
            max={100}
            step={1}
            placeholder="0"
          />
        </LabeledField>
        <LabeledField id={`s-${row.id}-dog`} label="Data optimization (GB)">
          <NumberWithSuffix
            id={`s-${row.id}-dog`}
            value={row.dataOptGb}
            onChange={(v) => s('dataOptGb', v)}
            suffix="GB"
            min={0}
            step={1}
            placeholder="0"
          />
        </LabeledField>
      </div>
      <LabeledField id={`s-${row.id}-gr`} label="Growth?">
        <textarea
          id={`s-${row.id}-gr`}
          className="field-strong min-h-10 resize-y"
          value={row.growth}
          onChange={(e) => s('growth', e.target.value)}
          rows={2}
        />
      </LabeledField>
      <LabeledField id={`s-${row.id}-bl`} label="Blockers">
        <textarea
          id={`s-${row.id}-bl`}
          className="field-strong min-h-10 resize-y"
          value={row.blockers}
          onChange={(e) => s('blockers', e.target.value)}
          rows={2}
        />
      </LabeledField>
    </div>
  )
}

/**
 * INITIATIVE, USE CASES, VALUE LEVERS
 *
 * Mirrors the gold v0.9.1 per-WG sheet's "INITIATIVE, USE CASES, VALUE
 * LEVERS" header group (columns W:AA = Initiative case / Technical Use
 * Case / Financial / Operational / Risk Reduction; AB:AD = Strategic /
 * Onboarding Effort / Politics). The `Additional notes` column (AE) sits
 * outside every banner group — see {@link AdditionalNotesBlock}.
 */
export function InitiativeValueLeversBlock({ row, s }: Base) {
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LabeledField id={`s-${row.id}-in`} label="Initiative case">
          <MultiComboboxChips
            id={`s-${row.id}-in`}
            value={row.initiativeCase}
            onChange={(v) => s('initiativeCase', v)}
            options={inputData.initiatives}
          />
        </LabeledField>
        <LabeledField id={`s-${row.id}-ta`} label="Technical Use Case">
          <MultiComboboxChips
            id={`s-${row.id}-ta`}
            value={row.technicalUsecase}
            onChange={(v) => s('technicalUsecase', v)}
            options={inputData.technicalUsecase}
          />
        </LabeledField>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <LabeledField id={`s-${row.id}-f`} label="Financial">
          <MultiComboboxChips
            id={`s-${row.id}-f`}
            value={row.financial}
            onChange={(v) => s('financial', v)}
            options={inputData.financial}
          />
        </LabeledField>
        <LabeledField id={`s-${row.id}-o`} label="Operational">
          <MultiComboboxChips
            id={`s-${row.id}-o`}
            value={row.operational}
            onChange={(v) => s('operational', v)}
            options={inputData.operational}
          />
        </LabeledField>
        <LabeledField id={`s-${row.id}-r`} label="Risk Reduction">
          <MultiComboboxChips
            id={`s-${row.id}-r`}
            value={row.riskReduction}
            onChange={(v) => s('riskReduction', v)}
            options={inputData.risk}
          />
        </LabeledField>
        <LabeledField id={`s-${row.id}-st2`} label="Strategic">
          <MultiComboboxChips
            id={`s-${row.id}-st2`}
            value={row.strategic}
            onChange={(v) => s('strategic', v)}
            options={inputData.strategic}
          />
        </LabeledField>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <LabeledField id={`s-${row.id}-e`} label="Onboarding Effort">
          <SelectWithEmpty
            value={row.onboardingEffort}
            onChange={(v) => s('onboardingEffort', v)}
            options={inputData.criticality as unknown as string[]}
            allowEmpty
            placeholder="Select…"
          />
        </LabeledField>
        <LabeledField id={`s-${row.id}-p`} label="Politics">
          <textarea
            id={`s-${row.id}-p`}
            className="field-strong min-h-10 resize-y"
            value={row.politics}
            onChange={(e) => s('politics', e.target.value)}
            rows={2}
          />
        </LabeledField>
      </div>
    </div>
  )
}

/**
 * ADDITIONAL NOTES
 *
 * Mirrors the gold v0.9.1 per-WG / per-Fleet sheet's column AE — the only
 * column that sits outside every row-1 banner group. Free-text catchall
 * for things that don't fit any of the structured fields above (vendor
 * contacts, ticket links, custom compliance carve-outs, ad-hoc reminders).
 * Single textarea, full-width, expandable: matches the `Politics` /
 * `Blockers` shape so the section reads consistently with the other
 * notes-style fields elsewhere in the form.
 */
export function AdditionalNotesBlock({ row, s }: Base) {
  const preview = row.additionalNotes.trim()
  return (
    <LabeledField
      id={`s-${row.id}-an`}
      label="Additional notes"
      hint="`https://…` links and `[label](https://…)` markdown render as clickable links in the preview below."
    >
      <textarea
        id={`s-${row.id}-an`}
        className="field-strong min-h-20 resize-y"
        value={row.additionalNotes}
        onChange={(e) => s('additionalNotes', e.target.value)}
        rows={3}
        placeholder="Anything else worth noting about this source — vendor contacts, ticket links, ad-hoc compliance carve-outs, etc."
      />
      {preview !== '' && (
        <div className="mt-2 space-y-1">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-cribl-muted">Link preview</p>
          <div className="max-h-48 overflow-y-auto rounded-md border border-cribl-border/70 bg-cribl-canvas/40 px-2 py-1.5 text-xs leading-relaxed text-cribl-ink">
            <AssistantMessageRich text={row.additionalNotes} linkifyPlainUrls className="m-0" />
          </div>
        </div>
      )}
    </LabeledField>
  )
}

type StackProps = {
  plan: PlanState
  row: SourceSummaryRow
  s: SourceSummaryFieldPatch
  sourceIndex: number
  /** Opens guided entry (step-by-step form) */
  onOpenGuidedTour?: () => void
}

/**
 * Four stacked cards for the source summary: primary data, volume, roadmap, value.
 */
function WorkerGroupAssignmentBlock({ plan, row, s }: { plan: PlanState; row: SourceSummaryRow; s: SourceSummaryFieldPatch }) {
  if (plan.workerGroups.length < 1) {
    return (
        <p className="m-0 text-sm text-cribl-muted">Add a worker group under Worker Groups in the plan.</p>
    )
  }
  if (isSourceRowAttachmentDisabled(row)) {
    const wg = row.workerGroupId
      ? plan.workerGroups.find((w) => w.id === row.workerGroupId)
      : null
    const wgLabel = wg?.wg.trim() || (row.workerGroupId ? 'Worker group' : '')
    return (
      <LabeledField
        id={`s-${row.id}-wgroup`}
        label="Assign to"
        hint="Disabled topology inputs cannot be moved between worker groups. You can detach to unassigned from the plan resource map or worker group page."
      >
        <p className="m-0 max-w-md rounded-lg border border-cribl-border/70 bg-cribl-card-body/60 px-3 py-2 text-sm text-cribl-muted">
          {row.workerGroupId
            ? `Attached to ${wgLabel || 'a worker group or fleet'} — use Unassign on the resource map to detach only.`
            : 'Unassigned — this disabled source cannot be attached from here.'}
        </p>
      </LabeledField>
    )
  }
  return (
    <LabeledField
      id={`s-${row.id}-wgroup`}
      label="Assign to"
      hint="Unassigned by default. Choose a worker group to roll this source and its destinations into that group’s capacity, or leave unassigned."
    >
      <select
        id={`s-${row.id}-wgroup`}
        className="w-full max-w-md rounded-lg border border-cribl-border bg-white px-3 py-2 text-sm text-cribl-ink"
        value={row.workerGroupId}
        onChange={(e) => s('workerGroupId', e.target.value)}
      >
        <option value="">Unassigned</option>
        {plan.workerGroups.map((w) => (
          <option key={w.id} value={w.id}>
            {w.wg.trim() || 'Unnamed worker group'}
          </option>
        ))}
      </select>
    </LabeledField>
  )
}

export function SourceSummaryStack({ plan, row, s, sourceIndex, onOpenGuidedTour }: StackProps) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // v0.9.1 dropped the dedicated "Display name" column — the gold per-WG sheet
  // uses the Source name as the row title. The header inline-edit now writes
  // directly to `source`; the disabled "Source" field inside Primary Data
  // Points mirrors the same value so both spots stay in sync.
  const label = sourceDisplayLabel(row, sourceIndex)
  const expandByDefault = getSourceDetailCardsExpanded()

  useEffect(() => {
    ensureDetailCardsPreferenceHydrated()
  }, [])

  useEffect(() => {
    if (!editing) {
      return
    }
    const el = inputRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [editing])

  return (
    <div className="space-y-6">
      <div>
        <p className="m-0 text-[11px] font-semibold text-cribl-primary uppercase">Source summary</p>
        {editing ? (
          <div className="mt-0.5 flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2 gap-y-1">
            <input
              ref={inputRef}
              id={`s-${row.id}-source`}
              className="min-w-[10rem] max-w-full border-0 border-b border-transparent bg-transparent py-0.5 text-lg font-semibold text-cribl-ink outline-none focus:border-cribl-primary/40"
              value={row.source}
              onChange={(e) => s('source', e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.currentTarget.blur()
                }
              }}
              placeholder={`Source ${sourceIndex + 1}`}
              autoComplete="off"
              aria-label="Source name"
            />
          </div>
        ) : (
          <h2 className="m-0 mt-0.5 flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2 text-lg font-semibold text-cribl-ink">
            <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
              <span className="min-w-0 break-words">{label}</span>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex shrink-0 self-center rounded p-0.5 text-cribl-muted hover:bg-cribl-elevate hover:text-cribl-ink"
                title="Edit name"
                aria-label="Edit source name"
              >
                <PencilIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          </h2>
        )}
        <p className="m-0 mt-1 text-sm text-cribl-muted">
          Each section below groups the questions for this data source.
          {onOpenGuidedTour && (
            <>
              {' '}
              <button
                type="button"
                onClick={onOpenGuidedTour}
                className="font-medium text-cribl-primary underline decoration-cribl-primary/30 decoration-1 underline-offset-2 hover:decoration-cribl-primary"
              >
                Guided entry
              </button>
            </>
          )}
        </p>
      </div>

      <SectionBox id={`ss-${row.id}-wgroup`} title="Assigned worker group" defaultOpen={expandByDefault}>
        <WorkerGroupAssignmentBlock plan={plan} row={row} s={s} />
      </SectionBox>

      <SectionBox id={`ss-${row.id}-primary`} title="Primary Data Points" defaultOpen={expandByDefault}>
        <PrimaryDataPointsBlock row={row} s={s} />
      </SectionBox>

      <SectionBox id={`ss-${row.id}-volume`} title="Volume &amp; priority" defaultOpen={expandByDefault}>
        <VolumePriorityBlock row={row} s={s} />
      </SectionBox>

      <SectionBox id={`ss-${row.id}-roadmap`} title="Phase &amp; roadmap" defaultOpen={expandByDefault}>
        <PhaseRoadmapBlock row={row} s={s} />
      </SectionBox>

      <SectionBox id={`ss-${row.id}-value`} title="Initiative, use cases, value levers" defaultOpen={expandByDefault}>
        <InitiativeValueLeversBlock row={row} s={s} />
      </SectionBox>

      <SectionBox id={`ss-${row.id}-notes`} title="Additional notes" defaultOpen={expandByDefault}>
        <AdditionalNotesBlock row={row} s={s} />
      </SectionBox>
    </div>
  )
}
