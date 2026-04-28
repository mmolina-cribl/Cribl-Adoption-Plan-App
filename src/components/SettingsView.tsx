import { useEffect, useState } from 'react'
import { clearPostAddPreference, getPostAddPreference, setPostAddPreference } from '../lib/postAddPreference'
import {
  getSourceDetailCardsExpanded,
  getWorkerGroupDetailCardsExpanded,
  setSourceDetailCardsExpanded,
  setWorkerGroupDetailCardsExpanded,
} from '../lib/detailCardsPreference'

export function SettingsView() {
  const [value, setValue] = useState<'ask' | 'wizard' | 'manual'>('ask')
  const [sourceExpanded, setSourceExpanded] = useState(true)
  const [wgExpanded, setWgExpanded] = useState(true)

  useEffect(() => {
    const v = getPostAddPreference()
    setValue(v ?? 'ask')
    setSourceExpanded(getSourceDetailCardsExpanded())
    setWgExpanded(getWorkerGroupDetailCardsExpanded())
  }, [])

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="m-0 text-lg font-semibold tracking-tight text-cribl-ink sm:text-xl">Settings</h2>
        <p className="m-0 mt-1.5 text-sm text-cribl-muted">
          Customize a few behaviors. More settings will land here over time.
        </p>
      </div>

      <section className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
        <h3 className="m-0 text-sm font-semibold text-cribl-ink">After adding a source</h3>
        <p className="m-0 mt-1 text-sm text-cribl-muted">
          This controls the “Remember my choice” behavior.
        </p>
        <div className="mt-4 space-y-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-cribl-border bg-cribl-canvas/40 px-3 py-2">
            <input
              type="radio"
              name="postAdd"
              checked={value === 'ask'}
              onChange={() => {
                setValue('ask')
                clearPostAddPreference()
              }}
              className="mt-1"
            />
            <div>
              <p className="m-0 text-sm font-medium text-cribl-ink">Ask every time</p>
              <p className="m-0 text-xs text-cribl-muted">Show the choice dialog after creating a source.</p>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-cribl-border bg-cribl-canvas/40 px-3 py-2">
            <input
              type="radio"
              name="postAdd"
              checked={value === 'wizard'}
              onChange={() => {
                setValue('wizard')
                setPostAddPreference('wizard')
              }}
              className="mt-1"
            />
            <div>
              <p className="m-0 text-sm font-medium text-cribl-ink">Always start guided entry</p>
              <p className="m-0 text-xs text-cribl-muted">Skip the choice dialog and open the wizard.</p>
            </div>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-cribl-border bg-cribl-canvas/40 px-3 py-2">
            <input
              type="radio"
              name="postAdd"
              checked={value === 'manual'}
              onChange={() => {
                setValue('manual')
                setPostAddPreference('manual')
              }}
              className="mt-1"
            />
            <div>
              <p className="m-0 text-sm font-medium text-cribl-ink">Always enter details myself</p>
              <p className="m-0 text-xs text-cribl-muted">Skip the choice dialog and open the full form.</p>
            </div>
          </label>
        </div>
      </section>

      <section className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
        <h3 className="m-0 text-sm font-semibold text-cribl-ink">Detail page card expansion</h3>
        <p className="m-0 mt-1 text-sm text-cribl-muted">
          Controls whether cards on Source and Worker Group detail pages start expanded.
        </p>
        <div className="mt-4 space-y-2">
          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-cribl-border bg-cribl-canvas/40 px-3 py-2">
            <div>
              <p className="m-0 text-sm font-medium text-cribl-ink">Sources</p>
              <p className="m-0 text-xs text-cribl-muted">Default to expanded on Source pages.</p>
            </div>
            <input
              type="checkbox"
              checked={sourceExpanded}
              onChange={(e) => {
                const next = e.target.checked
                setSourceExpanded(next)
                setSourceDetailCardsExpanded(next)
              }}
              className="mt-1"
            />
          </label>

          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-cribl-border bg-cribl-canvas/40 px-3 py-2">
            <div>
              <p className="m-0 text-sm font-medium text-cribl-ink">Worker groups</p>
              <p className="m-0 text-xs text-cribl-muted">Default to expanded on Worker Group pages.</p>
            </div>
            <input
              type="checkbox"
              checked={wgExpanded}
              onChange={(e) => {
                const next = e.target.checked
                setWgExpanded(next)
                setWorkerGroupDetailCardsExpanded(next)
              }}
              className="mt-1"
            />
          </label>
        </div>
      </section>
    </div>
  )
}

