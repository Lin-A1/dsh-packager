#!/usr/bin/env node
/**
 * Non-invasive packager: specify external DSH_DIR, copy built artifacts into resources/dsh
 * Usage:
 *   pnpm run build -- --dsh-dir ../deepseek-harness
 *   DSH_DIR=../deepseek-harness pnpm run build
 *   pnpm run build -- --dsh-dir G:\path\to\dsh --skip-build
 */
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const args = process.argv.slice(2)
function getArg(name) {
  const i = args.indexOf(name)
  if (i !== -1) return args[i + 1]
  const pref = args.find(a => a.startsWith(name + '='))
  if (pref) return pref.slice(name.length + 1)
  return undefined
}

const dshDirRaw = getArg('--dsh-dir') ?? process.env.DSH_DIR ?? 'github:deepseek-ai/deepseek-harness'

// github:<owner>/<repo> — shallow clone to temp, then treat as local dir
function materializeGithubSource(spec) {
  const target = join(process.env.TEMP || '/tmp', 'dsh-packager-clone', spec.replace(/[^a-z0-9-]/gi, '_'))
  if (existsSync(join(target, 'package.json'))) {
    console.log(`[packager] reusing cached clone ${target}`)
    return target
  }
  console.log(`[packager] cloning ${spec} -> ${target}`)
  mkdirSync(dirname(target), { recursive: true })
  const r = spawnSync('git', ['clone', '--depth', '1', spec.replace(/^github:/, 'https://github.com/') + '.git', target], {
    stdio: 'inherit', shell: process.platform === 'win32',
  })
  if (r.status !== 0) {
    console.error('[packager] git clone failed — install git or use a local DSH_DIR')
    process.exit(1)
  }
  return target
}

const resolvedRaw = dshDirRaw.startsWith('github:') ? materializeGithubSource(dshDirRaw) : dshDirRaw
const dshDir = resolve(root, resolvedRaw)
const skipBuild = args.includes('--skip-build')
const outDir = join(root, 'resources/dsh')

if (!existsSync(join(dshDir, 'package.json'))) {
  console.error(`[packager] DSH_DIR not found: ${dshDir}`)
  console.error(`  pass --dsh-dir <path|github:owner/repo> or DSH_DIR env`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(join(dshDir, 'package.json'), 'utf8'))
console.log(`[packager] DSH_DIR=${dshDir} (${manifest.name}@${manifest.version})`)
console.log(`[packager] out=${outDir} skipBuild=${skipBuild}`)

if (!skipBuild) {
  console.log('[packager] ensuring dsh built artifacts...')
  const hasLib = existsSync(join(dshDir, 'apps/cli/lib/bin.js'))
  const hasWeb = existsSync(join(dshDir, 'apps/web/dist'))
  if (!hasLib || !hasWeb) {
    const r = spawnSync('pnpm', ['run', 'build'], { cwd: dshDir, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, CI: 'true' } })
    if (r.status !== 0) process.exit(r.status ?? 1)
  } else {
    console.log('[packager] found apps/cli/lib/bin.js and apps/web/dist, skip pnpm build')
  }
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const copies = [
  ['apps/cli/lib', 'apps/cli/lib'],
  ['apps/cli/config', 'apps/cli/config'],
  ['apps/cli/package.json', 'apps/cli/package.json'],
  ['apps/web/dist', 'apps/web/dist'],
  ['package.json', 'package.json'],
  ['pnpm-workspace.yaml', 'pnpm-workspace.yaml'],
]

let ok = 0
for (const [src, dst] of copies) {
  const s = join(dshDir, src)
  const d = join(outDir, dst)
  if (!existsSync(s)) {
    console.warn(`[packager] skip missing ${src}`)
    continue
  }
  mkdirSync(join(d, '..') === d ? d : join(d, '..'), { recursive: true })
  try {
    cpSync(s, d, { recursive: true })
    ok++
    console.log(`[packager] cp ${src} -> resources/dsh/${dst}`)
  } catch (e) {
    console.warn(`[packager] cp failed ${src}: ${e.message}`)
  }
}

console.log(`[packager] done. ${ok} entries staged.`)
console.log(`[packager] Next: pnpm run dist  (or dist:win/mac/linux)`)
console.log(`[packager] DSH_HOME remains at ~/.dsh (resolveDshHome), plugin hot-plug via profile node_modules stays outside asar.`)
