#!/usr/bin/env node
/**
 * Fixed (immutable) build — bake selected plugins into asar, isolated DSH_HOME.
 * Non-invasive: read-only DSH_DIR, generate fixed/cordis.yml, deploy to staging, then electron-builder packs asar inside.
 * Usage: node scripts/build-fixed.mjs --config agent.config.yml
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function getArg(name) {
  const idx = process.argv.indexOf(name)
  if (idx !== -1) return process.argv[idx + 1]
  const pref = process.argv.find(a => a.startsWith(name + '='))
  if (pref) return pref.slice(name.length + 1)
  return undefined
}
const configPath = resolve(root, getArg('--config') ?? 'agent.config.yml')
const cfg = yaml.load(readFileSync(configPath, 'utf8'))
const dshDir = resolve(root, cfg.dshDir ?? '../deepseek-harness')
const mode = cfg.mode ?? 'fixed'
console.log(`[fixed] mode=${mode} DSH_DIR=${dshDir} product=${cfg.productName} @${readFileSync(join(dshDir,'package.json'),'utf8').match(/"version"\s*:\s*"([^"]+)"/)?.[1]}`)

if (!existsSync(join(dshDir, 'apps/cli/lib/bin.js'))) {
  console.log('[fixed] dsh lib missing, building DSH_DIR...')
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync('pnpm', ['run','build'], { cwd: dshDir, stdio: 'inherit', shell: process.platform==='win32', env: {...process.env, CI:'true'} })
  if (r.status!==0) process.exit(r.status??1)
}

// Generate fixed/cordis.yml — each plugin as insert row, id globally unique
const fixedDir = join(root, 'fixed')
mkdirSync(fixedDir, { recursive: true })
const rows = (cfg.plugins ?? []).map(p => ({
  insert: [{ id: p.id, name: p.name, ...(p.config?{config:p.config}:{}) , ...(p.inject?{inject:p.inject}:{}) }]
}))
// Flatten or keep as array of patches; electron's cordis loader expects PatchOptions[]
const cordisYml = rows.map(r => yaml.dump(r)).join('---\n')
writeFileSync(join(fixedDir, 'cordis.yml'), `# fixed bundle for ${cfg.productName} mode=${mode}\n` + (rows.length? yaml.dump(rows.flat()): '[]\n'))
console.log(`[fixed] wrote fixed/cordis.yml with ${cfg.plugins?.length??0} plugins`)

// For compat mode, delegate to existing build.mjs (extraResources outside asar)
if (mode === 'compat') {
  console.log('[fixed] compat mode — delegating to scripts/build.mjs (extraResources outside asar, DSH_HOME=~/.dsh)')
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync('node', [join(root,'scripts/build.mjs'), '--dsh-dir', dshDir], { cwd: root, stdio: 'inherit', shell: process.platform==='win32' })
  process.exit(r.status??0)
}

// Fixed mode: copy DSH lib/dist + fixed cordis into resources/fixed (asar inside)
const outFixed = join(root, 'resources/fixed')
rmSync(outFixed, { recursive: true, force: true })
mkdirSync(outFixed, { recursive: true })
const copies = [
  ['apps/cli/lib', 'apps/cli/lib'],
  ['apps/cli/config', 'apps/cli/config'],
  ['apps/web/dist', 'apps/web/dist'],
]
for (const [src,dst] of copies) {
  const s = join(dshDir, src)
  if (!existsSync(s)) { console.warn(`[fixed] skip missing ${src}`); continue }
  cpSync(s, join(outFixed, dst), { recursive: true })
  console.log(`[fixed] cp ${src} -> resources/fixed/${dst}`)
}
cpSync(join(fixedDir,'cordis.yml'), join(outFixed,'cordis.yml'))
console.log(`[fixed] staged fixed/cordis.yml -> resources/fixed/cordis.yml`)
console.log(`[fixed] done. Next: npx electron-builder --win --config.extraResources=null (fixed is inside asar) or use builder UI`)
