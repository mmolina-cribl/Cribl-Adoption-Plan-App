# Cribl Adoption Plan Tool Roadmap

This roadmap is the project-facing source of truth for **ongoing programs** and
**upcoming themes**. It is intentionally lightweight: items here come from real
CSE / PS usage and feedback, but they are not committed delivery dates.

Detailed implementation history belongs in [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md);
version-scoped summaries belong in `build/v*.*.*-release-notes.md`. This file
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
  agent-assisted modeling**, **import from live environments**, **push plan to env
  via agent**, Activation, tile alignment with Cribl-as-Code).

---

## Recently delivered

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
- **On-prem one-pager:** [`docs/standalone-on-premises.md`](./docs/standalone-on-premises.md)
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

- **Pre-release checklist:** [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md) now
  requires skimming **Cribl Stream / Edge / What’s New** release notes before
  tagging so `referenceData` tiles stay aligned with the product.

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
  [`docs/standalone-on-premises.md`](./docs/standalone-on-premises.md) or add
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

## Not Currently Planned

- Replacing the Adoption Plan Excel workbook as the handoff artifact.
- Multi-user collaboration inside the standalone HTML build.
- A customer-facing hosted service/SaaS version.
