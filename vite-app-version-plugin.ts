import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** Repo root (directory that contains `package.json`). */
export const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))

export function readPackageVersion(): string {
  try {
    const j = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf-8')) as { version?: string }
    return String(j.version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
}

/**
 * Injects `APP_VERSION` from `package.json` on each transform so **`npm run dev`**
 * picks up semver bumps after save (HMR / full reload). Replaces compile-time
 * `define.__APP_VERSION__`, which Vite evaluates only once at dev-server startup.
 */
export function appVersionFromPackageJsonPlugin(): Plugin {
  return {
    name: 'app-version-from-package-json',
    enforce: 'pre',
    transform(_code, id) {
      if (id.replace(/\\/g, '/').endsWith('/src/appVersion.ts')) {
        const v = readPackageVersion()
        return `/** Semantic version from package.json (injected by Vite). */\nexport const APP_VERSION: string = ${JSON.stringify(v)}\n`
      }
      return null
    },
  }
}
