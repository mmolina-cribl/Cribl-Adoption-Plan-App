# Adoption Plan

**Adoption Plan** is a field-facing browser app for designing a customer’s
[Cribl Stream](https://cribl.io/stream/) and [Cribl Edge](https://cribl.io/edge/)
adoption — worker groups, fleets, sources, and projected daily volume — with
**gold v0.9.1 Excel** import/export (styled workbook round-trip).

The same codebase ships as:

- **Cribl App Platform** install (`.tgz`) — primary deployment; state in per-app **KV**.
- **Standalone HTML** (`.html`) — single file for customers **without** the App
  Platform; state in **`localStorage`**; **Export .xlsx** is the durable handoff.

**Repository:** [github.com/mmolina-cribl/Cribl-Adoption-Plan-App](https://github.com/mmolina-cribl/Cribl-Adoption-Plan-App)

**Security / vendor review:** Third-party open-source libraries are listed in
[**Dependencies & supply chain**](#dependencies--supply-chain) (direct packages +
roles, resolved versions, SBOM commands). The **complete** graph (every transitive
package, tarball URL, and integrity hash) is only in
[`package-lock.json`](./package-lock.json) at the **git tag / commit** you audit
— not duplicated in full in this README. For data egress (imports vs optional AI),
see `docs/adoption-plan-tool-one-pager.md` when you maintain that tree locally
(see [Documentation](#documentation)).

---

## Table of contents

1. [Quick start](#quick-start)
2. [Install in Cribl and standalone distribution](#install-in-cribl-and-standalone-distribution)
3. [Development](#development)
4. [Build and release](#build-and-release)
5. [Testing](#testing)
6. [What you can do in the app](#what-you-can-do-in-the-app)
7. [Import and export](#import-and-export)
8. [Dependencies & supply chain](#dependencies--supply-chain)
9. [Configuration](#configuration)
10. [Project layout](#project-layout)
11. [Documentation](#documentation)
12. [Troubleshooting](#troubleshooting)
13. [Versioning](#versioning)
14. [Author & credits](#author--credits)

---

> “Your end-to-end Cribl Stream and Edge rollout in one place — the worker
> groups and fleets, the sources feeding them, and the daily volume each one
> contributes.”

**Release line:** **v2.3.x** — tenant + diagnostic import, Summary / executive
readout, AI assistant (session modes, plan patch proposals), and more; see
GitHub **Release** notes for the tag (or `docs/releases/v2.3.0.md` locally). **v2.3.1** is a **patch**: per-WG / per-fleet **Excel** validation and color scales past row **21** when a group has **20+ sources**, plus **`propose_plan_patch`** structural ops (add/move sources and groups), digest **ids**, assistant **tool/prompt** alignment, and rollup **source counts**. Gold **v0.9.1** alignment
and design history: [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md#v20-schema-rewrite-gold-v091).

---

## Quick start

**Installing on a Cribl tenant?** Use **[Install in Cribl and standalone distribution](#install-in-cribl-and-standalone-distribution)** below — the workspace **Apps → Install** flow must use **Import from file** with the release **`.tgz`**. **Import from git** and **Import from URL** are not supported for this app.

**Prerequisites:** Node.js + npm (for building from source; **not** required for
end users of a released `.html` or `.tgz`).

```bash
git clone https://github.com/mmolina-cribl/Cribl-Adoption-Plan-App.git
cd Cribl-Adoption-Plan-App
npm install

# Dev server → http://localhost:5173
npm run dev

# Lint
npm run lint

# Unit tests
npm test
```

Without `window.CRIBL_API_URL`, the app uses **`localStorage`** for plan state
(same behavior as standalone). See [Configuration](#configuration).

---

## Install in Cribl and standalone distribution

### Cribl App Platform (`.tgz`)

In the Cribl workspace, open **Settings → Apps → Install** (or your org’s equivalent). In the install dialog, choose **Import from file** only — **Import from git** and **Import from URL** do **not** work for Adoption Plan (they fail with errors such as **app not found**).

1. Download **`adoption-plan-<version>.tgz`** from **[GitHub Releases](https://github.com/mmolina-cribl/Cribl-Adoption-Plan-App/releases)** for the version you want (direct link pattern: `…/releases/download/v<version>/adoption-plan-<version>.tgz`). Do **not** use GitHub’s auto-generated **Source code (tar.gz)** — that is not a Cribl app pack.
2. In **Apps → Install**, select **Import from file** and upload that downloaded **`.tgz`**.
3. Open the app from **Apps**; plan state persists to **workspace KV**.

**Maintainers / CI:** To produce the same pack locally instead of downloading, use a tagged checkout and run **`npm run package`** (see [Build and release](#build-and-release)); the artifact is **`build/adoption-plan-<version>.tgz`** (version from `package.json`).

### Standalone HTML (customer handoff)

1. Run **`npm run build:standalone`**.
2. Deliver **`dist-standalone/cribl-adoption-plan.html`** (~2.2 MB raw / ~720 KB
   gzipped — comfortable to email), or point customers at the same asset on
   [GitHub Releases](https://github.com/mmolina-cribl/Cribl-Adoption-Plan-App/releases)
   (e.g. `…/releases/download/v2.3.1/cribl-adoption-plan.html`).
3. Customer opens the file in a modern browser (`file://` or hosted HTTPS). No
   Node, no server.

For **security / data-boundary** language (imports, AI egress, KV), use the
customer one-pager at `docs/adoption-plan-tool-one-pager.md` when you keep that
file under the local `docs/` tree (see [Documentation](#documentation)).

---

## Development

### Everyday commands

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Vite dev server at `http://localhost:5173` |
| `npm run build` | `tsc -b` + Vite production build (App Platform `dist/`) |
| `npm run build:standalone` | `tsc -b` + single-file HTML under `dist-standalone/` |
| `npm run package` | `npm run build` + `build/adoption-plan-<version>.tgz` |
| `npm run release:upload-github-assets` | After `package` + `build:standalone`, uploads **`.tgz` + `.html`** to the GitHub release for the current `package.json` version (needs `gh`) |
| `npm run lint` | ESLint |
| `npm test` | Vitest (`vitest run`) |
| `npm run preview` | Serve last production build locally |

### Running outside the Cribl iframe

When `window.CRIBL_API_URL` is **undefined** (plain `npm run dev`), the KV helper
falls back to **`localStorage`** with the same namespacing as inside the iframe,
so local work persists across refreshes without extra config — same path the
standalone build uses at runtime.

---

## Build and release

Two production configs share one source tree; outputs differ:

| Target | Command | Output | Persistence |
| ------ | ------- | ------ | ----------- |
| **Cribl App** | `npm run build` → `npm run package` | `build/adoption-plan-<version>.tgz` | Workspace **KV** |
| **Standalone HTML** | `npm run build:standalone` | `dist-standalone/cribl-adoption-plan.html` | **`localStorage`** |

The standalone build **inlines** `public/adoption-plan-empty.xlsx` (gold v0.9.1)
as base64 at build time so Import/Export match the iframe behavior — **no**
extra files beside the `.html`.

**GitHub Release:** attach **`build/adoption-plan-<version>.tgz`** (from `npm run package`) **and** **`dist-standalone/cribl-adoption-plan.html`** (from `npm run build:standalone`). Use `npm run release:upload-github-assets` after the tag exists, or see [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md#release-checklist-github--release-assets). Do not use GitHub’s **Source code (tar.gz)** for Cribl installs.

---

## Testing

```bash
npm test
```

Vitest covers selected libraries (e.g. executive summary markdown post-processing).
Add tests alongside modules under `src/` when behavior is non-trivial.

---

## What you can do in the app

- **Plan dashboard** — Ingest snapshot, worker-group mix, recent sources,
  onboarding status (Planned / In Progress / Complete).
- **Interactive resource maps** — Drag sources onto worker groups / detach;
  plan-wide and per-WG views with search.
- **Worker groups** — Capacity (ingest / egress / throughput / 1-day storage),
  worker count, hosting taxonomy, topology detail; bulk actions on the index.
- **Sources** — Volume, criticality, compliance, onboarding window, tile
  catalog, free-text detail; bulk actions on the index.
- **Excel round-trip** — Import v0.9.1-shaped `.xlsx`; Export styled workbook
  (INSTRUCTIONS, PS Use Case Worksheet, Stream/Edge overviews, `wg-*` / `fl-*`
  sheets, `input_data`) using the imported file as the **visual shell**.
- **Animations preference** — Settings toggle + `prefers-reduced-motion`.
- **Import from live tenant** — In the App Platform, **File → Import** can
  bootstrap worker groups / fleets and **configured sources** from Leader APIs
  (`/master/groups`, per-group **`/m/{group}/system/inputs`**). Worker-detail /
  hosting hints from `estimatedIngestRate` / `cloud` / `onPrem`; Leader input
  **`description`** → source **additional notes**. **Import debug** shows counts,
  tables, warnings, JSON. Routing (pipelines / destinations) is **not** imported.
  Field matrix: `docs/tenant-import-leader-data.md` (local `docs/` tree).
- **Import from diagnostic bundle** — **File → Import** accepts Stream/Edge
  **`.tar.gz` / `.tgz`** and parses `groups/<id>/…/inputs.yml` in the browser.
  Cloud vs self-managed nuance: `docs/diag-import.md` (local `docs/` tree).
- **Activation** (Plan nav) — PS Use Case Worksheet aligned to Excel.
- **Summary** (Plan nav) — Executive narrative, provenance, full inventory;
  **Download summary (.md)** and **Download workbook (.xlsx)**. Optional
  **AI-assisted talking points** (BYOL OpenAI): capped JSON snapshot; verify before
  external sharing.
- **AI ASSISTANT (right rail)** — Optional BYOL OpenAI (`gpt-4o-mini`), plan digest,
  session modes, **Apply / Dismiss** on proposed plan patches; `proxies.yml` +
  KV per [`AGENTS.md`](./AGENTS.md). Resizable rail width (persisted).

---

## Import and export

### Import (`File → Import`)

- **Adoption plan `.xlsx`** — v0.9.1 gold shape; workbook bytes cached and reused
  as the export shell (styles, merges, conditional formatting, `input_data`).
- **Legacy sheet names** — `wg<name>` / `fl<name>_fleet` still import; see
  [`src/lib/v091SheetNames.ts`](./src/lib/v091SheetNames.ts).
- **Diagnostic bundle** — `.tar.gz` / `.tgz` topology path (no Leader call for
  the parse step).

If nothing is imported yet, Export uses **`public/adoption-plan-empty.xlsx`**
(App build) or the base64-inlined twin (standalone).

### Export

Use sidebar **Export** or **Plan → Summary → Download workbook**. Filename pattern:

```text
<customer name> Adoption Plan - MM-DD-YYYY.xlsx
```

Customer name (header, top-right) is also written to workbook **`Props.Title`**.

---

## Dependencies & supply chain

For **security**, **vendor**, and **compliance** reviewers (and anyone generating
an SBOM). Released **`.html`** / **`.tgz`** artifacts **do not** run `npm install`
on the customer machine — **runtime** libraries below are **compiled into** the
JavaScript bundle at build time.

**Source of truth for “every package”:** [`package-lock.json`](./package-lock.json)
pins the full transitive tree (on the order of **400+** packages including nested
dependencies of `exceljs`, `xlsx`, Vite, etc.). **Declared ranges** live in [`package.json`](./package.json).

**Resolved direct dependency versions** (from `package-lock.json` at app **v2.3.0**;
your audit should use the lockfile at **your** checked-out tag or release commit):

> **Maintenance:** If this README’s version column lags a future tag, read
> **`package.json` / `package-lock.json`** on the commit you ship — those files
> are authoritative.

### Production bundle (`dependencies`)

These packages (and their transitive dependencies) contribute to the **browser
bundle** customers run.

| Package | Resolved (v2.3.0 lock) | Role in this app |
| ------- | --------------------- | ---------------- |
| [react](https://www.npmjs.com/package/react) | 19.2.5 | UI |
| [react-dom](https://www.npmjs.com/package/react-dom) | 19.2.5 | UI DOM rendering |
| [react-router-dom](https://www.npmjs.com/package/react-router-dom) | 7.14.2 | Client-side routing |
| [exceljs](https://www.npmjs.com/package/exceljs) | 4.4.0 | Styled **export** (OOXML shell, style restore) |
| [xlsx](https://www.npmjs.com/package/xlsx) (SheetJS) | 0.18.5 | **Import**: parse `.xlsx` into plan state |
| [jszip](https://www.npmjs.com/package/jszip) | 3.10.1 | ZIP / `.tar.gz` diagnostic bundle reads |
| [yaml](https://www.npmjs.com/package/yaml) | 2.9.0 | Parse `inputs.yml` in diag import |
| [buffer](https://www.npmjs.com/package/buffer) | 6.0.3 | Browser `Buffer` for binary / workbook paths |

### Build-time only (`devDependencies`)

Used on the machine that runs **`npm install`** / **`npm ci`** and **`npm run build`**.
They shape the bundle but are **not** shipped as separate npm packages to end
users (the compiled output does not `require('eslint')` in the browser).

| Package | Resolved (v2.3.0 lock) | Role |
| ------- | --------------------- | ---- |
| [vite](https://www.npmjs.com/package/vite) | 8.0.10 | Dev server + production bundler |
| [@vitejs/plugin-react](https://www.npmjs.com/package/@vitejs/plugin-react) | 6.0.1 | React refresh + JSX transform |
| [vite-plugin-singlefile](https://www.npmjs.com/package/vite-plugin-singlefile) | 2.3.3 | Single-file standalone HTML |
| [typescript](https://www.npmjs.com/package/typescript) | 6.0.3 | `tsc -b` typecheck before Vite |
| [tailwindcss](https://www.npmjs.com/package/tailwindcss) | 4.2.4 | CSS utilities |
| [@tailwindcss/vite](https://www.npmjs.com/package/@tailwindcss/vite) | 4.2.4 | Tailwind Vite plugin |
| [eslint](https://www.npmjs.com/package/eslint) | 10.2.1 | Lint |
| [@eslint/js](https://www.npmjs.com/package/@eslint/js) | 10.0.1 | ESLint recommended JS rules |
| [typescript-eslint](https://www.npmjs.com/package/typescript-eslint) | 8.59.1 | Type-aware ESLint |
| [eslint-plugin-react-hooks](https://www.npmjs.com/package/eslint-plugin-react-hooks) | 7.1.1 | React hooks lint rules |
| [eslint-plugin-react-refresh](https://www.npmjs.com/package/eslint-plugin-react-refresh) | 0.5.2 | React Fast Refresh lint |
| [globals](https://www.npmjs.com/package/globals) | 17.5.0 | Global identifiers for ESLint |
| [vitest](https://www.npmjs.com/package/vitest) | 3.2.4 | Unit tests (`npm test`) |
| [@types/node](https://www.npmjs.com/package/@types/node) | 24.12.2 | TypeScript types |
| [@types/react](https://www.npmjs.com/package/@types/react) | 19.2.14 | TypeScript types |
| [@types/react-dom](https://www.npmjs.com/package/@types/react-dom) | 19.2.3 | TypeScript types |
| [@types/xlsx](https://www.npmjs.com/package/@types/xlsx) | 0.0.35 | TypeScript types for SheetJS |

### Shipped build (typical customer) — quick answers

| Question | Answer |
| -------- | ------ |
| Need Node/npm to **use** the tool? | **No** for release `.html` / installed `.tgz`. |
| Where is the **full** dependency graph? | [`package-lock.json`](./package-lock.json) at the **exact commit** that produced your artifact. |
| What ships in the browser? | Compiled JS includes **production** `dependencies` and their **transitives** — not ESLint/Vitest/etc. |

### SBOM / license inventory

```bash
npm ci
npm ls --all              # full tree (large)
npm ls --omit=dev --all   # production subtree only (still includes transitive deps)
```

To aggregate **licenses**, common options are `npx license-checker --summary` or
importing `package-lock.json` into your org’s SBOM / SCA tool — not wired as a
repo script here.

**Supply chain:** `npm install` / `npm ci` contacts the **npm registry** (or your
org’s npm mirror). End users opening standalone **`.html`** do **not** download
`node_modules`.

---

## Configuration

Typically injected by the **Cribl host** or absent in standalone / plain dev.

| Variable / artifact | Effect |
| ------------------- | ------ |
| `window.CRIBL_API_URL` | When set (Apps iframe), **KV** APIs target this workspace base; **Import from live tenant** calls Leader-oriented HTTP APIs on **your** deployment. |
| `window.CRIBL_API_URL` **unset** | **`localStorage`** fallback (dev + standalone). |
| `config/proxies.yml` | Declares outbound HTTPS domains the app may call through the platform fetch proxy (e.g. for AI tools). See [`AGENTS.md`](./AGENTS.md). |
| OpenAI API key in **Settings** | Optional AI assistant + Summary talking points; BYOL; see **Customer data flows** in `docs/adoption-plan-tool-one-pager.md` when you maintain that file locally. |

---

## Project layout

```text
Cribl-Adoption-Plan-App/
├── src/
│   ├── App.tsx              # Routes + view switch
│   ├── components/          # React UI (Plan, Import, Export, Settings, …)
│   ├── hooks/               # usePlanStorage, …
│   ├── lib/                 # KV, import/export, Excel v0.9.1, activation, AI helpers, …
│   ├── data/                # planDataMap, referenceData (tiles, INSTRUCTIONS)
│   ├── types/               # planTypes, cribl globals
│   └── assets/              # e.g. cribl-ai-icon (inlined in standalone)
├── config/
│   └── proxies.yml          # External-domain allowlist for fetch proxy
├── public/
│   ├── adoption-plan-empty.xlsx   # Gold shell (runtime fetch App / inlined standalone)
│   └── favicon.svg
├── docs/                    # Optional local tree (gitignored): one-pager, releases/, import guides
├── scripts/
│   ├── package.mjs          # .tgz assembly
│   └── pkgutil.mjs
├── vite.config.ts           # App Platform build
└── vite.standalone.config.ts
```

---

## Documentation

The **`docs/`** directory at the repo root is **gitignored** (see
[`.gitignore`](./.gitignore)): long-form guides, release-note drafts, and
customer-facing Markdown **do not ship with a bare `git clone`**. Maintainers
typically keep that tree locally and/or attach key files (one-pager, release
notes) to **GitHub Releases** or an internal wiki.

| Location | Description |
| -------- | ----------- |
| **`docs/adoption-plan-tool-one-pager.md`** (local) | Customer / security summary (standalone + App; **Customer data flows** for imports vs AI) |
| **`docs/releases/v*.md`** (local) | Version-scoped release notes drafts |
| **`docs/tenant-import-leader-data.md`** (local) | Leader vs plan import matrix |
| **`docs/diag-import.md`** (local) | Diagnostic bundle import scope |
| **`docs/copilot-integration-research.md`** (local) | Copilot vs BYOL research |
| **This README → [Dependencies & supply chain](#dependencies--supply-chain)** | Direct npm inventory + SBOM commands; pair with `package-lock.json` on the tag you ship |
| [`AGENTS.md`](./AGENTS.md) | Cribl App Platform developer guide (KV, `proxies.yml`, iframe globals) |
| [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md) | Engineering decisions, packaging, known issues (`__local__` shell) |
| [`ROADMAP.md`](./ROADMAP.md) | Themes and exploration backlog |

---

## Troubleshooting

| Symptom | What to check |
| ------- | ------------- |
| **“App not found” (or similar) when installing the pack** | Use **Settings → Apps → Install → Import from file** with **`adoption-plan-<version>.tgz`** from [Releases](https://github.com/mmolina-cribl/Cribl-Adoption-Plan-App/releases). Do **not** use **Import from git**, **Import from URL**, or GitHub’s **Source code** archive — those paths are not valid for this app. |
| **Plan lost after reload in `__local__` shell** | **`__local__`** has no pack KV; storage can be unreliable. Use a **deployed** app for QA, or Export / Summary → workbook. [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md) |
| **“Not a supported workbook” on Import** | File must match v0.9.1 adoption shape (or legacy wg/fl names). Try a fresh export from this app. |
| **No Import from live tenant** | Expected on standalone / dev without `CRIBL_API_URL` (Apps iframe feature). |
| **AI or Summary generation fails** | Key / `proxies.yml` / workspace policy; outbound HTTPS blocked. |
| **Runtime: which browser?** | Modern Chrome, Edge, Firefox, Safari. |
| **Data sent to third parties?** | Imports + Excel core paths: **no OpenAI** by themselves. **Optional AI** sends a capped digest — see the one-pager section **Customer data flows** in `docs/adoption-plan-tool-one-pager.md` when you have that file locally. |
| **App semver vs Cribl Stream version** | **Settings → About** is **this tool**; not Leader product version unless captured in the plan. |

For **Cribl Copilot vs BYOL** positioning, see `docs/copilot-integration-research.md` in your local `docs/` tree when available.

---

## Versioning

Semver in lockstep: **`package.json`** + **`package-lock.json`**. One version
for both build targets.

- **2.3.x** — Tenant import, diag import, Summary / executive readout, AI modes
  + plan patches, layout polish, Credits; see **GitHub Release** notes for the
  tag and [`ROADMAP.md`](./ROADMAP.md) (local `docs/releases/v2.3.0.md` if you maintain it).
- **2.0.x** — Gold v0.9.1 (`wg-*` / `fl-*`), overviews, PS Use Case Worksheet,
  Activation, resource maps, standalone HTML, OOXML export fidelity.
- **1.x** — Earlier interactive maps, tiles, bulk actions, topology — see git tags.

**Artifacts:** `npm run package` → **`.tgz`**; `npm run build:standalone` → **`.html`**.

---

## Author & credits

**Author:** Michael Molina — Cribl Sr. CSE.

**Credits:** Thank you to [dadamic@cribl.io](mailto:dadamic@cribl.io),
[rallen@cribl.io](mailto:rallen@cribl.io), and
[jdeslauriers@cribl.io](mailto:jdeslauriers@cribl.io) for early field feedback on
adoption planning — it helped shape this tool for teams planning Cribl
deployments.
