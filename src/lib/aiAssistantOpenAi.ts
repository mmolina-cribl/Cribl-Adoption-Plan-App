import { ADOPTION_APP_REFERENCE } from './adoptionAssistantAppContext'
import { getOpenAiKeyForLocalDevOnly, isCriblLocalShell } from './kvStore'
import { searchCriblPacksOnGitHub } from './criblPacksGitHubSearch'
import { searchCriblDocsLlms } from './criblDocsLlmsSearch'
import {
  postProcessExecutiveSummaryAiMarkdown,
  type ExecutiveSummaryAiBoldContext,
} from './executiveSummaryAiMarkdownPost'
import { validatePlanPatchProposal, type PlanPatchProposal } from './planPatchApply'
import type { PlanState } from '../types/planTypes'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'

const DOC_AREA_ENUM = [
  'stream',
  'edge',
  'search',
  'lake',
  'insights',
  'copilot',
  'guard',
  'iam',
  'cribl-as-code',
  'reference-architectures',
  'llm-observability',
  'use-cases',
  'fedramp',
  'billing-licensing',
  'known-issues',
  'apps',
] as const

/**
 * System instructions for the BYOL assistant.
 * Embedded reference: `adoptionAssistantAppContext.ts` (nav + PS static copy + detailed user guide).
 * Long-form guide body: `adoptionPlanAssistantUserGuide.ts`. Starter prompts / tooltip: `AiAssistantPanel.tsx`.
 */
export const ADOPTION_ASSISTANT_SYSTEM = `You are a Cribl field adoption assistant. You help CSEs think through Stream and Edge rollout planning.

**Adoption Planner app (this UI / workbook):** The user is in the Cribl Adoption Plan web app, which mirrors the v0.9.1 adoption-plan Excel shape. Besides worker groups, fleets, and sources, the app has an **Activation** area for **Cribl Professional Services (PS)** worksheet tracking: PS tier, a **base scope** checklist, **use case overview** (kind pickers per slot), and a **per-use-case worksheet** (parameters, status, notes). Export/import round-trips styled .xlsx with that template. A **detailed user guide** (sections 1–22) is included below under **“Adoption Plan — detailed user guide”** — use it for step-by-step and “how do I…” answers.

${ADOPTION_APP_REFERENCE}

**PS tiers inside this app (always answer from the plan digest — do not say this is missing from search results):** \`activationSummary.tier\` is Silver, Gold, Platinum, or unset (null). The app soft-gates how many of the **five** PS use-case worksheet slots are treated as in-scope: **Silver → first 2 slots**, **Gold → first 3**, **Platinum → all 5**. Use \`activationSummary.unlockedUseCaseSlotsInScope\`, \`totalPsWorksheetUseCaseSlots\`, and \`tierScopeSummaryInApp\` for exact wording. If \`tierUnsetShowsAllSlotsInUi\` is true, all five slots are still visible in the UI until the customer picks a tier. This reflects **in-app worksheet scope**, not a full commercial PS packaging catalog; for contract-level PS entitlements outside the workbook, say so briefly and point to the account team or official PS materials if the user needs that.

**PS Base Scope deliverables & use-case kinds:** The **full names, long descriptions, worksheet anchor rows, and the 12 use-case kind definitions** are in the **“PS Use Case Worksheet — static canonical copy”** section above (sourced from the same strings as the Activation UI). The digest only has \`activationSummary.baseScopeComplete\` / \`baseScopeTotal\` (progress counts). **Never** tell the user that deliverable or kind definitions are “not in the digest” — summarize or quote from that static section. Only defer to the account team for **commercial** scope not captured in this template.

Rules:
- Be concise and practical. Prefer short bullet lists over long prose.
- Never claim you changed the customer's plan or Cribl configuration.
- **Questions about this app** (where to click, what a label or tab means, how a screen maps to the workbook, where Import/Export/Settings live, **what the five PS base-scope deliverables are**, **what a use-case kind means**, worksheet structure, provenance, troubleshooting): answer from the **App UI reference**, **PS Use Case Worksheet — static canonical copy**, and **Adoption Plan — detailed user guide** sections above, plus the plan digest for **customer-specific progress**. Do not hand-wave to “search results” or doc tools for definitions that already appear in those sections; use doc/pack tools when the user asks about **Cribl product behavior** beyond what this app stores.
- Topology and sources: treat the JSON "plan digest" as structured ground truth about this workbook. It includes worker-group mix, per-source adoption hints (collection path, locations, Stream vs Edge column), activation tier/progress, and optional CSE notes — not live tenant config.
- Do not invent product facts, version numbers, default settings, or feature names you are not confident about. When unsure, say what is unknown and what to check in the tenant (Stream UI, config) or official docs.
- **Links — critical:** Never fabricate URLs. You **may** cite:
  - Repository links exactly as returned in tool JSON from \`search_cribl_packs_github\` (\`html_url\`, \`full_name\`).
  - Documentation links exactly as they appear inside \`markdown_line\` strings from \`search_cribl_docs_llms\` (those lines are copied from Cribl's published llms.txt indexes at docs.cribl.io).
  For any other product URL, only use text the user pasted in chat.
- When the user asks about **community packs**, **criblpacks**, or GitHub packs, call \`search_cribl_packs_github\` with focused keywords. When they ask about **product behavior**, **sources**, **destinations**, **Stream/Edge** setup, **release notes**, **known issues**, **App Platform** / packaged apps, or **official docs**, call \`search_cribl_docs_llms\` with keywords (and optional \`doc_areas\` — include \`known-issues\` or \`apps\` when relevant). The doc tool always loads the global docs index plus matching product indexes. You may call each tool multiple times with different queries.
- **Plan edits:** When the user explicitly asks you to update workbook fields (blockers, notes, pipeline use case text, per-source GB/day, etc.), you may call \`propose_plan_patch\` with a short \`summary\` and an \`operations\` array. Only use allowlisted operations the tool schema describes. The app **never** applies changes automatically — the user must click **Apply** in the UI. If you are unsure or the request is out of scope, answer in prose instead of proposing a patch.
- Distinguish **built-in source types** (in the digest) from **optional community packs**; packs are not guaranteed to exist for every source.
- Suggest next steps (workbook fields, Stream validation, questions for the customer) rather than generic filler.`

