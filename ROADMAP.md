# Cribl Adoption Plan Tool Roadmap

This roadmap is the project-facing source of truth for **ongoing programs** and
**upcoming themes**. It is intentionally lightweight: items here come from real
CSE / PS usage and feedback, but they are not committed delivery dates.

Detailed implementation history belongs in [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md);
version-scoped summaries can live under local `docs/releases/` (**`docs/` is
gitignored** — distribute via GitHub Release bodies or internal docs as needed;
`build/` remains gitignored for local pack output). This file
tracks **what is still in flight** (including standing programs without an end
date), a short **recently delivered** snapshot, and **exploration** ideas so the
backlog stays aligned with the product.

## What’s left (summary)

Most remaining work is **open-ended**: the app will keep eating **real customer
Excel** and **standalone deployment** edge cases for as long as those are the
product surface. Expect **incremental** releases (small fixes + fixtures +
clearer errors), not a single “workbooks finished” milestone.

- **Ongoing programs** (below): standing quality bar for **import/export /
  round-trip**, deeper **diagnostics** when something fails, and **on‑prem
  collateral** only when the field asks.
- **Planned exploration**: product and UX bets that are useful but not tied to a
  schedule (nested fleets polish, internal renames, **AI-assisted pattern
  onboarding** (packs, routes, docs), **customer-facing readouts**, **financial /
  agent-assisted modeling**, **import from live environments**, **plan-level
  Cribl Leader version** (see below), **push plan to env via agent**, Activation,
  tile alignment with Cribl-as-Code).

## Cribl product versions (alignment log)

When we refresh **tiles**, **import assumptions**, or **field copy** against **Cribl
Stream / Edge** (and related docs such as Search / Lake or **What’s New**), record
the **product semver(s)** we actually skimmed or smoke-tested — e.g. **Stream
4.18.0**, **Edge 4.x.y** — so the next person does not have to rediscover context.

This is **not** a “minimum supported customer version” contract; it is a **working
log** of what the repo was last aligned to on purpose. Update the table when
[`src/data/referenceData.ts`](./src/data/referenceData.ts) (or similar) changes
because of a **Cribl product** release, not on every Adoption Plan app semver bump.

| Product | Version used | Last aligned (approx.) | Notes |
|---------|--------------|------------------------|-------|
| Cribl Stream | *e.g. 4.18.0* | *YYYY-MM* | e.g. release-notes skim for `techTiles` / destinations |
| Cribl Edge | *e.g. 4.x.y* | *YYYY-MM* | |
| Cribl Search / Lake | *optional* | *YYYY-MM* | if relevant to tiles or copy |

---

## Recently delivered

### v3.0.0 (GitHub Release)

Major release: **Environment** routing visualization and import-time routing harvest.

- **Environment (new nav):** Interactive routing map — sources → routes → pipelines → destinations — from tenant or diagnostic import; drill Worker Groups / Fleets → group → pack; entity detail panel; placeholders when sources or destinations are missing; read-only snapshot (plan edits do not update the map; **Reset plan** clears it).
- **Import:** Unified **File → Import** tabs (tenant, diagnostic bundle, Excel); **overwrite review** dialog with plan + environment diff before replacing data; shared harvest options (omit stock groups, disabled inputs).
- **Tenant harvest:** Leader topology + routing snapshot; quieter KV/API probes; pack inputs/routes/pipelines paths aligned to Leader API; pack outputs inferred from routes when list API is absent.
- **Diagnostic harvest:** Bundle topology + environment routing (`harvestDiagEnvironment`); stock/outpost/search group filtering; user-friendly import copy.
- **Persistence:** Environment snapshot in pack KV (`users/…/environment`); hydration via `kvGet` on refresh; import provenance sync banner when plan and snapshot diverge.
- **Plan / UX:** Environment link in sidebar; executive readout and assistant context updates; confirm clear dialog mentions environment reset.
- **Tests:** Vitest coverage for environment flow graph, pack entry, tenant/diag harvest, import diff, KV-adjacent helpers (158+ tests in suite at ship).
- **Packaging:** Semver **3.0.0**; same `npm run package` / `build:standalone` flow as **v2.3.0**+.

