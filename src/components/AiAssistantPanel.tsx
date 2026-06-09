import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { useResizableAiRailWidth } from '../hooks/useResizableAiRailWidth'
import { runAdoptionAssistantChat, type AdoptionAssistantMode } from '../lib/aiAssistantOpenAi'
import {
  loadPersistedChatMessages,
  planChatStorageId,
  savePersistedChatMessages,
  type PersistedChatMessage,
} from '../lib/aiAssistantChatStorage'
import { useAnimationsEnabled, usePrefersReducedMotion } from '../lib/animationsPreference'
import { getSafeLocalStorage } from '../lib/safeLocalStorage'
import { AssistantMessageReveal } from './AssistantMessageReveal'
import { AssistantMessageRich } from './AssistantMessageRich'
import { buildPlanDigestJson } from '../lib/planDigest'
import { probeOpenAiKeyPresent, isCriblLocalShell, OPENAI_KEY_AVAILABILITY_EVENT } from '../lib/kvStore'
import type { PlanState } from '../types/planTypes'
import type { PlanPatchOp, PlanPatchProposal } from '../lib/planPatchApply'

const COLLAPSE_STORAGE_KEY = 'cribl-adoption-ai-rail-collapsed-v1'

const PLAN_PATCH_OP_PREVIEW_LIMIT = 15

function shortId(id: string): string {
  const t = id.trim()
  if (t.length <= 10) {
    return t
  }
  return `${t.slice(0, 8)}…`
}

function summarizePlanPatchOp(op: PlanPatchOp): string {
  switch (op.op) {
    case 'updateCseNotes':
      return `Update plan notes (${op.value.length} chars)`
    case 'updateSourceField':
      return `Source ${shortId(op.sourceId)} — set ${op.field}`
    case 'addWorkerGroup': {
      const label = op.kind === 'edge' ? 'Edge fleet' : 'Stream worker group'
      const sub = op.parentFleetId ? ' (sub-fleet)' : ''
      return `Add ${label} “${op.wg}”${sub}`
    }
    case 'addSource': {
      const attach = op.workerGroupWg
        ? ` → “${op.workerGroupWg}”`
        : op.workerGroupId
          ? ` → group ${shortId(op.workerGroupId)}`
          : ' (unassigned)'
      const tile = op.sourceTile ? ` [tile: ${op.sourceTile}]` : ''
      return `Add source “${op.source}”${attach}${tile}`
    }
    case 'setSourceWorkerGroup': {
      const attach = op.workerGroupWg
        ? ` → “${op.workerGroupWg}”`
        : op.workerGroupId
          ? ` → group ${shortId(op.workerGroupId)}`
          : ' → unassigned'
      return `Move source ${shortId(op.sourceId)}${attach}`
    }
  }
}

const ASSISTANT_SETUP_TOOLTIP =
  'Add your OpenAI API key in Settings so the AI assistant can run. In Cribl the key is stored with your app; locally it stays in this browser. Tenant admins: allow outbound access to OpenAI (and doc search hosts if you use them)—see AGENTS.md in the app package. AI can make mistakes — verify important answers against your plan and official docs.'

/** Shown after ~1s hover (or on focus) — digest source-row cap. */
const DIGEST_CAP_TIP =
  'Caps how many source-summary rows are included in the plan digest JSON sent to the model each turn. This is not a workbook or export filter. Larger digests use more tokens and are more likely to hit model/request limits; your full plan stays in the app UI either way.'

const PLAN_MODE_TIP =
  'Each request includes your plan digest so answers track this customer’s topology, sources, and PS tier context. Pack and doc tools still run when relevant.'

const RESEARCH_MODE_TIP =
  'Prioritizes searchable product surfaces (criblpacks GitHub + docs indexes) with lighter plan grounding. Use for mostly product-level questions rather than inventory-specific reasoning.'

const ASSISTANT_MODE_MENU_LABEL: Record<AdoptionAssistantMode, string> = {
  plan: 'Plan + digest',
  research: 'Product research',
  activation: 'Activation & PS',
  sources: 'Sources & ingest',
  executive: 'Executive readout',
  edge_topology: 'Edge vs Stream',
  export_gold: 'Import & export',
  patch_coach: 'Plan patch coach',
}

