# Cribl Adoption Plan — Engineering Notes

Companion document to inline `// see CRIBL_DEV_NOTES.md` references in the
codebase. Captures the decisions and platform realities behind the
non-obvious bits — KV hydration strategy, the user-identity gap inside
the iframe, the Excel round-trip approach, Vite + Cribl `?init=` /
`localStorage` sandbox pitfalls, and a few smaller display contracts.

For platform-level rules (fetch proxy, KV REST shape, `proxies.yml`),
see [`AGENTS.md`](./AGENTS.md). For a feature-level overview, see
[`README.md`](./README.md). For **customer / security one-pager** messaging (standalone **and** cloud Apps),
see [`docs/adoption-plan-tool-one-pager.md`](./docs/adoption-plan-tool-one-pager.md)
(standalone-only pointer: [`docs/standalone-on-premises.md`](./docs/standalone-on-premises.md)). For
**Cribl Copilot / Cribl AI integration research** (APM reference, `/ai/*` spike
snippet, internal questions for platform/AI), see
[`docs/copilot-integration-research.md`](./docs/copilot-integration-research.md).

---

## Before tagging any release — Cribl product release notes

Before you cut a build customers will treat as “current with Stream/Edge,” skim
recent **Cribl product** release notes so you can decide whether this repo needs
a follow-up change (new or renamed sources/destinations, deprecations, defaults
that affect planning conversations):

