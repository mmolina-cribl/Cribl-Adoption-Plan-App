# Cribl App Platform Developer Guide

## Installing this pack on a tenant

Use **Settings → Apps → Install** and choose **Import from file** with the release **`adoption-plan-<version>.tgz`** from [GitHub Releases](https://github.com/mmolina-cribl/Cribl-Adoption-Plan-App/releases) (or a locally built copy from `npm run package`). **Import from git** and **Import from URL** are **not** supported for this app. See [**README** — Install in Cribl and standalone distribution](./README.md#install-in-cribl-and-standalone-distribution).

## Global Variables

The following are set on `window` automatically when your app runs inside Cribl. They are read-only and always present.

| Variable | Example | Description |
|---|---|---|
| `CRIBL_API_URL` | `https://localhost:9000/api/v1` | Base URL for all Cribl API calls |
| `CRIBL_BASE_PATH` | `/app-ui/my-app` | The base path your app is mounted at |

## How API Calls Work (Fetch Proxy)

Your app runs inside a sandboxed iframe. The platform **automatically intercepts all `fetch()` calls** to `CRIBL_API_URL` and proxies them through the parent window. This is transparent to your code — just use `fetch()` normally.

**What the proxy does for you:**
- Injects authentication headers (your app never sees or handles auth tokens)
- Rewrites URLs to scope requests to your app
- Streams responses back to your app

**What this means for your code:**
- Use `fetch()` as normal — it just works
- You do NOT need to handle authentication
- You cannot override or replace `window.fetch` (it is locked)
- Requests that don't target `CRIBL_API_URL` are passed through directly (no proxy)

### URL Rewriting Rules

The proxy applies these rewrites automatically:

| What you call | What actually happens | Why |
|---|---|---|
| `fetch(CRIBL_API_URL + '/kvstore/my-key')` | Rewritten to `/api/v1/a/{yourAppId}/kvstore/my-key` | Scopes KV store access to your app |
| `fetch(CRIBL_API_URL + '/proxy/some/path')` | Rewritten to `/api/v1/a/{yourAppId}/proxy/some/path` | Scopes proxy calls to your app |
| `fetch('https://api.example.com/data')` | Rewritten to `/api/v1/a/{yourAppId}/proxy/api.example.com/data` | External calls are routed through the platform proxy |
| `fetch(CRIBL_API_URL + '/search/jobs')` | Passed through as-is | Standard API calls are not rewritten |

**Important:** Your app cannot access other apps' resources. Any request targeting a different app ID will be rejected.

### Request Timeout

Proxied requests time out after **30 seconds** if no response is received. Use `AbortController` if you need to cancel requests earlier.

## Platform APIs

API endpoint definitions are available in `openapi.json` (if downloaded during project setup).

### Key-Value Store

Each app has a scoped KV store. Use `CRIBL_API_URL` as the base — the proxy handles scoping.

| Operation | Method | URL | Body |
|---|---|---|---|
| Get | GET | `CRIBL_API_URL + '/kvstore/the/path/to/key'` | — |
| Set | PUT | `CRIBL_API_URL + '/kvstore/the/path/to/key'` | value |
| Delete | DELETE | `CRIBL_API_URL + '/kvstore/the/path/to/key'` | — |
| List keys | POST | `CRIBL_API_URL + '/kvstore/keys'` | `{ prefix: 'my/key/prefix' }` |

### Config Group Context

Cribl REST API endpoints that don't begin with `/system/` are contextual and can be called in the context of a config group using the prefix `/m/:groupId`. Config groups can be listed using the `/master/groups` endpoint.

Endpoints beginning with `/search/` should ALWAYS use `groupId` set to `default_search` — for example: `/m/default_search/search/jobs`. Never use any other group ID for search endpoints.

When asked to build a feature, always inspect Cribl REST APIs and understand the context of the request before starting to build.

### External API Calls

To call external APIs, just use `fetch()` with the full URL. The platform will automatically route these through your app's proxy endpoint. The external domain must be declared in your app's `config/proxies.yml`.

### proxies.yml — External Domain Configuration

Your app must declare every external domain it needs to access in `config/proxies.yml`. This file lives in your project's `config/` directory and gets packaged with your app. Admins can see exactly which external endpoints your app communicates with at install time.

**Schema:**

```yaml
# config/proxies.yml
# Top-level keys are domain:port pairs (port optional, defaults to 443)

api.openai.com:
  timeout: 10000          # Optional: request timeout in ms (1000–120000, default 30000)

  # Optional: verify the upstream TLS certificate chain. Defaults to `true`.
  # Set to `false` only when targeting trusted internal endpoints that present
  # self-signed or otherwise untrusted certificates.
  rejectUnauthorized: true

  paths:                   # Optional: control which URL paths are allowed
    allowlist:             # Prefix match — request path must start with one of these
      - /v1/chat/
      - /v1/models
    blocklist:             # Prefix match — these paths are always blocked (takes precedence over allowlist)
      - /v1/admin/

  headers:                 # Optional: control header forwarding and injection
    inject:                # Headers to add to every outgoing request to this domain
      x-api-key: "'static-key'"
      Authorization: "'Bearer ' + kv.openaiApiKey"
      x-custom: kv.myHeaderValue
    allowlist:             # Only forward these headers from the original request (supports wildcards)
      - content-type
      - accept
      - x-custom-*
    blocklist:             # Never forward these headers (takes precedence, supports wildcards)
      - x-internal-*
```

**Header injection expressions** support:
- String literals: `"'my-static-value'"`
- KV store lookups: `kv.mySecretKey` (platform resolves the stored value when building the outbound request; backing storage may be encrypted at rest)
- Concatenation: `"'Bearer ' + kv.apiToken"`

**Security notes:**
- **KV admin visibility:** Pack KV is often readable in **plaintext in the Cribl Apps KV UI** to anyone with permission to manage that app’s KV. That is separate from at-rest encryption (which protects persisted bytes, not what a privileged admin screen shows). Treat `openaiKey` like any shared credential: restrict roles, rotate on compromise, and prefer org policy over expecting the console to mask values.
- Sensitive headers (`cookie`, `authorization`, `proxy-authorization`, `host`, `connection`, `transfer-encoding`) are always stripped from the original request before forwarding — use `headers.inject` to set auth headers instead
- The platform validates target domains against SSRF protections (private/reserved IPs are blocked)
- Requests are rate-limited per app (100 requests/minute)
- All proxied requests use HTTPS
- Upstream TLS certificates are verified by default (`rejectUnauthorized: true`). Disable only for trusted internal endpoints with self-signed certs.

**Example — minimal config for a single API:**

```yaml
# config/proxies.yml
api.example.com:
  headers:
    inject:
      Authorization: "'Bearer ' + kv.apiKey"
```

**Example — multiple domains with path restrictions:**

```yaml
# config/proxies.yml
api.openai.com:
  timeout: 60000
  paths:
    allowlist:
      - /v1/chat/completions
      - /v1/embeddings
  headers:
    inject:
      Authorization: "'Bearer ' + kv.openaiKey"

hooks.slack.com:
  paths:
    allowlist:
      - /services/
  headers:
    inject:
      Content-Type: "'application/json'"
```

**How it connects to fetch:** When your app calls `fetch('https://api.openai.com/v1/chat/completions', ...)`, the platform rewrites this to `/api/v1/a/{yourAppId}/proxy/api.openai.com/v1/chat/completions`, looks up `api.openai.com` in your `proxies.yml`, validates the path, injects headers, and forwards the request.

**In-app BYOL key:** Users with KV write access can save the pack key `openaiKey` from **Settings** in the Adoption Plan app (same key path as `kv.openaiKey` in `proxies.yml`). Plan and UI preferences continue to use per-user namespaced keys via `kvGet` / `kvSet`.

**Local dev (`npm run dev` / `vite preview` on localhost):** Without `CRIBL_API_URL`, the Cribl platform does not rewrite external `fetch`. The Adoption Plan app: (1) reads `openaiKey` from **Settings** (localStorage) and sends `Authorization: Bearer …` to **OpenAI** from the browser (use only on a trusted machine); (2) rewrites **docs.cribl.io** llms fetches to **`/__cribl_docs__/…`**, which Vite proxies to the CDN (see `vite.config.ts`) so **browser CORS does not block** index reads. In the Cribl iframe, use real `https://docs.cribl.io/...` URLs — the platform proxy applies. **GitHub** pack search uses `api.github.com`, which sends permissive CORS for the search API.

**Hybrid dev (`?init=` from Cribl Cloud / staging into Vite):** When the URL includes `?init=https://…/app-ui/__local__/init.js…`, the platform’s `init.js` owns `CRIBL_API_URL` and the real app id. Do not ship or inject a conflicting `window.CRIBL_APP_ID = '__dev__…'` in that mode — KV requests will target the wrong app id (`/api/v1/a/__dev__…/`). **BYOL OpenAI** (Settings `openaiKey` + right-rail assistant) is **disabled** when `__local__` is detected (`isCriblLocalShell()`); use a **deployed** installed pack for that. Some shells sandbox the iframe without `allow-same-origin`, so **`localStorage` can throw `SecurityError`**; all storage access must go through `getSafeLocalStorage()` and fail soft (see [`CRIBL_DEV_NOTES.md`](./CRIBL_DEV_NOTES.md) section *Vite dev + Cribl `?init=`, `localStorage`, and production HTML*).

**Assistant tools (packaged app in Cribl):** Declare **`api.github.com`** (`/search/repositories`) and **`docs.cribl.io`** (the `llms.txt` paths in this repo’s `config/proxies.yml`, including `/llms-known-issues.txt` and `/apps/llms.txt`) so the assistant’s tools work behind the platform proxy.

## React Router

When using React Router, set the basename to `window.CRIBL_BASE_PATH`:

```jsx
<BrowserRouter basename={window.CRIBL_BASE_PATH}>
```

## Navigation

The platform synchronizes navigation between your app and the parent Cribl UI. If you use `history.pushState()` or `history.replaceState()`, the parent URL bar will update to reflect your app's current route. Navigation changes from the parent are also forwarded to your app as `popstate` events.

