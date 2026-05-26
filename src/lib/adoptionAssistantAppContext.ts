/**
 * Static Adoption Plan app context for the BYOL assistant system prompt.
 * Navigation copy: update when left-nav labels or major surfaces change.
 * PS worksheet definitions: `buildAdoptionAssistantPsWorksheetStaticReference` in
 * `psUseCaseLayout.ts` (same source as the Activation UI).
 * Detailed user guide: `adoptionPlanAssistantUserGuide.ts`.
 */
import { buildAdoptionAssistantPsWorksheetStaticReference } from './psUseCaseLayout'
import { ADOPTION_PLAN_ASSISTANT_USER_GUIDE } from './adoptionPlanAssistantUserGuide'

const ADOPTION_APP_NAV_REFERENCE = [
  '### App UI reference (where things live, what labels mean)',
  '',
  '**Chrome:** Header shows “Adoption Plan” and the build version. The **Customer** field (header) edits the plan-wide customer name. **Left sidebar** (desktop; resizable) and the **compact top nav** (small screens) switch main views. **Right rail:** AI assistant — resizable like the plan rail; uses the JSON plan digest plus this reference; optional tools search criblpacks on GitHub and Cribl docs indexes.',
  '',
  '**Plan** (sidebar, first section): Landing view is the **Plan dashboard** (Overview): topology / resource map, paths into worker groups, fleets, and sources, initiative copy, CSE notes, and Activation onboarding callouts. Expand the chevron next to **Plan** to open sub-items:',
  '- **Summary** — Executive readout: full group and source inventory, narrative, provenance; Markdown and .xlsx export on the page.',
  '- **Activation** — In-app **PS Use Case Worksheet** aligned to the Excel sheet of the same theme. **PS tier** control in the header (Silver / Gold / Platinum, or unset). Helper text explains how many of the **five** use-case slots are in scope. **Tabs:** (1) **Base Scope** — five fixed PS deliverables with Status + Notes per row; (2) **Use Case Overview** — pick the **kind** for each numbered use-case slot that is in tier scope; (3) **Use Case Worksheet** — per-slot parameters, Status, and Notes (five parameters per slot in the gold template). Lower tiers hide out-of-scope slots until the user raises the tier.',
  '',
  '**Worker Groups** (Stream): List and index of Stream worker groups; **+ Add Worker Group**; click a row for **Worker group detail** — ingest/egress-style fields, hosting, worker counts, **resource map**, and sources attached to that group.',
  '',
  '**Fleets** (Edge): Same pattern for Edge fleets (top-level fleets and **sub-fleets** under a parent). **+ Add Fleet**; fleet detail mirrors worker group detail for Edge; sub-fleets can be created from the parent fleet flow where the UI offers it.',
  '',
  '**Sources:** Index of all data sources; **+ Add source**. **Source detail** is the full per-source adoption form (the **Source** field is the row identity). Each source attaches to a worker group or fleet. After creating a source, the app may offer **guided entry** vs the full form depending on **Settings**.',
  '',
  '**Import:** Import an existing **.xlsx** adoption workbook (v0.9.1 template family). When the app runs inside the **Cribl App Platform**, **Import from live tenant** can bootstrap worker groups, fleets, and **configured sources** (Leader inputs per group) from the Leader — it replaces topology in memory; the user should review before exporting.',
  '',
  '**Export:** Download a **styled .xlsx** workbook reflecting the current plan in memory (same template shape as import).',
  '',
  '**Settings** (sidebar): **OpenAI API key** for the assistant (pack KV `openaiKey` and proxies when deployed; local dev may store in the browser — see on-screen help); **After adding a source** (ask every time vs always guided wizard vs always manual form); **Plan dashboard prompts** (show or hide the “Plan in shape? Activate it.” Activation nudge when no tier is set); **Detail page card expansion** defaults on source and worker-group detail pages; **UI animations** toggle; **Clear plan…** wipes the current plan after confirmation; **About this build** (version string); **Feedback & app support** (email **mmolina@cribl.io** for app issues or feedback).',
  '',
  '**Plan digest (JSON appended to this system message):** Structured snapshot — e.g. customerName, planProvenance, `digestCoverage` (what is omitted), activationSummary (tier, unlocked use-case slot counts, tierScopeSummaryInApp, base-scope **completion counts only**), workerGroups, trimmed source rows, etc. It is **not** a full cell-by-cell Excel dump and **not** live tenant telemetry unless the user imported from tenant.',
  '',
  '**Excel mapping (high level):** The app is built around the Cribl **v0.9.1 adoption plan** workbook: worker groups, fleets, and sources map to the template’s planning sheets; Activation maps to the **PS Use Case Worksheet** blocks (base scope, use-case overview kinds, per-use-case parameters).',
].join('\n')

/** Navigation + PS worksheet static text + detailed user guide for `ADOPTION_ASSISTANT_SYSTEM`. */
export const ADOPTION_APP_REFERENCE = [
  ADOPTION_APP_NAV_REFERENCE,
  buildAdoptionAssistantPsWorksheetStaticReference(),
  ADOPTION_PLAN_ASSISTANT_USER_GUIDE,
].join('\n\n')
