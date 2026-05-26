# Cribl Adoption Plan Tool — One-pager (standalone & cloud)

Audience: **customers, partners, and security reviewers** evaluating the tool in either delivery form:

| Delivery | What you get |
|----------|----------------|
| **Standalone HTML** | Single file **`cribl-adoption-plan.html`** — no Cribl App install; typical **on‑prem / air‑gapped friendly** when used without optional cloud features (see **Network access**). |
| **Cribl App Platform (cloud / tenant)** | Packaged **`.tgz`** installed on a **Cribl Cloud or on‑prem Cribl** workspace; runs inside the Cribl **Apps** iframe with workspace **Key-Value (KV)** persistence and optional **Import from live tenant**. |

Both builds share the **same UI and Excel v0.9.1 export shape**; only **persistence, network, and a few menu features** differ.

---

## Purpose

The Cribl Adoption Plan Tool is a **browser-based** planning aid used to build and maintain a Cribl adoption plan. It helps document:

- Cribl **Stream** worker groups and **Edge** fleets  
- Data sources feeding those worker groups / fleets  
- Estimated **daily ingest volume**  
- Source **criticality**, compliance context, onboarding timing, and notes  
- **Activation** / use-case planning (tier, base scope, worksheet-oriented use cases)

The tool is intended to make the **Adoption Plan Excel** workflow easier to complete. Users build the plan in an interactive interface and **export** a **styled .xlsx** workbook aligned to the current Cribl Adoption Plan template for review, governance, and handoff.

**Also in the UI (both forms, where enabled):** **Summary** under **Plan** (stakeholder narrative + inventory snapshot, print / Save as PDF); **optional right-rail AI assistant** (bring-your-own **OpenAI** API key in **Settings**) to answer questions about the plan from a short in-app digest — **opt-in** and **network-dependent** (see below).

---

## How it runs

### Standalone HTML (`cribl-adoption-plan.html`)

For environments that **cannot** use Cribl Apps, the tool is provided as a **single self-contained HTML file**. Open it in a **modern browser** (Chrome, Edge, Firefox, or Safari). **No** server, installer, browser extension, or Node.js runtime is required for **core** planning, **Import / Export** of `.xlsx`, or **Summary**.