### v2.3.2 (GitHub Release)

Patch release: **Sources index UX**, **left-rail sizing**, and **popover menus** that escape overflow clipping.

- **Sources — filters & sorting:** **Assignment state** dropdown (All / Unassigned / Stream / Edge) plus **Disabled only** checkbox; additional filters (**Criticality**, **Compliance**, **Source context**, **Has daily volume**); sort by **Attachment disabled**; **Filter** badge no longer counts the global “show disabled” default; **Clear filters** resets the new controls.
- **Sources — bulk:** Mark rows **attachment-disabled** or **not disabled** (clears flag + Leader-style ` disabled` name suffix with `sourceVolume` name sync); helper **`stripAttachmentDisabledNameSuffix`** in [`sourceAttachmentDisabled.ts`](./src/lib/sourceAttachmentDisabled.ts).
- **Show disabled in lists:** Preference defaults **off** (`readShowDisabledSourcesInLists` / KV); left nav shows a **“N sources hidden”** note instead of a toggle; **Source** detail keeps the show-disabled control.
- **Left rail:** Default width **465px**, max **~605px** (30% above default) in [`useResizableRail.ts`](./src/hooks/useResizableRail.ts).
- **PopoverButton:** Panel renders in a **`document.body` portal** with **`position: fixed`**, measured from the trigger, with scroll/resize listeners — **Filter / Sort / Bulk** (and Worker Groups) no longer clip inside `overflow-x-hidden` main columns.
- **Plan patch:** Define missing **`MAX_FIELD_LEN`** clamp for `updateCseNotes` / `updateSourceField` in [`planPatchApply.ts`](./src/lib/planPatchApply.ts) (restores `tsc` / release build).
- **Packaging:** Semver **2.3.2**; same `npm run package` / standalone build flow as **v2.3.0**+ (unchanged).

### v2.3.1 (GitHub Release)

Patch release: **export parity** for large per-WG source lists, plus **AI assistant** plan-patch behavior that should have shipped with the v2.3.0 assistant surface.

- **Export (v0.9.1):** Per-`wg-*` / `fl-*` / unassigned-bucket sheets with **more than 19 sources** extend **data validation `sqref`** and **conditional formatting `sqref`** past gold row **21** (`extendPerWgSheetSourceBandSqrefs` after `restorePerWgSheets` in [`v091ExportSheetRestore.ts`](./src/lib/v091ExportSheetRestore.ts)).
- **Export:** New data rows beyond the gold scaffold reuse **row 21 column `s=`** when inserting missing overlay cells (`insertMissingCells`).
- **AI assistant — `propose_plan_patch`:** Allowlisted structural ops — **`addWorkerGroup`** (Stream / Edge; optional **`parentFleetId`** for Edge sub-fleet under a top-level parent), **`addSource`** (attach by `workerGroupId` or **`workerGroupWg`** name match; unassigned when both omitted), **`setSourceWorkerGroup`** — plus existing field updates; caps **`MAX_PLAN_PATCH_OPS`** / **`MAX_PLAN_PATCH_NEW_SOURCES`** ([`planPatchApply.ts`](./src/lib/planPatchApply.ts)). Tool schema + session prompts updated ([`aiAssistantOpenAi.ts`](./src/lib/aiAssistantOpenAi.ts)); higher **`MAX_TOOL_ROUNDS`** for multi-step chats.
- **Plan digest:** Each source row includes stable **`id`**; Edge worker groups include **`parentFleetId`** when set; **`digestCoverage`** text documents patch capability ([`planDigest.ts`](./src/lib/planDigest.ts)).
- **UI:** Pending-patch preview lists all op types with short labels and a cap + “more operations” tail ([`AiAssistantPanel.tsx`](./src/components/AiAssistantPanel.tsx)).
- **Rollups:** [`workerGroupRollup.ts`](./src/lib/workerGroupRollup.ts) counts **every** source attached to a worker group for labels/nav (not only rows with parseable GB/day).
- **Docs:** [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md) — `propose_plan_patch` allowlist summary for operators.
- **Tests:** Vitest for [`v091ExportSheetRestore.test.ts`](./src/lib/v091ExportSheetRestore.test.ts), [`planPatchApply.test.ts`](./src/lib/planPatchApply.test.ts), [`workerGroupRollup.test.ts`](./src/lib/workerGroupRollup.test.ts).
- **Packaging:** Semver **2.3.1**; same `npm run package` / standalone build flow as v2.3.0.

