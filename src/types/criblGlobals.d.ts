// Global variables injected by the Cribl App Platform runtime when your app
// is loaded inside the Cribl iframe. See AGENTS.md ("Global Variables").
//
// All three are present and read-only inside the Cribl iframe. They are
// `undefined` when the app runs on plain `localhost:5173` outside the iframe
// (useful as a feature-detect for the local-dev fallback path).

declare global {
  /** Semantic version from `package.json`, injected at Vite build (`define`). */
  const __APP_VERSION__: string

  interface Window {
    /** Base URL for all Cribl API calls. Example: `https://<tenant>.cribl-staging.cloud/api/v1` */
    CRIBL_API_URL?: string

    /** The base path your app is mounted at. Example: `/app-ui/adoption-plan` */
    CRIBL_BASE_PATH?: string

    /** The app ID. In dev: `__dev__<name>`; in prod: `<name>`. */
    CRIBL_APP_ID?: string
  }
}

export {}
