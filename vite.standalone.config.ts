import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { appVersionFromPackageJsonPlugin } from './vite-app-version-plugin.ts'

/**
 * Standalone (on-prem) build target.
 *
 * Output: `dist-standalone/cribl-adoption-plan.html` — one self-contained
 * HTML file with every JS bundle, every CSS rule, AND the gold v0.9.1 Excel
 * template inlined. Customer downloads the file, double-clicks it, app
 * works in any modern browser via `file://` with no server, no install,
 * and no IT-side allowlist. State persists to `localStorage` (the
 * existing fallback in `src/lib/kvStore.ts` activates automatically when
 * `window.CRIBL_API_URL` is undefined).
 *
 * Differences from the primary `vite.config.ts`:
 *
 *   1. {@link viteSingleFile} folds all `<script>` / `<link rel=stylesheet>`
 *      assets into the HTML so the deliverable is a single file. We also
 *      disable code-splitting and asset hashing so there is nothing left
 *      to load externally.
 *
 *   2. {@link inlineGoldTemplatePlugin} resolves the virtual module
 *      `virtual:embedded-gold-template` to a base64 string of
 *      `public/adoption-plan-empty.xlsx`. The runtime code in
 *      `src/lib/adoptionPlanTemplateExport.ts` imports it lazily and
 *      uses it as the fallback when `fetch(getAdoptionPlanEmptyTemplateUrl())`
 *      fails (which it always does under `file://` — browsers block
 *      cross-origin file fetches by default).
 *
 *   3. The Cribl-Apps-only middlewares (`/package.tgz`,
 *      `inject-script-from-query`) are intentionally omitted — they have
 *      no purpose outside the App Platform iframe.
 */

const VIRTUAL_GOLD_ID = 'virtual:embedded-gold-template'

/**
 * Vite plugin that exposes `public/adoption-plan-empty.xlsx` as a
 * synchronous import:
 *
 * ```ts
 * import { embeddedGoldTemplateBase64 } from 'virtual:embedded-gold-template'
 * ```
 *
 * The string is base64-encoded at build time so it survives JS string
 * literal escaping cleanly. The runtime decodes it via `atob` +
 * `Uint8Array.from` (both are available in every browser the app
 * supports). At ~210 KB raw / ~280 KB base64 the encoded literal sits
 * comfortably inside the bundled JS without bumping the gzipped file
 * size meaningfully (base64 of compressed binary doesn't compress
 * further, so this trades ~280 KB of HTML for ~210 KB of saved network
 * round-trip — a fair deal for a self-contained deliverable).
 */
function inlineGoldTemplatePlugin(): Plugin {
  return {
    name: 'cribl-inline-gold-template',
    enforce: 'pre',
    resolveId(id) {
      if (id === VIRTUAL_GOLD_ID) {
        return '\0' + VIRTUAL_GOLD_ID
      }
      return null
    },
    load(id) {
      if (id === '\0' + VIRTUAL_GOLD_ID) {
        const xlsxPath = join(process.cwd(), 'public', 'adoption-plan-empty.xlsx')
        const bytes = readFileSync(xlsxPath)
        const b64 = bytes.toString('base64')
        return [
          '// Generated at build time by vite.standalone.config.ts.',
          '// Source: public/adoption-plan-empty.xlsx',
          `export const embeddedGoldTemplateBase64 = ${JSON.stringify(b64)}`,
          'export const hasEmbeddedGoldTemplate = true',
        ].join('\n')
      }
      return null
    },
  }
}

/**
 * Rename the singlefile-produced `index.html` to the customer-facing
 * `cribl-adoption-plan.html` after Rollup finishes writing it. Runs in
 * `closeBundle` so the rename happens after every plugin (including
 * viteSingleFile) is done. Idempotent — re-running the build replaces
 * the file in place.
 */
function renameStandaloneOutputPlugin(outDir: string): Plugin {
  return {
    name: 'cribl-rename-standalone-output',
    apply: 'build',
    closeBundle() {
      const from = join(outDir, 'index.html')
      const to = join(outDir, 'cribl-adoption-plan.html')
      if (!existsSync(from)) {
        this.warn(
          `Expected ${from} to exist after build; standalone artifact not renamed.`,
        )
        return
      }
      renameSync(from, to)
    },
  }
}

/**
 * Strip the `<link rel="icon" href="./favicon.svg">` from the produced
 * HTML. The favicon lives in `public/` and isn't copied into the
 * standalone build (`publicDir: false`), so the link would resolve to
 * a 404. Removing it keeps the browser console clean and lets the
 * browser fall back to its default tab icon — a fair trade for
 * shipping one self-contained file.
 *
 * If you ever decide you want the favicon visible under `file://`,
 * swap this for an inline-as-data-URL transform that reads
 * `public/favicon.svg` at build time.
 */
function stripFaviconLinkPlugin(): Plugin {
  return {
    name: 'cribl-strip-favicon-link',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(
        /<link\b[^>]*\brel="icon"[^>]*\/?>(?:\s*\n)?/g,
        '',
      )
    },
  }
}

const STANDALONE_OUT_DIR = 'dist-standalone'

export default defineConfig({
  plugins: [
    appVersionFromPackageJsonPlugin(),
    react(),
    tailwindcss(),
    inlineGoldTemplatePlugin(),
    viteSingleFile({
      removeViteModuleLoader: true,
      useRecommendedBuildConfig: true,
    }),
    stripFaviconLinkPlugin(),
    renameStandaloneOutputPlugin(STANDALONE_OUT_DIR),
  ],
  base: './',
  // Skip Vite's default `public/` copy. The gold template is inlined via
  // the virtual module above; the rest of `public/` (`favicon.svg`,
  // `icons.svg`, etc.) is intentionally not part of the standalone
  // deliverable so the dist folder ends up with a single .html file
  // and no orphan assets a customer would have to keep co-located.
  publicDir: false,
  build: {
    outDir: STANDALONE_OUT_DIR,
    assetsDir: '.',
    emptyOutDir: true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 8 * 1024,
    // Bump the inline threshold so every asset imported from src/
    // (icons, the Cribl AI mark, etc.) gets folded into the bundle as
    // a base64 data URL. 96 KB is comfortably above any source asset
    // we currently ship and well below browser data-URL limits.
    assetsInlineLimit: 96 * 1024,
  },
  // The Cribl-Apps-only `injectScriptFromQueryPlugin` writes a
  // `window.CRIBL_APP_ID` constant on dev-server pages. Standalone has
  // no equivalent (and no need for one — the KV helper falls back to
  // localStorage when CRIBL_API_URL is undefined regardless), so the
  // plugin is intentionally omitted from this config.
})
