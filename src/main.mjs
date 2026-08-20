import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
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

function resolveIcon() {
  const candidates = [
    join(process.resourcesPath, 'build/icon.png'),
    join(__dirname, '../build/icon.png'),
    join(__dirname, '../build/icon.ico'),
  ]
  for (const p of candidates) if (existsSync(p)) return p
  return undefined
}

let dshProc = null
let win = null
let tray = null
let isQuiting = false

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
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return win
  }
  const iconPath = resolveIcon()
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f0f0f',
      symbolColor: '#ffffff',
      height: 28,
    },
    backgroundColor: '#0f0f0f',
    icon: iconPath ? nativeImage.createFromPath(iconPath) : undefined,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  win.once('ready-to-show', () => win.show())

  // Close -> hide to tray, not quit
  win.on('close', (e) => {
    if (!isQuiting) {
      e.preventDefault()
      win.hide()
    }
  })

  // Tray
  if (!tray && iconPath) {
    const trayIcon = nativeImage.createFromPath(iconPath)
    tray = new Tray(trayIcon.resize({ width: 16, height: 16 }))
    tray.setToolTip('dsh desktop — click to show, right-click to quit')
    const contextMenu = Menu.buildFromTemplate([
      { label: '显示窗口', click: () => { win.show(); win.focus() } },
      { type: 'separator' },
      { label: '退出', click: () => { isQuiting = true; app.quit() } },
    ])
    tray.setContextMenu(contextMenu)
    tray.on('double-click', () => { win.show(); win.focus() })
    tray.on('click', () => { if (!win.isVisible()) { win.show(); win.focus() } })
  }

  const url = 'http://127.0.0.1:3080'
  let retries = 0
  const tryLoad = () => {
    if (!win || win.isDestroyed()) return
    win.loadURL(url).catch(() => {
      if (retries++ < 30) setTimeout(tryLoad, 500)
    })
  }
  win.webContents.on('did-fail-load', (_e, _code, _desc, validatedURL) => {
    if (validatedURL === url && retries < 30) setTimeout(tryLoad, 500)
  })
  // Single delayed try, not infinite data-url loop
  setTimeout(tryLoad, 800)

  return win
}

app.whenReady().then(async () => {
  dshProc = await startDsh()
  createWindow()
  app.on('activate', () => {
    if (win && !win.isDestroyed()) win.show()
    else createWindow()
  })
})

// Hide to tray on all windows closed, don't quit (except macOS where dock stays)
app.on('window-all-closed', () => {
  // keep app running in tray; macOS dock already keeps it, Windows/Linux hide
})

app.on('before-quit', () => {
  isQuiting = true
  if (dshProc) dshProc.kill()
  if (tray) tray.destroy()
})
