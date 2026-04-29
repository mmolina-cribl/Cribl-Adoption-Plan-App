/**
 * Option lists from the "input_data" reference sheet in the Cribl adoption plan template.
 * Used for client-side select/datalist filters and for the **static** `input_data` tab on export.
 * That tab is not derived from `PlanState`: it is the same validation / picklist source every time, like the gold .xlsx.
 *
 * v1.2 tile refresh:
 *  - `techTiles` and `destTiles` were modernized against the canonical Cribl Stream + Cribl Edge
 *    docs (https://docs.cribl.io/stream/sources/, https://docs.cribl.io/stream/destinations/,
 *    https://docs.cribl.io/edge/sources/, https://docs.cribl.io/edge/destinations/) — outdated
 *    spellings normalized to the doc names, missing connectors added, and the lists are now
 *    sorted alphabetically. Underlying fields are still free-text strings, so any older
 *    workbook (with e.g. `O365`, `Cribl Lake`, `OTEL`, `CS NGSIEM`, `Devnull`) still loads
 *    and round-trips byte-for-byte; the picker just defaults to the new canonical names.
 *  - `getInputDataRows()` now sizes the exported `input_data` tab to whichever option list
 *    is longest, so adding more tiles in the future does not silently truncate the validation
 *    range in the workbook.
 */
export const securityDataTypes = [
  'Security',
  'Observability',
  'Both',
  'Non-Security',
] as const

export const streamOrEdge = ['Stream', 'Edge'] as const

export const sourceTypes = ['On-Prem', 'Cloud/Internet'] as const

/**
 * Suggestions for retention; users can still type any value (e.g. "400 days", "18 mo").
 */
export const retentionSuggestions = [
  '7 days',
  '30 days',
  '60 days',
  '90 days',
  '120 days',
  '180 days',
  '270 days',
  '365 days',
  '1 year',
  '18 months',
  '2 years',
  '3 years',
  '4 years',
  '5 years',
  '6 years',
  '7 years',
  'indefinite',
] as const

export const inputData = {
  techTiles: [
    'AmazonCloudWatch',
    'AmazonFirehose',
    'AmazonKinesis',
    'AmazonMSK',
    'AmazonS3',
    'AmazonSecurityLake',
    'AmazonSQS',
    'AzureBlob',
    'AzureEventHub',
    'AzureMonitor',
    'ConfluentCloud',
    'CriblHTTP',
    'CriblInternal',
    'CriblLake',
    'CriblTCP',
    'CrowdStrikeFalcon',
    'CrowdStrikeFDR',
    'Database',
    'Datadog',
    'ElasticBeats',
    'ElasticsearchAPI',
    'FileSystem',
    'FluentForward',
    'GoogleCloudStorage',
    'GooglePubSub',
    'Grafana',
    'HTTP',
    'JournalFiles',
    'Kafka',
    'KubernetesEvents',
    'KubernetesLogs',
    'KubernetesMetrics',
    'LinuxMetrics',
    'Loki',
    'Netflow',
    'NewRelic',
    'O365Activity',
    'O365MGMT',
    'O365Services',
    'OpenTelemetry',
    'Prometheus',
    'PrometheusRemoteWrite',
    'RawHTTP',
    'RawTCP',
    'REST API',
    'Script',
    'ServiceNow',
    'SNMPTrap',
    'SplunkHEC',
    'SplunkSearch',
    'SplunkTCP',
    'Syslog',
    'TCPJSON',
    'WindowsEvents',
    'WindowsMetrics',
    'WinEvtFwd',
    'ZscalerCloudNSS',
    'ZscalerLSS',
  ],
  destTiles: [
    'AmazonCloudWatch',
    'AmazonKinesis',
    'AmazonMSK',
    'AmazonS3',
    'AmazonSecurityLake',
    'AmazonSQS',
    'AzureBlob',
    'AzureDataExplorer',
    'AzureEventHub',
    'AzureMonitor',
    'ClickHouse',
    'CloudflareR2',
    'ConfluentCloud',
    'CriblHTTP',
    'CriblLake',
    'CriblSearch',
    'CriblTCP',
    'CrowdStrikeLogScale',
    'CrowdStrikeNGSIEM',
    'Databricks',
    'Datadog',
    'DataLakeS3',
    'DevNull',
    'DynatraceHTTP',
    'DynatraceOTLP',
    'ElasticCloud',
    'Elasticsearch',
    'Exabeam',
    'FilesystemNFS',
    'GoogleChronicleAPI',
    'GoogleCloudLogging',
    'GoogleCloudStorage',
    'GooglePubSub',
    'GoogleSecOps',
    'GrafanaCloud',
    'Graphite',
    'Honeycomb',
    'InfluxDB',
    'Kafka',
    'Loki',
    'MicrosoftFabric',
    'MicrosoftSentinel',
    'MinIO',
    'NetFlow',
    'NewRelicEvents',
    'NewRelicLogs',
    'OpenTelemetry',
    'Prometheus',
    'SentinelOneAISIEM',
    'SentinelOneDataSet',
    'ServiceNowO11y',
    'SignalFx',
    'SNMPTrap',
    'SplunkHEC',
    'SplunkLB',
    'SplunkSingle',
    'StatsD',
    'StatsDExtended',
    'SumoLogic',
    'Syslog',
    'TCPJSON',
    'Wavefront',
    'Webhook',
    'WizDefend',
    'XSIAM',
  ],
  pipeline: [
    'Aggregation',
    'Cleanup',
    'Dedup',
    'Masking',
    'Parsing',
    'Passthru',
    'Publish metrics',
    'Sampling',
    'Schematize',
  ],
  criticality: ['HIGH', 'MEDIUM', 'LOW'],
  initiatives: [
    'Data Optimization',
    'SIEM Migration & Optimization',
    'Threat Analysis / Hunting',
    'Real Time Monitoring & Alerting',
    'Application Sprawl',
    'Cloud Migration',
    'Distributed Cluster O11y',
    'Linux + Windows Monitoring (Agent Consolidation)',
    'OpenTelemetry Adoption',
    'Kubernetes',
    'Performance & Expense Control',
    'Infrastructure Modernization & Centralization',
    'Compliance Efficiency',
    'Data Lake Strategy + Implementation',
  ],
  technicalUsecase: [
    'Cloud Migration',
    'Edge Collection',
    'Enrichment',
    'Redaction',
    'Reduction',
    'Replay',
    'Routing',
    'Search',
    'Transformation',
    'Universal Receiver',
    'Other (Manual Entry)',
  ],
  financial: [
    'Reduce data/license cost by optimizing data',
    'Reduce data/license cost by routing data around expensive systems of analysis',
    'Reduce storage cost by routing to more affordable storage',
    'Reduce storage cost by optimizing data',
    'Reduce/eliminate pipeline infrastructure costs (e.g., syslog, HF, indexers, cloud compute/data pipelines)',
    'Consolidate tools (e.g., agents, data analysis, and search tools)',
    'Reduce network egress costs',
    'Avoid a renewal extension of a deprecated tool by accelerating migration to a new tool',
  ],
  operational: [
    'Simplify getting data in/out (incl. multiple dest.)',
    'Simplify the reshaping of data',
    'Simplify the enriching of data',
    'Simplify the redacting of data',
    'Simplify replaying the data',
    'Simplify searching/analyzing data',
    'Simplify maintaining a data lake',
    'Simplify management of pipeline infrastructure (e.g., syslog/HFs/indexers, etc.)',
    'Simplify management of agents',
    'Simplify maintaining compliance requirements (e.g., retention and/or data privacy)',
    'Improve MTTI & MTTR',
    'Avoid/eliminate building/maintaining DIY tooling for streaming and shipping (e.g., Logstash, Kafka, NiFi, etc.)',
  ],
  risk: [
    'Improve ability to meet SLAs/LOS',
    'Improve visibility',
    'Improve MTTI/MTTR',
    'Decrease the probability of an IT outage',
    'Improve ability to meet compliance regulations (increase in retention requirements, access data for audits, etc.)',
    'Improve ability to meet compliance regulations (complying with GDPR, PII, PHI)',
    'Enhance performance of system of analysis',
  ],
  strategic: [
    'Enable data broker strategy (collect once-route many)',
    'Future proof enterprise - decouple data from SIEM',
    'Easily experiment new tools - derisk selection of new tools',
    'Increase leverage over vendors',
    'Accelerate migration to Cloud',
    'Generate reveneue - get data previously unavailable to other internal customers',
  ],
} as const

