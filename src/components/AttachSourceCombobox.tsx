import { useEffect, useMemo, useRef, useState } from 'react'
import type { SourceSummaryRow } from '../types/planTypes'
import { SearchInput } from './SearchInput'

export type AttachSourceCandidate = {
  row: SourceSummaryRow
  currentWgName: string | null
}

type Props = {
  candidates: AttachSourceCandidate[]
  onAttach: (sourceId: string) => void
  /** Override placeholder text — defaults to a multi-field search hint. */
  placeholder?: string
  /** Optional id (also used for the screen-reader label). */
  id?: string
  /** Optional className applied to the wrapper. */
  className?: string
}

/**
 * Type-ahead combobox to attach a Source to a Worker Group. Lists unassigned
 * sources first, then sources currently assigned to a different group.
 */
export function AttachSourceCombobox({
  candidates,
  onAttach,
  placeholder = 'Attach a source… (search by name, sourcetype, or current group)',
  id = 'wg-attach-source',
  className,
}: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const ranked = candidates
      .filter((c) => {
        if (!needle) {
          return true
        }
        const src = (c.row.source || '').toLowerCase()
        const tile = (c.row.sourceTile || '').toLowerCase()
        const wg = (c.currentWgName || '').toLowerCase()
        return src.includes(needle) || tile.includes(needle) || wg.includes(needle)
      })
      // Unassigned sources surface first; assigned-elsewhere sources after.
      .sort((a, b) => {
        const au = a.currentWgName ? 1 : 0
        const bu = b.currentWgName ? 1 : 0
        return au - bu
      })
    return ranked.slice(0, 12)
  }, [candidates, q])

  if (candidates.length === 0) {
    return null
  }

  return (
    <div ref={wrapRef} className={`relative ${className ?? ''}`}>
      <SearchInput
        id={id}
        value={q}
        onChange={(next) => {
          setQ(next)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        ariaLabel="Attach a source to this worker group"
      />
      {open && matches.length > 0 ? (
        <ul className="absolute left-0 right-0 z-20 mt-1 max-h-80 list-none overflow-auto rounded-lg border border-cribl-border bg-white p-1 shadow-card-float">
          {matches.map((c) => {
            const src = c.row.source?.trim()
            const name = src || 'Source'
            const tile = c.row.sourceTile?.trim()
            const subtitleBits = [tile, src].filter(Boolean) as string[]
            const subtitle = subtitleBits
              .filter((b, i) => subtitleBits.findIndex((x) => x.toLowerCase() === b.toLowerCase()) === i)
              .join(' · ')
            return (
              <li key={c.row.id}>
                <button
                  type="button"
                  onClick={() => {
                    onAttach(c.row.id)
                    setQ('')
                    setOpen(false)
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-md border-0 bg-transparent px-3 py-2 text-left hover:bg-cribl-elevate"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-cribl-ink">{name}</span>
                    {subtitle ? (
                      <span className="block truncate text-xs text-cribl-muted">{subtitle}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[11px] font-medium">
                    {c.currentWgName ? (
                      <span className="rounded-md bg-cribl-card-body px-2 py-0.5 text-cribl-muted">
                        in {c.currentWgName}
                      </span>
                    ) : (
                      <span className="rounded-md bg-cribl-primary-soft px-2 py-0.5 text-cribl-primary-ink">
                        Unassigned
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : open && q.trim() ? (
        <p className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-cribl-border bg-white p-3 text-xs text-cribl-muted shadow-card-float">
          No sources match “{q.trim()}”.
        </p>
      ) : null}
    </div>
  )
}
