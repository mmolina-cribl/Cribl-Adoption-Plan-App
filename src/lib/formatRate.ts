export function parseGb(s: string | undefined): number {
  if (!s || !s.trim()) return Number.NaN
  return parseFloat(s.replace(/,/g, ''))
}

/**
 * Display rules (v1.2 rounding pass — see Step 19 in CRIBL_DEV_NOTES.md):
 *  - invalid / negative          → "—" GB/d
 *  - gbPerDay ≥ 1000             → TB/d, rounded to nearest 0.01 TB
 *                                  ("1.34 TB/d", "5.7 TB/d", "1,200 TB/d")
 *  - 1 ≤ gbPerDay < 1000         → GB/d, rounded to the nearest whole GB
 *                                  (so 100.7 → "101 GB/d", 100.3 → "100 GB/d")
 *  - 0 < gbPerDay < 1            → GB/d, rounded to nearest 0.01 GB so sub-GB
 *                                  values don't all collapse to "0"
 *  - exactly 0                   → "0 GB/d"
 *
 * `Math.round` is used (half-away-from-zero) instead of relying on `Intl.NumberFormat`'s
 * default banker's rounding, so the user's stated example (100.7 → 101, 100.3 → 100) holds.
 * `toLocaleString` is then used purely for the thousands separator and to suppress
 * trailing-zero noise (e.g. 1.10 → "1.1", 2.00 → "2").
 *
 * 1 TB is treated as 1000 GB (decimal), matching how cloud vendors and customers talk
 * about throughput in adoption planning conversations. The ingest field is itself stored
 * as free-text GB, so there is no risk of losing fidelity here — only the display rounds.
 */
export function formatGbOrTbPerDay(gbPerDay: number): { value: string; unit: 'GB/d' | 'TB/d' } {
  if (!Number.isFinite(gbPerDay) || gbPerDay < 0) {
    return { value: '—', unit: 'GB/d' }
  }
  if (gbPerDay >= 1000) {
    const tb = Math.round((gbPerDay / 1000) * 100) / 100
    return {
      value: tb.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      unit: 'TB/d',
    }
  }
  if (gbPerDay >= 1) {
    return {
      value: Math.round(gbPerDay).toLocaleString(),
      unit: 'GB/d',
    }
  }
  const sub = Math.round(gbPerDay * 100) / 100
  return {
    value: sub.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    unit: 'GB/d',
  }
}

export function formatGbOrTbPerDayStr(gbPerDay: number): string {
  const f = formatGbOrTbPerDay(gbPerDay)
  return `${f.value} ${f.unit}`
}

