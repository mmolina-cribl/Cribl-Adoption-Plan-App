# Cribl Adoption Plan

A field-facing planning tool for designing a customer's
[Cribl Stream](https://cribl.io/stream/) and
[Cribl Edge](https://cribl.io/edge/) adoption — model worker groups,
fleets, sources, and projected daily volume in one place.

The app ships in **two flavors from the same codebase**:

- **Cribl App Platform install** (`.tgz`) — the primary deployment,
  embedded inside Cribl Cloud / Cribl on-prem tenants that have the
  [App Platform](https://docs.cribl.io/dev/) enabled. State persists to
  the platform's per-app KV store.
- **Standalone HTML file** (`.html`) — a single self-contained file for
  customers running on-prem **without** the App Platform. Double-click
  to open in any modern browser; state persists to `localStorage`. The
  `.xlsx` Export is the canonical save path — see
  [Standalone deployment](#standalone-deployment) below.

> "Your end-to-end Cribl Stream and Edge rollout in one place — the
> worker groups and fleets, the sources feeding them, and the daily
> volume each one contributes."

> **v2.0 shipped.** Full alignment to the v0.9.1 gold Excel template
> (per-WG sheets, Stream + Edge overviews, PS Use Case Worksheet),
> Activation page, kind-aware resource maps, multi-sheet exporter with
> OOXML-level style fidelity, the `wg-<name>` / `fl-<name>` sheet
> naming scheme (back-compat import for legacy `wg<name>` /
> `fl<name>_fleet` workbooks), grouped tab order on cloned scaffolds,
> the standalone HTML deployment target for on-prem use, and a small
> batch of UX polish (inline customer-name pencil edit on the hero,
> dismissible Activation callout, Plan as default landing). See
> [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md#v20-schema-rewrite-gold-v091)
> for the full design history (PRs A–D).

## What it does

- **Plan dashboard** — A snapshot view of total ingest, worker-group
  breakdown, recent sources, and onboarding status (Planned, In Progress,
  Complete).
- **Interactive resource maps** — Tree visualizations of how sources flow
  into worker groups. Drag a source onto a worker group to attach it,
  click the × badge on a connector to detach it, and search the
  unassigned bucket to find what to wire up next. Available both
  plan-wide (one map across every WG) and per-worker-group (the WG-detail
  page).
- **Worker groups** — Capacity (ingest / egress / throughput / 1-day
  storage), worker count, hosting taxonomy, and an editable topology
  detail. Bulk-edit hosting, clear capacity overrides, duplicate, or
  delete from the index page's Bulk Actions popover.
- **Sources** — Per-source volume, criticality, compliance flag,
  onboarding window, source-tile catalog, and a free-text detail
  paragraph. Bulk-assign worker groups, criticality, context (On-Prem /
  Cloud), or compliance from the index page.
- **Excel round-trip** — Import an existing `.xlsx` to seed the plan;
  Export a styled, Cribl-branded workbook (INSTRUCTIONS, PS Use Case
  Worksheet, Stream Overview, per-WG `wg-<name>` sheets, Edge Overview,
  per-fleet `fl-<name>` sheets, input_data) using the imported file as
  the visual shell so the download is indistinguishable from a
  hand-edited copy of the gold v0.9.1 template.
- **Animations preference** — Subtle entry animations on bars, donuts,
  and connector lines, with a Settings toggle (and automatic respect for
  OS-level `prefers-reduced-motion`).
- **Import from live tenant** — When running inside the Cribl App Platform,
  **File → Import** can bootstrap worker groups / fleets and **configured sources**
  from Leader APIs (`/master/groups` and per-group **`/m/{group}/system/inputs`**). When `/master/groups` returns **`estimatedIngestRate`**, **`cloud`**, or **`onPrem`**, the app pre-fills **worker detail / hosting hints** (MB/s tier line — not GB/day workbook numbers). Leader input **`description`** is copied into source **additional notes**.
  After a successful run, expand **Import debug** for per-group input counts, an
  **Imported sources** table (labels, collector types, WG), harvest warnings, and
  copyable JSON. Routing (pipelines / destinations) is **not** imported—fill that in the plan or Excel as usual.
  For a full **Leader vs plan** field matrix (what can be pulled, what we use, what we ignore), see
  [`docs/tenant-import-leader-data.md`](./docs/tenant-import-leader-data.md).
- **Import from diagnostic bundle** — **File → Import** accepts a Cribl Stream/Edge
  **`.tar.gz` / `.tgz`** diagnostic bundle and parses `groups/<id>/…/inputs.yml` in
  the browser (no Leader call). On **Cribl.Cloud**, Leader-oriented diagnostics differ from **self-managed** (where you can also create **per-worker** bundles); **live tenant import** is usually the easiest way to hydrate the full topology there. Scope and limits: [`docs/diag-import.md`](./docs/diag-import.md).
- **Activation** (Plan nav) — In-app **PS Use Case Worksheet** (tier, base scope, use-case overview, per-use-case parameters) aligned to the Excel sheet of the same name.
- **Summary** (Plan nav) — **executive summary**: stakeholder narrative, provenance, and the **full**
  worker-group and source inventory; **Download summary (.md)** and **Download workbook (.xlsx)** on the page.
  Optional **AI-assisted talking points** use the same optional OpenAI API key as the assistant (bring your own key): the app sends a **capped JSON**
  snapshot of the plan (large source lists may be sampled with explicit omit counts in the payload). Anyone editing the plan can generate this content. Generated Markdown
  is stored on the plan, shown on the Summary page, and appended to the downloaded `.md` with a fixed disclaimer — always
  verify against the full inventory tables and workbook before sharing outside your organization.
- **AI ASSISTANT (right rail)** — Optional BYOL OpenAI (`gpt-4o-mini`) using
  `config/proxies.yml` + KV per AGENTS.md; sends a compact JSON plan digest for
  grounded suggestions. On large screens, drag the rail’s **left** edge to resize (width is persisted like the plan sidebar).

## Quick start

```bash
# Install
npm install

# Run the dev server (http://localhost:5173)
npm run dev

# Production build (Cribl App Platform target)
npm run build

# Production build (standalone HTML target)
npm run build:standalone

# Lint
npm run lint

# Build + bundle into a Cribl App Platform .tgz under ./build
npm run package
```

## Build targets

The repo has two production build configs that share every line of
source code; the only difference is what comes out of `dist/`:

| Target          | Command                       | Output                                          | Persistence    | Use case                                                                      |
| --------------- | ----------------------------- | ----------------------------------------------- | -------------- | ----------------------------------------------------------------------------- |
| Cribl App       | `npm run build` → `npm run package` | `build/adoption-plan-<version>.tgz`             | KV store       | Upload via **Settings → Apps → Install** on a Cribl Cloud or on-prem tenant   |
| Standalone HTML | `npm run build:standalone`    | `dist-standalone/cribl-adoption-plan.html` (single file) | `localStorage` | On-prem customers without the App Platform — no install, no server, no Node   |

The standalone build inlines the gold v0.9.1 Excel template
(`public/adoption-plan-empty.xlsx`) into the HTML as a base64 string at
build time, so Export and Import work the same way they do inside the
Cribl iframe — no fetch, no server, no extra files to ship alongside
the `.html`.

## Standalone deployment

The single HTML file is the entire deliverable. Hand it to a customer
the way you'd hand them a PDF:

1. Run `npm run build:standalone`.
2. Send the customer
   `dist-standalone/cribl-adoption-plan.html` (~2.2 MB / ~720 KB
   gzipped — comfortable to email).
3. They double-click the file. It opens in their default browser via
   `file://` and works immediately. No Node, no `npm`, no IT-side
   allowlist.

For a **short customer- and security-facing summary** (purpose, data boundaries,
network) covering **both** standalone HTML and the **Cribl App Platform** install,
see [`docs/adoption-plan-tool-one-pager.md`](./docs/adoption-plan-tool-one-pager.md).
The legacy filename [`docs/standalone-on-premises.md`](./docs/standalone-on-premises.md)
redirects to the same material.

For **Cribl Copilot / Cribl AI** vs **BYOL** options from an App Platform iframe,
see [`docs/copilot-integration-research.md`](./docs/copilot-integration-research.md)
(public-doc summary, APM reference protocol, `/ai/*` verification snippet, and
internal stakeholder questions).

A few UX notes worth setting expectations on:

- **`localStorage` is path-scoped under `file://`.** If a customer
  moves the `.html` to a different directory (or someone else opens a
  copy from a different location), the saved plan **does not follow**.
  Treat the **Excel Export** as the canonical save path — it always
  has been — and treat `localStorage` as session continuity within a
  given file location.
- **No KV-backed multi-user.** There is no shared state across browser
  profiles, machines, or files. The standalone build is single-user
  by design; share via Excel Export / Import.
- **Same UI, same code paths.** The KV helper detects
  `window.CRIBL_API_URL === undefined` and routes every read/write to
  `localStorage` — there is no separate "lite mode."

## Cribl Apps `__local__` dev shell (known limitation)

The platform’s **`__local__`** shell is for engineering only — **customers use a
deployed installed pack**, which has pack KV and reliable plan persistence.

In **`__local__`**, plan state (including after **Import from live tenant**) **may
not survive a full page reload**: there is no pack KV, and browser storage can be
unavailable or unreliable inside the sandboxed iframe. For QA, use a **deployed**
app, or download **Export** / **Summary → Download workbook** as your snapshot.
Details: [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md) (*Known issue — plan persistence in the `__local__` shell*).

## Running outside the Cribl iframe (dev only)

When `window.CRIBL_API_URL` is not defined (i.e. you're hitting the
dev server directly via `npm run dev`), the KV store helper
transparently falls back to `localStorage` with the same namespacing
it uses inside the iframe. So local development persists state across
hard refreshes without any config — just open the dev URL and edit.
This is the same fallback the standalone build relies on at runtime.

## Importing an existing plan

`File → Import` accepts `.xlsx` files in the same shape this app
exports (the v0.9.1 gold template). The workbook's bytes are cached in
memory and re-used as the visual shell on the next Export, so styles,
themes, merges, the per-WG conditional formatting, and the
`input_data` validation tab survive the round-trip.

The importer also accepts the **legacy** v0.9.0-era sheet names
(`wg<name>` / `fl<name>_fleet`) so workbooks produced by older copies
of this app still seed cleanly — see
[`src/lib/v091SheetNames.ts#classifyV091SheetName`](./src/lib/v091SheetNames.ts).

If no import has been done in the current session, Export falls back to
the bundled empty shell at `public/adoption-plan-empty.xlsx` (Cribl
App build) or its base64-inlined twin (standalone build). There is no
plain-XLSX path: that build is ~1.5× larger, unstyled, and easy to
mistake for a real export.

## Exporting

Use **Export** in the sidebar (below **Import**), or open **Summary** under **Plan** and use **Download workbook**, to download a file named:

```
<customer name> Adoption Plan - MM-DD-YYYY.xlsx
```

…using the customer name from the header (set in the top-right) and
today's local date. The customer name is also written to the workbook's
`Props.Title` metadata.

## Project layout

```
src/
  App.tsx                    Top-level route + view switch
  components/                React UI
    PlanDataOverview.tsx     Plan tab dashboard
    PlanResourceMap.tsx      Plan-wide drag/drop resource map
    WorkerGroupDetailView.tsx Per-WG detail (Resource map, Capacity, Topology, …)
    WorkerGroupResourceMap.tsx Per-WG drag/drop resource map
    SourcesIndexView.tsx     Sources index + bulk actions
    WorkerGroupsIndexView.tsx Worker Groups index + bulk actions
    SearchInput.tsx          Reusable search field with leading magnifier + clear ×
    AnimatedBar.tsx          Reusable progress-bar entry animation
    HeaderCustomerName.tsx   Top-right customer name (click-to-edit pencil)
    SettingsView.tsx         User preferences (animations, OpenAI API key for assistant, etc.)
    …                        Add/Confirm dialogs, form controls, etc.
  hooks/
    usePlanStorage.ts        KV-backed plan state hook (gates UI on initial read)
    …
  lib/
    kvStore.ts               Per-user-namespaced KV with localStorage fallback
    animationsPreference.ts  Animations on/off (KV-backed) + useEntryAnimation hook
    detailCardsPreference.ts Detail-card open/closed state (KV-backed)
    workbookDownload.ts      Build + download the .xlsx blob
    importWorkbook.ts        Parse a workbook into PlanState
    exportWorkbook.ts        Build a workbook from PlanState
    adoptionPlanShellExceljs.ts  ExcelJS in-place fill that preserves styles
    shellOoxmlStyleMerge.ts  OOXML-level patch for source-body fonts
    formatRate.ts            Canonical GB/d ↔ TB/d formatter
    onboardingStatus.ts      Onboarding status palette + counter
    workerGroupRollup.ts     Capacity / volume aggregation per WG
    planDashboardStats.ts    Snapshot stats for the Plan dashboard
    planWorkbookLayout.ts    Sheet names + header layouts shared across import/export
    v091ExportWorkbook.ts    v0.9.1 multi-sheet exporter (per-WG sheets, overviews, PSU CW)
    v091ExportSheetRestore.ts OOXML-level style fidelity restoration after ExcelJS write
    v091SheetNames.ts        wg-/fl- sheet name derivation + legacy-form classifier
    adoptionPlanTemplateExport.ts Build-flavor-aware gold template loader
    activationCalloutPreference.ts Plan-dashboard activation nudge dismissal (KV-backed)
    …
  data/
    planDataMap.ts           Sheet → role mapping shown on the Export page
    referenceData.ts         input_data picklists + INSTRUCTIONS copy
  types/
    planTypes.ts             PlanState, SourceSummaryRow, WorkerGroupRow, Activation
    criblGlobals.d.ts        Window-level Cribl App Platform globals
    virtualModules.d.ts      Build-time virtual module declarations (embedded gold)
  assets/
    cribl-ai-icon.png        Cribl AI mark, imported via Vite (inlined in standalone build)
config/
  proxies.yml                External-domain allowlist (currently empty)
public/
  adoption-plan-empty.xlsx   v0.9.1 gold shell used when no import is in memory
                             (fetched at runtime in the App build, base64-inlined in standalone)
  favicon.svg                Tab icon (App build only — stripped from the standalone HTML)
scripts/
  package.mjs                Build + tarball for the Cribl App Platform installer
  pkgutil.mjs                Tar/gzip plumbing
vite.config.ts               Cribl App Platform build (the primary target)
vite.standalone.config.ts    Standalone single-HTML build (vite-plugin-singlefile + inlined gold)
```

See [`AGENTS.md`](./AGENTS.md) for the **Cribl App Platform Developer
Guide** (fetch proxy rules, KV API shape, `proxies.yml` schema, etc.),
[`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md) for engineering-side
decisions referenced from inline code comments (KV hydration strategy,
user-identity gap, Excel round-trip rationale, GB/d rounding rules), and
[`ROADMAP.md`](./ROADMAP.md) for upcoming project themes such as Edge
subfleet support.

## Versioning

Standard semver, in lockstep between `package.json` and
`package-lock.json`. Both build targets share the same version (one
source of truth in `package.json`). Recent history:

- **2.0.x** — Gold v0.9.1 alignment. Per-WG sheets (`wg-<name>` for
  Stream, `fl-<name>` for Edge), Stream + Edge overviews, PS Use Case
  Worksheet round-trip, multi-sheet `.xlsx` exporter with OOXML-level
  style fidelity, kind-aware resource maps, Activation page (tier
  picker, base-scope checklist, use-case overview + worksheet board),
  standalone HTML build for on-prem deployment, and UI polish (Plan
  hero pencil-edit customer name, dismissible Activation callout,
  Plan as default landing).
- **2.3.x** — Tenant import from Leader, Summary / executive readout, AI assistant session modes and plan patches, diagnostics import, centered Import/Export/Settings layout, Settings **Credits** + **README** thank-you (three contributors); see [`docs/releases/v2.3.0.md`](./docs/releases/v2.3.0.md) and [`ROADMAP.md`](./ROADMAP.md).
- **1.3.x** — Interactive resource maps, animations preference,
  full-card click targets, header redesign, dated export filename,
  reusable `SearchInput` component.
- **1.2.x** — Source-tile catalog refresh, sortable Sources index,
  onboarding-completion bar.
- **1.1.x** — Filter + Bulk Actions popovers, hosting taxonomy,
  Topology section.
- **1.0.x** — First stable release.

Tagged commits live on `main`; the App-Platform release is the `.tgz`
produced by `npm run package`, and the on-prem release is the `.html`
produced by `npm run build:standalone`.

## Author

Michael Molina — Cribl Sr. CSE.

## Credits:

Thank you to [dadamic@cribl.io](mailto:dadamic@cribl.io), [rallen@cribl.io](mailto:rallen@cribl.io), and [jdeslauriers@cribl.io](mailto:jdeslauriers@cribl.io) for sharing early feedback on adoption planning challenges from the field. That perspective helped shape early versions of this app for teams planning Cribl deployments.