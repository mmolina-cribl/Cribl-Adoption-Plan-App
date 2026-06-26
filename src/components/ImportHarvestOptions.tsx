import {
  readImportOmitDisabledInputs,
  readImportOmitStockGroups,
  writeImportOmitDisabledInputs,
  writeImportOmitStockGroups,
} from '../lib/importHarvestOptions'
import { useState } from 'react'

type Props = {
  omitStockGroups: boolean
  setOmitStockGroups: (v: boolean) => void
  omitDisabledInputs: boolean
  setOmitDisabledInputs: (v: boolean) => void
}

/** Shared checkboxes for tenant + diagnostic import harvest options. */
export function ImportHarvestOptions({
  omitStockGroups,
  setOmitStockGroups,
  omitDisabledInputs,
  setOmitDisabledInputs,
}: Props) {
  return (
    <div className="space-y-2 rounded-lg border border-cribl-border/70 bg-cribl-canvas/40 px-3 py-2.5">
      <p className="m-0 text-xs font-medium text-cribl-ink/90">Options</p>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-cribl-muted">
        <input
          type="checkbox"
          checked={!omitDisabledInputs}
          onChange={(e) => {
            const omit = !e.target.checked
            setOmitDisabledInputs(omit)
            writeImportOmitDisabledInputs(omit)
          }}
        />
        <span>Include disabled inputs</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-cribl-muted">
        <input
          type="checkbox"
          checked={omitStockGroups}
          onChange={(e) => {
            const v = e.target.checked
            setOmitStockGroups(v)
            writeImportOmitStockGroups(v)
          }}
        />
        <span>Omit built-in default groups</span>
      </label>
      <p className="m-0 text-[10px] text-cribl-muted/80">Saved in this browser.</p>
    </div>
  )
}

export function useImportHarvestOptionsState() {
  const [omitStockGroups, setOmitStockGroups] = useState(readImportOmitStockGroups)
  const [omitDisabledInputs, setOmitDisabledInputs] = useState(readImportOmitDisabledInputs)
  return { omitStockGroups, setOmitStockGroups, omitDisabledInputs, setOmitDisabledInputs }
}
