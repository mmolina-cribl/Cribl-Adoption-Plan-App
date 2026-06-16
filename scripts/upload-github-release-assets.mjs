/**
 * Upload Cribl App Platform pack + standalone HTML to an existing GitHub release.
 * Both files are required release assets (tenant install uses the .tgz; do not upload only the .html).
 * Run after `npm run package` and `npm run build:standalone`.
 *
 * Usage:
 *   node scripts/upload-github-release-assets.mjs [TAG]
 * TAG defaults to `v` + version from package.json (must match the release tag).
 *
 * Requires: GitHub CLI (`gh`) authenticated for the repo.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'))
const version = pkg.version ?? '0.0.0'
const tag = process.argv[2]?.trim() || `v${version}`

const tgz = join(rootDir, 'build', `adoption-plan-${version}.tgz`)
const html = join(rootDir, 'dist-standalone', 'cribl-adoption-plan.html')

const missing = []
if (!existsSync(tgz)) missing.push(tgz)
if (!existsSync(html)) missing.push(html)
if (missing.length) {
  console.error('Missing files — run from repo root after builds:\n  npm run package && npm run build:standalone\n')
  for (const p of missing) console.error(`  missing: ${p}`)
  process.exit(1)
}

const r = spawnSync(
  'gh',
  ['release', 'upload', tag, tgz, html, '--clobber'],
  { stdio: 'inherit', cwd: rootDir },
)
if (r.error) {
  console.error(r.error)
  process.exit(1)
}
process.exit(r.status ?? 1)
