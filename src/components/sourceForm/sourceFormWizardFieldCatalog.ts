/**
 * One guided step per field (or one tight pair for data optimization), with
 * a plain-language lede above each input.
 *
 * v2.0 (gold v0.9.1): added `physicalLocations` and `currentCollection`.
 * The only per-source column gold actually dropped is `Display name` —
 * `Additional notes` (briefly absent in v0.9.0) was reinstated and round-
 * trips through column AE on every per-WG / per-Fleet sheet. The value-
 * lever fields (operational / riskReduction / strategic / onboardingEffort
 * / politics) all remain.
 *
 * v2.0 also dropped the `streamOrEdge` wizard step — that field is now
 * auto-derived from the worker-group / fleet a source is attached to
 * (see `lib/workerGroupIds.deriveStreamOrEdge`). It still round-trips on
 * the v0.9.1 Excel "Stream or Edge?" column, but the customer no longer
 * picks it directly.
 */
export type SourceWizardFieldKind =
  | 'intro'
  | 'wrap'
  | 'securityOrObs'
  | 'physicalLocations'
  | 'type'
  | 'currentCollection'
  | 'sourceTile'
  | 'pipelineUsecase'
  | 'destinations'
  | 'retention'
  | 'avgDailyGb'
  | 'complianceRelated'
  | 'dataCriticality'
  | 'stakeholders'
  | 'isCurrent'
  | 'targetOnboardStart'
  | 'targetOnboardEnd'
  | 'onboardingCompletedOn'
  | 'blockers'
  | 'growth'
  | 'dataOptimizationPair'
  | 'initiativeCase'
  | 'technicalUsecase'
  | 'financial'
  | 'operational'
  | 'riskReduction'
  | 'strategic'
  | 'onboardingEffort'
  | 'politics'
  | 'additionalNotes'

export type SourceWizardFieldStep = {
  id: string
  /** Section label (e.g. primary data, volume) */
  section: string
  /** What this specific step is about */
  headline: string
  /** What to enter and why (shown above the field) */
  lede: string
  kind: SourceWizardFieldKind
}