**Obtain released builds:** [GitHub Releases](https://github.com/mmolina-cribl/Cribl-Adoption-Plan-App/releases) attach **`cribl-adoption-plan.html`** per version (example: `…/releases/download/v2.3.0/cribl-adoption-plan.html`). Your CSE may also deliver the same file directly.

### Cribl App Platform (installed app)

The same application is installed on the tenant as a **Cribl App** (packaged `.tgz` per workspace procedures). It runs **inside the browser** in the Cribl **Apps** UI. Plan data is read and written through the platform’s **KV APIs** into the app’s storage on **that workspace** (not a separate vendor-hosted SaaS for this tool).

**Cloud-only / iframe-only features** include **Import from live tenant** (optional bootstrap of worker groups / fleets / configured sources from the workspace **Leader** APIs when an administrator uses **File → Import** — user-initiated, not a background scan).

---

## What it accesses

### Common (both deliveries)

- Data **manually entered** in the tool  
- Excel workbooks the user **explicitly** selects through the **Import** file picker  
- Data the app persists for continuity (**localStorage** vs **workspace KV** — see **Data storage**)  
- Files the user **explicitly** exports or downloads (`.xlsx`, print / PDF from the browser)

It does **not** automatically scan local directories, read arbitrary OS or hardware telemetry, or modify Cribl product configuration on disk.

### Standalone-specific

- **No** Cribl deployment APIs are called for **default** planning when `CRIBL_API_URL` is not present: draft state uses **`localStorage`** scoped to the browser profile and the **exact file path / origin** of the HTML file.

### Cloud / App Platform–specific

- The browser tab calls **your workspace’s Cribl App / KV HTTP APIs** (same tenant session) to load and save plan state and small UI preferences, per platform rules.  
- **Import from live tenant** (when shown) calls **Leader-oriented HTTP APIs** on **your** Cribl deployment to read topology / route / input metadata the user chooses to import — only when triggered from the UI. **Import from diagnostic bundle** uses only the file the user selects (no extra network call to Cribl for that step). On **Cribl.Cloud**, diagnostics are **Leader-centric**; **per-worker / per-node** bundle workflows differ from self-managed Stream, so **live tenant import** is often the practical way to hydrate the full plan from Cloud.

---

## Network access

### Standalone HTML

- **Core planning (default):** Import `.xlsx`, **diagnostic bundle** (`.tar.gz` / `.tgz` — offline parse of `groups/*/inputs.yml` when you have an exported archive; **customer-managed** deployments; Cloud users often rely on **live tenant import** instead), edit, export `.xlsx`, and use **Summary** without **requiring** internet or Cribl connectivity.  
- **Optional AI assistant:** If an **OpenAI API key** is saved in **Settings**, the browser may contact **OpenAI** and (for assistant tools) other **HTTPS endpoints** you allow by policy (e.g. **GitHub**, **Cribl docs**) from the user’s machine. **Disable by not configuring a key.** Use a **trusted machine** and your org’s key-handling standards.  
- The tool does **not** “phone home” to a separate Cribl-hosted database for the plan; **Excel export** remains the portable handoff artifact.

### Cribl App Platform

- **Normal use:** HTTPS traffic stays in scope of **your Cribl workspace** (Apps + KV + same-tab Leader APIs as configured for the product).  
- **Optional AI assistant:** Outbound **OpenAI** (and tool domains declared in the app’s **`proxies.yml`**, e.g. **GitHub**, **Cribl docs**) is used **only when** workspace admins have configured **proxies + pack KV** for the key and users choose to use the assistant. Planning does **not** require it.

---

## Data storage

### Standalone

Draft state is stored in **`localStorage`** so work is not lost on refresh.

- **`localStorage` is scoped** to the browser profile and the **path / origin** of the HTML file. Moving the file to a different folder or opening a copy elsewhere can **orphan** the prior draft.  
- The **recommended durable save** is **Excel Export** (sidebar **Export** or **Summary → Download workbook**). Store exported workbooks per the customer’s **document-handling and classification** policy.

### Cribl App Platform

Plan and key preferences are stored in the workspace **App Key-Value store** (and optionally browser session behavior inside the iframe), governed by **Cribl access control** and admin practices. **Excel Export** is still the standard **portable handoff** outside the app.

---

## Data handling

The tool processes planning data **in the browser** (and, in the cloud form, persists blobs the user’s session is permitted to write via **KV**). Planning data may include source names, estimated volumes, worker group / fleet names, notes (onboarding, stakeholders, compliance, use cases), and Activation selections.

Customers should treat **exported workbooks** and any **KV-backed drafts** according to **internal data classification and retention** policies and Cribl workspace governance.

---

## What it produces

An **Excel workbook** in the **current Cribl Adoption Plan (v0.9.1 family)** format. The workbook can be reviewed, edited offline, shared, and archived like any other Adoption Plan spreadsheet.

---

## What it does not do

Neither delivery:

- Installs **native** desktop agents (it is a web app in the browser)  
- Modifies the **OS** outside normal browser download / save behavior  
- **Uploads** plan Excel files to Cribl **automatically** — export is **user-initiated**  
- Replaces **official Cribl product documentation** or live **Leader** configuration — it **plans** and **exports**; operators still apply changes in Cribl Stream / Edge as usual  

**Standalone** additionally does **not** connect to **Cribl Cloud or Leader APIs** unless you later open a build under a Cribl shell that injects those globals (not the typical customer `file://` use case).

**Cloud** does **not** silently push the adoption plan into production pipelines; **Import from live tenant** only **reads** selected Leader metadata into the **in-memory plan model** for user review before export.

---

## Recommended usage

### Standalone

1. Obtain **`cribl-adoption-plan.html`** from [Releases](https://github.com/mmolina-cribl/Cribl-Adoption-Plan-App/releases) or your CSE.  
2. Open in a modern browser (`file://` or internal HTTPS hosting).  
3. Build a new plan or **Import** an existing Adoption Plan `.xlsx`.  
4. Review and edit; use **Summary** as needed.  
5. **Export** the updated workbook and store it in the customer’s normal document system.  
6. **Optional:** Configure the AI assistant only if policy allows outbound access and a managed OpenAI key.

### Cribl App Platform

1. Install the app pack per workspace procedure.  
2. Open the app from **Apps**; allow KV to hydrate the plan.  
3. **Import** workbook and/or use **Import from live tenant** when appropriate; edit.  
4. **Export** for offline review and handoff.  
5. Configure **OpenAI + proxies** only if the organization wants the assistant; otherwise leave disabled.

---

## Security review summary (short)

| Topic | Standalone HTML | Installed Cribl App |
|--------|-----------------|---------------------|
| **Execution** | Client-side in the browser tab | Client-side in the browser tab inside Cribl Apps |
| **Default network** | No Cribl calls required for core Excel workflow | HTTPS to **your** Cribl workspace for KV / app APIs |
| **Sensitive planning data** | Stays in browser + user-chosen exports unless optional AI is enabled | Stored per workspace KV policy + user-chosen exports; optional AI via **your** proxy config |
| **Handoff artifact** | User-controlled **.xlsx** export | User-controlled **.xlsx** export |

For **app-specific issues or feedback**, use **Settings → Feedback & app support** in the UI or contact **mmolina@cribl.io**. For build version, see **Settings → About this build**.

Technical depth: [`README.md`](../README.md), [`AGENTS.md`](../AGENTS.md) (App Platform), [`CRIBL_DEV_NOTES.md`](../CRIBL_DEV_NOTES.md).