- [Cribl Stream release notes](https://docs.cribl.io/stream/release-notes/)
- [Cribl Edge release notes](https://docs.cribl.io/edge/release-notes/)
- [What’s New](https://docs.cribl.io/whats-new/) (cross-product highlights)

If a release introduces tiles, destinations, or topology concepts you expect on
adoption plans, update [`src/data/referenceData.ts`](./src/data/referenceData.ts)
(and wizard or export copy if needed) in the same release or an immediate patch,
then note it in `docs/releases/vX.Y.Z.md`. When you intentionally align to a
specific **Cribl product** semver, add or refresh the row in
[`ROADMAP.md`](./ROADMAP.md) (**Cribl product versions (alignment log)**).

---

## Release checklist (Cribl App `.tgz`)

Before tagging a release that ships **`npm run package`**:

1. Run **`npm run package`** from a clean tree (or at least after `npm run build`).
2. Install the `.tgz` on a tenant (or unpack `static/` locally) and open the app **without** importing a workbook.
3. Use **Export** in the sidebar (or **Summary → Download workbook**) and confirm a **styled** `.xlsx` downloads (gold template **`adoption-plan-empty.xlsx`** must sit beside **`index.html`** under `static/`; the app resolves it relative to the document URL).
4. **File → Import** a known-good v0.9.1 export from the previous release, make a small edit, export again, and spot-check key sheets.
5. Record outcomes in **`build/vX.Y.Z-release-notes.md`**.

---

## Release checklist (GitHub — on‑prem standalone HTML)

On‑prem customers use the **single-file** build from GitHub, not the App Platform
`.tgz`. Every **public GitHub release** they might hand to a customer **must**
include the standalone artifact on the release page:

1. From a clean tree at the tagged commit, run **`npm run build:standalone`**
   (output: **`dist-standalone/cribl-adoption-plan.html`** — see [`README.md`](./README.md#standalone-deployment)).
2. Upload it to the GitHub release, for example:
   `gh release upload vX.Y.Z dist-standalone/cribl-adoption-plan.html --repo <owner>/<repo>`
   (use the same tag as the release).

`dist-standalone/` is gitignored; the HTML is **not** committed — it is only a
build artifact and a **release asset**.

---

## Decision 1 — KV hydration strategy

**Problem.** The Cribl App Platform's KV store is a remote service. A
read takes ~50–200 ms on the first call after the iframe mounts, more
on a cold tenant. We need a strategy that doesn't make the whole UI
flicker between "empty default plan" and "user's actual plan" on every
hard refresh.

**Rule.**

| State family | Strategy | Rationale |
|---|---|---|
| **Main plan** (`PlanState`) | **Gate the entire UI** on the initial `kvGet`. While loading, render a small spinner — never the empty default. | Flashing an unpopulated plan to a populated one is jarring; users see lists, sources, and worker groups appear out of nowhere. Gating costs one paint on cold load and is invisible on warm reloads (KV cache). |
| **Small UI prefs** (rail width, detail-card open/closed, animations on/off, post-add wizard choice, default landing page) | **Flash-of-default**, then settle. Render the default value synchronously on first paint; resolve the real value via the in-memory cache populated by a background `kvGet`. | A 50 ms blip on a sidebar width is benign; a 50 ms blip on the entire dashboard's contents is not. The tradeoff is asymmetric, so the strategy is too. |

**Wired by.** [`src/hooks/usePlanStorage.ts`](./src/hooks/usePlanStorage.ts)
(plan: gated), and the `*Preference.ts` modules under
[`src/lib/`](./src/lib/) (small prefs: synchronous in-memory cache hydrated
in the background).

The pattern for a small pref is:

```ts
let value: T = DEFAULT_VALUE
const listeners = new Set<(v: T) => void>()

void (async () => {
  value = await kvGet<T>(KEY, DEFAULT_VALUE)
  for (const fn of listeners) fn(value)
})()

export function useValue(): T {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((n) => n + 1)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  return value
}
```

This gives every component in the tree a synchronous read with the right
default, plus a re-render the moment the real value arrives — without
gating render on `await`.

---

## User identity inside the iframe — confirmed gap

**Status as of 2026-04-28:** the Cribl App Platform does **not** expose
the current user's identity to embedded apps in any documented form.
There is no global on `window`, no header echoed back from the proxy,
and no documented `/users/me` endpoint that an app can hit through the
fetch proxy.

**Why this matters here.** KV is per-app, **shared across all users on
the tenant**. Two CSEs at the same Cribl Cloud tenant who both
`PUT /kvstore/plan` on the Adoption Plan app would silently overwrite
each other's draft.

**Mitigation.** Every key is silently namespaced by
[`src/lib/kvStore.ts`](./src/lib/kvStore.ts) as
`users/<userId>/<logical-key>`. Call sites pass `plan`,
`prefs/rail/px`, `prefs/aiRail/px`, etc. and don't see the prefix. This means the moment
we *can* identify the user, we flip a single function and all reads
and writes route correctly without changing any caller.

```ts
// TODO(per-user-scoping): swap this stub for a real call to the user-info
// endpoint once the platform team confirms the path. For the dev tenant
// (single user) `'default'` is safe; for multi-user deployment this MUST
// be replaced or two CSEs will overwrite each other's KV data.
function getCurrentUserId(): string {
  return 'default'
}
```

**Customer name.** Because we can't read the identity of the user
filling the plan in, the customer name in the header is captured as
free text (placeholder `e.g. Cribl`). This is also semantically right —
the customer name in the workbook is the **customer's** organization,
not the user's. The header field is the source of truth; the export
filename and the `Props.Title` metadata both consume it.

---

## Excel round-trip — shell strategy

The Adoption Plan workbook customers receive is a styled, branded thing
with merged cells, a custom theme, an `input_data` validation tab, and
an INSTRUCTIONS sheet. It looks identical to a hand-edited copy of the
gold v0.8.6 template. None of that survives a naive
`xlsx.write(workbook)` round-trip — the community `xlsx` package
re-emits a stripped-down OOXML that drops styles, themes, and merges.

**Approach (`src/lib/adoptionPlanShellExceljs.ts`).**

1. Always start from a **shell**: either the bytes of the user's last
   imported workbook ([`src/lib/importShellStore.ts`](./src/lib/importShellStore.ts)),
   or the bundled empty template at
   [`public/adoption-plan-empty.xlsx`](./public/adoption-plan-empty.xlsx).
2. Open it in **ExcelJS** (which preserves themes, styles, and merges).
3. Fill in the `Source summary` and `Copy of Sources and WGs` cells **in
   place**, leaving every other byte alone.
4. Run a small OOXML-level patch (`shellOoxmlStyleMerge.ts`) over the
   result to remap topology source-body cell styles back to the 10pt
   body font. ExcelJS' style writer can't be coaxed into matching the
   gold template's `cellXfs` table for that one corner.
5. Return the buffer for download.

There is **no** plain-XLSX fallback path. If the shell can't be loaded,
Export throws `ExportShellUnavailableError` with an actionable message
("re-import your Copy of Adoption plan"). Reason: a plain build is ~1.5×
the size, unstyled, missing `input_data`, and easy to mistake for a
real export. Better to fail visibly.

**Filename.** `<customer name> Adoption Plan - MM-DD-YYYY.xlsx`,
sanitized for filesystem-illegal characters and falling back to
`Adoption Plan - MM-DD-YYYY.xlsx` if the customer name is empty.
See [`src/lib/workbookDownload.ts`](./src/lib/workbookDownload.ts).

---

## Step 19 — v1.2 GB/d rounding pass

The pre-1.2 codebase had ~6 different formatters that disagreed on
where the GB ↔ TB threshold sat, whether to round half-up or half-even,
and whether sub-1-GB values should display as `0`, `0.1`, or `<1`. The
v1.2 rounding pass collapsed every site onto
[`src/lib/formatRate.ts`](./src/lib/formatRate.ts) and pinned the
display contract:

| Input (GB/d) | Display | Why |
|---|---|---|
| invalid / negative / `NaN` | `— GB/d` | Distinguishable from a real zero |
| `0` | `0 GB/d` | An explicit zero is a real signal |
| `0 < x < 1` | `x.xx GB/d` (2 decimals) | Sub-GB values don't all collapse to `0` |
| `1 ≤ x < 1000` | `x GB/d` (no decimals) | Customer conversations round to whole GB |
| `x ≥ 1000` | `(x/1000) TB/d` (2 decimals max) | 1 TB = 1000 GB (decimal, matches cloud-vendor quotes) |

**`Math.round` (half-away-from-zero), not banker's rounding.** Stated
example: `100.7 → 101`, `100.3 → 100`. `Intl.NumberFormat`'s default is
half-even, which violates the example, so we round explicitly and use
`toLocaleString` only for thousands separators and trailing-zero
suppression.

`1 TB = 1000 GB`, not 1024. Adoption planning is a customer-facing
exercise; everyone speaks decimal TB.

---

## Resource map design (v1.3)

Two parallel components, sharing approach but not code:

- [`src/components/PlanResourceMap.tsx`](./src/components/PlanResourceMap.tsx) —
  every WG and its sources, with each WG group expandable into a
  per-source list.
- [`src/components/WorkerGroupResourceMap.tsx`](./src/components/WorkerGroupResourceMap.tsx) —
  one WG hub on the right, its sources fanning in from the left, plus
  a separate Unassigned section that doubles as a drop target for
  detaching.

**Shared techniques.**

- **SVG branches** drawn as cubic Bézier paths between source-card
  centers and the WG hub center, computed off `getBoundingClientRect()`
  measurements and re-measured on `ResizeObserver` ticks.
- **Draw animation on entry**: each path uses `pathLength={1}` plus
  `strokeDasharray={1}` and animates `strokeDashoffset` from `1` to `0`
  over ~800 ms, gated by [`useEntryAnimation`](./src/lib/animationsPreference.ts).
  In the Plan map, summary branches revert to `strokeDasharray="5 5"`
  after the draw completes so the dashed style is preserved.
- **Drag-and-drop** via custom pointer handlers (no HTML5 DnD — we need
  the rubber-band line in the foreground and full control over the
  drop-target highlight). Drag origin: a small dot on the right edge
  of unassigned source cards, or any source card connected to a WG
  (drag retargets it). Drop targets: every WG card except the source's
  origin group, plus the Unassigned section (detaches).
- **Hover cooldown** (220 ms) on the WG card's "↦ source" panel so
  quick swipes between adjacent connectors don't slam it shut
  mid-transition.
- **Drop-here dot** on the left edge of every WG card the moment a drag
  starts, growing brighter when the cursor is over the card.
- **`role="button"` on cards** rather than `<button>` because the
  connector × badge and the drag handle are real `<button>`s and
  nesting `<button>` inside `<button>` is invalid HTML. Keyboard
  activation (Enter/Space) is wired by hand.

---

## Animations preference

[`src/lib/animationsPreference.ts`](./src/lib/animationsPreference.ts)
exposes:

- `getAnimationsEnabled()` / `setAnimationsEnabled(v)` — synchronous
  in-memory cache, KV-backed (Decision 1 small-pref pattern).
- `useAnimationsEnabled()` — React hook that re-renders consumers when
  the value changes (used by the Settings page toggle).
- `useEntryAnimation()` — one-shot `off → on` edge for CSS transitions.
  Returns `{ animated, enabled }` where `animated` is `false` for the
  first paint and flips to `true` on the next double-RAF, giving the
  browser a clean state transition to animate against. Respects
  OS-level `prefers-reduced-motion` automatically.

The hook deliberately does **not** re-trigger when the user toggles the
preference mid-session — toggling on after a chart already settled
would replay the entry animation on every preference change. The new
behavior takes effect on the next navigation that remounts the chart.

Used by: `AnimatedBar`, `MiniBars`, `DonutChart` (in both
`PlanDataOverview` and `WorkerGroupDetailView`), `ProgressMini`,
`AnimatedBar`, and the resource maps' connector draws.

---

## Default landing page

The app boots into the **Plan** tab (`mainView = 'overview'`). Earlier
builds defaulted to Sources, but the Plan tab gives a first-time visitor
the highest-density introduction to what they're looking at — the
resource map plus the dashboard widgets — so it's the one we lead with.

If you change this, also update the hero blurb in
[`src/components/PlanDataOverview.tsx`](./src/components/PlanDataOverview.tsx)
which assumes the user lands here.

---

## v2.0 schema rewrite (gold v0.9.1)

The Cribl Professional Services team ships a new gold Excel template
periodically. v0.9.1 (April 2026) is a structural break from v0.8.6:

| Concern | v0.8.6 | v0.9.1 |
|---|---|---|
| Per-source data | one `Source summary` sheet for the whole plan | one sheet per worker group / fleet (`wg-<name>` for Stream, `fl-<name>` for Edge — see PR D for the rename rationale; PR B initially shipped the `wg<name>` / `fl<name>_fleet` form) |
| Topology overview | one `Copy of Sources and WGs` sheet | inferred top-of-file `Stream Overview` (rolled up from `wg-*` sheets) + `Edge Overview` (rolled up from `fl-*` sheets) |
| Activations | not modeled | new `PS Use Case Worksheet` with tier (Silver / Gold / Platinum), base scope, and use-case board |
| Region semantics | `Region(s)` (cloud-region biased) | `Physical location(s)` (Edge fleets can live on hosts, not regions) |
| Migration source field | only present on the topology sheet | promoted to the per-WG sheet as `Current Collection` |
| Per-source columns dropped | n/a | only `Display name` and `Additional notes`. The "value lever" fields (Operational / Risk Reduction / Strategic / Onboarding Effort / Politics) **stay** on every per-WG / per-Fleet sheet — an early read of the gold based on a stale `SAMPLE` sheet incorrectly suggested they were dropped. |

The app's response is a major version bump (`v2.0.0`), originally
planned as three sequential PRs so each landed as a reviewable,
releasable slice. A fourth (PR D) followed during release polish to
restore export-time style fidelity, rename the per-WG sheets, and
add the standalone HTML build target — all backwards-compatible
additions, all merged before the `v2.0.0` GitHub release:

### PR A — `feat/v2.0-rc.1-data-model` (this PR)

**Scope.** Align the in-app data model and left-nav structure to
v0.9.1's worker-group / fleet split, without yet changing the Excel
format.

Data model changes (see [`src/types/planTypes.ts`](./src/types/planTypes.ts)):

- `SourceSummaryRow` drops 2 fields (`displayName`, `additionalNotes`).
  The 5 "value lever" fields (`operational`, `riskReduction`,
  `strategic`, `onboardingEffort`, `politics`) **stay** — they are
  still on every per-WG / per-Fleet sheet of the gold v0.9.1 template.
- `regions` → `physicalLocations`. New `currentCollection` field.
- `WorkerGroupRow` gains `kind: 'stream' | 'edge'`. `'stream'` is the
  default and what every imported v0.8.6 row, hydrated v1.x KV blob,
  and "Add Worker Group" click produces. `'edge'` is reserved for the
  new "Add Fleet" flow.
- New `sourceLabel(row, index)` helper replaces every inline
  `row.displayName?.trim() || \`Source N\`` fallback. The Source field
  is now the row's identity — the inline pencil in the source detail
  view writes back to `source` directly.

UI changes:

- [`PlanSidebar`](./src/components/PlanSidebar.tsx) splits the worker-
  group section into two parallel sections (`Worker Groups` + `Fleets`).
  Each has its own header, list, chevron, and add button. The add
  button passes the section's `kind` to the parent so the dialog
  reuses the same component with kind-aware copy.
- [`AddWorkerGroupDialog`](./src/components/AddWorkerGroupDialog.tsx)
  now takes a `kind` prop. Title / placeholder / submit-button copy
  switch between "worker group" and "fleet" automatically.
- [`WorkerGroupsIndexView`](./src/components/WorkerGroupsIndexView.tsx)
  is parameterized by `kind` (defaults to `'stream'`). Mounted twice
  in [`App.tsx`](./src/App.tsx): once at `mainView === 'workerGroups'`
  with `kind="stream"`, once at `mainView === 'fleets'` with
  `kind="edge"`. Empty-state copy, search placeholder, bulk-action
  confirms, and unnamed-row fallback all switch on the prop.
- The wizard catalog
  ([`src/components/sourceForm/sourceFormWizardFieldCatalog.ts`](./src/components/sourceForm/sourceFormWizardFieldCatalog.ts))
  adds 2 new steps for `physicalLocations` and `currentCollection`
  and keeps every value-lever step.

I/O changes (transitional, v0.8.6 layout still in use):

- Legacy v0.8.6 import / export still works as a transitional safety
  net. The exporter writes the 5 value-lever fields and emits `''`
  only for `Display name` and `Additional notes`, so the gold v0.8.6
  shell's column borders / number formats stay intact.
- `Region(s)` (v0.8.6) is accepted on import as a fallback alias for
  `Physical location(s)` (v0.9.1).
- KV hydrate (`usePlanStorage.normalizePlan`) carries `regions` into
  `physicalLocations` and defaults missing `kind` to `'stream'`, so a
  v1.3.x saved plan opens cleanly in v2.0 without losing data.

**Out of scope.** Sheet renames, multi-sheet enumeration, the
`PS Use Case Worksheet`, and the per-WG / per-Fleet sheet creation
on add. Those are PR B and PR C below.

### PR B — `feat/v2.0-rc.2-multi-sheet`

Replace `public/adoption-plan-empty.xlsx` with the gold v0.9.1 file
(committed verbatim — no in-place sanitization; the importer treats
the per-WG sheets as the source of truth and ignores the example
"Non-Prod_*" rows that only exist in the Stream Overview rollup
table). Rewrite
[`planWorkbookLayout.ts`](./src/lib/planWorkbookLayout.ts),
[`importWorkbook.ts`](./src/lib/importWorkbook.ts),
[`exportWorkbook.ts`](./src/lib/exportWorkbook.ts), and
[`adoptionPlanShellExceljs.ts`](./src/lib/adoptionPlanShellExceljs.ts)
to:

- Generate one sub-sheet per `WorkerGroupRow` on export
  (`wg<sanitized-name>` for `kind === 'stream'`,
  `fl<sanitized-name>_fleet` for `kind === 'edge'`). Adding a new
  worker group / fleet in the UI naturally produces a new sub-sheet
  on the next export — there is no separate "create sheet" action.
- Roll up `Stream Overview` from every `wg*` sub-sheet and
  `Edge Overview` from every `fl*_fleet` sub-sheet. Static values
  only — no formulas, no hyperlinks. The gold's original Google-
  Sheets `=HYPERLINK(...)` approach was applied inconsistently
  (only some rows had it), so the app rebuilds the overview
  deterministically every export with the WG / Fleet name written
  as plain text in column A of the spec table.
- Auto-detect v0.8.6 vs v0.9.1 by sheet presence on import; always
  write v0.9.1 on export. The `INSTRUCTIONS`, `PS Use Case
  Worksheet`, and `input_data` sheets are treated as static and
  emitted verbatim from the shell.

#### v0.9.1 schema audit (captured from gold)

The gold template ships with these sheets (parsed via
`/tmp/v091_dump.txt` — see commit message of the audit commit):

| Sheet | Role |
|---|---|
| `INSTRUCTIONS` | Static. Google-Sheets clone-and-rename ritual; preserved verbatim on export |
| `PS Use Case Worksheet` | PR C territory; preserved verbatim on export until then |
| `Stream Overview` | Rolled-up view of Stream worker groups + their sources |
| `Edge Overview` | Rolled-up view of Edge fleets + their sources |
| `wg<name>` | One per Stream worker group — full per-source data |
| `fl<name>_fleet` | One per Edge fleet — same per-source layout as `wg<name>` |
| `input_data` | Data-validation lookup tables (Tech_tiles, Dest_tiles, Pipeline, Criticality, StreamEdge, Initiatives, Technical use cases, Financial / Operational / Risk reduction / Strategic value lever options) |

The gold seeds `wgdefault`, `wgdefaultHybrid`, and `fldefault_fleet`
as example sheets so a fresh `adoption-plan-empty.xlsx` open in v2.0
boots a plan with 2 Stream WGs + 1 Edge Fleet. The names are user-
renameable.

Per-WG / per-Fleet sheets share the same 30-column layout (A:AD).
Only column D's title flips: `Worker Group` for Stream sheets,
`Fleet` for Edge sheets. Headers in row 2; data starts row 3; gold
seeds 19 blank data rows. Five group banners merge across row 1
(`SOURCE ONBOARDING`, `PRIMARY DATA POINTS`, `VOLUME & PRIORITY`,
`PHASE & ROADMAP`, `INITIATIVE, USE CASES, VALUE LEVERS`).
Constants in [`planWorkbookLayout.ts`](./src/lib/planWorkbookLayout.ts)
(see `V091_*` exports) capture all of this for reuse by importer +
exporter.

Stream Overview / Edge Overview each stack two tables:

- Top (rows 2–14): rolled-up sources. Headers `Source / Daily Volume
  (GB/day) / Physical location(s) / Current Collection / Cribl
  Collection / WG (or FL) / Use Case(s) / Destination(s) / Notes`.
- Bottom (rows 16+): per-WG / per-Fleet capacity. Column A is the
  WG / Fleet name as plain text (matching the per-WG / per-Fleet
  sheet name body, e.g. `wgdefault` → `default`). The gold pre-
  fills cells D17:D24 with `=B+C` and H17:H24 with `=C/8` as a
  fallback for users editing ingest / egress directly in Excel; the
  exporter writes static computed values into those same cells but
  leaves the pre-existing formulas intact in any cell it doesn't
  touch (i.e. unused row slots).

Sheet-name sanitization lives in
[`v091SheetNames.ts`](./src/lib/v091SheetNames.ts):

- Strip Excel-illegal chars (`: \\ / ? * [ ]`), collapse runs of
  whitespace, trim.
- Truncate the body so `prefix + body + suffix` fits in 31 chars.
- Disambiguate collisions with `-2`, `-3`, … against a
  case-insensitive set seeded with the static sheet names so a user-
  named WG can never shadow `Stream Overview` etc.
- A worker-group / fleet row with an empty `wg` field falls back to a
  kind-aware default identifier (`wgWorkerGroup` /
  `flFleet_fleet`).

#### Per-message progress checkpoints

PR B is sized in commits, not one big rewrite:

1. _Foundation_ (done): replace `public/adoption-plan-empty.xlsx` with
   the gold; add v0.9.1 layout constants to `planWorkbookLayout.ts`;
   new `v091SheetNames.ts`; rewrite the dev notes section.
2. _Importer_ (done): detect v0.9.1 by sheet presence, enumerate
   per-WG / per-Fleet sheets, set `WorkerGroupRow.kind` from the sheet
   prefix, parse capacity from the overview tables. The v0.8.6 path is
   preserved verbatim and routed only when the workbook has neither a
   `Stream Overview` / `Edge Overview` sheet nor any sheet name that
   parses as `wg<name>` / `fl<name>_fleet`. Every per-WG sheet's source
   rows are tagged with that sheet's freshly-minted `workerGroupId` at
   parse time, so `assignWorkerGroupIds` is a no-op fast-path. Overview
   rollups feed only the seven capacity columns onto each matching WG /
   Fleet — the top "Sources" table is intentionally ignored because
   it's a write-only artifact the exporter regenerates each save.
3. _Exporter_ (done): generate per-WG / per-Fleet sheets, regenerate
   Stream / Edge Overview rollups as plain-text static values. New
   module `v091ExportWorkbook.ts` runs three phases:
     - **JSZip clone pre-pass** ensures the shell has at least one
       `wg<name>` scaffold per Stream WG and one `fl<name>_fleet`
       scaffold per Edge fleet. The gold ships 2 + 1 — a plan that
       needs more triggers OOXML-level cloning of the first scaffold
       of each kind. Each clone gets a unique placeholder name
       (`wg_v091Clone<N>` / `fl_v091Clone<N>_fleet`) so the Phase 2
       scaffold detector still recognizes it; the placeholder is
       renamed in Phase 2 to the resolved plan-WG sheet name. Clones
       reuse the source's per-sheet rels (comments / drawings /
       vmlDrawings) so they inherit Cribl validation hints for free.
     - **ExcelJS fill** opens the expanded shell, resolves every
       plan-WG sheet name through `resolveAllSheetNames`, renames
       scaffolds in plan order, blanks the data rows from row 3 to at
       least the gold's 19-row scaffold floor (so a shrink doesn't
       leave phantoms), and writes `sourceSummaryValueForHeaderName`
       output by header name. Stream / Edge Overview is regenerated
       from scratch: rows 3..14 (top "Sources, Volume, Region") and
       rows 17.. (specs) are blanked to the gold's table footprint
       and re-filled with computed plain-text rollups (no formulas,
       no hyperlinks). Unused scaffolds are dropped via
       `wb.removeWorksheet`.
     - **OOXML post-pass** restores `xl/styles.xml` + `xl/theme/theme1.xml`
       from the expanded shell (so Cribl colors / fonts / fills
       survive ExcelJS's round-trip), widens `table4`-`table7` `ref=`
       attributes when overview data exceeds the gold's footprint,
       splices the gold's verbatim per-WG `<conditionalFormatting>`
       blocks into every output `wg*` / `fl*_fleet` sheet (so the
       Low/Medium/High color rules' `dxfId` references line up with
       the restored gold styles after ExcelJS re-numbered them), and
       strips ExcelJS's spurious `operator="notContainsBlanks"` echo
       so stricter parsers (openpyxl) can validate the file too.
   Verified via tsx round-trip + openpyxl strict load on five
   plan shapes: empty / 1S+0E / 0S+1E / 3S+2E (single clone each
   side) / 5S+3E (heavy clone). Shell version is auto-detected in
   `workbookDownload.ts#fillShell` so v0.8.6 imports still flow
   through the legacy `adoptionPlanShellExceljs.ts` pipeline.
4. _Resource-map kind sweep_ — every kind-sensitive string in
   `PlanResourceMap`, `WorkerGroupResourceMap`,
   `WorkerGroupDetailView`, and `PlanDataOverview` now flips at
   render time off `workerGroup.kind` / `g.kind` / `g.wg?.kind`.
   Centralized into per-file `copy` objects (and a
   `copyForKind(kind)` helper in the shared resource map) so a
   Fleet detail page reads naturally end-to-end — header kicker,
   SectionBox titles, hub kicker, detach / unassign tooltips,
   empty-state hints, drag prompts, topology prose, the
   destructive Remove button, and the confirm-dialog fallback
   name. The plan-wide map gained a parallel "+ New fleet" CTA
   next to "+ New worker group" (`onAddWorkerGroup` widened to
   `(kind?: WorkerGroupKind) => void`), and per-card kickers now
   read "Worker group" / "Fleet" / "Unassigned" based on the
   group's `kind`. The plan dashboard renames "Worker Groups" to
   "Worker groups & fleets" with a Stream/Edge breakdown, adds a
   per-row WG/Fleet badge, flips the "in/out" capacity tooltip to
   "Same as Fleet → Capacity…" for Edge rows, and pairs "All
   worker groups" with a new "All fleets" jump-link wired through
   a new `onGoToFleets` prop on `PlanDataOverview`. The deferred
   pure-rename follow-up for WG-prefixed shared modules now lives
   in [`ROADMAP.md`](./ROADMAP.md), which is the project-facing
   source of truth for future work.
5. _Version bump + smoke_: `2.0.0-rc.1` → `2.0.0-rc.2`. Round-trip
   smoke tests cover empty / single Stream / single Edge / mixed
   small / heavy-clone shapes; tsx import + openpyxl strict load
   pass on every shape.

### PR C — `feat/v2.0-ps-use-cases`

The gold `PS Use Case Worksheet` sheet has been preserved verbatim by
the app since v2.0.0-rc.1 (it round-trips as a static, unread tab). PR
C makes it a first-class citizen of the app: a new "Activation" page
in the left nav lets the customer + CSE jointly fill it out, and the
exporter writes their answers back to the same sheet so the resulting
`.xlsx` is faithful to the gold layout for downstream consumers.

#### What's literally on the gold sheet

The sheet is 5 columns wide (A–E) and 46 rows tall, broken into three
stacked blocks separated by blank rows. Banner cells (rows 1, 9, 17)
are merged across A–E and styled like section dividers.

1. **Activation Base Scope** (rows 1–7). A 5-row deliverables
   checklist — _Architecture_ / _Use Case Planning_ / _Deployment_ /
   _Source/Destination Configuration_ / _Health Check_. Columns A
   ("Item") and C ("Deliverable") are pre-filled by the gold and are
   immutable (the app re-writes them verbatim on export). Column B is
   a literal `_` separator cell, also static. Columns D ("Status",
   validated against the four-value list `Not Started / In Progress /
   Pending Review / Complete`) and E ("Notes", free text) are the
   editable fields.
2. **Activation Use Case Overview** (rows 9–15). 5 numbered slots
   (1.0–5.0 in column A) where the customer picks _what_ each use case
   is from a fixed dropdown of 12 options (`Data Onboarding`,
   `Advanced Data Onboarding`, `Data Archiving`, `Data Reduction`,
   `Logs to Metrics`, `Edge Deployment`, `Data Enrichment`, `Format
   Conversion`, `Data Routing`, `Cribl Search`, `Container
   Deployment`, `Other`). Column B is the only editable column.
3. **Activation Use Case Worksheet** (rows 17–46). The expanded
   worksheet. 28 data rows total, all sharing the same column layout
   (Use Case label / Use Case # / Parameters / Status / Notes):
   - **Rows 19–21** — three "Base Scope" anchor rows (`Base Scope -
     Primary Source`, `Base Scope - Primary Destination`, `Base Scope
     - Storage Location`), each with its own free-text Parameters,
     Status, Notes. These are pre-engagement infrastructure questions,
     not part of any numbered use case.
   - **Rows 22–26** — Use Case #1 (Silver), 5 parameter rows
     (numbered 1.0 through 5.0).
   - **Rows 27–31** — Use Case #2 (Silver), 5 parameter rows.
   - **Rows 32–36** — Use Case #3 (Gold), 5 parameter rows.
   - **Rows 37–41** — Use Case #4 (Platinum), 5 parameter rows.
   - **Rows 42–46** — Use Case #5 (Platinum), 5 parameter rows.

   The "(Silver) / (Gold) / (Platinum)" labels in column A are
   **baked into the gold template** — the app re-writes them verbatim
   on export. They tell the reader which tier of the Cribl PS
   engagement covers that use case slot.

#### Why "tier" matters in the app

Cribl PS engagements are sold in three tiers: _Silver_, _Gold_, or
_Platinum_. The tier the customer purchased determines how many use
cases are in scope:

- _Silver_: 2 use cases (slots #1 and #2).
- _Gold_: 3 use cases (slots #1, #2, and #3).
- _Platinum_: all 5 use cases.

The gold spreadsheet itself does **not** carry the customer's tier in
any cell — it only tags each use case slot with the tier that unlocks
it. So the app's "tier" is an in-app convenience that lives in
`PlanState.activation.tier` and persists to KV, but does not
round-trip through the `.xlsx`.

#### Tier picker UX

This app is used by both the customer and the CSE — often together.
The tier picker is therefore:

- **Modal-first.** When the user lands on the Activation page and
  `tier` is unset, a centered modal blocks the page with a friendly
  prompt ("Which Cribl Professional Services tier is this engagement
  contracted for? Silver / Gold / Platinum"). The modal is dismissible
  ("Skip — I'll pick later") so a customer flipping through the app
  isn't forced to commit before reading the rest.
- **Sticky.** Once picked, tier is saved into the plan and surfaces in
  the page header as a small `PS Tier: Gold ▾` chip. Clicking the
  chip re-opens the modal.
- **Soft-gating.** Use case cards that fall outside the chosen tier
  fade to ~50% opacity and gain a small "Out of scope for Silver" pill,
  but stay fully editable. This is intentional: a CSE pre-staging an
  upgrade or a customer experimenting before committing to a higher
  tier should never feel locked out. The visual fade is enough signal.
- **Skip-friendly.** When `tier` is `null` (skipped or never picked),
  no fading happens and all 5 use case cards render at full opacity —
  the page behaves identically to the gold's "no tier knowledge"
  baseline.

#### `PlanState.activation` shape

Single new top-level field on `PlanState`. All five blocks below
combined hold ~50 strings; the entire activation object stays well
under any KV size budget.

```ts
type ActivationStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Pending Review'
  | 'Complete'

type ActivationTier = 'Silver' | 'Gold' | 'Platinum'

type Activation = {
  /**
   * Customer's PS engagement tier. `null` when unset (modal hasn't
   * been answered yet, or the user explicitly skipped). Does not
   * round-trip through the gold .xlsx — purely an in-app convenience
   * for soft-gating use case cards.
   */
  tier: ActivationTier | null

  /** Rows 3–7 (Activation Base Scope). 5 fixed deliverables. */
  baseScope: { status: ActivationStatus; notes: string }[]  // length 5

  /** Rows 11–15 (Activation Use Case Overview). 5 picker slots. */
  useCaseOverview: { kind: string }[]  // length 5; '' when unset

  /** Rows 19–21 (Base Scope sub-rows of the worksheet). */
  baseScopeWorksheet: {
    parameters: string
    status: ActivationStatus
    notes: string
  }[]  // length 3, ordered: Primary Source / Primary Destination / Storage Location

  /** Rows 22–46 (Use Case worksheet). 5 use cases × 5 parameter rows. */
  useCases: {
    parameters: {
      parameters: string
      status: ActivationStatus
      notes: string
    }[]  // length 5
  }[]  // length 5
}
```

The Item / Deliverable column-A and column-C labels in block 1, the
"Use Case #" column in block 2, and the "Use Case #N (Tier)" /
parameter-number labels in block 3 are **not stored in state** — they
are constants (`psUseCaseLayout.ts`) the UI reads to render row labels
and the exporter reads to write static column-A and column-B cells
verbatim. Tier of each use case slot (`'Silver' / 'Silver' / 'Gold' /
'Platinum' / 'Platinum'`) is derived by index from the same module.

#### I/O round-trip

The `PS Use Case Worksheet` sheet is preserved verbatim by both the
v0.8.6 and v0.9.1 pipelines today. PR C extends the v0.9.1 importer
and exporter to also _read from_ and _write into_ this sheet:

- **Importer** parses block 1 (D/E columns of rows 3–7), block 2 (B
  column of rows 11–15), block 3a (C/D/E columns of rows 19–21), and
  block 3b (C/D/E columns of rows 22–46). All static labels are
  ignored at parse time.
- **Exporter** writes the editable cells in-place, leaves every
  static label / banner / header row untouched (so the gold's
  conditional formatting, data validation, fonts, and merged cells
  all survive verbatim). No new sheets are added; sheet ordering
  stays as the gold ships it.

The PS Use Case Worksheet is **independent** of the per-WG / per-Fleet
sheets — it does not influence which `wg<name>` / `fl<name>_fleet`
sheets the exporter generates, and the importer ingests it
unconditionally regardless of how many WGs / Fleets the plan has.

#### What shipped in `2.0.0`

- New `Activation` data model on `PlanState` with the gold-true 5/5/3/5×5
  shape, plus a tolerant `backfillActivation()` normalizer that pads or
  trims older saved plans to the canonical shape on KV hydrate.
- Left-nav **Activation** entry (desktop rail + mobile chip bar) that
  surfaces the picked tier as a small badge.
- Dedicated `ActivationView` page with three tabbed blocks (base scope,
  use-case overview, use-case worksheet), a native **PS tier** `<select>` in
  the page header (Silver / Gold / Platinum), and soft-gating: out-of-scope
  use case cards fade to ~50% opacity with an "Out of scope" pill but stay
  fully editable.
- Importer + exporter for the `PS Use Case Worksheet` sheet that
  round-trip every editable cell while leaving every static label /
  banner / header / dropdown / conditional-formatting block verbatim.
  Verified end-to-end with a 16-spot-check + 4-shape-assertion smoke.

### PR D — `feat/v2.0-export-style-fidelity`

PR D is a grab-bag of work that started as one focused thing
(restoring style fidelity in the multi-sheet `.xlsx` exporter so
downloaded workbooks were visually indistinguishable from the gold
template) and grew during release polish. None of it is a breaking
change relative to PRs A–C, so all of it ships under the same
`v2.0.0` tag rather than as a separate point release. Four loose
groupings:

#### Style-fidelity restoration

The PR B exporter wrote correct values but ExcelJS would silently
drop styles on the per-WG sheets — green banner backgrounds turned
white, bold/merged headers lost their formatting, and conditional-
formatting blocks dropped. PR D adds a JSZip-based post-pass in
[`src/lib/v091ExportSheetRestore.ts`](./src/lib/v091ExportSheetRestore.ts)
that opens the freshly-written workbook, walks each sheet's OOXML,
and restores styling from the gold template wherever ExcelJS dropped
it. Per-WG sheets, the Stream / Edge overviews, the PS Use Case
Worksheet, and `input_data` each have a tailored restore path —
they share scaffolding (`restoreOverviewSheet`, etc.) but the per-
sheet logic is explicit because each gold sheet has a different
"style of style" (banner-and-grid vs. card-grid vs. picklist).

A subtle two-pass collision in `restorePerWgSheets` was uncovered
during smoke testing. Pass 1 populates each plan WG's per-WG sheet;
pass 2 restores any unconsumed gold scaffold (`wg-default`,
`wg-defaultHybrid`, `fl-default`) with empty bodies so the output
workbook always has usable empty templates alongside the user's
real WGs. Pass 2's "wasn't consumed" check was based on whether the
scaffold's name appeared in `plan.workerGroups` — but a plan WG
named `default` resolves to sheet name `wg-default`, which is also
the name of the first gold scaffold. So pass 2 would happily
overwrite the populated `wg-default` sheet with an empty overlay
and silently lose every source the user had assigned to it. Fix:
pass 1 records every output sheet name it writes into a
`Set<string>` (`restoredOutNames`), and pass 2 skips any scaffold
whose target name is in that set. End-to-end smoke (`overview-
export-smoke.ts`, since deleted) created a plan with two Stream WGs
(`default`, `apex`) plus an Edge fleet (`rover`), each with sources,
exported, re-imported, and asserted source counts and
`additionalNotes` values survived round-trip.

#### Sheet rename: `wg-<name>` / `fl-<name>`

The PR B naming convention (`wg<name>` for Stream, `fl<name>_fleet`
for Edge) had two flaws that surfaced in field use:

1. **The `_fleet` suffix wasn't intentional.** It came from a literal
   `default_fleet` worker group name in an early gold template; the
   exporter accidentally treated it as part of the sheet-name format
   rather than the WG's name. So a fleet called `rover` would export
   as `flrover_fleet` instead of just `flrover`.
2. **No visible separator between prefix and name.** A WG named
   `default` and a hypothetical WG named `wgdefault` both produced
   sheet names that started with `wgdefault…` and were impossible to
   distinguish at a glance.

PR D introduces a dash separator and drops the suffix:
`wg-<name>` / `fl-<name>`. Tradeoffs:

- **Excel forbids `:` in sheet names.** The user's first proposal
  (`wg:default`) is impossible. Dashes are valid and visually similar.
- **Dashed sheet names need single-quoting in formulas.** `wg-default`
  appearing in `definedName` for autofilter ranges had to become
  `'wg-default'!$A$2:$AE$21` — the OOXML spec rejects bare hyphenated
  references. The two gold scaffolds
  (`public/adoption-plan-empty.xlsx` and the user's local copy) were
  patched in place via a one-shot Python script
  (`zipfile` + `xml.etree.ElementTree`); the runtime exporter doesn't
  emit `definedName` formulas, so no code change was needed there.
- **The two namespaces are now disjoint.** `wg-` only ever matches
  Stream, `fl-` only ever matches Edge — the
  `startsWith(prefix) && !endsWith(suffix)` checks in
  [`exportWorkbook.ts`](./src/lib/exportWorkbook.ts) collapsed to
  prefix-only checks, simplifying the scaffold-detection logic.

**Back-compat for import.** Workbooks exported by older copies of
the app during PR B's life (legacy `wg<name>` and `fl<name>_fleet`)
still seed cleanly. The classifier in
[`src/lib/v091SheetNames.ts#classifyV091SheetName`](./src/lib/v091SheetNames.ts)
matches in this order:

1. New Edge form `fl-<name>` → kind: edge, displayName: name
2. Legacy Edge form `fl<name>_fleet` → kind: edge, displayName: name
   (the `_fleet` suffix is **explicitly stripped** so a legacy
   `flrover_fleet` imports as a fleet named `rover`, matching user
   intent)
3. New Stream form `wg-<name>` → kind: stream, displayName: name
4. Legacy Stream form `wg<name>` → kind: stream, displayName: name
   (with a guard against bare prefixes that would resolve to an
   empty display name)

The legacy `_fleet` constant lives on as
`LEGACY_V091_FLEET_SHEET_SUFFIX` in
[`planWorkbookLayout.ts`](./src/lib/planWorkbookLayout.ts) — used
**only** by the import classifier. The exporter no longer emits any
suffix.

#### Cloned scaffolds inserted in grouped tab order

When a plan has more WGs than the gold's two Stream scaffolds (or
more fleets than the one Edge scaffold), the exporter clones a
scaffold to make room for the extras. Pre-PR-D, clones were appended
at the end of `xl/workbook.xml#sheets`, which produced an unsorted
tab strip after a few extra WGs/fleets:

```
INSTRUCTIONS · PS Use Case Worksheet · Stream Overview ·
wg-default · wg-defaultHybrid · Edge Overview · fl-default ·
input_data · wg-apex · wg-edge-1 · fl-rover     ← clones, end of strip
```

`insertSheetEntry` in
[`exportWorkbook.ts`](./src/lib/exportWorkbook.ts) now inserts each
clone strategically:

- `wg-*` clones go immediately before the `Edge Overview` entry, so
  every Stream sheet is contiguous.
- `fl-*` clones go immediately before the `input_data` entry, so
  every Edge sheet is contiguous.
- A fallback path appends before `</sheets>` if either anchor is
  missing — defensive against a future gold without those sheets.

Result:

```
INSTRUCTIONS · PS Use Case Worksheet · Stream Overview ·
wg-default · wg-defaultHybrid · wg-apex · wg-edge-1 ·
Edge Overview · fl-default · fl-rover · input_data
```

#### `Additional notes` (column AE) reinstated

The early read of the v0.9.1 gold (PR A) marked `displayName` and
`additionalNotes` as dropped from the per-WG sheets. Re-reading the
gold during PR D confirmed `Additional notes` is in fact still
present — column AE — but had been silently dropped from the
importer/exporter along with `displayName`. PR D reinstates it
across the round-trip:

- [`SourceSummaryRow`](./src/types/planTypes.ts) gains
  `additionalNotes?: string`.
- The importer maps the `Additional notes` header back into the
  field; `normalizePlan` defaults missing values to `''` so legacy
  KV blobs don't crash.
- The exporter writes the field back into AE, with the same banner
  + grey-fill column treatment as the surrounding "free-text"
  columns.
- The source-detail panel and the source-add wizard each get a new
  `AdditionalNotesBlock` so the field is editable in the UI, not
  just on round-trip.

#### A second build target — single self-contained HTML

The v2.0 deliverable is a `.tgz` for the Cribl App Platform; the
on-prem audience that runs Cribl outside Cribl Cloud (and therefore
without the App Platform) had no way to use the tool. PR D adds a
second build target — `npm run build:standalone` — that produces
`dist-standalone/cribl-adoption-plan.html` as a single self-contained
file. The customer downloads it, double-clicks it, the app works.

The standalone build is the same React tree, the same components, the
same I/O code; the difference is bundling:

- [`vite.standalone.config.ts`](./vite.standalone.config.ts) wires
  [`vite-plugin-singlefile`](https://github.com/richardtallent/vite-plugin-singlefile)
  to fold every JS chunk and stylesheet into one HTML payload, and a
  small custom plugin (`inlineGoldTemplatePlugin`) registers the
  virtual module `virtual:embedded-gold-template` whose default export
  is `public/adoption-plan-empty.xlsx` re-encoded as a base64 string
  at build time. A second small plugin
  (`renameStandaloneOutputPlugin`) renames the produced
  `index.html` → `cribl-adoption-plan.html` in `closeBundle` so the
  artifact has a customer-facing filename, and a third
  (`stripFaviconLinkPlugin`) strips the `<link rel="icon">` from the
  HTML since the standalone build sets `publicDir: false` and would
  otherwise leave a 404 in the console.
- The primary [`vite.config.ts`](./vite.config.ts) registers a no-op
  stub for the same virtual module so the dynamic
  `await import('virtual:embedded-gold-template')` in
  [`adoptionPlanTemplateExport.ts`](./src/lib/adoptionPlanTemplateExport.ts)
  resolves cleanly in the App-Platform build too. The stub exports
  `hasEmbeddedGoldTemplate: false`, which the runtime resolver
  branches on; the App build never reaches the decode path because
  `fetch('/adoption-plan-empty.xlsx')` always succeeds first. ~50
  bytes of overhead in the App build, zero in the standalone bundle.
- `assetsInlineLimit` is bumped to 96 KB in the standalone config so
  every src-imported asset (the Cribl AI mark, etc.) gets folded into
  the bundle as a base64 data URL. As part of this, the one source-
  level reference to a `public/` asset
  (`<img src="/cribl-ai-icon.png">` in `CriblLogos.tsx`) was migrated
  to a Vite import (`import url from '../../assets/cribl-ai-icon.png'`)
  so both build targets produce a working image — the App build emits
  a fingerprinted `dist/assets/cribl-ai-icon-XXXX.png`, the standalone
  build inlines it. `public/cribl-ai-icon.png` was relocated to
  `src/assets/cribl-ai-icon.png` to make this work.

The result is a 2.2 MB / 720 KB-gzipped HTML file that opens
correctly via `file://` in every modern browser, with no Node, no
`npm`, no IT-side allowlist, and no extra files to ship alongside.
End-to-end smoke confirmed:

```
$ python3 -c "..." dist-standalone/cribl-adoption-plan.html
decoded xlsx size: 162913 bytes (expected 162913)
sheets in embedded gold:
  ['INSTRUCTIONS', 'PS Use Case Worksheet', 'Stream Overview',
   'wg-default', 'wg-defaultHybrid', 'Edge Overview',
   'fl-default', 'input_data']
```

**Persistence under `file://`.** The KV-fallback path
([`src/lib/kvStore.ts`](./src/lib/kvStore.ts), see "Local-dev fallback"
below) is the same one the dev server already used, so persistence
"just works" — but `localStorage` is path-scoped under `file://`,
which is a non-obvious gotcha worth documenting in the
[README](./README.md#standalone-deployment): if the user moves the
`.html` to a different directory, their saved plan does not follow.
The `.xlsx` Export is the canonical save path and always has been;
`localStorage` is session continuity, not durable storage. We
considered IndexedDB, an `import()`-based file picker, and an
auto-suggested re-export-on-close prompt — all add UX complexity for
~no real-world benefit since every workflow already produces an
Excel file at the natural save points. Keep it boring.

**Repo structure.** Both build targets live in the same repo, share
one `package.json` and one `package-lock.json`, and read the same
`version` field. Reasons:

- Every src/ change has to land in both targets at once anyway.
  Keeping them in one repo guarantees they never drift.
- The version string is the source of truth in `package.json`. The
  App-Platform `.tgz` reads it via `scripts/package.mjs`; the
  standalone HTML carries it implicitly via the bundled JS. One bump,
  two artifacts.
- `scripts/package.mjs` packages **only** `dist/` into the `.tgz`, so
  `dist-standalone/` is naturally excluded from the App-Platform
  release and you can't accidentally ship the wrong artifact.

#### UI polish

Three small but visible changes that don't fit a "feature" label:

1. **Inline pencil edit on the Plan hero.** The "Adoption plan" hero
   on the Plan dashboard now defaults to "Cribl" in muted grey italic
   with a pencil icon next to it. Click to edit; the text turns
   black once the user enters their own customer name. Implemented
   as a new `HeroCustomerName` subcomponent in
   [`PlanDataOverview.tsx`](./src/components/PlanDataOverview.tsx) that
   mirrors the existing `HeaderCustomerName` UX (pencil → input →
   commit on blur/Enter/Escape) but with hero-scale styling. The
   underlying state is the same `plan.customerName`, so editing in
   either place updates both. The hero's card border / shadow /
   background were also removed (it now "floats"), while the
   Activation callout below it keeps the card styling for visual
   prominence.
2. **Dismissible Activation callout.** The "Plan in shape? Activate
   it." card on the Plan dashboard now has a small × in its top-right
   corner. Dismissal is persisted via a new
   [`activationCalloutPreference.ts`](./src/lib/activationCalloutPreference.ts)
   (KV under the iframe, `localStorage` outside it — same fallback as
   the rest of the app), exposed through the
   `useActivationCalloutDismissed` hook. A reactivation toggle was
   added to the Settings view ("Show 'Plan in shape? Activate it.'
   nudge") so a customer who dismisses by accident can bring it back.
3. **Plan is the default landing page.** Activation had briefly been
   the default during PR C polish; user feedback was that Plan should
   remain the default. The `useState<MainView>` initial value in
   [`App.tsx`](./src/App.tsx) is `'overview'`.

**Tag history.** `v2.0.0-rc.1` (PR A merge), `v2.0.0-rc.2` (PR B
merge), `v2.0.0` (PRs C + D merged together, GitHub release). PR D
was originally tracked as a hypothetical `v2.1.x` while in flight,
but since neither rc tag was ever pushed to GitHub the entire v2.0
arc lands as a single public release.

---

## Local-dev fallback

When `window.CRIBL_API_URL` is undefined (i.e. the app is opened
directly at `http://localhost:5173/` outside the Cribl iframe),
[`src/lib/kvStore.ts`](./src/lib/kvStore.ts) silently routes every
read/write through `localStorage`, with the same `users/<id>/<key>`
namespacing it uses inside the iframe. This means:

- `npm run dev` "just works" with persistent state.
- Test data written outside the iframe is invisible inside the iframe
  and vice versa (different storage backend), so a CSE running both
  contexts side by side won't accidentally pollute their tenant's KV.
- `kvGet` / `kvSet` / `kvDelete` are best-effort: they return the
  fallback on 404, HTTP errors, network errors, or JSON parse errors,
  and only `console.warn` on failure. KV is treated as a cache — losing
  it never crashes the app.

---

## Vite dev + Cribl `?init=`, `localStorage`, and production HTML

This section exists so we do not regress into a **blank UI** or **wrong
KV app id** when mixing local Vite with the Cribl staging shell.

### `?init=` — do not inject `window.CRIBL_APP_ID` (`__dev__…`)

The Cribl local-dev flow loads the app as
`http://localhost:5173/?init=https://…/app-ui/__local__/init.js?…`.
That **`init.js`** sets `window.CRIBL_API_URL`, the real **`CRIBL_APP_ID`**
for the tenant, and other globals.

**Failure mode we hit:** [`vite.config.ts`](./vite.config.ts) used to
prepend **every** HTML response (including production `vite build`) with
`window.CRIBL_APP_ID = '__dev__<package-name>'` for convenience on
pure localhost. That collides with the platform in two ways:

1. **`?init=` present:** our assignment ran **before** the real id was
   established, so `fetch` rewrote KV URLs to
   `/api/v1/a/__dev__adoption-plan/kvstore/…` — wrong app, confusing 404s,
   and broken state vs. the installed pack.
2. **Read-only globals:** the shell may define `CRIBL_APP_ID` as
   non-writable. A synchronous assignment in an inline `<script>` throws
   **before** the ES module bundle loads → **entire iframe stays blank**.

**Rules (wired in `vite.config.ts`):**

| Mode | `inject-script-from-query` plugin | `CRIBL_APP_ID` inline tag |
|---|---|---|
| `vite` / `vite preview` (`apply: 'serve'`) | Runs | Injected **only when the URL has no `?init=`** query param (pure local dev). |
| `vite build` | Plugin **not** applied | No inline assignment; packaged `dist/index.html` is clean. |

When `?init=` is present, **only** the external `init.js` `<script src=…>`
tag is injected; the platform owns app identity.

### `localStorage` — sandbox `SecurityError` (must not crash React)

Some dev shells embed Vite in an iframe whose sandbox **omits
`allow-same-origin`**. In that environment **reading**
`window.localStorage` throws **`SecurityError`**, including for idioms
like `typeof localStorage === 'undefined'` (the engine still touches the
`localStorage` getter on `Window`).

**Failure mode we hit:** assistant chat persistence and rail-collapse
prefs touched `localStorage` inside a `useEffect`. The exception was
**uncaught** → React tore down the tree → blank app, while pure
localhost (no sandbox) kept working.

**Rule:** Never read or write `localStorage` directly in new code. Use
[`src/lib/safeLocalStorage.ts`](./src/lib/safeLocalStorage.ts)
`getSafeLocalStorage()` (try/catch around `window.localStorage`, returns
`null` when unusable). Existing call sites to update when touching prefs:
[`src/lib/kvStore.ts`](./src/lib/kvStore.ts) localStorage fallback,
[`src/lib/aiAssistantChatStorage.ts`](./src/lib/aiAssistantChatStorage.ts),
and any component-local prefs.

When storage is unavailable, features degrade gracefully (no chat
thread persistence, no local KV mirror) — **they must not throw**.

### Expected console noise (not bugs by themselves)

- **KV `GET …/kvstore/… 404`:** first open on a key that was never written
  (prefs, import shell, etc.). [`kvStore.ts`](./src/lib/kvStore.ts) treats
  404 as “use fallback”.
- **Mixed content warnings** if the **parent** page is **HTTPS** but Vite
  serves **HTTP** on `localhost:5173` — the browser flags subresources;
  use the packaged `.tgz` on the tenant or match schemes when debugging.

### Gold template `403` via `…/proxy/localhost:5173/…`

If `document.baseURI` or resolved template URLs point at `localhost`
through the tenant **proxy** while the pack is not allowed to reach your
machine, gold pre-fetch can return **403**. That is a **dev wiring**
issue (base URL / proxy), separate from the `localStorage` /
`CRIBL_APP_ID` failures above — track the actual failing URL in DevTools
→ Network when debugging exports on hybrid dev setups.

### Pack KV `openaiKey` — store the **raw** secret (no JSON quotes)

`proxies.yml` injects `Authorization: 'Bearer ' + kv.openaiKey`. The pack KV
value must be the **plain** `sk-…` string. If the app (or admin UI) writes
`JSON.stringify(key)` into KV, the stored body includes literal `"` characters
and OpenAI responds with **401** (“Incorrect API key”) while echoing the key
with extra quotes.

[`src/lib/kvStore.ts`](./src/lib/kvStore.ts) `kvSetOpenAiKey` writes **`body:
trimmed`** (raw) for iframe PUTs; `probeOpenAiKeyPresent` /
`getOpenAiKeyForLocalDevOnly` use `normalizeOpenAiSecretFromKvPayload` so **legacy**
JSON-quoted values still read correctly until the user re-saves the key.

### `__local__` shell — BYOL OpenAI disabled

When `CRIBL_APP_ID` is `__local__` or the page URL references `__local__` (e.g.
`?init=…/__local__/init.js`), the Cribl Apps shell is the **`__local__`** dev
context. Pack KV for `openaiKey` is not available (`Unknown App "__local__"`), and
outbound OpenAI via the platform proxy is not reliable there. The app sets
**`isCriblLocalShell()`** in [`kvStore.ts`](./src/lib/kvStore.ts): **Settings** does
not offer saving a BYOL key, and the right-rail assistant is disabled with copy
pointing to a **deployed** installed pack. Plain **`npm run dev` on localhost**
(without that shell) is unchanged: browser `openaiKey` + direct `fetch` to OpenAI
still work for local assistant dev.

Hybrid dev **without** `__local__` in the URL may still set a tab-local
**`sessionStorage`** hint after KV returns `Unknown App "__local__"` so browser
storage is used for `openaiKey` until you open a real installed pack (hint cleared).

### Known issue — plan persistence in the `__local__` shell

The **`__local__`** Cribl Apps dev shell has **no pack KV**. The app tries to
mirror the plan (and other generic keys) to **`localStorage`** and to recover
after KV **404** / errors for non–installed-pack iframe contexts, but **a full
reload may still show an empty plan** in practice: the host iframe may omit
**`allow-same-origin`** (so `localStorage` throws or is opaque), **`CRIBL_APP_ID`**
can arrive after the first hydration read, or a very large tenant import can hit
**quota** limits. **Customers are not expected to use `__local__`.**

**What to do:** validate tenant import and refresh behavior on a **deployed**
installed pack (pack KV). For `__local__` QA only, treat **Export (.xlsx)** or
**Summary → Download workbook** as the durable snapshot until you switch to a
deployed app.