const CRIBL_PACKS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'search_cribl_packs_github',
    description:
      'Search public GitHub repositories in the criblpacks organization (https://github.com/criblpacks) for Stream/Edge community packs. Returns JSON with items[].html_url, full_name, description, stars.',
    parameters: {
      type: 'object',
      properties: {
        search_query: {
          type: 'string',
          description:
            'Keywords to find packs, e.g. "splunk hec", "windows xml", "kafka json", "s3 parquet", "syslog rfc".',
        },
      },
      required: ['search_query'],
    },
  },
}

const CRIBL_DOCS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'search_cribl_docs_llms',
    description:
      'Search Cribl official documentation indexes (llms.txt link lists on docs.cribl.io). Returns markdown lines that contain real https://docs.cribl.io/... URLs. Use for product questions, sources, destinations, sizing, and onboarding — not for community GitHub packs.',
    parameters: {
      type: 'object',
      properties: {
        search_query: {
          type: 'string',
          description:
            'Keywords, e.g. "syslog source", "S3 destination", "worker group fleet", "QuickConnect", "packs import".',
        },
        doc_areas: {
          type: 'array',
          description:
            'Optional doc index areas. Use `known-issues` for bugs/regressions/release notes context; `apps` for App Platform, packaged apps, proxies, KV. Omit to auto-select (always includes global index + stream + edge plus keyword matches).',
          items: {
            type: 'string',
            enum: [...DOC_AREA_ENUM],
          },
        },
      },
      required: ['search_query'],
    },
  },
}

const PROPOSE_PLAN_PATCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'propose_plan_patch',
    description:
      'Propose allowlisted edits to the in-browser adoption plan (sources blockers/notes/pipeline use case/avg daily GB, or plan notes). The user must confirm in the UI — nothing applies automatically. Use only when the user asked for concrete plan updates you can express as patch operations.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'One or two sentences describing the change (shown above Apply/Dismiss).',
        },
        operations: {
          type: 'array',
          description:
            'Each item: { op: "updateSourceField", sourceId, field, value } with field one of blockers | avgDailyGb | additionalNotes | pipelineUsecase; or { op: "updateCseNotes", value } for the plan-wide notes field.',
          items: { type: 'object', additionalProperties: true },
        },
      },
      required: ['summary', 'operations'],
    },
  },
}

const ASSISTANT_TOOLS = [CRIBL_PACKS_TOOL, CRIBL_DOCS_TOOL, PROPOSE_PLAN_PATCH_TOOL] as const

type ToolCall = {
  id: string
  type: string
  function: { name: string; arguments: string }
}

type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

function openAiHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  const localKey = getOpenAiKeyForLocalDevOnly()
  if (localKey) {
    h.authorization = `Bearer ${localKey}`
  }
  return h
}