### v2.3.0 (GitHub Release + local `docs/releases/v2.3.0.md` if maintained)

- **Tenant import** from live Leader (`/master/groups` + routes per worker group) on **File → Import** when embedded in App Platform; **plan provenance** tracks `tenant` vs `xlsx` vs `scratch`.
- **Summary** under Plan nav — **executive summary**: stakeholder narrative + inventory snapshot + caveats for tenant-derived plans; Summary AI **markdown post-processing** (Vitest coverage).
- **AI ASSISTANT (right rail):** BYOL OpenAI via `proxies.yml` + KV `openaiKey`; plan digest context; multiple **session modes** (Activation & PS, Sources & ingest, Executive readout, Edge vs Stream, Import & export, Plan patch coach, etc.); grouped **`+`** menu; digest row cap in menu; **overlay rail** with smooth resize; **`propose_plan_patch`** Apply/Dismiss + session undo; compact **Cribl-tinted** suggested prompts; header **AI ASSISTANT** + inline **ⓘ**; clear-chat confirm scoped to the rail.
- **Import / diagnostics:** Diagnostics import path and UI; tenant/leader harvest and topology import refinements.
- **Layout:** **Import**, **Export**, and **Settings** centered `max-w-2xl` column in the main pane.
- **Settings / README:** **OpenAI API key**; **Feedback & app support** (`mmolina@cribl.io`); **About this build**; footer **Credits:** thank-you to **dadamic@cribl.io**, **rallen@cribl.io**, and **jdeslauriers@cribl.io** (aligned with **README**).
- **Packaging:** Semver **2.3.0**; build/package flow unchanged (`npm run package` → local `build/*.tgz`); GitHub **v2.3.0** release + standalone HTML aligned with repo notes.

### v2.1.2 (`build/v2.1.2-release-notes.md`)

- **Copilot / Cribl AI research:** `docs/copilot-integration-research.md` (local `docs/` tree)
  — APM-style `/ai/*` agent pattern, verification steps, stakeholder questions, BYOL path.
- **Docs cross-links:** [`README.md`](./README.md) and [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md)
  point to the research note.
- **Product boundary:** [`ROADMAP.md`](./ROADMAP.md) **`Explicit non-goals`** — no
  customer-facing hosted SaaS for this tool; distribution stays App Platform pack,
  standalone HTML, and workbook handoffs.

### v2.1.0 (`build/v2.1.0-release-notes.md`)

- **Nested Edge fleets:** `parentFleetId` on worker-group rows, hierarchy
  helpers, plan / worker-group map UX, persistence, and v0.9.1 export/import
  paths updated for parent/child topology.
- **Left-nav reorder:** drag handles for sources and for Stream worker groups /
  Edge fleets; **`plan.sourceSummary` and `plan.workerGroups` order** drives
  v0.9.1 Excel layout (`wg-*` / `fl-*` tabs and overview rows follow that
  order).
- **Scratch styled export:** empty gold workbook is loaded from a URL
  **resolved next to `index.html`** so packaged **`.tgz`** installs on the App
  Platform find `adoption-plan-empty.xlsx` under `static/`.
- **Source destinations:** tile-only multi-select (no free-text destination
  chips) on the source wizard and source form.
