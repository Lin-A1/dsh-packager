import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dshApp = join(process.resourcesPath, 'dsh/apps/cli/lib/bin.js')
const dshFallback = join(__dirname, '../resources/dsh/apps/cli/lib/bin.js')

function resolveDshBin() {
  if (existsSync(dshApp)) return dshApp
  if (existsSync(dshFallback)) return dshFallback
  const dev = process.env.DSH_DIR ? join(process.env.DSH_DIR, 'apps/cli/lib/bin.js') : null
  if (dev && existsSync(dev)) return dev
  return null
}

let dshProc = null
let win = null

async function startDsh() {
  const bin = resolveDshBin()
  if (!bin) {
    console.error('[dsh-desktop] dsh bin not found. Run pnpm run build -- --dsh-dir <path> first')
    return null
  }
  const args = ['--profile', 'web', '--port', '3080', '--no-open']
  console.log(`[dsh-desktop] spawn node ${bin} ${args.join(' ')}`)
  const proc = spawn(process.execPath, [bin, ...args], {
    stdio: 'inherit',
    env: process.env,
  })
  proc.on('exit', code => console.log(`[dsh-desktop] dsh exited ${code}`))
  return proc
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    title: 'dsh desktop',
  })
  const url = 'http://127.0.0.1:3080'
  setTimeout(() => win.loadURL(url).catch(() => {
    win.loadURL(`data:text/html,<h3>dsh starting...</h3><p>Waiting for ${url}</p><script>setTimeout(()=>location.href='${url}',1500)</script>`)
  }), 1200)
}

app.whenReady().then(async () => {
  dshProc = await startDsh()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (dshProc) dshProc.kill()
})