async function chatCompletion(messages: ChatMessage[]): Promise<{
  finish_reason: string
  message: { content?: string | null; tool_calls?: ToolCall[] }
}> {
  const body = {
    model: 'gpt-4o-mini',
    temperature: 0.25,
    parallel_tool_calls: false,
    messages,
    tools: [...ASSISTANT_TOOLS],
    tool_choice: 'auto' as const,
  }
  const r = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: openAiHeaders(),
    body: JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) {
    throw new Error(`OpenAI error (${r.status}): ${text.slice(0, 400)}`)
  }
  const j = JSON.parse(text) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string | null; tool_calls?: ToolCall[] } }>
  }
  const choice = j.choices?.[0]
  if (!choice?.message) {
    throw new Error('OpenAI returned no message.')
  }
  return {
    finish_reason: choice.finish_reason ?? 'stop',
    message: choice.message,
  }
}

/** Narrow system prompt for the Summary tab — no tools; JSON context only. */
const EXECUTIVE_SUMMARY_AI_SYSTEM = `You help prepare a short executive readout for the Cribl Stream/Edge adoption plan described in the JSON. The reader may be an internal team or the customer organization — keep tone professional and inclusive.

Output rules:
- Output **Markdown only**. Use exactly these top-level section headings (use ##): ## Talking points, ## Questions to validate, ## Suggested next steps
- Under each section: 3–6 concise bullets unless the data is very sparse (then fewer). Use "- " bullet lines.
- Ground every bullet in the JSON: customer name, atAGlance counts, worker group names, sourceInventorySample, blockers in sample, PS Activation tier / scope fields, planNotesSnippet (free-text plan notes from the workbook, if any), provenance. Never invent product versions, live tenant facts, or sources not implied by the JSON.
- **Customer name in bullets:** Whenever you refer to this account by name, use the exact characters from JSON field \`customerName\` wrapped in Markdown bold (e.g. **Acme Corp**). Use that form even when \`customerName\` is the placeholder "Customer". Do not bold product phrases such as "Cribl Stream/Edge" as a whole—only bold the \`customerName\` token when it names the customer organization (e.g. write **Cribl** for the account, but "Cribl Stream/Edge" for the product line without bolding the product words).
- **Other salient tokens:** Also bold (Markdown \`**…**\`) when they appear in bullets: each **exact** worker group / fleet name from \`workerGroups\` (spelling must match JSON), the PS Activation tier word from \`atAGlance.psActivationTier\` when set (Silver / Gold / Platinum only), and numeric counts from \`atAGlance\` (stream worker groups, edge fleets, source rows) when you cite those numbers — do not bold unrelated numbers.
- If omittedSourcesCount is greater than 0, state clearly that the JSON lists only a **sample** of sources and the full count is atAGlance.sourceRowsInPlan — do not claim you listed every source; do not enumerate omitted rows.
- Never fabricate URLs. Plain language suitable for executives.

If a field is empty or null, say it is unset briefly rather than guessing.`

const MAX_EXEC_SUMMARY_CONTEXT_CHARS = 14_000

async function chatCompletionNoTools(messages: ChatMessage[]): Promise<{
  finish_reason: string
  message: { content?: string | null }
}> {
  const body = {
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages,
  }
  const r = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: openAiHeaders(),
    body: JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) {
    throw new Error(`OpenAI error (${r.status}): ${text.slice(0, 400)}`)
  }
  const j = JSON.parse(text) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>
  }
  const choice = j.choices?.[0]
  if (!choice?.message) {
    throw new Error('OpenAI returned no message.')
  }
  return {
    finish_reason: choice.finish_reason ?? 'stop',
    message: choice.message,
  }
}

const MAX_TOOL_ROUNDS = 8

export type AdoptionAssistantMode =
  | 'plan'
  | 'research'
  | 'activation'
  | 'sources'
  | 'executive'
  | 'edge_topology'
  | 'export_gold'
  | 'patch_coach'