const ASSISTANT_MODE_MENU_SUB: Record<AdoptionAssistantMode, string> = {
  plan: 'Workbook digest every turn — topology, sources, PS tier. Doc & pack tools when relevant.',
  research: 'Tools-first answers from official docs + criblpacks; lighter plan grounding.',
  activation: 'PS tier, base scope, use-case slots — static worksheet copy + digest progress.',
  sources: 'Rank sources by volume, blockers, Stream vs Edge fit; inventory-first.',
  executive: 'Short CIO-style bullets from digest facts only — no big tables in chat.',
  edge_topology: 'Fleets vs worker groups, how sources attach; patterns from digest + docs.',
  export_gold: 'Provenance, gold template, import/export round-trip — guide + digest.',
  patch_coach: 'Steers allowlisted propose_plan_patch after you confirm what to change.',
}

const ASSISTANT_MODE_CHIP_TIP: Record<AdoptionAssistantMode, string> = {
  plan: PLAN_MODE_TIP,
  research: RESEARCH_MODE_TIP,
  activation:
    'Uses digest activation summary plus the built-in PS worksheet definitions in the system prompt. Add docs only for product PS packaging beyond this template.',
  sources:
    'Emphasizes digest source rows, GB/day, blockers, and collection context. Tools for evidence — only cite URLs returned by tools.',
  executive:
    'Keeps answers brief and leadership-ready; no invented metrics beyond the digest JSON.',
  edge_topology:
    'Uses workerGroups + sourceRowsByWorkerKind in the digest; doc/pack tools for Cribl patterns with real links only.',
  export_gold:
    'Explains provenance, export checks, and customer messaging for Excel round-trip — grounded in digest + user guide.',
  patch_coach:
    'Prefer propose_plan_patch when your intent is clear; nothing applies until you click Apply.',
}

/** `+` menu — section headers keep many modes scannable. */
const SKILL_MENU_GROUPS: ReadonlyArray<{ title: string; modes: AdoptionAssistantMode[] }> = [
  { title: 'Workbook', modes: ['plan', 'export_gold', 'patch_coach'] },
  { title: 'Field & narrative', modes: ['activation', 'sources', 'edge_topology', 'executive'] },
  { title: 'Product & docs', modes: ['research'] },
]

const HOVER_TIP_MS = 1000

/**
 * Rich tooltip after pointer dwell or immediately on keyboard focus; keeps open while
 * pointer moves onto the tooltip (child of the same wrapper).
 */
function DelayHoverTip({ content, children }: { content: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current)
      focusTimerRef.current = null
    }
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  const showNow = useCallback(() => {
    clearTimers()
    setOpen(true)
  }, [clearTimers])

  const scheduleHoverOpen = useCallback(() => {
    clearTimers()
    hoverTimerRef.current = setTimeout(() => setOpen(true), HOVER_TIP_MS)
  }, [clearTimers])

  const hideIfLeaving = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      const next = e.relatedTarget as Node | null
      if (next && (e.currentTarget as HTMLElement).contains(next)) {
        return
      }
      clearTimers()
      setOpen(false)
    },
    [clearTimers],
  )

  return (
    <span
      className="relative inline-flex max-w-full min-w-0"
      onMouseEnter={scheduleHoverOpen}
      onMouseLeave={hideIfLeaving}
      onFocusCapture={() => {
        clearTimers()
        focusTimerRef.current = setTimeout(showNow, 0)
      }}
      onBlurCapture={(e) => {
        const next = e.relatedTarget as Node | null
        if (next && (e.currentTarget as HTMLElement).contains(next)) {
          return
        }
        clearTimers()
        setOpen(false)
      }}
    >
      {children}
      {open ? (
        <>
          {/* Bridges the gap so moving the pointer from control → tooltip does not fire mouseleave on the wrapper. */}
          <span aria-hidden className="pointer-events-auto absolute left-0 right-0 top-full z-[99] h-2" />
          <span
            role="tooltip"
            className="pointer-events-auto absolute left-0 top-[calc(100%+0.35rem)] z-[100] max-w-[min(18rem,calc(100vw-2rem))] rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-[10px] leading-snug text-neutral-800 shadow-md"
          >
            {content}
          </span>
        </>
      ) : null}
    </span>
  )
}

/** Stacked up + down chevrons — reads as “drag vertically to resize”. */
function AiComposerResizeGripGlyph() {
  return (
    <svg className="h-4 w-4 text-neutral-600" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 2.5 4.5 6.5h7z" fill="currentColor" fillOpacity={0.88} />
      <path d="M8 13.5l3.5-4h-7l3.5 4z" fill="currentColor" fillOpacity={0.88} />
    </svg>
  )
}

const COMPOSER_HEIGHT_MIN_PX = 76
const COMPOSER_HEIGHT_MAX_PX = 440
const COMPOSER_HEIGHT_DEFAULT_PX = 92

