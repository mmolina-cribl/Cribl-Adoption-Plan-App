import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react'
import { useResizableAiRailWidth } from '../hooks/useResizableAiRailWidth'
import { runAdoptionAssistantChat } from '../lib/aiAssistantOpenAi'
import {
  loadPersistedChatMessages,
  planChatStorageId,
  savePersistedChatMessages,
  type PersistedChatMessage,
} from '../lib/aiAssistantChatStorage'
import { getSafeLocalStorage } from '../lib/safeLocalStorage'
import { AssistantMessageReveal } from './AssistantMessageReveal'
import { AssistantMessageRich } from './AssistantMessageRich'
import { buildPlanDigestJson } from '../lib/planDigest'
import { probeOpenAiKeyPresent, isCriblLocalShell, OPENAI_KEY_AVAILABILITY_EVENT } from '../lib/kvStore'
import type { PlanState } from '../types/planTypes'

const COLLAPSE_STORAGE_KEY = 'cribl-adoption-ai-rail-collapsed-v1'

const ASSISTANT_SETUP_TOOLTIP =
  'Add your OpenAI API key in Settings so the AI assistant can run. In Cribl the key is stored with your app; locally it stays in this browser. Tenant admins: allow outbound access to OpenAI (and doc search hosts if you use them)—see AGENTS.md in the app package. AI can make mistakes — verify important answers against your plan and official docs.'

/** Grouped starter prompts — wording nudges the model toward the matching tools where relevant. */
const ASSISTANT_WELCOME_SAMPLES: Array<{
  title: string
  hint: string
  items: Array<{ q: string }>
}> = [
  {
    title: 'Plan & workbook',
    hint: 'Answers from the plan digest in this session (topology, sources, activation hints).',
    items: [
      {
        q: 'What are the differences between Silver, Gold, and Platinum PS tiers in this app, and what does the digest say about our activation tier?',
      },
      {
        q: 'What are the top onboarding risks in this plan, and what should we validate in the first customer workshop?',
      },
      {
        q: 'Give me five short bullets summarizing worker groups, Edge fleets, and source mix for an executive readout.',
      },
    ],
  },
  {
    title: 'Community packs (GitHub)',
    hint: 'Uses search_cribl_packs_github — only cite pack URLs returned by that tool.',
    items: [
      {
        q: 'Search criblpacks on GitHub for packs that could help with Splunk HEC, Windows XML, or Kafka JSON ingestion.',
      },
      {
        q: 'Find community packs related to syslog RFC5424, S3 parquet, or edge file collection.',
      },
    ],
  },
  {
    title: 'Official documentation',
    hint: 'Uses search_cribl_docs_llms — only cite docs.cribl.io URLs that appear in tool results.',
    items: [
      {
        q: 'From the official docs indexes, what should we know about Stream worker groups, fleet sizing, or adding a Syslog Source?',
      },
      {
        q: 'Search product documentation for pack import, QuickConnect, or App Platform proxies; include doc links from the tool output only.',
      },
    ],
  },
]

type Props = { plan: PlanState }

/** In-memory only — stripped before `savePersistedChatMessages`. */
type AiChatMessage = PersistedChatMessage & { streamNonce?: number }

type AiChatState = {
  messages: AiChatMessage[]
  /** Which assistant `streamNonce` (if any) is currently revealing character-by-character. */
  streamNonceActive: number | null
}

function stripStreamMeta(messages: AiChatMessage[]): PersistedChatMessage[] {
  return messages.map(({ role, text }) => ({ role, text }))
}

type AiChatAction =
  | { type: 'hydrate'; messages: PersistedChatMessage[] }
  | { type: 'addUser'; text: string }
  | { type: 'addAssistant'; text: string }
  | { type: 'streamDone' }
  | { type: 'clear' }

const initialAiChat: AiChatState = { messages: [], streamNonceActive: null }