/**
 * Full `input_data` grid for the exported workbook: same column layout as the template.
 * Entirely static (no user/plan fields). Intended as the source range for data validation in Excel.
 */
export function getInputDataRows(): (string | number | null)[][] {
  const h = inputData
  const se = streamOrEdge
  const headers = [
    'Tech_tiles',
    'Dest_tiles',
    'Pipeline',
    'Criticality',
    'StreamEdge',
    'Initiatives',
    'Technical use cases',
    'Financial value',
    'Operational value',
    'Risk reduction value',
    'Strategic value',
  ] as const
  /**
   * Auto-size to the longest option list so growing tile catalogs (Stream + Edge)
   * never get silently truncated in the workbook's `input_data` validation range.
   * Original Cribl template (v0.8.6) was a fixed 34 data rows; v1.2 onward this
   * grows automatically as new tiles are added in the lists above.
   */
  const n = Math.max(
    h.techTiles.length,
    h.destTiles.length,
    h.pipeline.length,
    h.criticality.length,
    se.length,
    h.initiatives.length,
    h.technicalUsecase.length,
    h.financial.length,
    h.operational.length,
    h.risk.length,
    h.strategic.length,
  )
  const out: (string | number | null)[][] = [Array.from(headers)]
  for (let i = 0; i < n; i += 1) {
    out.push([
      h.techTiles[i] ?? null,
      h.destTiles[i] ?? null,
      h.pipeline[i] ?? null,
      h.criticality[i] ?? null,
      se[i] ?? null,
      h.initiatives[i] ?? null,
      h.technicalUsecase[i] ?? null,
      h.financial[i] ?? null,
      h.operational[i] ?? null,
      h.risk[i] ?? null,
      h.strategic[i] ?? null,
    ])
  }
  return out
}

/**
 * INSTRUCTIONS sheet (column B) — static copy of v0.8.6 Cribl template. Not app-generated narrative.
 * When exporting, we do not add app state into this sheet.
 */
export const TEMPLATE_INSTRUCTIONS = [
  '1. Clone this sheet and rename it to "<customer name> adoption plan"',
  '2. Move the cloned sheet in Google Drive to Shared Drives > [Internal] CX > CX Customer Folders [Shared w/Sales] > CX - Customer Folder - <customername>',
  '3. In Gainsight, navigate to the customer page > Customer Info > CX Details > scroll to the bottom of CX Details and paste the sheet URL into the Adoption Plan URL field',
  '4. Delete this tab (the one titled INSTRUCTIONS).',
] as const
