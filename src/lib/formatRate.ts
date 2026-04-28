export function parseGb(s: string | undefined): number {
  if (!s || !s.trim()) return Number.NaN
  return parseFloat(s.replace(/,/g, ''))
}

export function formatGbOrTbPerDay(gbPerDay: number): { value: string; unit: 'GB/d' | 'TB/d' } {
  if (!Number.isFinite(gbPerDay) || gbPerDay < 0) {
    return { value: '—', unit: 'GB/d' }
  }
  if (gbPerDay >= 1024) {
    const tb = gbPerDay / 1024
    return { value: tb.toLocaleString(undefined, { maximumFractionDigits: 2 }), unit: 'TB/d' }
  }
  return { value: gbPerDay.toLocaleString(undefined, { maximumFractionDigits: 1 }), unit: 'GB/d' }
}

export function formatGbOrTbPerDayStr(gbPerDay: number): string {
  const f = formatGbOrTbPerDay(gbPerDay)
  return `${f.value} ${f.unit}`
}

