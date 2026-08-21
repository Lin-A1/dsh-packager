import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Runtime resources (dsh-desktop only): extraResources/dsh + fixed/cordis.yml
const dshApp = join(process.resourcesPath, 'dsh/apps/cli/lib/bin.js')
const fixedCordis = join(process.resourcesPath, 'fixed/cordis.yml')

function resolveDshBin() {
  if (existsSync(dshApp)) return dshApp
  return null
}

function resolveIcon() {
  const candidates = [
    join(process.resourcesPath, 'build/icon.png'),
    join(process.resourcesPath, 'icon.png'),
  ]
  for (const p of candidates) if (existsSync(p)) return p
  return undefined
}

// Entry decision is made ONLY by which electron-builder config produced this exe:
// - packager build: files include scripts/, no resources/dsh → builder UI
// - desktop build: files include resources/, extraResources dsh → dsh runtime
const hasRuntimeResources = existsSync(dshApp) || existsSync(fixedCordis)
const BUILDER_MODE = process.env.BUILDER === '1' ? true : !hasRuntimeResources

let dshProc = null
let win = null
let tray = null
let isQuiting = false
let builderWin = null

// Single instance lock — prevents duplicate windows from second launch
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

async function startDsh() {
  const bin = resolveDshBin()
  if (!bin) return null
  const isFixed = existsSync(fixedCordis)
  const args = ['--profile', isFixed ? 'fixed' : 'web', '--port', '3080', '--no-open']
  console.log(`[dsh-desktop] spawn ${args.join(' ')} (${isFixed ? 'fixed' : 'compat'})`)
  const proc = spawn(process.execPath, [bin, ...args], { stdio: 'inherit', env: process.env })
  proc.on('exit', code => console.log(`[dsh-desktop] dsh exited ${code}`))
  return proc
}

function waitForPort(host, port, timeoutMs) {
  return new Promise(resolve => {
    const socket = createConnection({ host, port }, () => { socket.end(); resolve(true) })
    socket.on('error', () => resolve(false))
    setTimeout(() => { try { socket.destroy() } catch {} resolve(false) }, timeoutMs)
  })
}

function createWindow() {
  if (win && !win.isDestroyed()) {
    if (!win.isVisible()) win.show()
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
    titleBarOverlay: { color: '#0f0f0f', symbolColor: '#ffffff', height: 28 },
    backgroundColor: '#0f0f0f',
    icon: iconPath ? nativeImage.createFromPath(iconPath) : undefined,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  win.once('ready-to-show', () => { if (!isQuiting) win.show() })
  win.on('closed', () => { win = null })

  // Close hides to tray; tray Quit actually exits
  win.on('close', e => {
    if (!isQuiting) { e.preventDefault(); win.hide() }
  })

  if (!tray && iconPath) {
    try {
      const img = nativeImage.createFromPath(iconPath)
      const resized = img.getSize().width > 16 ? img.resize({ width: 16, height: 16 }) : img
      if (process.platform === 'win32') resized.setTemplateImage(false)
      tray = new Tray(resized)
      tray.setToolTip('dsh desktop — 双击显示，右键退出')
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '显示窗口', click: () => { if (win && !win.isDestroyed()) { win.show(); win.focus() } else createWindow() } },
        { type: 'separator' },
        { label: '退出 dsh', click: () => { isQuiting = true; app.quit() } },
      ]))
      tray.on('double-click', () => { if (win && !win.isDestroyed()) { win.show(); win.focus() } else createWindow() })
      tray.on('click', () => { if (win && !win.isDestroyed() && !win.isVisible()) { win.show(); win.focus() } })
    } catch (e) {
      console.error('[tray] failed', e)
    }
  }

  // Load once after port ready; bounded retry, never infinite loop of windows
  const url = 'http://127.0.0.1:3080'
  let loadTimer = null
  let loaded = false
  let retries = 0
  const tryLoad = async () => {
    if (!win || win.isDestroyed() || isQuiting || loaded) return
    if (retries >= 30) {
      win.loadURL(`data:text/html,<body style="background:#0f0f0f;color:#eee;font-family:system-ui;padding:24px"><h3>dsh 未就绪</h3><p>已重试 30 次（3080 未开）</p><button onclick="location.reload()">重试</button>`)
      return
    }
    retries++
    const ready = await waitForPort('127.0.0.1', 3080, 400)
    if (!ready) { loadTimer = setTimeout(tryLoad, 700); return }
    try { await win.loadURL(url); loaded = true } catch { loadTimer = setTimeout(tryLoad, 700) }
  }
  win.webContents.on('did-fail-load', (_e, code) => {
    if (loaded || isQuiting || code === -3) return
    if (retries < 30) loadTimer = setTimeout(tryLoad, 700)
  })
  win.on('closed', () => { if (loadTimer) clearTimeout(loadTimer) })
  loadTimer = setTimeout(tryLoad, 900)
  return win
}

