import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

type LabeledFieldProps = {
  label: string
  id?: string
  hint?: string
  className?: string
  children: ReactNode
}

export function LabeledField({ label, id, hint, className, children }: LabeledFieldProps) {
  return (
    <div className={`min-w-0 flex flex-col gap-1 ${className ?? ''}`}>
      <label
        className="m-0 text-xs font-medium tracking-wide text-cribl-muted uppercase"
        htmlFor={id}
      >
        {label}
      </label>
      {children}
      {hint && <p className="m-0 text-xs text-cribl-muted/90 leading-snug">{hint}</p>}
    </div>
  )
}

type SelectProps = {
  id?: string
  value: string
  onChange: (v: string) => void
  options: readonly string[] | string[]
  placeholder?: string
  allowEmpty?: boolean
}

export function SelectWithEmpty({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  allowEmpty = true,
}: SelectProps) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowEmpty && (
        <option value="" disabled hidden>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

type SelectOrCustomProps = {
  id: string
  value: string
  onChange: (v: string) => void
  options: readonly string[] | string[]
  placeholder?: string
  customLabel?: string
  customPlaceholder?: string
}

/**
 * Dropdown with an explicit Custom option (reveals a text field).
 * Useful when the list is long but you still want a true select UI.
 */
export function SelectOrCustom({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  customLabel = 'Custom…',
  customPlaceholder = 'Type a custom value',
}: SelectOrCustomProps) {
  const normalized = String(value || '')
  const isOption = options.some((o) => String(o) === normalized)
  const mode = normalized === '' ? '' : isOption ? normalized : '__custom__'

  return (
    <div className="space-y-2">
      <select
        id={id}
        value={mode}
        onChange={(e) => {
          const v = e.target.value
          if (v === '__custom__') {
            onChange(normalized && !isOption ? normalized : '')
            return
          }
          onChange(v)
        }}
      >
        <option value="" disabled hidden>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
        <option value="__custom__">{customLabel}</option>
      </select>
      {mode === '__custom__' && (
        <input
          type="text"
          value={normalized}
          onChange={(e) => onChange(e.target.value)}
          placeholder={customPlaceholder}
          autoComplete="off"
        />
      )}
    </div>
  )
}

export function NumberWithSuffix({
  id,
  value,
  onChange,
  suffix,
  min,
  max,
  step,
  placeholder,
  disabled,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  suffix: string
  min?: number
  max?: number
  step?: number
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <div className="relative w-full min-w-0">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full pr-12"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-cribl-muted">
        {suffix}
      </span>
    </div>
  )
}

function parseRetention(v: string): { n: string; unit: 'days' | 'months' | 'years' } | null {
  const m = String(v ?? '')
    .trim()
    .match(/^(\d+)\s*(day|days|month|months|year|years)\s*$/i)
  if (!m) {
    return null
  }
  const rawN = m[1] ?? ''
  const rawU = (m[2] ?? '').toLowerCase()
  const unit: 'days' | 'months' | 'years' =
    rawU.startsWith('day') ? 'days' : rawU.startsWith('month') ? 'months' : 'years'
  return { n: rawN, unit }
}

export function RetentionDials({
  idBase,
  value,
  onChange,
}: {
  idBase: string
  value: string
  onChange: (v: string) => void
}) {
  const parsed = parseRetention(value)
  const n = parsed?.n ?? ''
  const unit = parsed?.unit ?? 'days'
  const hasUnparsed = value.trim() !== '' && !parsed

  const setN = (next: string) => {
    const clean = next.trim()
    if (!clean) {
      onChange('')
      return
    }
    onChange(`${clean} ${unit}`)
  }

  const setUnit = (next: 'days' | 'months' | 'years') => {
    const baseN = n.trim()
    if (!baseN) {
      onChange('')
      return
    }
    onChange(`${baseN} ${next}`)
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <input
            id={idBase + '-n'}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={n}
            onChange={(e) => setN(e.target.value)}
            placeholder="e.g. 90"
          />
        </div>
        <div className="min-w-0">
          <select
            id={idBase + '-u'}
            value={unit}
            onChange={(e) => setUnit(e.target.value as 'days' | 'months' | 'years')}
          >
            <option value="days">days</option>
            <option value="months">months</option>
            <option value="years">years</option>
          </select>
        </div>
      </div>
      {hasUnparsed ? (
        <p className="m-0 text-xs text-cribl-muted">
          Current value: <span className="font-mono text-cribl-ink/80">{value}</span>. Adjust the dials to replace it.
        </p>
      ) : null}
    </div>
  )
}

const MAX_SUGGESTIONS = 200
/** When there are more options than this, the list does not open with everything at once—type to search. */
const TYPEAHEAD_MIN_TO_SEARCH = 24

type ListPos = { top: number; left: number; width: number }

type ComboboxProps = {
  id: string
  value: string
  onChange: (v: string) => void
  options: readonly string[] | string[]
  placeholder?: string
  /** @deprecated not used; kept for call-site compatibility */
  listName?: string
}

type MultiComboboxProps = {
  id: string
  value: string
  onChange: (v: string) => void
  options: readonly string[] | string[]
  placeholder?: string
  /** If true, user can type values not in `options`. */
  allowCustom?: boolean
  /** Separator used when serializing back to a string field. */
  joinWith?: string
  /** When false, do not show the suggestion list (chips + typing only). */
  showSuggestions?: boolean
  /**
   * When true, the dropdown shows options immediately on open even for long lists
   * (instead of requiring a search string).
   */
  alwaysShowOptions?: boolean
}

function parseMultiValue(v: string): string[] {
  const parts = (v || '')
    .split(/[,;\n]+/g)
    .map((x) => x.trim())
    .filter(Boolean)
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    const k = p.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
  }
  return out
}