- **Integration lists:** `techTiles` / `destTiles` refreshed from Stream + Edge
  product docs (with doc-aligned comments in `referenceData.ts`).
- **Plan rail (desktop):** Activation nested under Plan; Plan defaults expanded.

### v2.1.1 (`build/v2.1.1-release-notes.md`)

- **In-app version:** Settings shows the package **version**; footer shows
  `Adoption Plan v…` (from `package.json`, injected at **Vite build** time).
- **Customer / security one-pager (standalone & cloud):** `docs/adoption-plan-tool-one-pager.md` (local `docs/` tree; short pointer: `docs/standalone-on-premises.md`)
  — purpose, data boundaries, `localStorage` / `file://`, network expectations.
  Linked from the repo README.
- **Release checklist:** [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md) — steps for
  validating a packaged **`.tgz`** before tagging.
- **Volume grid destinations:** **Sources, volume, region** uses the same
  **tile-only** destination multi-select as detailed sources.
- **Import UX:** clearer messages for unreadable `.xlsx` files and for workbooks
  that are not a supported adoption plan shape.
- **Source wizard ↔ detail form parity:** wizard includes **On-Prem vs
  Cloud/internet** (`type`); **current collection** lives under **Primary data**
  in both flows, uses the same **chip / comma** entry as physical locations, and
  is labeled **optional** (net-new feeds often have no prior path). **Retention**
  wizard copy matches the **number + unit** dials behavior.
- **Long lists when the field is empty:** **Source tile** and wizard **destinations**
  open a **full, scrollable** suggestion panel (`max-height` constrained) without
  requiring keystrokes first (`ComboboxText.alwaysShowOptions`,
  `MultiComboboxChips.alwaysShowOptions` on that step).
- **Sub-fleet authoring:** `AddSubfleetDialog`; **Add Subfleet** beside **New source**
  on the fleet resource map; **＋ Add Subfleet** on **Fleets** index cards (toolbar
  duplicate removed); attach under a top-level fleet via `topLevelFleetIdForNewSubfleet`.
- **Index shortcuts:** **New worker group**, **New fleet**, and **New source** on
  their index pages (same flows as the left-nav **+**).
- **Left nav (desktop rail):** **Alt+↑** / **Alt+↓** on the focused drag grip;
  **A–Z**, **Z–A**, and **GB↓ / GB↑** next to **Sources**, **Worker Groups**, and
  **Fleets**; wider default rail; larger grips on **coarse pointers** (`pointer-coarse:`).
- **Import screen:** dropped obsolete automation-server copy; **Import** errors
  stay clearer for bad or unsupported workbooks.
- **Stability:** removing a fleet from its detail view no longer trips a
  Rules-of-Hooks crash (blank main panel).

### Unreleased (main; tag on next version bump)

- **Import from diagnostic bundle:** parse Cribl Stream/Edge **`.tar.gz` / `.tgz`** bundles in-browser (`groups/<id>/…/inputs.yml`) — see `docs/diag-import.md` (local `docs/` tree) for **Cloud vs customer-managed** bundle availability; `planProvenance.kind` **`diag`**.
- **Pre-release checklist:** [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md) —
  skim **Cribl Stream / Edge / What’s New** before tagging so `referenceData`
  tiles stay aligned; refresh the **Cribl product versions (alignment log)** when
  doc-driven copy changes. Also follow **Release checklist for app semver and
  docs** in that file (grep prior app version, update README / ROADMAP / examples,
  do not treat unrelated `package-lock.json` dependency versions as the app semver).
  After **GitHub** release assets (**`.tgz` + `.html`**) are up, post a **short,
  user-facing** internal Slack blurb from **`docs/slack-update-posts.md`** (local
  **`docs/`** tree) and maintain that file for the next version.

## Ongoing programs (no committed finish line)

These are **standing responsibilities**, not a time-boxed “near term.” Progress
shows up as **versioned fixes** when a concrete failure or gap appears—usually
with a **regression fixture** so the same workbook shape stays supported.

### Workbooks: import, export, and round-trip