function createBuilderWindow() {
  if (builderWin && !builderWin.isDestroyed()) {
    builderWin.show()
    builderWin.focus()
    return builderWin
  }
  builderWin = new BrowserWindow({
    width: 1160,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0d10', symbolColor: '#ffffff', height: 32 },
    backgroundColor: '#0b0d10',
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: join(__dirname, 'preload.mjs') },
  })
  builderWin.once('ready-to-show', () => builderWin.show())
  builderWin.loadFile(join(__dirname, 'builder.html'))
  // Builder close quits directly (no tray for packager)
  return builderWin
}

// IPC — external catalog (bundled plugins.catalog.json first), DSH version, build dispatch
ipcMain.handle('builder:listPlugins', async (_e, _dshDir) => {
  try {
    const catalogPath = join(__dirname, '../plugins.catalog.json')
    if (existsSync(catalogPath)) {
      const cached = JSON.parse(readFileSync(catalogPath, 'utf8'))
      if (Array.isArray(cached) && cached.length) return cached
    }
  } catch {}
  try {
    const { listPlugins } = await import('../scripts/list-plugins.mjs')
    return listPlugins(process.env.DSH_DIR || resolve(__dirname, '../../deepseek-harness'))
  } catch {}
  return []
})

ipcMain.handle('builder:dsh-version', async (_e, dshDir) => {
  try {
    const dir = dshDir ? resolve(dshDir) : resolve(__dirname, '../../deepseek-harness')
    const m = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return `${m.name}@${m.version}`
  } catch { return null }
})

ipcMain.handle('builder:build', async (_e, payload) => {
  const { dshDir, productName, mode, plugins } = payload
  const ids = new Set()
  for (const p of plugins) {
    if (ids.has(p.id)) throw new Error(`duplicate id ${p.id}`)
    ids.add(p.id)
  }
  const configPath = join(__dirname, '../agent.config.yml')
  const yamlLines = [
    `dshDir: ${dshDir}`,
    `productName: ${productName}`,
    `appId: com.example.${productName.replace(/[^a-z0-9-]/gi,'-').toLowerCase()}`,
    `mode: ${mode}`,
    `plugins:`,
    ...plugins.flatMap(p => [`  - id: ${p.id}`, `    name: "${p.name}"`]),
  ]
  writeFileSync(configPath, yamlLines.join('\n') + '\n')
  const script = mode === 'fixed' ? 'scripts/build-fixed.mjs' : 'scripts/build.mjs'
  const args = mode === 'fixed' ? ['--config', configPath] : ['--dsh-dir', dshDir]
  return new Promise(resolvePromise => {
    let log = ''
    const proc = spawn('node', [join(__dirname, `../${script}`), ...args], { stdio: 'pipe', shell: process.platform === 'win32' })
    proc.stdout.on('data', d => { log += d.toString() })
    proc.stderr.on('data', d => { log += d.toString() })
    proc.on('close', code => resolvePromise({ log: log + `\n[exit ${code}]`, code }))
  })
})

app.whenReady().then(async () => {
  if (BUILDER_MODE) {
    createBuilderWindow()
  } else {
    dshProc = await startDsh()
    createWindow()
  }
  app.on('activate', () => {
    if (BUILDER_MODE) { if (!builderWin || builderWin.isDestroyed()) createBuilderWindow() }
    else { if (!win || win.isDestroyed()) createWindow() }
  })
})

app.on('second-instance', () => {
  const target = BUILDER_MODE ? builderWin : win
  if (target && !target.isDestroyed()) {
    if (target.isMinimized()) target.restore()
    target.show(); target.focus()
  }
})

app.on('window-all-closed', () => {
  // dsh keeps running in tray; builder quits naturally when window closed
  if (BUILDER_MODE) app.quit()
})

app.on('before-quit', () => {
  isQuiting = true
  if (dshProc) dshProc.kill()
  if (tray) tray.destroy()
})
