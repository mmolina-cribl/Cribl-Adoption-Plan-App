# Cribl Adoption Plan

A field-facing planning tool for designing a customer's
[Cribl Stream](https://cribl.io/stream/) and
[Cribl Edge](https://cribl.io/edge/) adoption — model worker groups,
fleets, sources, and projected daily volume in one place. The app runs
embedded inside the [Cribl App Platform](https://docs.cribl.io/dev/) but
also works standalone in a browser for local development.

> "Your end-to-end Cribl Stream and Edge rollout in one place — the
> worker groups and fleets, the sources feeding them, and the daily
> volume each one contributes."

> **v2.0 in progress.** The app is being aligned to the v0.9.1 gold
> Excel template (per-WG sheets, Stream + Edge overviews, PS Use Case
> Worksheet). PR A — data model alignment — is what `2.0.0-rc.1` ships;
> the multi-sheet I/O rewrite (PR B) and PS Use Case Worksheet (PR C)
> follow. See [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md#v20-schema-rewrite-gold-v091)
> for the full plan.

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
  Export a styled, Cribl-branded workbook (Source summary, input_data,
  Sources and WGs topology, INSTRUCTIONS) using the imported file as the
  visual shell so the download is indistinguishable from a hand-edited
  copy of the gold template.
- **Animations preference** — Subtle entry animations on bars, donuts,
  and connector lines, with a Settings toggle (and automatic respect for
  OS-level `prefers-reduced-motion`).

## Quick start

```bash
# Install
npm install

# Run the dev server (http://localhost:5173)
npm run dev

# Production build
npm run build

# Lint
npm run lint

# Build + bundle into a Cribl App Platform .tgz under ./build
npm run package
```

The `package` script produces `build/adoption-plan-<version>.tgz`, which
is what you upload via **Settings → Apps → Install** on a Cribl Cloud or
on-prem tenant.

## Running outside the Cribl iframe

When `window.CRIBL_API_URL` is not defined (i.e. you're hitting the dev
server directly), the KV store helper transparently falls back to
`localStorage` with the same namespacing it uses inside the iframe. So
local development persists state across hard refreshes without any
config — just open the dev URL and edit.

## Importing an existing plan

`File → Import` accepts `.xlsx` files in the same shape this app exports
(or the same shape as the v0.8.6 "Copy of Adoption plan" gold template).
The workbook's bytes are cached in memory and re-used as the visual
shell on the next Export, so styles, themes, merges, and the
`input_data` validation tab survive the round-trip.

If no import has been done in the current session, Export falls back to
a bundled empty shell at `public/adoption-plan-empty.xlsx`. There is no
plain-XLSX path: that build is ~1.5× larger, unstyled, and easy to
mistake for a real export.

## Exporting

`File → Export` produces a file named:

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
    SettingsView.tsx         User preferences (animations, etc.)
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
    …
  data/
    planDataMap.ts           Sheet → role mapping shown on the Export page
    referenceData.ts         input_data picklists + INSTRUCTIONS copy
  types/
    planTypes.ts             PlanState, SourceSummaryRow, WorkerGroupRow
    criblGlobals.d.ts        Window-level Cribl App Platform globals
config/
  proxies.yml                External-domain allowlist (currently empty)
public/
  adoption-plan-empty.xlsx   v0.8.6 empty shell used when no import is in memory
scripts/
  package.mjs                Build + tarball for the Cribl App Platform installer
  pkgutil.mjs                Tar/gzip plumbing
```

See [`AGENTS.md`](./AGENTS.md) for the **Cribl App Platform Developer
Guide** (fetch proxy rules, KV API shape, `proxies.yml` schema, etc.) and
[`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md) for engineering-side
decisions referenced from inline code comments (KV hydration strategy,
user-identity gap, Excel round-trip rationale, GB/d rounding rules).

## Versioning

Standard semver, in lockstep between `package.json` and
`package-lock.json`. Recent history:

- **1.3.x** — Interactive resource maps, animations preference, full-card
  click targets, header redesign, dated export filename, reusable
  `SearchInput` component.
- **1.2.x** — Source-tile catalog refresh, sortable Sources index,
  onboarding-completion bar.
- **1.1.x** — Filter + Bulk Actions popovers, hosting taxonomy,
  Topology section.
- **1.0.x** — First stable release.

Tagged commits live on `main`; releases are the `.tgz` produced by
`npm run package`.

## Author

Michael Molina — Cribl Sr. CSE.