function aiChatReducer(state: AiChatState, action: AiChatAction): AiChatState {
  switch (action.type) {
    case 'hydrate':
      return {
        messages: action.messages.map((m) => ({ role: m.role, text: m.text })),
        streamNonceActive: null,
      }
    case 'addUser':
      return {
        messages: [...state.messages, { role: 'user', text: action.text }],
        streamNonceActive: null,
      }
    case 'addAssistant': {
      const maxNonce = state.messages.reduce(
        (mx, m) => (typeof m.streamNonce === 'number' && m.streamNonce > mx ? m.streamNonce : mx),
        0,
      )
      const nonce = maxNonce + 1
      return {
        messages: [...state.messages, { role: 'assistant', text: action.text, streamNonce: nonce }],
        streamNonceActive: nonce,
      }
    }
    case 'streamDone':
      return state.streamNonceActive === null ? state : { ...state, streamNonceActive: null }
    case 'clear':
      return initialAiChat
    default:
      return state
  }
}

/**
 * Right-rail assistant: BYOL OpenAI + tool calls to GitHub (criblpacks) and
 * docs.cribl.io llms.txt indexes. See `proxies.yml` and AGENTS.md.
 */
export function AiAssistantPanel({ plan }: Props) {
  const { width: railW, beginResize, minW: railMinW, maxW: railMaxW } = useResizableAiRailWidth()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const ls = getSafeLocalStorage()
      if (!ls) {
        return false
      }
      // Persisted `'1'` = user collapsed the rail; missing/`'0'` = expanded (default).
      return ls.getItem(COLLAPSE_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [openAiKeyPresent, setOpenAiKeyPresent] = useState<boolean | null>(null)
  const [criblLocalShell, setCriblLocalShell] = useState(() =>
    typeof window !== 'undefined' ? isCriblLocalShell() : false,
  )

  const digest = useMemo(() => buildPlanDigestJson(plan), [plan])

  const workerGroupCount = plan.workerGroups?.length ?? 0
  const sourceSummaryCount = plan.sourceSummary?.length ?? 0
  const chatId = useMemo(
    () => planChatStorageId(plan),
    [plan.customerName, plan.planProvenance?.kind, workerGroupCount, sourceSummaryCount],
  )

  const [chat, dispatchChat] = useReducer(aiChatReducer, initialAiChat)
  const { messages, streamNonceActive } = chat
  const [clearChatDialogOpen, setClearChatDialogOpen] = useState(false)
  const clearChatTitleId = useId()
  const chatIdRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** Skip one save after (re)loading from disk — avoids Strict Mode double-effect saving stale `[]`. */
  const skipPersistRef = useRef(false)

  useEffect(() => {
    if (!clearChatDialogOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setClearChatDialogOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [clearChatDialogOpen])

  useEffect(() => {
    setClearChatDialogOpen(false)
  }, [chatId])

  useEffect(() => {
    if (chatIdRef.current !== chatId) {
      chatIdRef.current = chatId
      skipPersistRef.current = true
      dispatchChat({ type: 'hydrate', messages: loadPersistedChatMessages(chatId) })
      return
    }
    if (skipPersistRef.current) {
      skipPersistRef.current = false
      return
    }
    savePersistedChatMessages(chatId, stripStreamMeta(messages))
  }, [chatId, messages])

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      const local = isCriblLocalShell()
      if (!cancelled) setCriblLocalShell(local)
      if (local) {
        if (!cancelled) setOpenAiKeyPresent(false)
        return
      }
      void probeOpenAiKeyPresent().then((present) => {
        if (!cancelled) setOpenAiKeyPresent(present)
      })
    }
    refresh()
    const tid = window.setTimeout(refresh, 800)

    const onKeyAvailability = () => refresh()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener(OPENAI_KEY_AVAILABILITY_EVENT, onKeyAvailability)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearTimeout(tid)
      window.removeEventListener(OPENAI_KEY_AVAILABILITY_EVENT, onKeyAvailability)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const toggle = () => {
    setCollapsed((c) => {
      const n = !c
      try {
        const ls = getSafeLocalStorage()
        if (ls) {
          ls.setItem(COLLAPSE_STORAGE_KEY, n ? '1' : '0')
        }
      } catch {
        /* ignore */
      }
      return n
    })
  }

  const onAssistantRevealComplete = useCallback(() => {
    dispatchChat({ type: 'streamDone' })
  }, [])

  const send = async () => {
    const q = input.trim()
    if (!q || busy || criblLocalShell || openAiKeyPresent === false) return
    setInput('')
    setErr(null)
    dispatchChat({ type: 'addUser', text: q })
    setBusy(true)
    try {
      const reply = await runAdoptionAssistantChat(q, digest)
      dispatchChat({ type: 'addAssistant', text: reply })
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : 'Request failed. Try again from the packaged Cribl app or local dev server; see AGENTS.md if the problem persists.'
      setErr(msg)
      const checklist =
        'What to try:\n• Check your API key in Settings (remove and re-save if unsure).\n• **401/403** from OpenAI usually means a bad or expired key. **429 insufficient_quota** means OpenAI billing needs attention.\n• In Cribl, a workspace admin may need to allow outbound access to OpenAI and doc search—see **AGENTS.md** in the app package.\n• For local development, run **npm run dev** or **npm run preview** so built-in proxies work; opening raw `dist/` files often blocks the assistant or docs.'
      dispatchChat({
        type: 'addAssistant',
        text: `Could not reach the model.\n\nDetail: ${msg}\n\n${checklist}`,
      })
    } finally {
      setBusy(false)
    }
  }

  const applySampleQuestion = (q: string) => {
    setInput(q)
    setErr(null)
    queueMicrotask(() => inputRef.current?.focus())
  }

  const requestClearChat = () => {
    if (messages.length === 0 && !err) return
    setClearChatDialogOpen(true)
  }

  const confirmClearChat = () => {
    setClearChatDialogOpen(false)
    setErr(null)
    dispatchChat({ type: 'clear' })
    savePersistedChatMessages(chatId, [])
  }

  /** Chat cannot run: missing key (or still probed as absent) or Cribl __local__ shell. */
  const chatDisabled = criblLocalShell || openAiKeyPresent === false

  return (
    <>
    <aside
      className="group/aiail relative hidden min-h-0 shrink-0 flex-col self-stretch border-l border-neutral-300/60 bg-neutral-100/95 shadow-[inset_1px_0_0_rgba(255,255,255,0.4)] print:hidden lg:flex"
      style={
        collapsed
          ? { width: '2.5rem', minWidth: '2.5rem' }
          : { width: railW, minWidth: railMinW, maxWidth: railMaxW }
      }
      aria-label="AI ASSISTANT panel"
    >
      {collapsed ? (
        <div className="flex h-full min-h-0 flex-col items-center border-b-0 py-2">
          <button
            type="button"
            title="Expand AI ASSISTANT"
            onClick={toggle}
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-neutral-600 transition hover:bg-neutral-200/80 hover:text-neutral-800"
            aria-expanded="false"
          >
            <span className="sr-only">Expand AI ASSISTANT</span>
            <span className="text-xs font-semibold" aria-hidden>
              «
            </span>
          </button>
          <button
            type="button"
            onClick={toggle}
            title="Expand AI ASSISTANT"
            aria-label="Expand AI ASSISTANT"
            aria-expanded="false"
            className="mt-2 flex min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center rounded-lg border-0 bg-transparent px-0 py-2 text-inherit transition hover:bg-neutral-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60"
          >
            <span
              className="inline-block origin-center rotate-90 select-none whitespace-nowrap text-sm font-semibold tracking-[0.28em] text-neutral-600"
              aria-hidden
            >
              AI ASSISTANT
            </span>
          </button>
        </div>
      ) : (
        <>
          <div className="relative flex shrink-0 items-center justify-between overflow-visible bg-neutral-100/80 px-2 py-2">
            <div className="relative z-10 flex shrink-0 items-center">
              <button
                type="button"
                title="Collapse AI ASSISTANT"
                onClick={toggle}
                className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent px-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-200/80 hover:text-neutral-800"
                aria-expanded="true"
              >
                <span className="sr-only">Collapse AI ASSISTANT</span>
                <span aria-hidden>»</span>
              </button>
            </div>
            <span className="pointer-events-none absolute left-1/2 top-1/2 z-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[length:calc(0.875rem*1.3)] font-semibold tracking-wide text-neutral-600">
              AI ASSISTANT
            </span>
            <div className="relative z-10 flex shrink-0 items-center">
              <span className="group relative inline-flex shrink-0">
                <button
                  type="button"
                  className="relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-[11px] font-semibold text-neutral-500 transition hover:bg-neutral-200/80 hover:text-neutral-800"
                  aria-label="How the AI ASSISTANT is configured"
                  aria-describedby="assistant-setup-help"
                >
                  <span aria-hidden>ⓘ</span>
                </button>
                <div
                  id="assistant-setup-help"
                  role="tooltip"
                  className="absolute right-0 top-full z-[200] -mt-px hidden max-h-52 w-[min(17rem,calc(100vw-1.5rem))] overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 text-left text-[10px] leading-snug text-neutral-800 shadow-md group-hover:block group-focus-within:block"
                >
                  {ASSISTANT_SETUP_TOOLTIP}
                </div>
              </span>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col px-2 pb-2 pt-1">
            <div
              className={
                chatDisabled
                  ? 'flex min-h-0 flex-1 flex-col px-4 pointer-events-none select-none opacity-55'
                  : 'flex min-h-0 flex-1 flex-col px-4'
              }
              aria-hidden={chatDisabled ? true : undefined}
            >
            <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md border border-neutral-200/80 bg-white/80 p-2 text-sm leading-relaxed text-neutral-800">
              {messages.length === 0 ? (
                <div className="space-y-3">
                  <div>
                    <p className="m-0 font-semibold text-neutral-800">Welcome</p>
                    <p className="m-0 mt-1 text-sm leading-relaxed text-neutral-600">
                      Replies use your plan digest. Pack and doc questions call tools that return real links — cite only those URLs (see ⓘ).
                    </p>
                  </div>
                  <p className="m-0 text-sm font-semibold uppercase tracking-wide text-neutral-500">Try a starter prompt</p>
                  <div className="space-y-2.5">
                    {ASSISTANT_WELCOME_SAMPLES.map((group) => (
                      <div key={group.title}>
                        <p className="m-0 text-sm font-semibold text-neutral-800">{group.title}</p>
                        <p className="m-0 text-sm leading-snug text-neutral-500">{group.hint}</p>
                        <ul className="m-0 mt-1 list-none space-y-1 p-0">
                          {group.items.map((row) => (
                            <li key={row.q} className="m-0">
                              <button
                                type="button"
                                disabled={busy || chatDisabled}
                                onClick={() => applySampleQuestion(row.q)}
                                className="w-full rounded-md border border-neutral-200/90 bg-neutral-50/90 px-2 py-1.5 text-left text-sm leading-snug text-neutral-800 transition hover:border-cribl-primary/40 hover:bg-cribl-primary/5 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {row.q}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                  <p className="m-0 text-sm text-neutral-500">
                    Tip: click a prompt to load it into the box below, or ask your own question, then Send now.
                  </p>
                  <p className="m-0 mt-1 text-sm text-neutral-500">
                    AI can make mistakes — verify important answers against your plan, tenant, and official docs.
                  </p>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                    <span
                      className={
                        m.role === 'user'
                          ? 'text-sm font-semibold uppercase text-neutral-500'
                          : 'text-sm font-semibold uppercase text-cribl-primary'
                      }
                    >
                      {m.role}
                    </span>
                    {m.role === 'user' ? (
                      <AssistantMessageRich text={m.text} className="m-0 mt-0.5" />
                    ) : (
                      <AssistantMessageReveal
                        key={m.streamNonce != null ? `asn-${m.streamNonce}` : `a-${i}`}
                        text={m.text}
                        className="m-0 mt-0.5"
                        animate={
                          m.role === 'assistant' &&
                          typeof m.streamNonce === 'number' &&
                          m.streamNonce === streamNonceActive
                        }
                        onRevealComplete={onAssistantRevealComplete}
                      />
                    )}
                  </div>
                ))
              )}
              {busy && (
                <p className="m-0 text-sm font-medium text-cribl-primary" role="status" aria-live="polite">
                  Thinking
                  <span className="ai-thinking-dots" aria-hidden>
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                </p>
              )}
            </div>
            {err && (
              <p className="m-0 mt-1 text-sm text-rose-700" role="alert">
                {err.slice(0, 280)}
              </p>
            )}
            {(messages.length > 0 || err) && (
              <div className="mt-1 flex justify-end">
                <button
                  type="button"
                  disabled={busy || chatDisabled}
                  onClick={() => requestClearChat()}
                  className="rounded-md border border-neutral-300/90 bg-white px-2 py-1 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
                >
                  Clear chat
                </button>
              </div>
            )}
            <div className="mt-2 flex shrink-0 flex-col gap-1">
              <textarea
                ref={inputRef}
                id="adoption-ai-assistant-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={2}
                placeholder="Ask a question…"
                className="w-full min-h-[4.5rem] resize-y rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 outline-none focus:border-cribl-primary focus:ring-1 focus:ring-cribl-primary/30"
                disabled={busy || chatDisabled}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || chatDisabled || !input.trim()}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-cribl-primary/50 bg-cribl-primary px-4 py-2 text-sm font-medium text-white shadow-ctrl transition hover:bg-cribl-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send now
              </button>
            </div>
            </div>
            {chatDisabled ? (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center bg-white/78 p-3 backdrop-blur-[2px]"
                role="alert"
                aria-live="polite"
              >
                <div className="w-full max-w-[min(18rem,calc(100%-0.5rem))] rounded-xl border border-cribl-primary/40 bg-cribl-primary-soft px-4 py-4 shadow-lg">
                  <p className="m-0 text-center text-sm font-semibold uppercase tracking-wide text-cribl-primary">
                    Chat unavailable
                  </p>
                  {criblLocalShell ? (
                    <p className="m-0 mt-2 text-center text-sm leading-snug text-cribl-primary-ink">
                      OpenAI is disabled in the Cribl <span className="font-mono text-[0.95em]">__local__</span> shell. Use the AI
                      ASSISTANT in a <span className="font-semibold">deployed</span> installed app after saving your API key there.
                    </p>
                  ) : (
                    <p className="m-0 mt-2 text-center text-sm leading-snug text-cribl-primary-ink">
                      No OpenAI API key is configured. Open <span className="font-semibold">Settings</span>, add your key, then
                      return here — the assistant cannot run until a key is saved.
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <div
            role="separator"
            title="Drag to resize AI assistant"
            onPointerDown={(e) => beginResize(e)}
            className="absolute left-0 top-0 z-20 h-full w-2 cursor-ew-resize select-none border-l border-transparent hover:border-cribl-primary/20 hover:bg-cribl-primary/5 group-hover/aiail:bg-cribl-primary/5"
            aria-label="Resize AI assistant"
          />
        </>
      )}
      {clearChatDialogOpen ? (
        <div
          className="absolute inset-0 z-[50] flex items-end justify-center bg-cribl-ink/50 p-3 sm:items-center sm:p-4"
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close dialog"
            onClick={() => setClearChatDialogOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={clearChatTitleId}
            className="relative z-10 w-full max-w-md rounded-2xl border border-cribl-border bg-white p-5 shadow-[0_16px_40px_rgba(10,22,40,0.2)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={clearChatTitleId} className="m-0 text-base font-semibold text-cribl-ink sm:text-lg">
              Clear this conversation?
            </h2>
            <p className="m-0 mt-2 text-sm leading-relaxed text-cribl-muted">
              This removes all messages in the AI ASSISTANT for this plan from this browser. You cannot undo it.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end sm:gap-3">
              <button
                type="button"
                onClick={() => setClearChatDialogOpen(false)}
                className="h-10 flex-1 rounded-lg border border-cribl-border bg-cribl-canvas px-3 text-sm font-medium text-cribl-ink sm:flex-none"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmClearChat()}
                className="h-10 flex-1 rounded-lg border border-rose-200 bg-rose-600 px-3 text-sm font-semibold text-white shadow-ctrl hover:bg-rose-700 sm:flex-none"
              >
                Clear chat
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>

    </>
  )
}