/** Grouped starter prompts — customer-facing voice (your org’s plan); two per section. */
const ASSISTANT_WELCOME_SAMPLES: Array<{
  title: string
  hint: string
  items: Array<{ q: string }>
}> = [
  {
    title: 'Right after import',
    hint: 'Uses your plan snapshot and in-app guidance. Only paste links that search tools actually return.',
    items: [
      {
        q: 'What should we double-check in our adoption plan right after import, before we brief our own teams?',
      },
      {
        q: 'In plain language, what does importing and exporting this workbook guarantee for us—and what does it not?',
      },
    ],
  },
  {
    title: 'Activation & PS',
    hint: 'Your PS tier in this plan sets how many use-case slots apply; deliverable names are explained in the app’s built-in guidance.',
    items: [
      {
        q: 'Our plan shows a PS tier—which use-case slots apply to us, and how do Silver, Gold, and Platinum change what we should expect?',
      },
      {
        q: 'Help us describe our base-scope progress: what we should finish first and what evidence we should collect in working sessions.',
      },
    ],
  },
  {
    title: 'Sources & data volume',
    hint: 'Grounded in your source rows and daily volume in this plan. Pack and doc links only if tools return them.',
    items: [
      {
        q: 'Rank our data sources by daily volume from this plan and list the top five risks or next steps we should own.',
      },
      {
        q: 'Which of our sources look like a better fit for Stream vs Edge, and what should we verify in our own environment?',
      },
    ],
  },
  {
    title: 'Worker groups & Edge fleets',
    hint: 'Summarizes your worker groups and how sources attach to Stream vs Edge.',
    items: [
      {
        q: 'Summarize our worker groups vs Edge fleets in plain English and how our sources attach to each.',
      },
      {
        q: 'How should we explain subfleets vs top-level fleets to our leadership using only what is captured in this plan?',
      },
    ],
  },
  {
    title: 'Workshops & meetings',
    hint: 'Agendas and talking points grounded in your topology and sources.',
    items: [
      {
        q: 'Draft a one-hour internal workshop agenda from this plan (topology, sources, activation).',
      },
      {
        q: 'Give us discovery questions we can ask our Splunk or syslog owners, based on the sources listed in this plan.',
      },
    ],
  },
  {
    title: 'Executive & readout',
    hint: 'Short bullets for briefings; numbers and facts come only from this plan—no big tables in chat.',
    items: [
      {
        q: 'Give us five bullets for a CIO briefing using only facts from this plan—no tables, no invented metrics.',
      },
      {
        q: 'Draft a simple renewal narrative from our worker-group mix and ingest footprint as shown in this plan.',
      },
    ],
  },
  {
    title: 'Docs & packs (deep)',
    hint: 'Official docs and community packs—only use links returned in search results.',
    items: [
      {
        q: 'Look up official guidance on sizing worker groups for an ingest footprint like ours in this plan.',
      },
      {
        q: 'Suggest community packs that could help with Splunk HEC or syslog ingestion; include only pack links returned by search.',
      },
    ],
  },
  {
    title: 'Safe workbook edits',
    hint: 'When your team wants controlled updates to this workbook, use Plan patch coach; changes still require Apply in the app.',
    items: [
      {
        q: 'We are ready to name specific source rows—propose allowed updates that clear blockers on our highest-volume sources.',
      },
      {
        q: 'What kinds of fields can be updated via a patch in this app, and what is safer for us to change manually in the workbook?',
      },
    ],
  },
]

