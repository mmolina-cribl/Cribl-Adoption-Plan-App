# Cribl Adoption Plan — Engineering Notes

Companion document to inline `// see CRIBL_DEV_NOTES.md` references in the
codebase. Captures the decisions and platform realities behind the
non-obvious bits — KV hydration strategy, the user-identity gap inside
the iframe, the Excel round-trip approach, and a few smaller display
contracts.

For platform-level rules (fetch proxy, KV REST shape, `proxies.yml`),
see [`AGENTS.md`](./AGENTS.md). For a feature-level overview, see
[`README.md`](./README.md).

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
`prefs/rail/px`, etc. and don't see the prefix. This means the moment
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
| Per-source data | one `Source summary` sheet for the whole plan | one sheet per worker group / fleet (`wg<name>` for Stream, `fl<name>_fleet` for Edge) |
| Topology overview | one `Copy of Sources and WGs` sheet | inferred top-of-file `Stream Overview` (rolled up from `wg:*` sheets) + `Edge Overview` (rolled up from `fl:*` sheets) |
| Activations | not modeled | new `PS Use Case Worksheet` with tier (Silver / Gold / Platinum), base scope, and use-case board |
| Region semantics | `Region(s)` (cloud-region biased) | `Physical location(s)` (Edge fleets can live on hosts, not regions) |
| Migration source field | only present on the topology sheet | promoted to the per-WG sheet as `Current Collection` |
| Per-source columns dropped | n/a | only `Display name` and `Additional notes`. The "value lever" fields (Operational / Risk Reduction / Strategic / Onboarding Effort / Politics) **stay** on every per-WG / per-Fleet sheet — an early read of the gold based on a stale `SAMPLE` sheet incorrectly suggested they were dropped. |

The app's response is a major version bump (`v2.0.0`) split into three
sequential PRs so each lands as a reviewable, releasable slice:

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

Replace `public/adoption-plan-empty.xlsx` with a sanitized v0.9.1
file. Rewrite [`planWorkbookLayout.ts`](./src/lib/planWorkbookLayout.ts),
[`importWorkbook.ts`](./src/lib/importWorkbook.ts),
[`exportWorkbook.ts`](./src/lib/exportWorkbook.ts), and
[`adoptionPlanShellExceljs.ts`](./src/lib/adoptionPlanShellExceljs.ts)
to:

- Generate one sub-sheet per `WorkerGroupRow` on export
  (`wg<sanitized-name>` for `kind === 'stream'`,
  `fl<sanitized-name>_fleet` for `kind === 'edge'`). Adding a new
  worker group / fleet in the UI naturally produces a new sub-sheet
  on the next export — there is no separate "create sheet" action.
- Roll up `Stream Overview` from every `wg:*` sub-sheet and
  `Edge Overview` from every `fl:*_fleet` sub-sheet, with hyperlinks
  back to the source rows.
- Auto-detect v0.8.6 vs v0.9.1 by sheet presence on import; always
  write v0.9.1 on export. The `SAMPLE` and `input_data` sheets are
  treated as static and emitted verbatim from the shell.

### PR C — `feat/v2.0-ps-use-cases`

New `PlanState.activation` with tier, base scope (6 items), and a
use-case board (5 use cases × parameters). New left-nav entry and
view. Round-trip the `PS Use Case Worksheet` sheet (rows 3–7 base
scope, rows 11–15 overview, rows 19–46 worksheet). The PS Use Case
Worksheet is independent of the per-WG / per-Fleet sheets — it does
not influence which sub-sheets are generated.

**Tag history.** `v2.0.0-rc.1` (PR A merge), `v2.0.0-rc.2` (PR B
merge), `v2.0.0` (PR C merge + GitHub release).

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