- **Field-driven triage:** when PS hits an import or export that misbehaves,
  capture the minimal repro (sanitized workbook or sheet layout notes) and fix
  in a focused change set.
- **Schema ladder:** keep improving paths for **legacy `v0.8.6`** imports and
  the current **`v0.9.1`** gold layout as new variants appear (extra sheets,
  renamed columns, merged cells, partial exports from older app builds).
- **Regression fixtures:** prefer every non-trivial fix to include an **`xlsx`**
  (or documented layout) under test so round-trip and import behavior do not
  slide backward silently.
- **Diagnostics (incremental):** extend “what failed and where” beyond the v2.1.1
  baseline—e.g. sheet name, column header or index, expected vs actual type—only
  when a real error trace shows the next gap worth shipping.

### Standalone / on‑prem collateral

- **Docs on demand:** extend
  `docs/adoption-plan-tool-one-pager.md` or add
  companion material when a deployment pattern or objection comes up often in
  the field (PDF export of the one-pager, tenant disclaimers, localized variants
  only if PS asks).

## Planned Exploration

### Customer-facing summary / readout views (what we mean)

- **Derived** views or short exports built *from* the plan for **customer**
  audiences: totals, top sources by volume, WG/fleet map snapshot, Activation tier,
  blockers, next steps — tuned for **discovery, scoping, and exec handoff** without
  exposing the full internal editor. Not a replacement for Excel; a **briefing
  layer** (could be in-app pages, a PDF, or a slide-oriented layout).

### Product themes

- **AI-assisted onboarding for *known* patterns:** use an **assistant** (e.g.
  IDE-style **right-hand agent / sidebar**) that understands **plan context**
  (sources, tiles, destinations, security vs observability, worker groups / fleets)
  and returns **grounded recommendations** for recurring topologies — e.g. which
  **Cribl content packs** to consider, **routing / pipeline** patterns that match
  those tiles, **destination and auth** notes, doc deep-links, and onboarding
  checklists. The CSE stays in control: **suggest, explain, link** — not silently
  rewrite the plan. Heavy **static templates** are optional; the main bet is
  **judged, pattern-aware help** that scales with product surface area.
- **Nested Edge fleets — remaining gaps:** harden and validate end-to-end
  behavior with real customer workbooks and PS feedback (Excel round-trip edge
  cases, import of unusual layouts, capacity / rollup semantics where parent
  and child fleets disagree, assignment UX polish).
- Rename WG-prefixed shared modules and UI internals to kind-neutral names once
  the current Stream/Fleet behavior settles. Examples include
  `WorkerGroupResourceMap`, `WorkerGroupDetailView`, and `WorkerGroupEditor`,
  which now serve both Stream worker groups and Edge fleets despite the legacy
  naming.
- **$$ alongside GB reduction (sources and beyond):** keep today’s **GB-based**
  data-optimization story, and add a credible path for **dollar impact**
  (license, egress, SIEM tax, etc.). That likely needs **assumption bundles +
  transparent math** and/or the **same conversational assistant** surface as
  pattern onboarding so CSEs can iterate drivers and sensitivity without turning
  the core UI into a full spreadsheet. Other “heavy” workflows (explain-back,
  what-if, compare scenarios) can share that surface over time.
