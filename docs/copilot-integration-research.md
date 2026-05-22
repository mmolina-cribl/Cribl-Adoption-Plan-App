# Research: Integrating Cribl Copilot (Adoption Plan / App Platform)

This document implements the engineering research plan for **Cribl Copilot / Cribl AI** vs **BYOL** LLMs in the Adoption Plan app. It does **not** ship product code; it records **public-doc findings**, a **reference implementation** (Cribl APM), **manual verification steps** for `/ai/*` from this app’s host context, and **internal questions** for Cribl platform / AI teams.

---

## 1. What Cribl documents today (public)

Primary source: [Cribl AI | Cribl Docs](https://docs.cribl.io/copilot/).

| Surface | Role | Relevance to Adoption Plan iframe |
|--------|------|-----------------------------------|
| **Copilot chatbot** | Suite-wide widget (bottom-right); RAG over docs + read-only deployment inspection | **No documented embed API** for the same widget inside a custom App Platform iframe. |
| **Copilot Editor**, **Guard** workflows, **Search** assistants, **Search investigations** | Product-scoped AI | Not drop-in for `PlanState` / adoption workbook unless Cribl exposes a **new agent** or **tools** for that domain. |
| **[MCP integrations](https://docs.cribl.io/copilot/mcp-integrations)** | Cribl AI agents connect **outbound** to external MCP servers | **Only Search investigations** uses MCP today. **Not** a browser-to-MCP shortcut for this React app without a server bridge. |
| **[Cribl MCP Server](https://docs.cribl.io/cribl-mcp-server/)** | External MCP **clients** → Cribl | For Cursor / Claude Desktop, etc.—orthogonal to in-iframe UI. |
| **[Custom AI Providers (BYOAI)](https://docs.cribl.io/copilot/cribl-byoai)** | Route **supported** Cribl AI features through **your** LLM | Still tied to **Cribl-managed feature surfaces**, not a generic “bring any Copilot into any app.” |
| **FedRAMP / Gov** | Same overview: Cribl AI **not available** in Cribl.Cloud Government | Any **Cribl-hosted** Copilot path is a **non-starter** there unless policy changes; **BYOL via `proxies.yml`** (see [AGENTS.md](../AGENTS.md)) may still be org-governed separately. |

---

## 2. Reference implementation: `criblio/apm` (NDJSON + tool loop)

The **[criblio/apm](https://github.com/criblio/apm)** app ships an **embedded “Copilot Investigator”** UI. It is the best public **code reference** for calling **Cribl AI agent HTTP APIs** from an App Platform `fetch` context.

### 2.1 Endpoints (from upstream `src/api/agent.ts`)

| Method | Path (relative to `window.CRIBL_API_URL`) | Purpose |
|--------|--------------------------------------------|---------|
| `POST` | `/ai/q/agents/local_search` | Streaming **NDJSON** agent turn; OpenAI-style `tool_calls` in stream. |
| `POST` | `/ai/event` | Best-effort analytics (`logAgentEvent`); native UI parity. |

Full URL in code: `` `${apiUrl()}/ai/q/agents/local_search` `` where `apiUrl()` is `window.CRIBL_API_URL ?? …` ([source](https://github.com/criblio/apm/blob/master/src/api/agent.ts)).

### 2.2 Protocol sketch

1. Client `POST`s JSON body: `messages`, `stream: true`, `sessionId`, `context`, optional `tools` definitions.
2. Server responds with **NDJSON** (one JSON object per line): text deltas, `tool_calls`, optional `notificationMessageType` frames, occasional `role: "tool"` server-side results.
3. Client **`agentLoop.ts`** implements the classic **tool loop**: append assistant message + tool results to `messages`, `POST` again until the model returns text with **no** pending tool calls (see [agentLoop.ts](https://github.com/criblio/apm/blob/master/src/api/agentLoop.ts)).

### 2.3 Operational lessons (from APM comments)

- **Proxy time-to-first-byte**: Long agent turns can hit **~30s** App Platform proxy behavior ([AGENTS.md](../AGENTS.md) documents a 30s timeout). APM caps turns partly for this reason.
- **`SessionExpiredError`**: 5xx bodies mentioning **“Bearer Token has expired”** reflect a **Cribl AI bearer token cache** issue (distinct from normal session); UI should not infinite-retry—see [InvestigatePage.tsx](https://github.com/criblio/apm/blob/master/src/routes/InvestigatePage.tsx) error copy.

### 2.4 Why `local_search` is not the Adoption Plan agent

`local_search` is **Search investigations** tooling (KQL, traces, datasets). Adoption Plan needs **plan digest + doc guidance** (and optionally read-only Leader metadata already planned for tenant import)—**different tools and safety scope**. Reusing `local_search` from this app would be **architecturally wrong** unless Cribl **redefines** that agent (unlikely without platform work).

---

## 3. Route / proxy spike: `/ai/*` from the Adoption Plan host

[AGENTS.md](../AGENTS.md) **URL rewriting table** explicitly mentions:

- `/kvstore/...`, `/proxy/...`, external `https://...`, and **pass-through** example `CRIBL_API_URL + '/search/jobs'`.

It does **not** explicitly list **`/ai/q/agents/*`** or **`/ai/event`**. Whether those paths are **passed through**, **rewritten**, or **blocked** for a pack **not** hosted inside Cribl Search must be **verified in a real workspace**.

### 3.1 Manual verification (run inside the packaged app iframe)

Prerequisites: app installed in a **non-Gov** workspace where **Cribl AI is enabled** and consented.

1. Open the Adoption Plan app from the Cribl UI (so `window.CRIBL_API_URL` is set).
2. Open **DevTools → Console** and run:

```js
const base = window.CRIBL_API_URL;
if (!base) {
  console.error('CRIBL_API_URL missing — not in App Platform iframe');
} else {
  const probe = async (path, init) => {
    const url = base.replace(/\/$/, '') + path;
    console.log('GET/POST', url);
    try {
      const r = await fetch(url, { ...init, headers: { ...(init?.headers || {}), accept: init?.method === 'POST' ? 'application/json' : '*/*' } });
      console.log(path, r.status, r.statusText);
      const t = await r.text();
      console.log(path, 'body prefix:', t.slice(0, 200));
    } catch (e) {
      console.error(path, e);
    }
  };
  // Event endpoint: should accept POST with JSON (APM sends analytics here)
  await probe('/ai/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientTimestamp: Date.now(),
      eventType: 'AdoptionPlanProbe',
      eventClass: 'connectivity',
      surface: 'adoptionPlanResearch',
    }),
  });
  // Agent endpoint: OPTIONS or POST — expect 4xx without full agent body, but NOT network/CORS failure from proxy
  await probe('/ai/q/agents/local_search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [], stream: false, sessionId: 'probe', context: {} }),
  });
}
```

3. **Interpret results**

| Outcome | Meaning |
|---------|--------|
| `404` / `403` on `/ai/q/agents/...` with JSON body | Route likely reached Leader; **authz or agent name** may gate usage—follow up with Cribl. |
| **CORS / network error** on `fetch(CRIBL_API_URL + '/ai/...')` | Proxy or host may **block** this path from this app context—**must** escalate to platform. |
| **`401` / consent** messages | Expected if AI disabled or user has not consented—toggle **Settings → AI** and retry. |

Record outcomes in an internal ticket; paste **status + body prefix** (redact tokens).

### 3.2 Gap in AGENTS.md (follow-up)

After verification, consider a **PR to [AGENTS.md](../AGENTS.md)** to document **`/ai/*`** behavior alongside `/search/jobs` so future apps do not rely on APM-only tribal knowledge.

---

## 4. Internal stakeholder questions (Cribl platform / AI)

Send to **App Platform + Cribl AI / Copilot** owners. Answers gate whether **first-party Copilot** is viable vs **BYOL-only** for v1.

1. Is there (or will there be) an **`/ai/q/agents/...`** endpoint (or successor) **supported from arbitrary App Platform packs**, not only apps hosted in **Cribl Search**?
2. Is there a roadmap for an **adoption-plan–scoped** agent (tools: read-only plan digest, doc links, optional Leader metadata) vs extending an existing agent?
3. Can the Adoption Plan iframe **reuse** a **first-party Copilot UI component** (embed / SDK / `postMessage`), or must apps **render their own chat** and call **HTTP APIs only**?
4. What are the **exact** allowed **`CRIBL_API_URL` path prefixes** for Cribl AI from packs **outside** Search?
5. **FedRAMP / Gov**: confirm hard exclusion of Cribl AI; confirm whether **BYOL** via [proxies.yml](../config/proxies.yml) is acceptable under customer compliance rules.

---

## 5. Recommended program conclusion

| Approach | Verdict |
|----------|--------|
| **Embed the global Copilot chatbot widget** inside the iframe | **Undocumented** as public API; needs Cribl confirmation. |
| **Call Cribl-hosted agent HTTP APIs** (APM pattern) | **Credible** if a **suitable agent id + tools** exist for adoption planning—**depends on Cribl**. |
| **MCP from the browser app** | **Not** the documented in-app path. |
| **BYOL LLM** via `proxies.yml` + KV | **Self-serve** per [AGENTS.md](../AGENTS.md); remains the **fallback** until first-party path is confirmed. |

---

## 6. References

- [Cribl AI overview](https://docs.cribl.io/copilot/)
- [Copilot chatbot](https://docs.cribl.io/copilot/copilot-chat)
- [MCP integrations](https://docs.cribl.io/copilot/mcp-integrations)
- [Custom AI Providers (BYOAI)](https://docs.cribl.io/copilot/cribl-byoai)
- [criblio/apm](https://github.com/criblio/apm) — `src/api/agent.ts`, `src/api/agentLoop.ts`, `src/routes/InvestigatePage.tsx`
- [AGENTS.md](../AGENTS.md) — `CRIBL_API_URL`, `fetch` proxy, `proxies.yml`, timeouts
