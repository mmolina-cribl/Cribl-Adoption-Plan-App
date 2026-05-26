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
import {
  isCriblLocalShell,
  kvClearOpenAiKey,
  kvSetOpenAiKey,
  openAiKeyUsesBrowserStorageOnly,
  probeOpenAiKeyPresent,
} from '../lib/kvStore'

/** Shown in the API key field when a secret exists but the user is not editing (never sent to KV). */
const STORED_OPENAI_KEY_FIELD_MASK = '\u2022'.repeat(32)

/** Maintainer contact for in-app feedback (Settings card + mailto subject). */
const SETTINGS_CONTACT_EMAIL = 'mmolina@cribl.io'
const SETTINGS_CONTACT_MAILTO = `mailto:${SETTINGS_CONTACT_EMAIL}?subject=${encodeURIComponent('Adoption Plan app — feedback or issue')}`

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

  const [openAiKeyDraft, setOpenAiKeyDraft] = useState('')
  /** True while the API key input is focused so we never show the synthetic mask during editing. */
  const [openAiKeyFieldFocused, setOpenAiKeyFieldFocused] = useState(false)
  const [openAiKeyPresent, setOpenAiKeyPresent] = useState<boolean | null>(null)
  const [openAiBusy, setOpenAiBusy] = useState(false)
  const [openAiBanner, setOpenAiBanner] = useState<string | null>(null)
  const [criblLocalShell, setCriblLocalShell] = useState(() =>
    typeof window !== 'undefined' ? isCriblLocalShell() : false,
  )

  useEffect(() => {
    const sync = () => setCriblLocalShell(isCriblLocalShell())
    sync()
    const tid = window.setTimeout(sync, 800)
    return () => window.clearTimeout(tid)
  }, [])

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

  useEffect(() => {
    let cancelled = false
    if (criblLocalShell) {
      setOpenAiKeyPresent(false)
      return () => {
        cancelled = true
      }
    }
    void probeOpenAiKeyPresent().then((present) => {
      if (!cancelled) setOpenAiKeyPresent(present)
    })
    return () => {
      cancelled = true
    }
  }, [criblLocalShell])

  const openAiKeyInputValue =
    openAiKeyDraft.length > 0
      ? openAiKeyDraft
      : openAiKeyPresent === true && !openAiKeyFieldFocused
        ? STORED_OPENAI_KEY_FIELD_MASK
        : ''

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="m-0 text-lg font-semibold tracking-tight text-cribl-ink sm:text-xl">Settings</h2>
        <p className="m-0 mt-1.5 text-sm text-cribl-muted">
          Customize a few behaviors. More settings will land here over time.
        </p>
      </div>

      <section className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
        <h3 className="m-0 text-sm font-semibold text-cribl-ink">OpenAI API key (assistant)</h3>
        {criblLocalShell ? (
          <>
            <p className="m-0 mt-1 text-sm text-cribl-muted">
              The right-rail <strong>AI assistant</strong> uses OpenAI. This Cribl <span className="font-mono text-cribl-ink/90">__local__</span>{' '}
              preview shell can’t save an API key here.
            </p>
            <p className="m-0 mt-2 text-sm text-cribl-ink/90">
              Open the Adoption Plan app from a <strong>deployed</strong> install on your tenant (Apps), then add your key in{' '}
              <strong>Settings</strong> there.
            </p>
          </>
        ) : (
          <>
            <p className="m-0 mt-1 text-sm text-cribl-muted">
              Paste an OpenAI API key so the <strong>AI assistant</strong> can answer questions about your plan. When a key is already
              saved, this field shows a masked placeholder until you click in to replace it. In Cribl it is stored with your app; when
              developing locally with <span className="font-mono">npm run dev</span> it stays in this browser only—use a machine you trust.
            </p>
            <details className="mt-3 rounded-lg border border-cribl-border/70 bg-cribl-canvas/40 px-3 py-2">
              <summary className="cursor-pointer select-none text-sm font-medium text-cribl-ink outline-none focus-visible:ring-2 focus-visible:ring-cribl-primary/35">
                For administrators &amp; developers
              </summary>
              <div className="mt-2 space-y-2 border-t border-cribl-border/50 pt-2 text-xs leading-relaxed text-cribl-muted">
                <p className="m-0">
                  <strong className="text-cribl-ink/90">Deployed Cribl app:</strong> Outbound assistant calls go through the App Platform
                  proxy. The tenant <span className="font-mono text-cribl-ink/85">config/proxies.yml</span> must allow{' '}
                  <span className="font-mono">api.openai.com</span> (and usually <span className="font-mono">api.github.com</span>,{' '}
                  <span className="font-mono">docs.cribl.io</span> for doc search) and inject the Authorization header from pack KV, e.g.{' '}
                  <span className="font-mono">kv.openaiKey</span>. Saving here writes the pack key <span className="font-mono">openaiKey</span>{' '}
                  (not under <span className="font-mono">users/…</span>) so that expression resolves.
                </p>
                <p className="m-0">
                  <strong className="text-cribl-ink/90">Local dev:</strong> Without the Cribl iframe, the browser sends{' '}
                  <span className="font-mono">Authorization</span> to OpenAI directly from this tab. Full proxy and KV notes live in{' '}
                  <span className="font-mono">AGENTS.md</span> in the app repository.
                </p>
                <p className="m-0">
                  <strong className="text-cribl-ink/90">Encryption:</strong> If your workspace stores pack KV encrypted at rest, the
                  platform still resolves <span className="font-mono">kv.openaiKey</span> to the real secret when building the proxy
                  request. This app writes the same raw <span className="font-mono">sk-…</span> value the header expression expects—no
                  extra client-side ciphertext layer—so you do not double-wrap the key or break <span className="font-mono">proxies.yml</span>.
                  <span className="mt-1 block">
                    The Apps <strong>KV admin screen</strong> may still show that value in plaintext to anyone who can open it; that is
                    normal for many admin UIs and is not something this app can hide. Limit who has KV access and rotate the key if it is
                    exposed.
                  </span>
                </p>
              </div>
            </details>
            <p id="openai-key-status" className="m-0 mt-2 text-xs text-cribl-muted">
              Status:{' '}
              {openAiKeyPresent === null ? (
                <span className="text-cribl-ink/70">Checking…</span>
              ) : openAiKeyPresent ? (
                <span className="text-emerald-800">A key is stored.</span>
              ) : (
                <span className="text-cribl-ink/70">No key stored yet.</span>
              )}
            </p>
            {openAiBanner && (
              <p className="m-0 mt-2 text-xs text-cribl-ink/90" role="status">
                {openAiBanner}
              </p>
            )}
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-medium text-cribl-ink" htmlFor="openai-key-input">
                API key
              </label>
              <input
                id="openai-key-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="openai-key-status"
                value={openAiKeyInputValue}
                onChange={(e) => {
                  setOpenAiKeyDraft(e.target.value)
                  setOpenAiBanner(null)
                }}
                onFocus={() => {
                  setOpenAiKeyFieldFocused(true)
                }}
                onBlur={() => {
                  setOpenAiKeyFieldFocused(false)
                }}
                placeholder="sk-…"
                disabled={openAiBusy}
                className="w-full rounded-md border border-cribl-border bg-white px-2 py-1.5 font-mono text-xs text-cribl-ink outline-none focus:border-cribl-primary focus:ring-1 focus:ring-cribl-primary/30"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={openAiBusy || !openAiKeyDraft.trim()}
                  onClick={() => {
                    void (async () => {
                      setOpenAiBusy(true)
                      setOpenAiBanner(null)
                      const result = await kvSetOpenAiKey(openAiKeyDraft)
                      setOpenAiBusy(false)
                      if (result.ok) {
                        setOpenAiKeyDraft('')
                        setOpenAiKeyPresent(true)
                        const inCribl =
                          typeof window !== 'undefined' && typeof window.CRIBL_API_URL === 'string'
                        if ('devTabMemoryOnly' in result && result.devTabMemoryOnly) {
                          setOpenAiBanner(
                            'Saved for this session only. This view cannot keep the key after a refresh—open the app in a normal browser tab or use a deployed install if you need it to stick.',
                          )
                        } else if (!openAiKeyUsesBrowserStorageOnly()) {
                          setOpenAiBanner('Saved. Your Cribl workspace will use it for assistant requests.')
                        } else if (inCribl) {
                          setOpenAiBanner(
                            'Saved in this browser for local testing. For production, save the key on a deployed app so your whole team shares it.',
                          )
                        } else {
                          setOpenAiBanner('Saved in this browser for local development only.')
                        }
                      } else {
                        setOpenAiBanner(result.message)
                      }
                    })()
                  }}
                  className="inline-flex h-8 items-center justify-center rounded-md bg-cribl-navy px-3 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Save key
                </button>
                <button
                  type="button"
                  disabled={openAiBusy || openAiKeyPresent !== true}
                  onClick={() => {
                    void (async () => {
                      setOpenAiBusy(true)
                      setOpenAiBanner(null)
                      await kvClearOpenAiKey()
                      const still = await probeOpenAiKeyPresent()
                      setOpenAiKeyPresent(still)
                      setOpenAiBusy(false)
                      setOpenAiBanner(
                        still ? 'Clear may have failed — a key is still present.' : 'Key removed.',
                      )
                    })()
                  }}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-cribl-border bg-white px-3 text-xs font-semibold text-cribl-ink disabled:opacity-50"
                >
                  Remove key
                </button>
              </div>
            </div>
          </>
        )}
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
        <h3 className="m-0 text-sm font-semibold text-cribl-ink">Feedback &amp; app support</h3>
        <p className="m-0 mt-1 text-sm text-cribl-muted">
          For anything specific to this Adoption Plan app—bugs, ideas, or concerns—reach out directly. Include the build
          version above when reporting a problem so it is easier to reproduce.
        </p>
        <p className="m-0 mt-3 text-sm text-cribl-ink/90">
          <a
            href={SETTINGS_CONTACT_MAILTO}
            className="font-medium text-cribl-navy underline decoration-cribl-border underline-offset-2 transition hover:text-cribl-ink hover:decoration-cribl-navy/50"
          >
            {SETTINGS_CONTACT_EMAIL}
          </a>
        </p>
      </section>

      <section className="card-axiom border-cribl-border/80 bg-white p-4 shadow-ctrl sm:p-5">
        <h3 className="m-0 text-sm font-semibold text-cribl-ink">Credits</h3>
        <p className="m-0 mt-1 text-sm text-cribl-muted">
          Initial ideas (not implementation):{' '}
          <a
            href="mailto:dadamic@cribl.io"
            className="font-medium text-cribl-navy underline decoration-cribl-border underline-offset-2 transition hover:text-cribl-ink hover:decoration-cribl-navy/50"
          >
            dadamic@cribl.io
          </a>
          ,{' '}
          <a
            href="mailto:rallen@cribl.io"
            className="font-medium text-cribl-navy underline decoration-cribl-border underline-offset-2 transition hover:text-cribl-ink hover:decoration-cribl-navy/50"
          >
            rallen@cribl.io
          </a>
          .
        </p>
      </section>
    </div>
  )
}