type Props = { plan: PlanState; setPlan: Dispatch<SetStateAction<PlanState>> }

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
export function AiAssistantPanel({ plan, setPlan }: Props) {
  const {
    width: railW,
    beginResize,
    minW: railMinW,
    maxW: railMaxW,
    railResizeDragging,
  } = useResizableAiRailWidth()
  const animationsEnabled = useAnimationsEnabled()
  const prefersReducedMotion = usePrefersReducedMotion()
  const railWidthMotionOk = animationsEnabled && !prefersReducedMotion
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

  const [assistantSkill, setAssistantSkill] = useState<{ mode: AdoptionAssistantMode } | null>({ mode: 'plan' })
  const assistantModeForApi: AdoptionAssistantMode = assistantSkill?.mode ?? 'plan'
  const [digestSourceRows, setDigestSourceRows] = useState<35 | 70 | 120>(35)
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false)
  const skillsMenuRef = useRef<HTMLDivElement>(null)
  const [pendingPlanPatch, setPendingPlanPatch] = useState<PlanPatchProposal | null>(null)
  const undoSnapshotRef = useRef<PlanState | null>(null)
  const [undoAvailable, setUndoAvailable] = useState(false)
  const [composerHeightPx, setComposerHeightPx] = useState(COMPOSER_HEIGHT_DEFAULT_PX)
  const composerResizeDragRef = useRef<{ pointerId: number; startY: number; startH: number } | null>(null)
  const [hasRetryableQuestion, setHasRetryableQuestion] = useState(false)
  const lastUserQuestionRef = useRef<string | null>(null)

  const digest = useMemo(() => buildPlanDigestJson(plan, { maxSourceRows: digestSourceRows }), [plan, digestSourceRows])

  const assistantDigestMaxChars = useMemo(() => {
    const high = digestSourceRows >= 70
    switch (assistantModeForApi) {
      case 'sources':
      case 'edge_topology':
        return high ? 19_000 : 15_000
      case 'export_gold':
        return high ? 17_000 : 13_000
      case 'research':
        return high ? 15_000 : 10_500
      default:
        return high ? 16_000 : 12_000
    }
  }, [assistantModeForApi, digestSourceRows])

  const workerGroupCount = plan.workerGroups?.length ?? 0
  const sourceSummaryCount = plan.sourceSummary?.length ?? 0
  const chatId = useMemo(
    () => planChatStorageId(plan),
    // Intentionally avoid `plan` identity — only reset persisted chat when workbook "shape" changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable chat thread for same customer + inventory size
    [plan.customerName, plan.planProvenance?.kind, workerGroupCount, sourceSummaryCount],
  )

  const [chat, dispatchChat] = useReducer(aiChatReducer, initialAiChat)
  const { messages, streamNonceActive } = chat
  const [clearChatDialogOpen, setClearChatDialogOpen] = useState(false)
  const clearChatTitleId = useId()
  const digestDescId = useId()
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
    queueMicrotask(() => {
      setClearChatDialogOpen(false)
    })
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

  const applyPendingPatch = useCallback(() => {
    if (!pendingPlanPatch) return
    undoSnapshotRef.current = JSON.parse(JSON.stringify(plan)) as PlanState
    setUndoAvailable(true)
    setPlan(pendingPlanPatch.nextPlan)
    setPendingPlanPatch(null)
    dispatchChat({
      type: 'addAssistant',
      text: 'Applied the assistant proposal to this plan. Re-export the workbook if you need an updated .xlsx.',
    })
  }, [pendingPlanPatch, plan, setPlan, dispatchChat])

  const dismissPendingPatch = useCallback(() => {
    setPendingPlanPatch(null)
  }, [])

  const undoAssistantApply = useCallback(() => {
    const snap = undoSnapshotRef.current
    if (!snap) return
    setPlan(snap)
    undoSnapshotRef.current = null
    setUndoAvailable(false)
  }, [setPlan])

  const sendWithText = async (qRaw: string) => {
    const q = qRaw.trim()
    if (!q || busy || criblLocalShell || openAiKeyPresent === false) return
    setSkillsMenuOpen(false)
    setErr(null)
    lastUserQuestionRef.current = q
    setHasRetryableQuestion(true)
    dispatchChat({ type: 'addUser', text: q })
    setBusy(true)
    try {
      const result = await runAdoptionAssistantChat(q, digest, plan, {
        mode: assistantModeForApi,
        digestMaxChars: assistantDigestMaxChars,
      })
      dispatchChat({ type: 'addAssistant', text: result.text })
      setPendingPlanPatch(result.pendingPlanPatch ?? null)
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
      setPendingPlanPatch(null)
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    const q = input.trim()
    if (!q || busy || criblLocalShell || openAiKeyPresent === false) return
    setInput('')
    await sendWithText(q)
  }

  const retryLastQuestion = () => {
    const q = lastUserQuestionRef.current
    if (!q || busy || chatDisabled) return
    void sendWithText(q)
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
    setPendingPlanPatch(null)
    undoSnapshotRef.current = null
    setUndoAvailable(false)
    setHasRetryableQuestion(false)
    dispatchChat({ type: 'clear' })
    savePersistedChatMessages(chatId, [])
  }

  /** Chat cannot run: missing key (or still probed as absent) or Cribl __local__ shell. */
  const chatDisabled = criblLocalShell || openAiKeyPresent === false

  const aiRailAsideStyle: CSSProperties = useMemo(() => {
    const base: CSSProperties = collapsed
      ? { width: '2.5rem', minWidth: '2.5rem', maxWidth: '2.5rem' }
      : {
          width: railW,
          minWidth: railMinW,
          // Allow dragging up to `railMaxW` but never wider than the main column (absolute overlay parent).
          maxWidth: `min(${railMaxW}px, 100%)`,
        }
    if (!railWidthMotionOk || railResizeDragging) {
      return { ...base, transition: 'none' }
    }
    return {
      ...base,
      transition: 'width 220ms ease-out, min-width 220ms ease-out, max-width 220ms ease-out',
    }
  }, [collapsed, railW, railMinW, railMaxW, railResizeDragging, railWidthMotionOk])

  const onComposerResizePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (busy || criblLocalShell || openAiKeyPresent === false) return
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      composerResizeDragRef.current = {
        pointerId: e.pointerId,
        startY: e.clientY,
        startH: composerHeightPx,
      }
    },
    [busy, criblLocalShell, openAiKeyPresent, composerHeightPx],
  )

  const endComposerResizeDrag = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const d = composerResizeDragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    try {
      if (typeof e.currentTarget.hasPointerCapture === 'function' && e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {
      /* ignore */
    }
    composerResizeDragRef.current = null
  }, [])

  const onComposerResizePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const d = composerResizeDragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    const next = Math.min(
      COMPOSER_HEIGHT_MAX_PX,
      // Top-corner affordance: drag up → taller, drag down → shorter (opposite of bottom-edge resize).
      Math.max(COMPOSER_HEIGHT_MIN_PX, Math.round(d.startH - (e.clientY - d.startY))),
    )
    setComposerHeightPx(next)
  }, [])

  const onComposerLostPointerCapture = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (composerResizeDragRef.current?.pointerId === e.pointerId) {
      composerResizeDragRef.current = null
    }
  }, [])

  const onComposerResizeKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setComposerHeightPx((h) => Math.max(COMPOSER_HEIGHT_MIN_PX, h - 16))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setComposerHeightPx((h) => Math.min(COMPOSER_HEIGHT_MAX_PX, h + 16))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setComposerHeightPx(COMPOSER_HEIGHT_MIN_PX)
    } else if (e.key === 'End') {
      e.preventDefault()
      setComposerHeightPx(COMPOSER_HEIGHT_MAX_PX)
    }
  }, [])

  useEffect(() => {
    if (!skillsMenuOpen) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setSkillsMenuOpen(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [skillsMenuOpen])

  useEffect(() => {
    if (!skillsMenuOpen) return
    const onDown = (e: Event) => {
      const t = e.target as Node | null
      const wrap = skillsMenuRef.current
      if (wrap && t && !wrap.contains(t)) {
        setSkillsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [skillsMenuOpen])

  return (
    <>
    <aside
      className="group/aiail relative z-40 hidden min-h-0 flex-col border-l border-neutral-200/90 bg-white shadow-[inset_1px_0_0_0_rgba(15,23,42,0.06)] print:hidden lg:absolute lg:right-0 lg:top-0 lg:bottom-0 lg:flex lg:flex-col"
      style={aiRailAsideStyle}
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
          <div className="relative shrink-0 border-b border-neutral-200 bg-white px-3 py-2">
            <div className="relative z-10 flex min-w-0 shrink-0 items-center gap-2">
              <button
                type="button"
                title="Collapse AI ASSISTANT"
                onClick={toggle}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-sm text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800"
                aria-expanded="true"
              >
                <span className="sr-only">Collapse AI ASSISTANT</span>
                <span aria-hidden>»</span>
              </button>
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate text-[0.8125rem] font-bold uppercase tracking-tight text-neutral-900">
                  AI ASSISTANT
                </span>
                <span className="group relative inline-flex shrink-0">
                  <button
                    type="button"
                    className="relative z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
                    aria-label="How the AI ASSISTANT is configured"
                    aria-describedby="assistant-setup-help"
                  >
                    <span aria-hidden>ⓘ</span>
                  </button>
                  <div
                    id="assistant-setup-help"
                    role="tooltip"
                    className="absolute left-0 top-full z-[200] mt-1 hidden max-h-52 w-[min(17rem,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-neutral-200/90 bg-white p-2.5 text-left text-[10px] leading-snug text-neutral-700 shadow-lg ring-1 ring-black/5 group-hover:block group-focus-within:block"
                  >
                    {ASSISTANT_SETUP_TOOLTIP}
                  </div>
                </span>
              </div>
            </div>
          </div>
          {undoAvailable ? (
            <div className="no-print shrink-0 border-b border-neutral-100 bg-neutral-50/70 px-3 py-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => undoAssistantApply()}
                className="w-full rounded-md border border-amber-200/80 bg-amber-50/90 px-2 py-1 text-center text-[11px] font-medium text-amber-950 transition hover:bg-amber-50"
              >
                Undo last assistant apply
              </button>
            </div>
          ) : null}
          <div className="relative flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2">
            <div
              className={
                chatDisabled
                  ? 'flex min-h-0 flex-1 flex-col px-1 pointer-events-none select-none opacity-55'
                  : 'flex min-h-0 flex-1 flex-col px-1'
              }
              aria-hidden={chatDisabled ? true : undefined}
            >
            <div className="mt-1 min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-2.5 text-xs leading-relaxed text-neutral-700">
              {messages.length === 0 ? (
                <div className="space-y-4">
                  <div className="flex w-full min-w-0 flex-col items-center space-y-3 px-1 pt-1 text-center">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-base text-neutral-800 shadow-sm"
                      aria-hidden
                    >
                      ✦
                    </div>
                    <div className="w-full max-w-full space-y-1.5">
                      <p className="m-0 text-base font-semibold leading-snug tracking-tight text-neutral-900">Welcome</p>
                      <p className="m-0 w-full max-w-full text-[11px] leading-relaxed text-neutral-500">
                        Use <span className="font-medium text-neutral-700">+</span> to pick how this assistant focuses (workbook, rollout, or product docs), set digest
                        detail, and choose skills. The chip above your message shows the mode;{' '}
                        <span className="font-medium text-neutral-700">×</span> clears it (back to the full plan + digest view). Only trust links that came from tools (see ⓘ).
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="m-0 text-[10px] font-medium uppercase tracking-wider text-neutral-400">Suggested prompts</p>
                    <div className="mt-2 space-y-3">
                      {ASSISTANT_WELCOME_SAMPLES.map((group) => (
                        <div key={group.title}>
                          <p className="m-0 text-[10px] font-semibold text-neutral-800">{group.title}</p>
                          <p className="m-0 mt-0.5 text-[9px] leading-snug text-neutral-400">{group.hint}</p>
                          <ul className="m-0 mt-1 grid list-none grid-cols-1 gap-1 p-0 sm:grid-cols-2">
                            {group.items.map((row) => (
                              <li key={row.q} className="m-0 min-w-0">
                                <button
                                  type="button"
                                  disabled={busy || chatDisabled}
                                  onClick={() => applySampleQuestion(row.q)}
                                  className="w-full rounded-md border border-cribl-primary/20 bg-cribl-primary-soft/50 px-2 py-1.5 text-left text-[11px] leading-snug text-neutral-700 transition hover:border-cribl-primary/45 hover:bg-cribl-primary-soft hover:text-cribl-primary-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cribl-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {row.q}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="m-0 text-center text-[10px] leading-snug text-neutral-400">
                    Tap a starter to load your message—edit it, then send.
                  </p>
                  <p className="m-0 text-center text-[10px] leading-snug text-neutral-400">
                    AI can make mistakes—double-check answers against your plan and Cribl’s official docs before you act.
                  </p>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                    <div
                      className={
                        m.role === 'user'
                          ? 'mb-0.5 flex items-center justify-end gap-2'
                          : 'mb-0.5 flex items-center justify-between gap-2'
                      }
                    >
                      <span
                        className={
                          m.role === 'user'
                            ? 'text-[10px] font-semibold uppercase tracking-wider text-neutral-400'
                            : 'text-[10px] font-semibold uppercase tracking-wider text-cribl-primary/90'
                        }
                      >
                        {m.role}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void navigator.clipboard.writeText(m.text).catch(() => {})
                        }}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50"
                      >
                        Copy
                      </button>
                    </div>
                    {m.role === 'user' ? (
                      <AssistantMessageRich text={m.text} className="m-0 mt-0.5 text-xs leading-relaxed text-neutral-700" />
                    ) : (
                      <AssistantMessageReveal
                        key={m.streamNonce != null ? `asn-${m.streamNonce}` : `a-${i}`}
                        text={m.text}
                        className="m-0 mt-0.5 text-xs leading-relaxed text-neutral-700"
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
              {pendingPlanPatch && !chatDisabled && (
                <div className="rounded-lg border border-cribl-primary/40 bg-cribl-primary-soft/80 p-2 text-left text-xs text-cribl-primary-ink">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-cribl-primary">
                    Proposed plan changes
                  </p>
                  <p className="m-0 mt-1 text-[11px] leading-snug text-cribl-primary-ink">{pendingPlanPatch.summary}</p>
                  <ul className="m-0 mt-1.5 list-disc space-y-0.5 pl-3.5 text-[10px] leading-snug text-cribl-primary-ink">
                    {pendingPlanPatch.operations.slice(0, PLAN_PATCH_OP_PREVIEW_LIMIT).map((op, opi) => (
                      <li key={opi}>{summarizePlanPatchOp(op)}</li>
                    ))}
                  </ul>
                  {pendingPlanPatch.operations.length > PLAN_PATCH_OP_PREVIEW_LIMIT ? (
                    <p className="m-0 mt-0.5 text-[9px] text-cribl-primary-ink/85">
                      +{pendingPlanPatch.operations.length - PLAN_PATCH_OP_PREVIEW_LIMIT} more operations
                    </p>
                  ) : null}
                  <p className="m-0 mt-1.5 text-[9px] leading-snug text-cribl-primary-ink/90">
                    Nothing applies until you confirm. Re-validate exports after applying.
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => applyPendingPatch()}
                      className="inline-flex items-center justify-center rounded-md bg-cribl-primary px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-cribl-primary-hover disabled:opacity-50"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => dismissPendingPatch()}
                      className="inline-flex items-center justify-center rounded-md border border-cribl-primary/35 bg-white px-2.5 py-1 text-[11px] font-semibold text-cribl-primary-ink transition hover:bg-white/90 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
              {busy && (
                <p className="m-0 text-xs font-medium text-cribl-primary" role="status" aria-live="polite">
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
              <p className="m-0 mt-1 text-xs text-rose-700" role="alert">
                {err.slice(0, 280)}
              </p>
            )}
            {(messages.length > 0 || err) && (
              <div className="mt-2 flex flex-wrap justify-end gap-1">
                <button
                  type="button"
                  disabled={busy || chatDisabled || !hasRetryableQuestion}
                  onClick={() => retryLastQuestion()}
                  className="rounded-md px-2 py-1 text-[11px] font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40"
                >
                  Retry last
                </button>
                <button
                  type="button"
                  disabled={busy || chatDisabled}
                  onClick={() => requestClearChat()}
                  className="rounded-md px-2 py-1 text-[11px] font-medium text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40"
                >
                  Clear chat
                </button>
              </div>
            )}
            <div className="relative mt-2 flex shrink-0 flex-col gap-2">
              <div className="relative overflow-visible">
                <div className="relative flex min-h-0 items-stretch gap-2 rounded-2xl border border-neutral-200/90 bg-white px-2 py-2 shadow-sm ring-1 ring-black/[0.04] transition-[border-color,box-shadow] focus-within:border-neutral-300 focus-within:ring-cribl-primary/15">
                  <div ref={skillsMenuRef} className="relative flex shrink-0 flex-col justify-start pt-0.5">
                    <button
                      type="button"
                      disabled={busy || chatDisabled}
                      aria-haspopup="menu"
                      aria-expanded={skillsMenuOpen}
                      aria-label="Skills, digest cap, and assistant mode"
                      title="Skills, digest row cap, and session modes (workbook, field, product)"
                      onClick={() => setSkillsMenuOpen((o) => !o)}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-0 bg-neutral-100 text-lg leading-none text-neutral-700 transition hover:bg-neutral-200/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="sr-only">Open assistant skills menu</span>
                      <span aria-hidden className="-mt-0.5 font-light">
                        +
                      </span>
                    </button>
                    {skillsMenuOpen ? (
                      <div
                        role="menu"
                        aria-label="Assistant skills"
                        className="absolute bottom-[calc(100%+0.35rem)] left-0 z-[130] flex max-h-[min(70vh,28rem)] w-[min(19rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg"
                      >
                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                          {SKILL_MENU_GROUPS.map((group, gi) => (
                            <div key={group.title} className={gi > 0 ? 'border-t border-neutral-200' : ''}>
                              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                                {group.title}
                              </div>
                              {group.modes.map((mode, mi) => (
                                <button
                                  key={mode}
                                  role="menuitem"
                                  type="button"
                                  title={ASSISTANT_MODE_CHIP_TIP[mode]}
                                  onClick={() => {
                                    setAssistantSkill({ mode })
                                    setSkillsMenuOpen(false)
                                    queueMicrotask(() => inputRef.current?.focus())
                                  }}
                                  className={
                                    mi > 0
                                      ? 'flex w-full flex-col gap-0.5 border-t border-neutral-100 px-3 py-2 text-left text-xs transition hover:bg-neutral-50'
                                      : 'flex w-full flex-col gap-0.5 px-3 py-2 text-left text-xs transition hover:bg-neutral-50'
                                  }
                                >
                                  <span className="font-semibold text-neutral-900">{ASSISTANT_MODE_MENU_LABEL[mode]}</span>
                                  <span className="text-[10px] leading-snug text-neutral-500">{ASSISTANT_MODE_MENU_SUB[mode]}</span>
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                        <div
                          className="shrink-0 border-t border-neutral-100 px-3 py-2"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span id={digestDescId} className="sr-only">
                            {DIGEST_CAP_TIP}
                          </span>
                          <DelayHoverTip content={DIGEST_CAP_TIP}>
                            <label className="flex min-w-0 flex-col gap-1.5 text-[10px] text-neutral-600">
                              <span className="font-medium leading-snug">Source rows (digest cap)</span>
                              <select
                                value={digestSourceRows}
                                disabled={busy}
                                onChange={(e) => setDigestSourceRows(Number(e.target.value) as 35 | 70 | 120)}
                                aria-describedby={digestDescId}
                                className="w-full max-w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] text-neutral-800"
                              >
                                <option value={35}>35 (default)</option>
                                <option value={70}>70</option>
                                <option value={120}>120 (max)</option>
                              </select>
                            </label>
                          </DelayHoverTip>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div
                    className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-hidden py-0.5 pr-1"
                    style={{ height: composerHeightPx, minHeight: COMPOSER_HEIGHT_MIN_PX }}
                  >
                    {assistantSkill ? (
                      <div
                        role="group"
                        aria-label={`Assistant skill: ${ASSISTANT_MODE_MENU_LABEL[assistantSkill.mode]}`}
                        className="inline-flex w-fit max-w-[min(100%,18rem)] shrink-0 self-start items-center gap-1.5 rounded-xl border border-cribl-primary/30 bg-cribl-primary/10 px-2.5 py-1 text-[10px] font-semibold leading-tight text-cribl-primary-ink"
                        title={ASSISTANT_MODE_CHIP_TIP[assistantSkill.mode]}
                      >
                        <span className="min-w-0 truncate" aria-live="polite">
                          {ASSISTANT_MODE_MENU_LABEL[assistantSkill.mode]}
                        </span>
                        <button
                          type="button"
                          disabled={busy || chatDisabled}
                          onClick={(e) => {
                            e.stopPropagation()
                            setAssistantSkill(null)
                          }}
                          aria-label="Remove assistant skill"
                          title="Remove skill — uses Plan + digest until you pick again from +"
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-[12px] font-semibold leading-none text-cribl-primary-ink/75 transition hover:bg-cribl-primary/25 hover:text-cribl-primary-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cribl-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span aria-hidden>×</span>
                        </button>
                      </div>
                    ) : null}
                    <textarea
                      ref={inputRef}
                      id="adoption-ai-assistant-input"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      rows={1}
                      placeholder="Let's chat…"
                      aria-label="Message to assistant"
                      className="min-h-0 w-full flex-1 resize-none border-0 bg-transparent px-0.5 py-1 text-xs leading-snug text-neutral-800 outline-none ring-0 placeholder:text-neutral-400 focus:ring-0"
                      disabled={busy || chatDisabled}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void send()
                        }
                      }}
                    />
                  </div>

                  <div className="flex min-w-0 shrink-0 flex-col justify-end items-end self-stretch pl-0.5 pr-1 pb-0.5">
                    <button
                      type="button"
                      onClick={() => void send()}
                      disabled={busy || chatDisabled || !input.trim()}
                      className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-cribl-primary/50 bg-cribl-primary px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-cribl-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Send
                    </button>
                  </div>

                  <div
                    role="slider"
                    aria-label="Resize question box height — drag up to expand, down to shrink"
                    aria-orientation="vertical"
                    aria-valuemin={COMPOSER_HEIGHT_MIN_PX}
                    aria-valuemax={COMPOSER_HEIGHT_MAX_PX}
                    aria-valuenow={composerHeightPx}
                    tabIndex={0}
                    onPointerDown={onComposerResizePointerDown}
                    onPointerMove={onComposerResizePointerMove}
                    onPointerUp={endComposerResizeDrag}
                    onPointerCancel={endComposerResizeDrag}
                    onLostPointerCapture={onComposerLostPointerCapture}
                    onKeyDown={onComposerResizeKeyDown}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      setComposerHeightPx(COMPOSER_HEIGHT_DEFAULT_PX)
                    }}
                    className="absolute right-1.5 top-1.5 z-30 flex h-9 w-9 cursor-ns-resize touch-none select-none items-start justify-end rounded-md border border-transparent p-0.5 text-neutral-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cribl-primary/35"
                  >
                    <span className="pointer-events-none flex h-7 w-7 items-start justify-end pt-0.5 pr-0.5">
                      <AiComposerResizeGripGlyph />
                    </span>
                  </div>
                </div>
              </div>
              <p className="m-0 px-1 text-center text-[9px] leading-snug text-neutral-400">
                Uses your plan context and tools — not for model training. Check answers against your workbook and official docs before sharing.
              </p>
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
