import { useCallback, useState } from 'react'
import { CriblAiIcon } from './brand/CriblLogos'

const COLLAPSE_STORAGE_KEY = 'cribl-adoption-ai-rail-collapsed-v1'

/**
 * Reserved column for a future in-app AI assistant. Placeholder content is inert when expanded; collapsed UI is interactive to expand.
 */

export function AiAgentPlaceholderPanel() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      if (typeof localStorage === 'undefined') return true
      // Default collapsed; only expand when the user has chosen expanded ('0').
      return localStorage.getItem(COLLAPSE_STORAGE_KEY) !== '0'
    } catch {
      return true
    }
  })

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const n = !c
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, n ? '1' : '0')
      } catch {
        /* ignore */
      }
      return n
    })
  }, [])

  return (
    <aside
      className="group/aiail relative hidden min-h-0 shrink-0 flex-col self-stretch border-l border-neutral-300/60 bg-neutral-100/95 shadow-[inset_1px_0_0_rgba(255,255,255,0.4)] select-none lg:flex"
      style={
        collapsed
          ? { width: '5rem', minWidth: '5rem' }
          : { width: '18rem', minWidth: '18rem' }
      }
      aria-label="AI assistant panel"
    >
      {collapsed ? (
        <div className="flex h-full min-h-0 flex-col items-center border-b-0 py-2">
          <button
            type="button"
            title="Expand assistant panel"
            onClick={toggle}
            className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-neutral-600 transition hover:bg-neutral-200/80 hover:text-neutral-800"
            aria-expanded="false"
          >
            <span className="sr-only">Expand assistant panel</span>
            <span className="text-sm font-semibold" aria-hidden>
              «
            </span>
          </button>
          <button
            type="button"
            onClick={toggle}
            title="Expand assistant panel"
            aria-label="Expand assistant panel"
            aria-expanded="false"
            className="mt-3 flex min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-start gap-1 rounded-lg border-0 bg-transparent p-1 text-inherit transition hover:bg-neutral-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60"
          >
            <CriblAiIcon className="pointer-events-none h-8 w-8" />
          </button>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center border-b border-neutral-300/50 bg-neutral-100/80 px-2 py-1.5">
            <button
              type="button"
              title="Collapse assistant panel"
              onClick={toggle}
              className="inline-flex h-7 items-center justify-center rounded-md border-0 bg-transparent px-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-200/80 hover:text-neutral-800"
              aria-expanded="true"
            >
              <span className="sr-only">Collapse assistant panel</span>
              <span aria-hidden>»</span>
            </button>
          </div>
          <div
            inert
            className="flex min-h-0 flex-1 flex-col items-stretch py-3 pl-0 pr-0"
            aria-label="AI assistant, coming later"
          >
            <div className="shrink-0 px-3">
              <p className="m-0 pl-0.5 text-[10px] font-semibold tracking-wider text-neutral-500 uppercase">
                Assistant
              </p>
            </div>
            <div className="mt-2 flex min-h-0 flex-1 flex-col items-stretch">
              <div className="flex flex-1 flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed border-neutral-300/60 bg-neutral-200/30 px-0 py-4 text-center">
                <CriblAiIcon className="h-10 w-10" />
                <p className="m-0 px-3 text-xs font-medium leading-snug text-neutral-600">Work in progress</p>
                <p className="m-0 max-w-[15rem] px-3 text-[11px] leading-relaxed text-neutral-600/95">
                  An AI guide for this app will be available here later.
                </p>
              </div>
              <p className="m-0 mt-2.5 px-3 text-center text-[10px] leading-tight text-neutral-500/90">
                Not available yet
              </p>
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
