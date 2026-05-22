import { inputData } from '../data/referenceData'

const CANONICAL_TILE = new Set<string>(inputData.techTiles)

function pick(tile: string): string {
  return CANONICAL_TILE.has(tile) ? tile : ''
}

function norm(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/-/g, '_')
}

/**
 * Best-effort map from Leader input API (`type`, `id`) to adoption workbook **Source tile**
 * (`input_data.techTiles` / `SourceSummaryRow.sourceTile`). Returns `''` when unknown or ambiguous.
 *
 * Leader `type` strings are product-specific (e.g. `cribl_http`, `splunk_hec`); tiles are the
 * canonical catalog names (`CriblHTTP`, `SplunkHEC`). This is heuristic — users can still edit.
 */
export function inferSourceTileFromLeaderInput(type: string | undefined, id: string | undefined): string {
  const typ = norm(type)
  const idn = norm(id)
  if (!typ) {
    return ''
  }

  // Splunk collector type is often just `splunk`; disambiguate with input id.
  if (typ === 'splunk') {
    if (idn.includes('hec')) {
      return pick('SplunkHEC')
    }
    return pick('SplunkTCP')
  }

  const byType: Record<string, string> = {
    appscope: 'AppScope',
    criblmetrics: 'Metrics',
    cribl: 'CriblInternal',
    http: 'HTTP',
    cribl_http: 'CriblHTTP',
    cribl_tcp: 'CriblTCP',
    elastic: 'ElasticsearchAPI',
    elasticbeats: 'ElasticBeats',
    syslog: 'Syslog',
    splunk_hec: 'SplunkHEC',
    tcp: 'RawTCP',
    tcpjson: 'TCPJSON',
    udp: 'RawUDP',
    open_telemetry: 'OpenTelemetry',
    otel: 'OpenTelemetry',
    kube_metrics: 'KubernetesMetrics',
    kube_logs: 'KubernetesLogs',
    kube_events: 'KubernetesEvents',
    system_metrics: 'SystemMetrics',
    system_state: 'SystemState',
    journal_files: 'JournalFiles',
    snmp: 'SNMPTrap',
    file: 'FileSystem',
    file_monitor: 'FileMonitor',
    windows_metrics: 'WindowsMetrics',
    win_event_logs: 'WindowsEvents',
    linux_metrics: 'LinuxMetrics',
    prometheus: 'Prometheus',
    prometheus_remote_write: 'PrometheusRemoteWrite',
    loki: 'Loki',
    kafka: 'Kafka',
    kinesis: 'AmazonKinesis',
    kinesis_firehose: 'AmazonFirehose',
    firehose: 'AmazonFirehose',
    s3: 'AmazonS3',
    sqs: 'AmazonSQS',
    msk: 'AmazonMSK',
    cloudwatch: 'AmazonCloudWatch',
    amazon_security_lake: 'AmazonSecurityLake',
    security_lake: 'AmazonSecurityLake',
    gcs: 'GoogleCloudStorage',
    pubsub: 'GooglePubSub',
    datadog: 'Datadog',
    newrelic: 'NewRelic',
    new_relic: 'NewRelic',
    azure_blob: 'AzureBlob',
    azure_event_hubs: 'AzureEventHubsAMQP',
    azure_monitor: 'AzureMonitor',
    confluent: 'ConfluentCloud',
    cloudflare: 'Cloudflare',
    o365: 'O365Services',
    microsoft_graph: 'MicrosoftGraph',
    rest: 'REST API',
    rest_api: 'REST API',
    exec: 'Exec',
    datagen: 'Datagen',
    healthcheck: 'HealthCheck',
    model_driven_telemetry: 'ModelDrivenTelemetry',
    mdt: 'ModelDrivenTelemetry',
    netflow: 'Netflow',
    servicenow: 'ServiceNow',
    servicenow_table: 'ServiceNowTableAPI',
    servicenowtableapi: 'ServiceNowTableAPI',
    database: 'Database',
    script: 'Script',
    fluentforward: 'FluentForward',
    prometheus_edge_scraper: 'PrometheusEdgeScraper',
    rawhttp: 'RawHTTP',
    rawtcp: 'RawTCP',
    rawudp: 'RawUDP',
    anthropic: 'AnthropicCompliance',
    openai: 'OpenAI',
    openai_compliance_logs: 'OpenAIComplianceLogs',
    okta: 'Okta',
    wiz: 'Wiz',
    crowdstrike_falcon: 'CrowdStrikeFalcon',
    crowdstrike_fdr: 'CrowdStrikeFDR',
    grafana: 'Grafana',
    metrics: 'Metrics',
    snmp_trap: 'SNMPTrap',
    journal: 'JournalFiles',
  }

  const mapped = byType[typ]
  if (mapped) {
    return pick(mapped)
  }

  return ''
}
