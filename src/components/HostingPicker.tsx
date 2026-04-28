import { WORKER_HOSTING_OPTIONS, classifyHosting } from '../lib/workerHosting'

type Props = {
  id?: string
  value: string
  onChange: (v: string) => void
  /** Optional placeholder for the inline "Other…" free-text input. */
  otherPlaceholder?: string
}

/**
 * Hosting picker: canonical select + "Other…" escape hatch.
 *
 * Stored value remains a free-text string in `WorkerGroupRow.workerHosting`
 * for workbook compatibility. When the value matches one of
 * `WORKER_HOSTING_OPTIONS` (case-insensitive) the dropdown pre-selects it;
 * otherwise it shows "Other…" and an inline text input lets the user keep
 * or refine the original wording.
 *
 * Used in two places that share the same backing field, so binding to a
 * single source of truth (`r.workerHosting`) keeps them auto-synced via
 * React state — there is no risk of divergence between the WG header
 * card and the Capacity-section editor.
 */
export function HostingPicker({ id, value, onChange, otherPlaceholder }: Props) {
  const classification = classifyHosting(value)
  const isOther = classification.kind === 'other'
  const selectValue =
    classification.kind === 'canonical' ? classification.value : isOther ? '__other__' : ''

  return (
    <div className="space-y-2">
      <select
        id={id}
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value
          if (v === '') {
            onChange('')
          } else if (v === '__other__') {
            onChange(isOther ? value : 'Other')
          } else {
            onChange(v)
          }
        }}
        className="h-9 w-full rounded-lg border border-cribl-border bg-white px-2 text-sm"
      >
        <option value="">— Not set —</option>
        {WORKER_HOSTING_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value="__other__">Other…</option>
      </select>
      {isOther ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={otherPlaceholder ?? 'Describe the hosting model'}
        />
      ) : null}
    </div>
  )
}
