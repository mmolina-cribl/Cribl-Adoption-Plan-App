import { defineConfig, type IndexHtmlTransformContext, type IndexHtmlTransformResult, type Plugin, type ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// @ts-expect-error pkgutil is plain JS without types
import { servePackageTgz } from './scripts/pkgutil.mjs'
import { appVersionFromPackageJsonPlugin, PROJECT_ROOT } from './vite-app-version-plugin.ts'

/**
 * No-op stub for the `virtual:embedded-gold-template` module that the
 * standalone build (`vite.standalone.config.ts`) registers as a
 * base64-inlined copy of `public/adoption-plan-empty.xlsx`.
 *
 * In the Cribl-Apps build the gold template is fetched at runtime next to
 * `index.html` (see `getAdoptionPlanEmptyTemplateUrl` in adoptionPlanTemplateExport.ts),
 * so this
 * stub just returns `hasEmbeddedGoldTemplate: false` — the runtime
 * resolver in `src/lib/adoptionPlanTemplateExport.ts` then short-
 * circuits past the embedded path and uses the fetch result. Adds
 * ~50 bytes to the App-Platform bundle and keeps the runtime branching
 * logic identical between both targets.
 */
function virtualGoldTemplateStubPlugin(): Plugin {
  const ID = 'virtual:embedded-gold-template'
  return {
    name: 'cribl-virtual-gold-template-stub',
    enforce: 'pre',
    resolveId(id) {
      if (id === ID) {
        return '\0' + ID
      }
      return null
    },
    load(id) {
      if (id === '\0' + ID) {
        return [
          '// Stub from vite.config.ts. The standalone build replaces this with the',
          '// actual base64-encoded gold template via inlineGoldTemplatePlugin().',
          'export const embeddedGoldTemplateBase64 = ""',
          'export const hasEmbeddedGoldTemplate = false',
        ].join('\n')
      }
      return null
    },
  }
}

const packageEndpointPlugin = () => ({
  name: 'vite-plugin-package-endpoint',
  configureServer(server: ViteDevServer) {
    server.middlewares.use('/package.tgz', (req: IncomingMessage, res: ServerResponse) => {
      void servePackageTgz(req, res, server.config.root)
    })
  },
})

/** Dev/preview: forward docs.cribl.io llms.txt fetches same-origin (avoids browser CORS). */
const criblDocsLlmsProxy = {
  target: 'https://docs.cribl.io',
  changeOrigin: true,
  secure: true,
  rewrite: (path: string) => path.replace(/^\/__cribl_docs__/, '') || '/',
} as const

/**
 * Dev / `vite preview` only. Must not run on `vite build`: the injected
 * `window.CRIBL_APP_ID = '__dev__…'` assignment can throw if the Cribl App
 * shell has already defined a non-writable `CRIBL_APP_ID`, which prevents
 * the ES module bundle from loading and leaves the iframe blank.
 */
const injectScriptFromQueryPlugin = (): Plugin => {
  let initScriptUrl: string | null = null
  return {
    name: 'inject-script-from-query',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const root = server.config.root;
      server.watcher.add([
        join(root, 'package.json'),
        join(root, 'config', 'proxies.yml'),
      ]);
      server.watcher.on('change', (file) => {
        if (file === join(root, 'package.json') || file === join(root, 'config', 'proxies.yml')) {
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
    transformIndexHtml(html: string, ctx: IndexHtmlTransformContext): IndexHtmlTransformResult {
      const url = new URL(ctx.originalUrl ?? '/', 'https://localhost')
      const initFromCribl = url.searchParams.get('init')
      initScriptUrl = initScriptUrl || initFromCribl
      let appName
      try {
        const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8')) as { name?: string }
        appName = pkg.name
      } catch {
        /* ignore missing or invalid package.json */
      }
      appName = appName || 'unknown'
      const tags: Array<{ tag: string; attrs?: Record<string, string>; children?: string; injectTo: 'head-prepend' }> =
        []
      // When `?init=` loads Cribl's init.js, it sets `CRIBL_APP_ID` / `CRIBL_API_URL`.
      // Do not assign `__dev__…` here — it breaks KV URLs (wrong app id) and can
      // race with the platform shell.
      if (!initFromCribl) {
        tags.push({
          tag: 'script',
          children: `window.CRIBL_APP_ID = '__dev__${appName}';`,
          injectTo: 'head-prepend' as const,
        })
      }
      if (initScriptUrl) {
        tags.push({
          tag: 'script',
          attrs: { src: initScriptUrl, type: 'text/javascript' },
          injectTo: 'head-prepend' as const,
        })
      }
      return { html, tags }
    },
  }
}

export default defineConfig({
  plugins: [
    appVersionFromPackageJsonPlugin(),
    react(),
    tailwindcss(),
    packageEndpointPlugin(),
    injectScriptFromQueryPlugin(),
    virtualGoldTemplateStubPlugin(),
  ],
  base: './',
  server: {
    cors: true,
    proxy: {
      '^/__cribl_docs__/.*': criblDocsLlmsProxy,
    },
  },
  preview: {
    proxy: {
      '^/__cribl_docs__/.*': criblDocsLlmsProxy,
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  }
})