/** Appended to the system message (after digest) for non-`plan` session modes. */
export function adoptionAssistantSessionModeAppend(mode: AdoptionAssistantMode | undefined): string {
  const m = mode ?? 'plan'
  if (m === 'plan') {
    return ''
  }
  if (m === 'research') {
    return `\n\n**Session mode — Product research:** The user may ask general Cribl Stream/Edge, pipeline, pack, sizing, or best-practice questions beyond their workbook snapshot. Prefer calling \`search_cribl_docs_llms\` and \`search_cribl_packs_github\` with concrete keywords. Still never fabricate URLs; keep citing only tool-returned links.`
  }
  if (m === 'activation') {
    return `\n\n**Session mode — Activation & PS:** Focus on the Adoption Planner **Activation** area: PS tier (Silver/Gold/Platinum or unset), base-scope progress counts, unlocked use-case slots, and how in-app scope maps to the worksheet. Use the **PS Use Case Worksheet — static canonical copy** and **App UI reference** in the system prompt for deliverable names, use-case kind definitions, and tab structure — do not claim those definitions are missing from context. Prefer digest fields for **customer-specific** progress; call doc tools only for **Cribl product PS packaging** beyond this template. Stay concise; suggest next fields to fill in the app.`
  }
  if (m === 'sources') {
    return `\n\n**Session mode — Sources & ingest:** Prioritize the digest **sources** rows and **sourceVolumeSample** / ingest footprint: ranking by \`avgDailyGb\`, blockers, destinations, Stream vs Edge column, collection paths, and questions for the customer. Stress practical follow-ups and validation in Stream/Edge rather than generic product essays. Use pack/doc tools when the user needs external evidence; never fabricate URLs.`
  }
  if (m === 'executive') {
    return `\n\n**Session mode — Executive narrative:** Produce **short, customer-ready bullets** (headlines + tight sub-bullets). Use digest facts only for quantities and topology — no large markdown tables in chat, no invented metrics. If something is not in the digest, say it is unknown or suggest what to capture in the workbook. Complements the Executive tab; keep tone appropriate for CIO/IT leadership readouts.`
  }
  if (m === 'edge_topology') {
    return `\n\n**Session mode — Edge vs Stream topology:** Explain **worker groups** from the digest (\`workerGroups\`, kinds stream vs edge), fleet vs worker-group language, how sources attach (\`sourceRowsByWorkerKind\`), and when Edge file/fleet patterns vs Stream worker groups are appropriate. Ground every structural claim in digest JSON; use docs/packs for **product pattern** backup with tool-returned links only.`
  }
  if (m === 'export_gold') {
    return `\n\n**Session mode — Import, export & gold template:** Explain **plan provenance**, import/export behavior, gold template parity, and what re-export is for — using the in-prompt **Adoption Plan — detailed user guide** and digest \`planProvenance\` / \`digestCoverage\`. Help the user explain round-trip Excel to customers. Defer live tenant truth to the customer; do not claim you changed files.`
  }
  if (m === 'patch_coach') {
    return `\n\n**Session mode — Plan patch coach:** The user wants **controlled workbook edits**. After they clearly confirm **what** should change (which sources, which fields), prefer a single \`propose_plan_patch\` call with allowlisted operations and a short summary. If the request is ambiguous or out of scope for the tool schema, answer in prose and ask clarifying questions — do not guess patch ops. Remind them nothing applies until they click **Apply** in the UI.`
  }
  return ''
}

export type AdoptionAssistantChatOptions = {
  /** Max chars of plan digest JSON embedded in system message (default 12000, max 20000). */
  digestMaxChars?: number
  /** Session steering mode (default `plan`). Each mode appends a short system suffix after the digest. */
  mode?: AdoptionAssistantMode
}

export type AdoptionAssistantChatResult = {
  text: string
  pendingPlanPatch?: PlanPatchProposal
}

async function runTool(name: string, argumentsJson: string): Promise<string> {
  if (name === 'search_cribl_packs_github') {
    try {
      const args = JSON.parse(argumentsJson || '{}') as { search_query?: string }
      return await searchCriblPacksOnGitHub(args.search_query ?? '')
    } catch {
      return JSON.stringify({ error: 'bad_tool_arguments', raw: argumentsJson.slice(0, 200) })
    }
  }
  if (name === 'search_cribl_docs_llms') {
    try {
      const args = JSON.parse(argumentsJson || '{}') as {
        search_query?: string
        doc_areas?: unknown
      }
      return await searchCriblDocsLlms({
        search_query: args.search_query ?? '',
        doc_areas: args.doc_areas,
      })
    } catch {
      return JSON.stringify({ error: 'bad_tool_arguments', raw: argumentsJson.slice(0, 200) })
    }
  }
  if (name === 'propose_plan_patch') {
    return JSON.stringify({
      error: 'propose_plan_patch must be the only tool call in its assistant turn; retry as a single function call.',
    })
  }
  return JSON.stringify({ error: 'unknown_tool', name })
}

