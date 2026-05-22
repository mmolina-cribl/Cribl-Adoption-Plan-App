import { ADOPTION_APP_REFERENCE } from './adoptionAssistantAppContext'
import { getOpenAiKeyForLocalDevOnly, isCriblLocalShell } from './kvStore'
import { searchCriblPacksOnGitHub } from './criblPacksGitHubSearch'
import { searchCriblDocsLlms } from './criblDocsLlmsSearch'

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
    tools: [CRIBL_PACKS_TOOL, CRIBL_DOCS_TOOL],
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

const MAX_TOOL_ROUNDS = 8

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
  return JSON.stringify({ error: 'unknown_tool', name })
}

/**
 * Single user turn: may perform multiple OpenAI rounds (tool calls to GitHub
 * and docs.cribl.io indexes, then final natural-language reply).
 */
export async function runAdoptionAssistantChat(userText: string, planDigest: string): Promise<string> {
  if (isCriblLocalShell()) {
    throw new Error(
      'OpenAI assistant is not available in the Cribl `__local__` shell. Use a deployed installed app (Settings → pack KV `openaiKey`).',
    )
  }

  const systemContent = `${ADOPTION_ASSISTANT_SYSTEM}\n\nPlan digest (JSON):\n${planDigest.slice(0, 12000)}`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userText },
  ]

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const { message } = await chatCompletion(messages)

    if (message.tool_calls?.length) {
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
      return out
    }
    throw new Error('OpenAI returned an empty message.')
  }

  throw new Error('Assistant stopped after too many tool rounds (max tool steps exceeded).')
}