function serializeMultiValue(parts: string[], joinWith: string): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(joinWith)
}

/**
 * Combobox: type with suggestions. Long lists (integrations, destinations, etc.) use “type to search”
 * instead of a huge scroll. The suggestion panel is portaled to `document.body` and positioned with
 * `position: fixed` so it is not clipped inside modals or scroll regions.
 */
export function ComboboxText({
  id,
  value,
  onChange,
  options,
  placeholder = '',
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [listPos, setListPos] = useState<ListPos | null>(null)

  const o = useMemo(() => options.map((s) => String(s)), [options])
  const isLarge = o.length > TYPEAHEAD_MIN_TO_SEARCH

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (isLarge) {
      if (!q) {
        return []
      }
      return o
        .filter((item) => item.toLowerCase().includes(q))
        .slice(0, MAX_SUGGESTIONS)
    }
    if (!q) {
      return o.slice(0, MAX_SUGGESTIONS)
    }
    return o
      .filter((item) => item.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS)
  }, [isLarge, o, value])

  const showTypeToSearch = open && isLarge && !value.trim() && filtered.length === 0
  const showNoMatches = open && isLarge && value.trim().length > 0 && filtered.length === 0
  const showListPanel = open && (filtered.length > 0 || showTypeToSearch || showNoMatches)

  const updatePosition = useCallback(() => {
    const el = inputRef.current
    if (!el) {
      return
    }
    const r = el.getBoundingClientRect()
    setListPos({
      top: r.bottom + 6,
      left: r.left,
      width: r.width,
    })
  }, [])

  useLayoutEffect(() => {
    if (!showListPanel) {
      setListPos(null)
      return
    }
    updatePosition()
    const onReposition = () => updatePosition()
    window.addEventListener('scroll', onReposition, true)
    window.addEventListener('resize', onReposition)
    return () => {
      window.removeEventListener('scroll', onReposition, true)
      window.removeEventListener('resize', onReposition)
    }
  }, [showListPanel, updatePosition, value, filtered.length])

  useEffect(() => {
    if (!open) {
      return
    }
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (containerRef.current?.contains(t) || listRef.current?.contains(t)) {
        return
      }
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = useCallback(
    (v: string) => {
      onChange(v)
      setOpen(false)
    },
    [onChange],
  )

  const listContent =
    showListPanel && listPos ? (
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        className="fixed z-[100] max-h-52 min-w-0 overflow-y-auto rounded-lg border border-cribl-border/90 bg-cribl-popover py-1 text-sm text-cribl-ink shadow-[0_12px_32px_rgba(10,22,40,0.18)]"
        style={{
          top: listPos.top,
          left: listPos.left,
          width: listPos.width,
        }}
      >
        {showTypeToSearch && (
          <li className="m-0 list-none p-0">
            <div className="px-2.5 py-2.5 text-xs leading-snug text-cribl-muted">
              Type a few letters to search. This list is long on purpose (product and integration names)—typing finds a
              match without scrolling through the whole set.
            </div>
          </li>
        )}
        {filtered.map((item) => (
          <li key={item} role="option" className="m-0 list-none p-0">
            <button
              type="button"
              className="w-full cursor-pointer px-2.5 py-1.5 text-left text-sm text-cribl-ink transition hover:bg-cribl-primary-soft"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(item)}
            >
              {item}
            </button>
          </li>
        ))}
        {isLarge && value.trim() && filtered.length === 0 && (
          <li className="m-0 list-none p-0">
            <div className="px-2.5 py-2 text-xs text-cribl-muted">No matches. Try a shorter search.</div>
          </li>
        )}
      </ul>
    ) : null

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <input
        ref={inputRef}
        id={id}
        name={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        placeholder={placeholder}
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-controls={showListPanel ? listId : undefined}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        className="w-full"
      />
      {listContent && typeof document !== 'undefined' ? createPortal(listContent, document.body) : null}
    </div>
  )
}

