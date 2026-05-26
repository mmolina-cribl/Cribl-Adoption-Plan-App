# Import from live tenant — Leader data scope

This document lists **which Cribl Leader APIs the Adoption Plan app calls**, **what JSON the Leader can return**, **what we import into the plan today**, and **what we do not pull**. Use it to decide what is important for your workflow versus what would need a product change or manual entry in the workbook.

The implementation lives in:

- `src/lib/tenantHarvest.ts` — HTTP calls and normalization
- `src/lib/leaderWorkerGroupMetrics.ts` — maps Leader `estimatedIngestRate` tier codes to MB/s labels for `workerDetail`
- `src/lib/topologyToPlan.ts` — mapping into `PlanState` / `SourceSummaryRow` / `WorkerGroupRow`

## 1. APIs called today

| Order | Request | Purpose |
| ----- | ------- | ------- |
| 1 | `GET {CRIBL_API_URL}/master/groups` | Inventory of Stream / Edge / fleet / outpost **worker groups** |
| 2a | `GET {CRIBL_API_URL}/m/{groupId}/system/inputs` | **Configured sources (inputs)** for that group |
| 2b | Same URL with `/inputs` instead of `/system/inputs` | Fallback if (2a) returns no parsable list |

`CRIBL_API_URL` is injected by the Cribl App Platform; the platform fetch proxy adds auth (see `AGENTS.md`).

**Not called:** routes, pipelines, destinations (outputs), deployments, metrics, commits, pack lists, global settings, etc.

---

## 2. Worker groups (`/master/groups`)

### What the Leader may return

Each item is a group object. Real tenants often include fields such as:

`id`, `description`, `name`, `type`, `isFleet`, `isSearch`, `onPrem`, `tags`, `provisioned`, `estimatedIngestRate`, `cloud` (e.g. provider / region), `configVersion`, `workerRemoteAccess`, `lookupDeployments`, and others depending on version and edition.

### What we **filter out** before import

- `id === 'default_search'`
- `isSearch === true`

### What we **use** from each remaining group

| Leader field | How we use it |
| ------------ | ------------- |
| `id` | Stable Leader group id (for debug / correlation) |
| `description` | Plan **worker group name** (`WorkerGroupRow.wg`); if empty, we use `id` |
| `isFleet` | With `type`, drives **Stream vs Edge** (`WorkerGroupRow.kind`) |
| `type` | If `edge` or `outpost` (case-insensitive), we treat the row as **Edge**; otherwise **Stream** unless `isFleet` is true |

### What we **map** into the adoption plan

| Plan field | Populated? |
| ---------- | ---------- |
| `WorkerGroupRow.wg` | Yes — from `description` or `id` |
| `WorkerGroupRow.kind` | Yes — `stream` or `edge` per above |
| `WorkerGroupRow.id` | New in-app id (not Leader id) |
| `WorkerGroupRow.workerHosting` | **Partial** — from Leader `onPrem` and `cloud.provider` / `cloud.region` when present (short hint, not full infra) |
| `WorkerGroupRow.workerDetail` | **Partial** — from Leader `estimatedIngestRate` when present: human-readable **provisioned max ingest (MB/s)** line. This is a Cribl **tier code**, not GB/day; see Cribl worker-group docs for code → throughput. |
| `WorkerGroupRow.ingestGbd` / `egressGbd` / `throughputGbd` | **No** — workbook columns expect **GB/day** planning numbers; we do not invent those from the tier code. |
| `WorkerGroupRow.workerCount`, `diskOneDayGb`, … | **No** — not returned in a usable form from the APIs we call today |

### Leader fields we **do not** read into the plan (today)

Examples: `name` (distinct from `description`), `tags`, `provisioned`, `configVersion`, nested deployment inventories, and any other group keys not listed above. Additional fields can be wired later if product prioritizes them.

---

## 3. Configured sources — inputs (`/m/{group}/system/inputs` or `/m/{group}/inputs`)

In Cribl Stream, **sources** are stored as **inputs** on the worker group.

### What the Leader returns

Each input is typically a **rich JSON object**: at minimum `id`, `type`, and often many **type-specific** fields (ports, hosts, URLs, auth settings, etc.). The exact shape depends on collector type (`syslog`, `http`, `s3`, …).

### What we **normalize** and keep in memory

From each object we currently copy only:

| Field | Use |
| ----- | --- |
| `id` | Required; skip row if missing |
| `type` | Collector type string |
| `disabled` | If true, we still import the row but set a note |
| `description` | Optional; kept in harvest JSON only — **not** used for plan **Source** name |

Implementation: `normalizeLeaderInputsResponse()` in `tenantHarvest.ts`.

### What we **map** into the adoption plan (`SourceSummaryRow`)

| Plan column / field | Populated? |
| ------------------- | ---------- |
| **Source** (name) | Yes — Leader input **`id`** (falls back to **`type`** if id were ever empty after normalization) |
| **Current collection** (pre-Cribl ingestion path in the workbook) | **No** — tenant import does not infer this from Leader input JSON (only normalized fields below are kept). |
| **Stream / Edge** | Derived from the **worker group** the input belongs to |
| **Pipeline / use case** and **Destinations** | **No** — left empty (`''`); routing is **not** imported (destinations may be wired later) |
| **On-Prem vs Cloud/Internet** (`type` enum on source row) | Left empty (`''`) — not inferred from Leader |
| **Volumes, stakeholders, PS fields, …** | **No** |
| **Additional notes** | **Partial** — Leader input `description` (when present) is appended as `Leader input description: …` (alongside any “Disabled on Leader” note). |
| **Source tile** (workbook catalog) | **Partially** — inferred from Leader input `type` (and `id` for generic `splunk`) via `inferSourceTileFromLeaderInput()` in `src/lib/leaderInputToSourceTile.ts`. Only values that exist in `input_data.techTiles` are written; otherwise the field stays empty so users can pick manually. |

Leader **collector** `type` is in **Import debug** as `syntheticSourceDetails[].collectorType` (from harvest order, not from `currentCollection`). The **Source** name is the input **`id`** (Leader `description` is not used for the Source column — it is copied into **additional notes** when present). The inferred workbook **Source tile** is the same row’s `syntheticSourceDetails[].sourceTile` (and `SourceSummaryRow.sourceTile` in the plan).

### What we **drop on the floor** (today)

All other input JSON keys (ports, endpoints, secrets, TLS, etc.). They are **not** persisted in `PlanState`. They still exist in the tenant if you open Stream UI; we simply do not copy them into the adoption workbook model yet.

If you need specific fields in the plan, the usual approach is to extend `LeaderInputItem` + normalization and map into an appropriate `SourceSummaryRow` field or `additionalNotes`.

---

## 4. What is **not** fetched at all

Examples of Leader / Stream concepts this import **does not** touch:

- **Routes** and route tables (`/m/{group}/routes`, …)
- **Pipelines** and pack references on routes
- **Destinations** (outputs)
- **Worker process** counts, CPU, health
- **Commits / versions** (except whatever might appear inside payloads we do not parse into plan fields)
- **Search** worker group (`default_search`) — excluded
- **Lake**, **Edge** device inventories beyond group list + inputs, **Git** remotes, **secrets** stores, etc.

---

## 5. What tends to matter for the adoption workbook

| Workbook / app goal | Supported by tenant import today? |
| ------------------- | ----------------------------------- |
| “Which worker groups / fleets exist?” | **Yes** — names + Stream vs Edge |
| “Which collectors (inputs) exist per group?” | **Partially** — id, type, disabled; Leader `description` copied into source **additional notes** |
| “How does data route (pipeline → destination)?” | **No** — enter manually or from Excel |
| “Volumes, sizing, security class, PS use cases?” | **Partially** — Leader **provisioned ingest tier** (`estimatedIngestRate` → MB/s hint in `workerDetail`) and **cloud / on-prem** hints in `workerHosting` when present; **GB/day** ingest/egress/throughput columns are still manual |

---

## 6. Debug payload after import

After **Bootstrap from tenant**, **Import debug** includes JSON with:

- `harvest.groups` — raw group objects as returned by `/master/groups` (minus filtered groups still in list… actually we store **post-filter** `groups` array in harvest — only groups we import)
- `harvest.inputsByGroup` — **normalized** inputs per group (**only** `id`, `type`, `disabled`, `description`), not full Leader JSON
- `syntheticSourceDetails` / tables — what landed in `PlanState`, plus **`collectorType`** per row from the harvest (same order as sources; **not** read from `currentCollection`) and **`sourceTile`** (best-effort inference from Leader `type` / `id`, catalog-validated)

To inspect **full** input documents from the Leader, use Stream’s API UI, `curl`, or extend the app to optionally attach raw payloads to debug output.
