# Import from diagnostic bundle — data scope

When **File → Import → Import from diagnostic bundle** is used, the Adoption Plan app
parses a **Cribl Stream / Edge diagnostic archive** (`.tar.gz` / `.tgz`) **entirely in
the browser**. Nothing is uploaded to Cribl or to a third party as part of this step.

Implementation:

- `src/lib/diagTarGz.ts` — gzip decompression (`DecompressionStream`) + POSIX **ustar** tar listing
- `src/lib/diagHarvest.ts` — discover `groups/<groupId>/…`, read `inputs.yml` / `inputs/*.yml`, map into the same harvest shape as tenant import
- `src/lib/topologyToPlan.ts` — `topologyHarvestToPlanState` (shared with live tenant import)
- `src/components/DiagImportSection.tsx` — UI on the Import page

`planProvenance.kind` is set to **`diag`** after a successful import.

---

## Cribl.Cloud vs customer-managed (on-premises)

**The importer is identical** for every `.tar.gz` / `.tgz` file: it only reflects **what paths and YAML are inside the archive**. What differs is **how you get that file** and **what Cribl typically puts in it**.

### Cribl.Cloud

On **Cribl.Cloud**, Stream/Edge diagnostics in the product UI are **Leader-oriented**: you can create diagnostics from the Leader (often to share with Cribl Support). What you **do not** get the same way as on many **self-managed** deployments is **per–worker / per–node** diagnostic creation and bundle export from the Workers UI—so it is harder to produce a tarball that contains every worker group’s full `groups/<id>/local/…` tree from Cloud’s worker-facing flows alone.

How bundles are **shared or downloaded** can still differ from self-managed Stream; see Cribl’s **Diagnosing issues** documentation for your product and edition: [docs.cribl.io/stream/diagnosing](https://docs.cribl.io/stream/diagnosing).

- A **Leader**-originated archive may still contain mostly **Leader-scope** `local/cribl/inputs.yml` and omit rich `groups/<workerGroup>/local/` trees, which often surfaces as a single synthetic **Leader (global)** row in this app.
- **Import from live tenant** (Leader APIs) remains the usual way to hydrate **all** worker groups and configured sources from Cloud in this tool.

### Customer-managed / on-premises

On **self-managed** Stream/Edge you can typically **create and download** diagnostic bundles from the Leader or Worker UI (Worker access often uses **Teleport / UI access** on the parent worker group or fleet). Bundles may also be available under **`$CRIBL_HOME/diag`** and re-downloadable from the UI, depending on version and procedure.

- **Worker node** archives usually include **`groups/<id>/local/cribl/inputs.yml`** for that node’s group, so this import path is more likely to show **multiple explicit worker groups**.
- **Leader-only** archives vary: you may see several groups if full per-group trees are on disk in the bundle, or mostly **Leader (global)** if not.

---

## What we read from the bundle

| Source path (suffix after any bundle root folder) | Purpose |
| ------------------------------------------------- | ------- |
| `groups/<id>/local/cribl/inputs.yml` (or `.yaml`) | Primary configured **sources** map for that worker group / fleet |
| `groups/<id>/default/cribl/inputs.yml` | Default layer; merged **before** `local/` so local overrides win per input id |
| `groups/<id>/local/cribl/inputs/*.yml` (and `default/…`) | Split input definitions; merged in deterministic order |
| `groups/<id>/local/cribl/groups.yml` | Optional **description**, **type**, **isFleet** hints for Stream vs Edge |
| `local/cribl/inputs.yml` (or `.yaml`) at bundle **root** (any prefix, but path must **not** contain `/groups/`) | **Leader-global** sources (`$CRIBL_HOME/local/cribl/…` in a Leader diag) — shown as one synthetic worker group **“Leader (global)”** in the plan |

We **discover** worker-group ids only from paths that include a real config segment **`/groups/<id>/local/`** or **`/groups/<id>/default/`** (so stray matches like `groups/default/log/…` do not invent empty groups). Stock template dirs (`default`, `defaultHybrid`, `default_fleet`, `default_outpost`, `default_search`) are **skipped** when they have no `inputs.yml` (common in diags). **`default_search`** is never imported.

YAML **`sources` / `inputs`** may be a **map** (id → config) or a **list** of objects with an **`id`** field.

For each input we keep **`id`**, **`type`**, **`disabled`**, and optional **`description`** (description is **not** copied into the plan **Source** name — same rule as tenant import).

---

## What we do **not** read

- **Routes, pipelines, outputs, destinations** — not parsed from the bundle for this import path.
- **Logs, metrics, jobs, git history** — ignored even if present in the archive.
- **Certificates and auth material** — Cribl’s diag tooling excludes many sensitive files; the app does not add special redaction beyond only reading the paths above.

---

## Browser support

**Gzip** decompression uses **`DecompressionStream('gzip')`**. If the browser is too old to provide it, import fails with a clear error — use a current Chromium, Firefox, or Safari.

**Tar** parsing supports common **ustar** layouts produced by `cribl diag create`. Exotic extensions (sparse files, pax global headers) are not targeted; if parsing yields zero files, try re-exporting the bundle or use **Import from live tenant** / **Excel** instead.

---

## Privacy & handling

Diagnostic bundles can still contain **hostnames, paths, or collector parameters**.
Only import bundles you are allowed to process under your customer’s policy. The
**Import debug → Copy full JSON** payload can include raw harvest fields — treat it
like any other sensitive engagement artifact.