/** @deprecated use ComboboxText; native datalist has poor layout */
export const DatalistText = ComboboxText

/**
 * Multi-combobox: Google Sheets-like multi-select with chips.
 * Stores to a single string field (comma-separated by default) for export/import compatibility.
 */
export function MultiComboboxChips({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select or type…',
  allowCustom = true,
  joinWith = ', ',
  showSuggestions = true,
  alwaysShowOptions = false,
}: MultiComboboxProps) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [listPos, setListPos] = useState<ListPos | null>(null)
  const [q, setQ] = useState('')

  const selected = useMemo(() => parseMultiValue(value), [value])
  const selectedSet = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected])

  const o = useMemo(() => options.map((s) => String(s)), [options])
  const isLarge = o.length > TYPEAHEAD_MIN_TO_SEARCH && !alwaysShowOptions
  const suggestEnabled = showSuggestions && o.length > 0

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (isLarge && !query) return []
    const base = query ? o.filter((x) => x.toLowerCase().includes(query)) : o
    return base.slice(0, MAX_SUGGESTIONS)
  }, [isLarge, o, q])

  const addToken = useCallback(
    (raw: string) => {
      const t = raw.trim()
      if (!t) return
      const k = t.toLowerCase()
      if (selectedSet.has(k)) return
      onChange(serializeMultiValue([...selected, t], joinWith))
      setQ('')
      queueMicrotask(() => inputRef.current?.focus())
    },
    [joinWith, onChange, selected, selectedSet],
  )

  const removeToken = useCallback(
    (token: string) => {
      const next = selected.filter((x) => x.toLowerCase() !== token.toLowerCase())
      onChange(serializeMultiValue(next, joinWith))
      queueMicrotask(() => inputRef.current?.focus())
    },
    [joinWith, onChange, selected],
  )

  const toggleToken = useCallback(
    (token: string) => {
      const k = token.trim().toLowerCase()
      if (!k) return
      if (selectedSet.has(k)) {
        removeToken(token)
      } else {
        addToken(token)
      }
    },
    [addToken, removeToken, selectedSet],
  )

  const updatePos = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setListPos({ top: r.bottom + 6, left: r.left, width: r.width })
  }, [])

  useLayoutEffect(() => {
    if (!suggestEnabled) return
    if (!open) return
    updatePos()
    const onResize = () => updatePos()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [suggestEnabled, open, updatePos])

  useEffect(() => {
    if (!suggestEnabled) return
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const el = containerRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      const listEl = listRef.current
      if (e.target instanceof Node && listEl && listEl.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [suggestEnabled, open])

  const customCandidate = q.trim()
  const showAddCustom =
    allowCustom &&
    customCandidate !== '' &&
    !selectedSet.has(customCandidate.toLowerCase()) &&
    !o.some((x) => x.trim().toLowerCase() === customCandidate.toLowerCase())

  const list =
    suggestEnabled && open && listPos
      ? createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="z-[60] max-h-64 overflow-auto rounded-xl border border-cribl-border bg-white p-1 shadow-[0_12px_30px_rgba(10,22,40,0.16)]"
            style={{
              position: 'fixed',
              top: listPos.top,
              left: listPos.left,
              width: listPos.width,
            }}
          >
            {showAddCustom && (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-cribl-elevate"
                  onClick={() => addToken(customCandidate)}
                >
                  <span className="min-w-0 truncate">
                    Add <span className="font-medium text-cribl-ink">“{customCandidate}”</span>
                  </span>
                  <span className="text-xs text-cribl-muted">Enter</span>
                </button>
              </li>
            )}
            {filtered.map((opt) => {
              const isSel = selectedSet.has(opt.trim().toLowerCase())
              return (
                <li key={opt}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-cribl-elevate"
                    onClick={() => toggleToken(opt)}
                    aria-selected={isSel}
                  >
                    <span className="min-w-0 truncate">{opt}</span>
                    <span
                      className={['text-sm', isSel ? 'text-cribl-primary' : 'text-transparent'].join(' ')}
                      aria-hidden
                    >
                      ✓
                    </span>
                  </button>
                </li>
              )
            })}
            {!showAddCustom && filtered.length === 0 && (
              <li className="px-2 py-2 text-sm text-cribl-muted">No matches.</li>
            )}
          </ul>,
          document.body,
        )
      : null

  return (
    <>
      <div
        ref={containerRef}
        className="flex min-h-10 w-full flex-wrap items-center gap-2 rounded-lg border border-cribl-border bg-white px-2 py-1.5 text-sm text-cribl-ink shadow-ctrl"
        onClick={() => {
          if (suggestEnabled) {
            setOpen(true)
          }
          inputRef.current?.focus()
        }}
        role="combobox"
        aria-expanded={suggestEnabled && open}
        aria-controls={suggestEnabled && open ? listId : undefined}
      >
        {selected.map((t) => (
          <span
            key={t.toLowerCase()}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-cribl-border bg-cribl-canvas px-2 py-1 text-sm"
          >
            <span className="min-w-0 truncate">{t}</span>
            <button
              type="button"
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-cribl-muted hover:bg-white hover:text-cribl-ink"
              onClick={(e) => {
                e.stopPropagation()
                removeToken(t)
              }}
              aria-label={`Remove ${t}`}
              title={`Remove ${t}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          ref={inputRef}
          className="min-w-[10rem] flex-1 border-0 bg-transparent p-0 outline-none"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            if (suggestEnabled) {
              setOpen(true)
            }
          }}
          onFocus={() => {
            if (suggestEnabled) {
              setOpen(true)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              if (q.trim()) {
                e.preventDefault()
                addToken(q)
              }
              return
            }
            if (e.key === 'Backspace' && q === '' && selected.length > 0) {
              e.preventDefault()
              removeToken(selected[selected.length - 1]!)
            }
            if (e.key === 'Escape') {
              setOpen(false)
              inputRef.current?.blur()
            }
          }}
          placeholder={selected.length === 0 ? placeholder : ''}
          autoComplete="off"
          aria-label="Multi select"
        />
      </div>
      {list}
    </>
  )
}

type CheckProps = {
  id: string
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}

export function CheckboxLabeled({ id, label, checked, onChange }: CheckProps) {
  return (
    <label
      className="flex min-h-9 cursor-pointer select-none items-center gap-2 rounded-lg border border-cribl-border bg-cribl-input px-2.5 text-sm text-cribl-ink shadow-ctrl"
      htmlFor={id}
    >
      <input
        id={id}
        className="size-4 rounded border-cribl-border text-cribl-primary focus:ring-2 focus:ring-cribl-primary/30"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

type SectionBoxProps = {
  title: ReactNode
  kicker?: string
  id?: string
  children: ReactNode
  actions?: ReactNode
  /** @default false — new sessions start with sections collapsed; “open to edit” cue until first expand */
  defaultOpen?: boolean
  /** @default true — set false to disable the collapse control (static card) */
  collapsible?: boolean
  /**
   * @default false — opt out of the default `overflow-hidden` on the outer
   * `<section>`. Use when a child renders absolute-positioned popovers,
   * comboboxes, or menus that need to escape the card bounds.
   */
  allowOverflow?: boolean
}

function ChevronToggle({ open, className }: { open: boolean; className?: string }) {
  return (
    <span
      className={[
        'inline-flex shrink-0 text-cribl-muted transition-transform duration-200',
        'h-6 w-6 sm:h-7 sm:w-7',
        open ? 'rotate-0' : '-rotate-90',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-full w-full">
        <path
          fillRule="evenodd"
          d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  )
}

export function SectionBox({
  title,
  kicker,
  id,
  children,
  actions,
  defaultOpen = false,
  collapsible = true,
  allowOverflow = false,
}: SectionBoxProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [touched, setTouched] = useState(defaultOpen)
  const contentId = useId()
  useEffect(() => {
    if (open) {
      setTouched(true)
    }
  }, [open])
  const showUnopenedCue = !open && !touched

  const simpleHeading = (
    <div>
      {kicker && (
        <p className="m-0 text-[11px] font-semibold tracking-tight text-cribl-primary uppercase">
          {kicker}
        </p>
      )}
      <h2 className="m-0 text-base font-semibold tracking-tight text-cribl-ink">{title}</h2>
    </div>
  )

  const hasChildren = children !== null && children !== undefined && children !== false

  if (!collapsible) {
    return (
      <section id={id} className="card-axiom">
        <div
          className={[
            'flex flex-wrap items-start justify-between gap-3 bg-cribl-card-header px-5 py-3.5 sm:px-5',
            hasChildren ? 'border-b border-cribl-border/70' : '',
          ].join(' ')}
        >
          {simpleHeading}
          {actions}
        </div>
        {hasChildren ? <div className="border-cribl-border/40 border-t-0 bg-cribl-card-body p-5">{children}</div> : null}
      </section>
    )
  }

  const titleBlock = (
    <div>
      {kicker && (
        <p className="m-0 text-[11px] font-semibold tracking-tight text-cribl-primary uppercase">
          {kicker}
        </p>
      )}
      <h2 className="m-0 text-base font-semibold tracking-tight text-cribl-ink">{title}</h2>
    </div>
  )
  const titleEl = (
    <div className="flex min-w-0 items-start gap-2.5">
      {showUnopenedCue && (
        <span
          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cribl-primary shadow-sm shadow-cribl-primary/40"
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">{titleBlock}</div>
    </div>
  )

  const toggle = () => setOpen((o) => !o)

  return (
    <section
      id={id}
      // The `card-axiom` utility bakes in `overflow: hidden`, which clips
      // absolute-positioned children (popovers / comboboxes). When
      // `allowOverflow` is set, override via inline style so it wins
      // regardless of Tailwind layer ordering.
      style={allowOverflow ? { overflow: 'visible' } : undefined}
      className="card-axiom"
    >
      <div
        className={[
          'flex min-w-0 items-stretch border-b border-cribl-border/70 pl-2 pr-1 sm:pl-3 sm:pr-2',
          'bg-cribl-card-header',
        ].join(' ')}
      >
        <button
          type="button"
          onClick={toggle}
          className={[
            'min-w-0 flex-1 border-0 py-3.5 pl-1.5 pr-2 text-left sm:pl-2',
            'bg-transparent hover:bg-cribl-elevate/90',
          ].join(' ')}
          aria-expanded={open}
          aria-controls={contentId}
        >
          {titleEl}
        </button>
        {actions && (
          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 self-center pr-1">
            {actions}
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          tabIndex={-1}
          className="group inline-flex min-w-11 shrink-0 items-center justify-center self-stretch rounded-r-lg border-0 bg-transparent px-1.5 text-cribl-muted hover:bg-cribl-elevate hover:text-cribl-ink sm:min-w-12 sm:px-2"
          title={open ? 'Collapse section' : 'Expand section'}
          aria-label={open ? 'Collapse section' : 'Expand section'}
        >
          <ChevronToggle open={open} className="text-cribl-muted group-hover:text-cribl-ink" />
        </button>
      </div>
      {open && (
        <div id={contentId} className="border-cribl-border/40 border-t-0 bg-cribl-card-body p-5">
          {children}
        </div>
      )}
    </section>
  )
}