/**
 * Single user turn: may perform multiple OpenAI rounds (tool calls to GitHub
 * and docs.cribl.io indexes, then final natural-language reply).
 * When the model proposes a valid `propose_plan_patch` alone, returns `pendingPlanPatch` for UI Apply/Dismiss.
 */
export async function runAdoptionAssistantChat(
  userText: string,
  planDigest: string,
  plan: PlanState,
  options?: AdoptionAssistantChatOptions,
): Promise<AdoptionAssistantChatResult> {
  if (isCriblLocalShell()) {
    throw new Error(
      'OpenAI assistant is not available in the Cribl `__local__` shell. Use a deployed installed app (Settings → pack KV `openaiKey`).',
    )
  }

  const digestMaxChars = Math.min(20_000, Math.max(4000, options?.digestMaxChars ?? 12_000))
  let systemContent = `${ADOPTION_ASSISTANT_SYSTEM}\n\nPlan digest (JSON):\n${planDigest.slice(0, digestMaxChars)}`
  systemContent += adoptionAssistantSessionModeAppend(options?.mode)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userText },
  ]

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const { message } = await chatCompletion(messages)

    if (message.tool_calls?.length) {
      const calls = message.tool_calls
      if (
        calls.length === 1 &&
        calls[0]!.type === 'function' &&
        calls[0]!.function.name === 'propose_plan_patch'
      ) {
        const tc = calls[0]!
        let args: { summary?: unknown; operations?: unknown }
        try {
          args = JSON.parse(tc.function.arguments || '{}') as { summary?: unknown; operations?: unknown }
        } catch {
          messages.push({
            role: 'assistant',
            content: message.content ?? null,
            tool_calls: message.tool_calls,
          })
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ error: 'invalid_json_arguments' }),
          })
          continue
        }
        const summary = typeof args.summary === 'string' ? args.summary : ''
        const prop = validatePlanPatchProposal(plan, args.operations, summary)
        if ('error' in prop) {
          messages.push({
            role: 'assistant',
            content: message.content ?? null,
            tool_calls: message.tool_calls,
          })
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ error: prop.error }),
          })
          continue
        }
        return {
          text: `${prop.summary}\n\n**Proposal ready** — review the card below, then click **Apply** or **Dismiss**.`,
          pendingPlanPatch: prop,
        }
      }

      messages.push({
        role: 'assistant',
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      })

      for (const tc of message.tool_calls) {
        const toolContent =
          tc.type === 'function'
            ? await runTool(tc.function.name, tc.function.arguments ?? '{}')
            : JSON.stringify({ error: 'unsupported_tool_type', type: tc.type })
        messages.push({ role: 'tool', tool_call_id: tc.id, content: toolContent })
      }
      continue
    }

    const out = message.content?.trim()
    if (out) {
      return { text: out }
    }
    throw new Error('OpenAI returned an empty message.')
  }

  throw new Error('Assistant stopped after too many tool rounds (max tool steps exceeded).')
}

const EXEC_SUMMARY_MODEL = 'gpt-4o-mini'

/**
 * One-shot Markdown for the Executive (Summary) tab. Same BYOL key / headers as
 * {@link runAdoptionAssistantChat}; no tools. `contextJson` should be capped JSON
 * (e.g. from {@link buildExecutiveSummaryAiContextJson}). `boldContext` carries the same
 * customer and inventory strings used for deterministic \`**…**\` post-processing.
 */
export async function runExecutiveSummaryAiMarkdown(
  contextJson: string,
  boldContext: ExecutiveSummaryAiBoldContext,
): Promise<{ markdown: string; model: string }> {
  if (isCriblLocalShell()) {
    throw new Error(
      'OpenAI is not available in the Cribl `__local__` shell. Use a deployed installed app (Settings → pack KV `openaiKey`).',
    )
  }
  const ctx = contextJson.slice(0, MAX_EXEC_SUMMARY_CONTEXT_CHARS)
  const messages: ChatMessage[] = [
    { role: 'system', content: EXECUTIVE_SUMMARY_AI_SYSTEM },
    {
      role: 'user',
      content: `Plan context (JSON). If omittedSourcesCount > 0, the source list is a capped sample — honor digestCoverage and atAGlance.sourceRowsInPlan.\n\n${ctx}`,
    },
  ]
  const { message } = await chatCompletionNoTools(messages)
  const out = message.content?.trim()
  if (!out) {
    throw new Error('OpenAI returned an empty message.')
  }
  return {
    markdown: postProcessExecutiveSummaryAiMarkdown(out, boldContext),
    model: EXEC_SUMMARY_MODEL,
  }
}
