import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
/**
 * List external plugins from dsh-hub + DSH_DIR packages.
 * Returns [{id,name,description,category,unique,enabled}]
 */
export function listPlugins(dshDir) {
  const out = []
  const seen = new Set()
  function add(id, name, desc, category, unique) {
    if (seen.has(id)) return
    seen.add(id)
    out.push({ id, name, description: desc, category, unique, enabled: false })
  }
  // dsh-hub plugins
  try {
    const hubPlugins = join(process.cwd(), '..', '..', 'plugins')
    if (existsSync(hubPlugins)) {
      for (const cat of readdirSync(hubPlugins)) {
        const catPath = join(hubPlugins, cat)
        for (const name of readdirSync(catPath)) {
          const pkg = join(catPath, name, 'package.json')
          if (!existsSync(pkg)) continue
          const j = JSON.parse(readFileSync(pkg,'utf8'))
          const unique = ['llm','sandbox','session','agent','agent-loop','system-prompt','subprocess'].includes(cat)
          add(j.name.replace(/^dsh-/,'').slice(0,24), j.name, j.description||'', cat, unique)
        }
      }
    }
  } catch {}
  // DSH_DIR packages
  try {
    const pkgs = join(dshDir, 'packages')
    for (const group of readdirSync(pkgs)) {
      for (const pkg of readdirSync(join(pkgs, group))) {
        const p = join(pkgs, group, pkg, 'package.json')
        if (!existsSync(p)) continue
        const j = JSON.parse(readFileSync(p,'utf8'))
        if (!j.name?.startsWith('@deepseek-ai/dsh-')) continue
        const unique = j.name.includes('llm') || j.name.includes('sandbox') || j.name.includes('session')
        add(j.name.split('/').pop().replace('dsh-','').slice(0,24), j.name, j.description||'', group, unique)
      }
    }
  } catch {}
  return out
}
if (process.argv[1] && process.argv[1].endsWith('list-plugins.mjs')) {
  const dir = process.argv[2] || '../deepseek-harness'
  console.log(JSON.stringify(listPlugins(dir), null, 2))
}
