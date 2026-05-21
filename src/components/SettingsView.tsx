import { useEffect, useState } from 'react'
import { clearPostAddPreference, getPostAddPreference, setPostAddPreference } from '../lib/postAddPreference'
import {
  getSourceDetailCardsExpanded,
  getWorkerGroupDetailCardsExpanded,
  setSourceDetailCardsExpanded,
  setWorkerGroupDetailCardsExpanded,
} from '../lib/detailCardsPreference'
import {
  getAnimationsEnabled,
  setAnimationsEnabled,
  useAnimationsEnabled,
} from '../lib/animationsPreference'
import { useActivationCalloutDismissed } from '../lib/activationCalloutPreference'
import { APP_VERSION } from '../appVersion'

export function SettingsView() {
  const [value, setValue] = useState<'ask' | 'wizard' | 'manual'>('ask')
  const [sourceExpanded, setSourceExpanded] = useState(true)
  const [wgExpanded, setWgExpanded] = useState(true)
  // Animation pref reads through the hook so this checkbox stays in
  // sync if it's ever toggled from elsewhere (e.g. a future shortcut).
  const animationsEnabled = useAnimationsEnabled()
  // Same hook the Plan dashboard's `ActivationCallout` uses, so flipping
  // the checkbox here brings the "Plan in shape? Activate it." nudge
  // back instantly on the dashboard.
  const [activationCalloutDismissed, setActivationCalloutDismissed] = useActivationCalloutDismissed()

  useEffect(() => {
    const v = getPostAddPreference()
    setValue(v ?? 'ask')
    setSourceExpanded(getSourceDetailCardsExpanded())
    setWgExpanded(getWorkerGroupDetailCardsExpanded())
    // Touch the getter once so callers in tests or older builds that
    // expect the cached value to be ready after a paint don't hit the
    // unhydrated default.
    void getAnimationsEnabled()
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
        <h3 className="m-0 text-sm font-semibold text-cribl-ink">About this build</h3>
        <p className="m-0 mt-1 text-sm text-cribl-muted">
          Include this version when reporting bugs so we can match your issue to the right{' '}
          <span className="font-mono text-cribl-ink/90">.tgz</span>, standalone HTML, or dev build.
        </p>
        <p className="m-0 mt-3 text-xs text-cribl-muted">
          Build <span className="font-mono text-cribl-ink/70">v{APP_VERSION}</span>
        </p>
      </section>

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
        <h3 className="m-0 text-sm font-semibold text-cribl-ink">Plan dashboard prompts</h3>
        <p className="m-0 mt-1 text-sm text-cribl-muted">
          Controls the “Plan in shape? Activate it.” nudge on the Plan dashboard. Dismiss it from there with the
          ×, or toggle it back on here. Only shown when no Activation tier has been picked yet — once you set
          one, the dashboard switches to a compact tier strip that always stays visible.
        </p>
        <div className="mt-4 space-y-2">
          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-cribl-border bg-cribl-canvas/40 px-3 py-2">
            <div>
              <p className="m-0 text-sm font-medium text-cribl-ink">
                Show “Plan in shape? Activate it.” nudge
              </p>
              <p className="m-0 text-xs text-cribl-muted">
                Surfaces Activation as the next step under the Adoption plan hero.
              </p>
            </div>
            <input
              type="checkbox"
              checked={!activationCalloutDismissed}
              onChange={(e) => {
                setActivationCalloutDismissed(!e.target.checked)
              }}
              className="mt-1"
            />
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

      <section className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
        <h3 className="m-0 text-sm font-semibold text-cribl-ink">Animations</h3>
        <p className="m-0 mt-1 text-sm text-cribl-muted">
          Bars, donut charts, and resource-map connectors play a brief entry
          animation the first time they appear in a view. Turn this off to
          render charts at their final state instantly. The OS-level
          “reduce motion” setting also disables them.
        </p>
        <div className="mt-4 space-y-2">
          <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-cribl-border bg-cribl-canvas/40 px-3 py-2">
            <div>
              <p className="m-0 text-sm font-medium text-cribl-ink">Enable chart and connector animations</p>
              <p className="m-0 text-xs text-cribl-muted">
                Smoothly draws bars, pie graphs, and connector lines on first paint.
              </p>
            </div>
            <input
              type="checkbox"
              checked={animationsEnabled}
              onChange={(e) => {
                setAnimationsEnabled(e.target.checked)
              }}
              className="mt-1"
            />
          </label>
        </div>
      </section>
    </div>
  )
}

