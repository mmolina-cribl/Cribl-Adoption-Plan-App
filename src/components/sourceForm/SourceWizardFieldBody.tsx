import { inputData, securityDataTypes, sourceTileSearchAliases } from '../../data/referenceData'
import type { SourceSummaryRow } from '../../types/planTypes'
import type { SourceSummaryFieldPatch } from './SourceFormPanels'
import type { SourceWizardFieldKind } from './sourceFormWizardFieldCatalog'
import {
  CheckboxLabeled,
  ComboboxText,
  LabeledField,
  MultiComboboxChips,
  NumberWithSuffix,
  RetentionDials,
  SelectWithEmpty,
} from '../FormControls'

type FieldBodyProps = {
  kind: SourceWizardFieldKind
  row: SourceSummaryRow
  s: SourceSummaryFieldPatch
}

export function SourceWizardFieldBody({ kind, row, s }: FieldBodyProps) {
  switch (kind) {
    case 'intro':
    case 'wrap':
      return null

    case 'securityOrObs':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-so`} label="Security or Observability or both data?">
            <SelectWithEmpty
              id={`w-${row.id}-so`}
              value={row.securityOrObs}
              onChange={(v) => s('securityOrObs', v)}
              options={[...securityDataTypes]}
              placeholder="Choose…"
            />
          </LabeledField>
        </div>
      )

    case 'physicalLocations':
      return (
        <div className="mt-4">
          <LabeledField
            id={`w-${row.id}-loc`}
            label="Physical location(s)"
            hint="Type a location, press Enter to bubble it, or use commas."
          >
            <MultiComboboxChips
              id={`w-${row.id}-loc`}
              value={row.physicalLocations}
              onChange={(v) => s('physicalLocations', v)}
              options={[]}
              showSuggestions={false}
              placeholder="e.g. us-east-1, DC4 / Stockholm…"
            />
          </LabeledField>
        </div>
      )

    case 'sourceTile':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-tile`} label="Source tile">
            <ComboboxText
              id={`w-${row.id}-tile`}
              value={row.sourceTile}
              onChange={(v) => s('sourceTile', v)}
              options={inputData.techTiles}
              optionAliases={sourceTileSearchAliases}
              placeholder="Type to search source tiles…"
            />
          </LabeledField>
        </div>
      )

    case 'pipelineUsecase':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-pipe`} label="Pipeline usecase">
            <MultiComboboxChips
              id={`w-${row.id}-pipe`}
              value={row.pipelineUsecase}
              onChange={(v) => s('pipelineUsecase', v)}
              options={inputData.pipeline}
              placeholder="e.g. Aggregation, Passthru, Cleanup"
            />
          </LabeledField>
        </div>
      )

    case 'destinations':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-dest`} label="Destinations">
            <MultiComboboxChips
              id={`w-${row.id}-dest`}
              value={row.destinations}
              onChange={(v) => s('destinations', v)}
              options={inputData.destTiles}
              allowCustom={false}
              alwaysShowOptions
              placeholder="Search tiles, then pick from the list…"
            />
          </LabeledField>
        </div>
      )

    case 'retention':
      return (
        <div className="mt-4">
          <LabeledField
            id={`w-${row.id}-ret`}
            label="Retention"
            hint="Set a number and a unit."
          >
            <RetentionDials
              idBase={`w-${row.id}-ret`}
              value={row.retention}
              onChange={(v) => s('retention', v)}
            />
          </LabeledField>
        </div>
      )

    case 'avgDailyGb':
      return (
        <div className="mt-4">
          <LabeledField
            id={`w-${row.id}-gb`}
            label="Average Daily Volume? (GB)"
            hint="Numeric value; GB is implied."
          >
            <NumberWithSuffix
              id={`w-${row.id}-gb`}
              value={row.avgDailyGb}
              onChange={(v) => s('avgDailyGb', v)}
              suffix="GB"
              min={0}
              step={1}
              placeholder="0"
            />
          </LabeledField>
        </div>
      )

    case 'complianceRelated':
      return (
        <div className="mt-4 rounded-lg border border-cribl-border/60 bg-cribl-canvas/50 p-4">
          <p className="m-0 text-xs font-medium tracking-wide text-cribl-muted uppercase">Compliance</p>
          <CheckboxLabeled
            id={`w-${row.id}-cpl`}
            label="Compliance related?"
            checked={row.complianceRelated}
            onChange={(b) => s('complianceRelated', b)}
          />
        </div>
      )

    case 'dataCriticality':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-cri`} label="Data criticality">
            <SelectWithEmpty
              id={`w-${row.id}-cri`}
              value={row.dataCriticality}
              onChange={(v) => s('dataCriticality', v)}
              options={[...inputData.criticality] as string[]}
              allowEmpty
              placeholder="e.g. HIGH, MEDIUM, LOW"
            />
          </LabeledField>
        </div>
      )

    case 'stakeholders':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-st`} label="Stakeholder(s) (team / line of business)">
            <textarea
              id={`w-${row.id}-st`}
              className="field-strong min-h-10 resize-y"
              value={row.stakeholders}
              onChange={(e) => s('stakeholders', e.target.value)}
              rows={2}
            />
          </LabeledField>
        </div>
      )

    case 'currentCollection':
      return (
        <div className="mt-4">
          <LabeledField
            id={`w-${row.id}-cc`}
            label="Current Collection"
            hint="The pre-Cribl ingestion path (e.g. Splunk UF, syslog-ng, Datadog Agent)."
          >
            <input
              id={`w-${row.id}-cc`}
              className="field-strong"
              value={row.currentCollection}
              onChange={(e) => s('currentCollection', e.target.value)}
              placeholder="e.g. Splunk Heavy Forwarder"
            />
          </LabeledField>
        </div>
      )

    case 'isCurrent':
      return (
        <div className="mt-4 rounded-lg border border-cribl-border/60 bg-cribl-canvas/50 p-4">
          <p className="m-0 text-xs font-medium tracking-wide text-cribl-muted uppercase">Status</p>
          <CheckboxLabeled
            id={`w-${row.id}-is`}
            label="Current?"
            checked={row.isCurrent}
            onChange={(b) => s('isCurrent', b)}
          />
        </div>
      )

    case 'targetOnboardStart':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-tos`} label="Target Onboarding Start">
            <input
              id={`w-${row.id}-tos`}
              type="date"
              value={row.targetOnboardStart}
              onChange={(e) => s('targetOnboardStart', e.target.value)}
            />
          </LabeledField>
        </div>
      )

    case 'targetOnboardEnd':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-toe`} label="Target Onboarding End">
            <input
              id={`w-${row.id}-toe`}
              type="date"
              value={row.targetOnboardEnd}
              onChange={(e) => s('targetOnboardEnd', e.target.value)}
            />
          </LabeledField>
        </div>
      )

    case 'onboardingCompletedOn':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-oc`} label="Onboarding Completed On">
            <input
              id={`w-${row.id}-oc`}
              type="date"
              value={row.onboardingCompletedOn}
              onChange={(e) => s('onboardingCompletedOn', e.target.value)}
            />
          </LabeledField>
        </div>
      )

    case 'blockers':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-bl`} label="Blockers">
            <textarea
              id={`w-${row.id}-bl`}
              className="field-strong min-h-10 resize-y"
              value={row.blockers}
              onChange={(e) => s('blockers', e.target.value)}
              rows={2}
            />
          </LabeledField>
        </div>
      )

    case 'growth':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-gr`} label="Growth?">
            <textarea
              id={`w-${row.id}-gr`}
              className="field-strong min-h-10 resize-y"
              value={row.growth}
              onChange={(e) => s('growth', e.target.value)}
              rows={2}
            />
          </LabeledField>
        </div>
      )

    case 'dataOptimizationPair':
      return (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LabeledField id={`w-${row.id}-dop`} label="Data optimization %">
            <NumberWithSuffix
              id={`w-${row.id}-dop`}
              value={row.dataOptPct}
              onChange={(v) => s('dataOptPct', v)}
              suffix="%"
              min={0}
              max={100}
              step={1}
            />
          </LabeledField>
          <LabeledField id={`w-${row.id}-dog`} label="Data optimization (GB)">
            <NumberWithSuffix
              id={`w-${row.id}-dog`}
              value={row.dataOptGb}
              onChange={(v) => s('dataOptGb', v)}
              suffix="GB"
              min={0}
              step={1}
            />
          </LabeledField>
        </div>
      )

    case 'initiativeCase':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-in`} label="Initiative case">
            <MultiComboboxChips
              id={`w-${row.id}-in`}
              value={row.initiativeCase}
              onChange={(v) => s('initiativeCase', v)}
              options={inputData.initiatives}
            />
          </LabeledField>
        </div>
      )

    case 'technicalUsecase':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-ta`} label="Technical Use Case">
            <MultiComboboxChips
              id={`w-${row.id}-ta`}
              value={row.technicalUsecase}
              onChange={(v) => s('technicalUsecase', v)}
              options={inputData.technicalUsecase}
            />
          </LabeledField>
        </div>
      )

    case 'financial':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-f`} label="Financial">
            <MultiComboboxChips
              id={`w-${row.id}-f`}
              value={row.financial}
              onChange={(v) => s('financial', v)}
              options={inputData.financial}
            />
          </LabeledField>
        </div>
      )

    case 'operational':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-o`} label="Operational">
            <MultiComboboxChips
              id={`w-${row.id}-o`}
              value={row.operational}
              onChange={(v) => s('operational', v)}
              options={inputData.operational}
            />
          </LabeledField>
        </div>
      )

    case 'riskReduction':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-r`} label="Risk Reduction">
            <MultiComboboxChips
              id={`w-${row.id}-r`}
              value={row.riskReduction}
              onChange={(v) => s('riskReduction', v)}
              options={inputData.risk}
            />
          </LabeledField>
        </div>
      )

    case 'strategic':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-st2`} label="Strategic">
            <MultiComboboxChips
              id={`w-${row.id}-st2`}
              value={row.strategic}
              onChange={(v) => s('strategic', v)}
              options={inputData.strategic}
            />
          </LabeledField>
        </div>
      )

    case 'onboardingEffort':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-e`} label="Onboarding Effort">
            <SelectWithEmpty
              id={`w-${row.id}-e`}
              value={row.onboardingEffort}
              onChange={(v) => s('onboardingEffort', v)}
              options={inputData.criticality as unknown as string[]}
              allowEmpty
              placeholder="Select…"
            />
          </LabeledField>
        </div>
      )

    case 'politics':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-p`} label="Politics">
            <textarea
              id={`w-${row.id}-p`}
              className="field-strong min-h-10 resize-y"
              value={row.politics}
              onChange={(e) => s('politics', e.target.value)}
              rows={2}
            />
          </LabeledField>
        </div>
      )

    case 'additionalNotes':
      return (
        <div className="mt-4">
          <LabeledField id={`w-${row.id}-an`} label="Additional notes">
            <textarea
              id={`w-${row.id}-an`}
              className="field-strong min-h-20 resize-y"
              value={row.additionalNotes}
              onChange={(e) => s('additionalNotes', e.target.value)}
              rows={3}
              placeholder="Vendor contacts, ticket links, ad-hoc compliance carve-outs, etc."
            />
          </LabeledField>
        </div>
      )

    default:
      return null
  }
}
