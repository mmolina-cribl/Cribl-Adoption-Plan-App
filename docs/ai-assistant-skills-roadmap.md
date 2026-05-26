# AI assistant — skills roadmap (Adoption Planner)

This app’s assistant is **BYOL OpenAI** with a **plan digest** plus **docs** / **criblpacks** tools and optional **plan patch** proposals. **Skills** are session modes: each appends a focused **system suffix** after the digest (see `adoptionAssistantSessionModeAppend` in [`src/lib/aiAssistantOpenAi.ts`](../src/lib/aiAssistantOpenAi.ts)) so prompting matches the user’s task without auto-applying data changes.

## Shipped today (UI + API)

| Mode ID | Menu label | Intent |
|---------|-------------|--------|
| `plan` | Plan + digest | Default workbook grounding — topology, sources, activation summary, tools when relevant. |
| `research` | Product research | Tools-first docs + packs; lighter digest slice in the UI (`digestMaxChars`). |
| `activation` | Activation & PS | PS tier, base scope counts, use-case slots; static worksheet copy is already in the base system prompt. |
| `sources` | Sources & ingest | Inventory-first: GB/day, blockers, Stream vs Edge fit; higher digest char budget when row cap is high. |
| `executive` | Executive readout | Short leadership bullets from digest facts; discourages huge tables in chat. |
| `edge_topology` | Edge vs Stream | Worker groups, kinds, how sources attach; doc/packs for patterns only with tool URLs. |
| `export_gold` | Import & export | Provenance, gold template, round-trip Excel; guide + digest. |
| `patch_coach` | Plan patch coach | Steers allowlisted `propose_plan_patch` after explicit user intent. |

**Starter prompts:** Eight grouped sections in [`src/components/AiAssistantPanel.tsx`](../src/components/AiAssistantPanel.tsx) (`ASSISTANT_WELCOME_SAMPLES`) — post-import validation, activation, sources, worker groups / Edge, workshop, executive, docs/packs, safe edits.

**`+` menu:** Grouped **Workbook** / **Field & narrative** / **Product & docs**; **Source rows (digest cap)** lives at the bottom of the menu (not the rail header).

## Digest coverage (verified)

[`buildPlanDigestJson`](../src/lib/planDigest.ts) already includes: `customerName`, `planProvenance`, `digestCoverage`, `activationSummary`, `workerGroupMix`, `sourceRowsByWorkerKind`, `ingestFootprintGbPerDayApprox`, `workerGroups` (summary fields), `sources` (trimmed rows up to cap), optional `sourceVolumeSample`, `cseNotesSnippet`. No schema change was required for new modes; the UI raises `digestMaxChars` for `sources` / `edge_topology` / `export_gold` and trims slightly for `research` to protect token budget.

## Stretch / later

- **Compare to last import** — needs revision history not fully modeled today.
- **Cribl Functions deep dive** — curated snippet or static cheat sheet if docs search is thin.
- **Pack fit for *my* sources** — multi-step: classify sources → pack search (higher complexity).
- **Sizing / GB sanity** — calculator-style prompts using digest totals + docs.

## Design principles

- **One primary signal per mode** — Session suffix makes the default behavior obvious vs `plan`.
- **Same safety rules** — No fabricated URLs; plan patches never auto-apply.
- **Token budget** — `digestMaxChars` and digest row cap scale with mode (`AiAssistantPanel` `assistantDigestMaxChars`).
- **Discoverability** — Grouped `+` menu; welcome cards mirror post-import workflows.

---

*Positioning: import once; the assistant carries field workflows — the plan UI remains the system of record.*
