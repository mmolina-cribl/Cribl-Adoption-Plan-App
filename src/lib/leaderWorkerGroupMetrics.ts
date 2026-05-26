/**
 * Maps Leader `/master/groups` fields into adoption-plan **worker group** strings.
 *
 * `estimatedIngestRate` is a Cribl **tier code** (not GB/day). See Cribl’s worker-group
 * configuration docs for the code → max MB/s table.
 */

export type LeaderCloudInfo = {
  provider?: string
  region?: string
}

/** Known `estimatedIngestRate` tier codes → provisioned max ingest (MB/s). */
const ESTIMATED_INGEST_RATE_MBPS: Readonly<Record<number, number>> = {
  1024: 12,
  2048: 24,
  3072: 36,
  4096: 48,
  5120: 60,
  7168: 84,
  10240: 120,
  13312: 156,
  15360: 180,
}

export function leaderEstimatedIngestMbs(rate: number | undefined): number | null {
  if (rate == null || !Number.isFinite(rate)) {
    return null
  }
  const n = Math.trunc(rate)
  return ESTIMATED_INGEST_RATE_MBPS[n] ?? null
}

/**
 * One-line hint for `WorkerGroupRow.workerDetail` from Leader metadata (not GB/day).
 */
export function leaderWorkerGroupDetailFromMetrics(opts: {
  estimatedIngestRate?: number
}): string {
  const parts: string[] = []
  const mbps = leaderEstimatedIngestMbs(opts.estimatedIngestRate)
  if (mbps != null) {
    parts.push(`Leader provisioned ingest (max ~${mbps} MB/s, tier ${opts.estimatedIngestRate})`)
  } else if (opts.estimatedIngestRate != null && Number.isFinite(opts.estimatedIngestRate)) {
    parts.push(`Leader estimatedIngestRate: ${opts.estimatedIngestRate}`)
  }
  return parts.join(' · ')
}

/** Short hosting / placement line from Leader `cloud` + `onPrem`. */
export function leaderWorkerHostingFromCloud(onPrem: boolean | undefined, cloud?: LeaderCloudInfo): string {
  const bits: string[] = []
  if (onPrem === true) {
    bits.push('On-prem')
  } else if (onPrem === false) {
    bits.push('Cloud')
  }
  const p = typeof cloud?.provider === 'string' ? cloud.provider.trim() : ''
  const r = typeof cloud?.region === 'string' ? cloud.region.trim() : ''
  if (p || r) {
    bits.push([p, r].filter(Boolean).join(' '))
  }
  return bits.join(' · ')
}
