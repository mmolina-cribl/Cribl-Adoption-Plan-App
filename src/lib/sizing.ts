import type { WorkerGroupRow } from '../types/planTypes'
import { parseGb } from './formatRate'

export type CpuProfile = 'x86_ht' | 'arm' | 'custom'

export function gbPerVcpuPerDay(profile: CpuProfile, customGbPerVcpuPerDay: number): number {
  if (profile === 'arm') return 480
  if (profile === 'x86_ht') return 200
  if (Number.isFinite(customGbPerVcpuPerDay) && customGbPerVcpuPerDay > 0) return customGbPerVcpuPerDay
  return 200
}

export function effectiveThroughputGbPerDay(w: WorkerGroupRow): number | null {
  const t = parseGb(w.throughputGbd)
  if (Number.isFinite(t) && t > 0) return t
  const a = parseGb(w.ingestGbd)
  const b = parseGb(w.egressGbd)
  if (Number.isFinite(a) && Number.isFinite(b)) return a + b
  if (Number.isFinite(a)) return a
  if (Number.isFinite(b)) return b
  return null
}

export function requiredVcpus(opts: {
  throughputGbPerDay: number
  gbPerVcpuPerDay: number
  headroomPct: number
}): number {
  const { throughputGbPerDay, gbPerVcpuPerDay, headroomPct } = opts
  const headroom = Number.isFinite(headroomPct) ? Math.max(0, headroomPct) / 100 : 0
  const per = Number.isFinite(gbPerVcpuPerDay) && gbPerVcpuPerDay > 0 ? gbPerVcpuPerDay : 200
  const need = (Number.isFinite(throughputGbPerDay) ? throughputGbPerDay : 0) * (1 + headroom)
  return Math.max(0, Math.ceil(need / per))
}

export function workerProcessesPerNode(vcpusPerNode: number): number {
  const v = Math.floor(vcpusPerNode)
  // Mirrors Stream default processCount = -2, but never below 2.
  return Math.max(2, Math.max(0, v - 2))
}

export function nodesNeeded(opts: { requiredVcpus: number; vcpusPerNode: number; nMinusOne: boolean }): number {
  const { requiredVcpus, vcpusPerNode, nMinusOne } = opts
  const need = Math.max(0, Math.ceil(requiredVcpus))
  const per = Math.max(1, Math.floor(vcpusPerNode))
  if (need === 0) return 0
  const base = Math.ceil(need / per)
  return nMinusOne ? base + 1 : base
}

export function pqDiskGb(opts: {
  egressGbPerDay: number
  days: number
  compressionRatio: number
}): number | null {
  const { egressGbPerDay, days, compressionRatio } = opts
  if (!Number.isFinite(egressGbPerDay) || egressGbPerDay <= 0) return null
  const d = Number.isFinite(days) ? Math.max(0, days) : 0
  if (d <= 0) return 0
  const c = Number.isFinite(compressionRatio) && compressionRatio > 0 ? compressionRatio : 1
  return (egressGbPerDay * d) / c
}

export function formatGbOrTb(nGb: number): string {
  if (!Number.isFinite(nGb) || nGb < 0) return '—'
  if (nGb >= 1024) {
    const tb = nGb / 1024
    return `${tb.toLocaleString(undefined, { maximumFractionDigits: 2 })} TB`
  }
  return `${nGb.toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`
}