export const SOURCE_WIZARD_FIELD_STEPS: SourceWizardFieldStep[] = [
  {
    id: 'intro',
    section: 'Welcome',
    headline: 'One question at a time',
    lede:
      'We’ll go through this data source step by step—one field on each screen. You already named the source when you added it, and you can set the technical sourcetype on the main page. Use Next to continue, Back to change an answer, or Exit to full form to see everything in one place. Your answers are saved in this app as you go.',
    kind: 'intro',
  },
  {
    id: 'securityOrObs',
    section: 'Primary data',
    headline: 'Security or observability (or both)',
    lede:
      'Clarify whether this stream is mainly for security (threat, fraud, GRC) or for observability / ITOps (AIOps, APM, infra logs), or both. That drives content packs, routing, and who cares about the data.',
    kind: 'securityOrObs',
  },
  {
    id: 'physicalLocations',
    section: 'Primary data',
    headline: 'Physical location(s)',
    lede:
      'Where this data physically lives — a region, a data center, or a host range. Free text. v0.9.1 of the gold template uses "Physical location(s)" instead of "Region(s)" because Edge fleets can live on hosts, not in cloud regions.',
    kind: 'physicalLocations',
  },
  {
    id: 'type',
    section: 'Primary data',
    headline: 'On-prem or cloud?',
    lede:
      'Rough hosting context for this source: on-premises infrastructure vs cloud or internet-sourced telemetry. This is separate from the Cribl “source tile” (product/integration name). It matches the legacy Excel “Type” column when present; v0.9.1 per-WG sheets focus on physical location and collection path, but the app still stores this for planning and imports.',
    kind: 'type',
  },
  {
    id: 'currentCollection',
    section: 'Primary data',
    headline: 'Current collection (optional)',
    lede:
      'Only answer if this data is **already** being collected today (Splunk UF, a forwarder, syslog, an agent, etc.). Many net-new sources have no prior path—leave this blank. When you do fill it, use Enter to turn each phrase into a chip, or separate with commas (same as Physical locations). Maps to the "Current Collection" column on each v0.9.1 per-WG / per-Fleet sheet.',
    kind: 'currentCollection',
  },
  {
    id: 'sourceTile',
    section: 'Primary data',
    headline: 'Source tile',
    lede:
      'Where this data sits in your overall picture: security, ITOps, cloud, or a specific product slot. Suggestions are product and integration names—type a few letters in the field to search the list, or type your own label if something else fits better.',
    kind: 'sourceTile',
  },
  {
    id: 'pipelineUsecase',
    section: 'Primary data',
    headline: 'Pipeline use case',
    lede:
      'Describe the main job the pipeline is doing for this data—reduction, aggregation, enrichment, pass-through, cleanup, or a mix. Pick the closest value or type a short phrase.',
    kind: 'pipelineUsecase',
  },
  {
    id: 'destinations',
    section: 'Primary data',
    headline: 'Destinations',
    lede:
      'Where should events land long term after Cribl (for example a SIEM index, a data lake, or another system)? This helps with sizing, contracts, and cost conversations.',
    kind: 'destinations',
  },
  {
    id: 'retention',
    section: 'Primary data',
    headline: 'Retention',
    lede:
      'How long must the organization keep this data for policy, legal, or operational reasons? Set a number and choose days, months, or years.',
    kind: 'retention',
  },
  {
    id: 'avgDailyGb',
    section: 'Volume & priority',
    headline: 'Average daily volume (GB)',
    lede:
      'A rough per-day size for this source so you can size workers, Cribl licenses, and downstream cost. A number is enough; you do not need the letters “GB” in the field.',
    kind: 'avgDailyGb',
  },
  {
    id: 'compliance',
    section: 'Volume & priority',
    headline: 'Compliance',
    lede:
      'Check this if regulations or company policy (PCI, HIPAA, etc.) change how the data is handled, stored, or who can see it. Leave it off if it is general-purpose operational data with no special rule set.',
    kind: 'complianceRelated',
  },
  {
    id: 'dataCriticality',
    section: 'Volume & priority',
    headline: 'Data criticality',
    lede:
      'If this feed stopped, how bad is the impact—production outage, bad decisions, or mostly inconvenient? Choose a level that matches how the organization talks about it (for example high, medium, or low).',
    kind: 'dataCriticality',
  },
  {
    id: 'stakeholders',
    section: 'Volume & priority',
    headline: 'Stakeholders',
    lede:
      'Who owns this source, who is waiting on the outcome, and which app or line of business should stay in the loop. Names, teams, or org names are all fine.',
    kind: 'stakeholders',
  },
  {
    id: 'isCurrent',
    section: 'Phase & roadmap',
    headline: 'Is this in scope already?',
    lede:
      'Mark “current” if this data is already in production in the scope of this project. If it is a net-new feed or a future state, leave it off.',
    kind: 'isCurrent',
  },
  {
    id: 'targetOnboardStart',
    section: 'Phase & roadmap',
    headline: 'Target onboarding start',
    lede:
      'The date you are aiming to start onboarding this source, even if it is a rough guess. It helps anchor planning and check-ins.',
    kind: 'targetOnboardStart',
  },
  {
    id: 'targetOnboardEnd',
    section: 'Phase & roadmap',
    headline: 'Target onboarding end',
    lede:
      'When you want to be at steady state in production. If a single end date is not the norm, a rough target still helps.',
    kind: 'targetOnboardEnd',
  },
  {
    id: 'onboardingCompletedOn',
    section: 'Phase & roadmap',
    headline: 'Onboarding completed on',
    lede:
      'The date the team called “done” for this source, if you track it. Optional until the project is finished.',
    kind: 'onboardingCompletedOn',
  },
  {
    id: 'blockers',
    section: 'Phase & roadmap',
    headline: 'Blockers',
    lede:
      'What is slowing things down: other teams, access, skills gaps, product issues, or approvals. Use it for your own follow-up and planning.',
    kind: 'blockers',
  },
  {
    id: 'growth',
    section: 'Phase & roadmap',
    headline: 'Growth',
    lede:
      'If volume or importance is going to change, capture that here (for example “merge with another DC next quarter” or “+30 percent YoY”).',
    kind: 'growth',
  },
  {
    id: 'dataOpt',
    section: 'Phase & roadmap',
    headline: 'Data optimization (percent and GB)',
    lede:
      'If you have a sense of how much you could reduce this stream (filtering, parsing, dropping noise), share an expected percent and, optionally, GB per day. Leave blank if you do not have estimates yet.',
    kind: 'dataOptimizationPair',
  },
  {
    id: 'initiative',
    section: 'Initiative & value',
    headline: 'Initiative case',
    lede:
      'The higher-level business or program (for example “shrink index costs in enterprise security”). Choose from the list or type a short name that matches how you think about the opportunity.',
    kind: 'initiativeCase',
  },
  {
    id: 'techUc',
    section: 'Initiative & value',
    headline: 'Technical use case',
    lede:
      'The specific technical play for this data within that initiative: filter and route, normalize fields, fan out to multiple tools, and so on. It keeps everyone aligned on scope.',
    kind: 'technicalUsecase',
  },
  {
    id: 'financial',
    section: 'Initiative & value',
    headline: 'Value: financial',
    lede:
      'Why does this work matter in money: license avoidance, headcount, cloud egress, and so on? Pick a line that matches your story, or type your own.',
    kind: 'financial',
  },
  {
    id: 'operational',
    section: 'Initiative & value',
    headline: 'Value: operational',
    lede:
      'Improved reliability, MTTR, fewer P1s, or faster onboarding of new apps—anything that makes the team’s day to day run better, even if the ROI is not priced yet.',
    kind: 'operational',
  },
  {
    id: 'risk',
    section: 'Initiative & value',
    headline: 'Value: risk reduction',
    lede:
      'Audit, breach exposure, data loss, compliance gaps, or other risk angles you are taking off the table by fixing this path.',
    kind: 'riskReduction',
  },
  {
    id: 'strategic',
    section: 'Initiative & value',
    headline: 'Value: strategic',
    lede:
      'Longer-term or executive outcomes—standardizing on a platform, enabling a future architecture, or a partnership goal that this source supports.',
    kind: 'strategic',
  },
  {
    id: 'onboardEffort',
    section: 'Initiative & value',
    headline: 'Onboarding effort',
    lede:
      'Rough t-shirt size for the work to get this source live: high, medium, low, or a similar scale. Helps staffing and success planning.',
    kind: 'onboardingEffort',
  },
  {
    id: 'politics',
    section: 'Initiative & value',
    headline: 'Politics / sensitivities',
    lede:
      'Organizational dynamics to be aware of: competing teams, a vocal critic, or past project friction. Keep it short and factual—this helps your team plan conversations.',
    kind: 'politics',
  },
  {
    id: 'additionalNotes',
    section: 'Additional notes',
    headline: 'Anything else worth flagging?',
    lede:
      'Free-text catchall for anything that doesn\u2019t fit the structured fields above\u2014vendor contacts, ticket links, custom compliance carve-outs, ad-hoc reminders for the onboarding team. Round-trips through column AE on the per-WG / per-Fleet Excel sheets.',
    kind: 'additionalNotes',
  },
  {
    id: 'wrap',
    section: 'Done',
    headline: 'That’s every field',
    lede:
      'You can add another source from the menu, or use View full form to see and edit everything on one page. Thanks for working through the guided path.',
    kind: 'wrap',
  },
]