- **Import grounded in the customer’s *current* environment:** today the happy
  path is scratch or **gold adoption Excel**. Longer term, **bootstrap a plan
  from reality** — discover or import topology (sources, destinations, rough
  volumes, fleet layout) from exports, APIs, or packaged reports. Community
  reference for the *shape* of the problem:
  [ryhennessy/CriblAdoptionReport](https://github.com/ryhennessy/CriblAdoptionReport).
  Anything here is **exploratory**: tenant boundaries, read-only vs write,
  which Cribl surfaces (Stream UI export, Cribl-as-Code, Search/Lake, etc.) drive
  the design.
- **Plan-level Cribl Leader version (under consideration — not scheduled):**
  capture **one optional Leader / Stream product version per adoption plan**
  (same tenant or diag context), **not** repeated per worker group / fleet and
  **not** in per-source **Additional notes**. Leave **blank** when import cannot
  detect it; customer can always override. **Detection (research):** live tenant
  **`GET /system/info`**; diagnostic bundle **`log/cribl.log`** (`upgradeMgr`
  `installedVersion`) with fallback to `groups/<id>/package.json` — see
  `docs/tenant-import-leader-data.md` /
  `docs/diag-import.md` when implemented. **Excel
  round-trip (proposed):** single value on **Stream Overview** (e.g. label **I1**,
  value **J1**); do **not** fan the same semver into every **Worker Detail**
  column (redundant and ambiguous on re-import). Open product questions: gold
  template cell placement, re-import overwrite vs preserve customer edits, whether
  Summary / digest copy references the field. **v2.3.x** tenant and diag import
  do not persist Leader version yet.
- **Diagnostic (`diag`) import support (shipped on `main`):** **File → Import** accepts a Cribl Stream/Edge **`.tar.gz` / `.tgz`** bundle and parses `groups/<id>/…/inputs.yml` (see `docs/diag-import.md` in local `docs/` tree). **Remaining:** fixture-backed tests on real bundle shapes, GNU/pax tar edge cases. **UX:** Import page and docs distinguish **Cribl.Cloud** (Leader-centric diags vs self-managed per-worker bundles; live tenant import) from **customer-managed** exports.
- **Import privacy — omit sensitive fields (not scheduled):** Today **Environment** import (diag + live tenant) stores rich YAML on inputs, outputs, routes, and pipelines, with **key-name redaction** only (`password`, `secret`, `token`, etc. in [`environmentConfigRedact.ts`](./src/lib/environmentConfigRedact.ts)). **Hosts, URLs, buckets, route filters, pipeline function `conf`, and `sourcePath`** still enter KV / `localStorage` and appear in the Environment detail panel. **Plan** import is thinner (input `id` / `type` / `disabled` / `description` only from `inputs.yml`; descriptions copy into **Additional notes**). **Import debug → Copy full JSON** can echo raw harvest. **Proposed direction:** refactor harvest to **not import** sensitive material — prefer **structural-only** snapshots (ids, types, disabled, routing refs `pipeline` / `output`) and drop config blobs, filters, and filesystem paths; optionally tighten plan (`description` → notes) and debug payloads. **Open product choices:** keep route-filter sublabels on the map vs omit filters entirely; whether input `id` / WG labels remain (needed for planning). Docs to update: `docs/diag-import.md`, Import **Browser & privacy** copy, one-pager data-flow table. **No committed version** — park until a customer or security review asks for a stricter posture than mask-on-store.
- **Push adoption-plan intent into the customer environment (later):**
  **materialize** what the plan describes (routes, pipelines, naming, rollout
  steps) with an **AI agent** that can read **both** the structured plan **and**
  the target estate — interactive, reversible, and explicit about **preview vs
  apply**. Requires deep alignment on **authz**, auditability, and product
  ownership; likely post-dates a mature “import from env” story.
- Polish the Activation workflow based on PS feedback from real engagements.
- Periodically align `techTiles` / `destTiles` (and any search aliases) with
  **Cribl-as-Code** surface area (Terraform provider / API `type` strings) in
  addition to Stream/Edge product docs, and document the mapping where names
  differ.

## Explicit non-goals

These are **permanent product boundaries**, not backlog items that might be
revisited later.

- **Customer-facing hosted SaaS:** this tool is not offered and will not be
  offered as a standalone multi-tenant web product for customers. Distribution
  stays **Cribl App Platform packaged app**, **standalone/on‑prem HTML**, and
  **workbook handoffs**—not a Cribl-operated consumer-facing service for the
  adoption plan UI itself.

## Not Currently Planned

- Replacing the Adoption Plan Excel workbook as the handoff artifact.
- Multi-user collaboration inside the standalone HTML build.
