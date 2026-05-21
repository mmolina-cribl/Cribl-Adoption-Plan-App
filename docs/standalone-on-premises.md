# Adoption Plan — standalone HTML (on‑premises) one-pager

This sheet is for **customers and partners** who run the Adoption Plan **without** the Cribl App Platform — the single-file **`cribl-adoption-plan.html`** build.

---

## What this tool is

A **browser-only** planning workbook for designing a Cribl **Stream** and **Edge** adoption: worker groups, fleets, data sources, rough daily volumes, and how data flows between them. The canonical handoff remains a **styled Excel (.xlsx)** file aligned to Cribl’s v0.9.1 Adoption Plan template.

---

## What runs where

| Location | What executes |
|----------|----------------|
| **Your computer** | The HTML file, JavaScript, and UI — all in the browser tab. |
| **Cribl Cloud / servers** | **Nothing** for the standalone build. There is no required backend for core editing, import, or export. |

---

## Data storage and boundaries

- **Plan content** (sources, groups, activation, etc.) is stored in the browser’s **`localStorage`**, scoped to the **exact `file://` path** of the HTML file.
- If someone **moves or copies** the `.html` to another folder, **saved state does not follow** automatically. Treat **File → Export (.xlsx)** as the durable save and share path; use **File → Import** to load it again.
- **Import / Export** of `.xlsx` runs **entirely in the browser**. Generated files are **not uploaded** to Cribl unless you separately email or upload them.

---

## Network behavior

- **Standalone:** no calls to Cribl APIs for normal use. The app uses `localStorage` when `window.CRIBL_API_URL` is undefined (same as opening the file from disk).
- **Optional:** if you run separate automation, hosting, or integrations outside this HTML file, those are **your** deployments — not part of the standalone artifact.

---

## How to obtain the file

Cribl or your CSE provides **`cribl-adoption-plan.html`**, produced with:

```bash
npm run build:standalone
```

Artifact path: **`dist-standalone/cribl-adoption-plan.html`**.

---

## Support and versioning

Open **Settings** in the app to see the **build version** (from `package.json`). Include that version when reporting issues so engineering can match **standalone** vs **App Platform (.tgz)** vs **local dev** builds.

For engineering detail, see [`README.md`](../README.md) and [`CRIBL_DEV_NOTES.md`](../CRIBL_DEV_NOTES.md).
