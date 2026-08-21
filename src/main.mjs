import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dshApp = join(process.resourcesPath, 'dsh/apps/cli/lib/bin.js')
const dshFallback = join(__dirname, '../resources/dsh/apps/cli/lib/bin.js')
const fixedCordis = join(process.resourcesPath, 'fixed/cordis.yml')
const fixedFallback = join(__dirname, '../resources/fixed/cordis.yml')

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

function isBuilderMode() {
  if (process.env.BUILDER === '1') return true
  if (!app.isPackaged) return true
  // Packager (builder) has no dsh/fixed resources; dsh-desktop has them
  const hasDsh = existsSync(dshApp) || existsSync(dshFallback) || existsSync(fixedCordis) || existsSync(fixedFallback)
  return !hasDsh
}

let dshProc = null
let win = null
let tray = null
let isQuiting = false
let builderWin = null

// Single instance lock — prevent infinite windows from second launch
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const target = isBuilderMode() ? builderWin : win
    if (target && !target.isDestroyed()) {
      if (target.isMinimized()) target.restore()
      target.show()
      target.focus()
    } else {
      if (isBuilderMode()) createBuilderWindow()
      else createWindow()
    }
  })
}

async function startDsh() {
  const bin = resolveDshBin()
  if (!bin) {
    console.error('[dsh-desktop] dsh bin not found. Run pnpm run build -- --dsh-dir <path> first')
    return null
  }
  // Detect fixed vs compat: fixed has resources/fixed/cordis.yml
  const isFixed = existsSync(fixedCordis) || existsSync(fixedFallback)
  const args = isFixed
    ? ['--profile', 'fixed', '--port', '3080', '--no-open']
    : ['--profile', 'web', '--port', '3080', '--no-open']
  console.log(`[dsh-desktop] spawn node ${bin} ${args.join(' ')} ${isFixed ? '(fixed)' : '(compat)'}`)
  const proc = spawn(process.execPath, [bin, ...args], {
    stdio: 'inherit',
    env: process.env,
  })
  proc.on('exit', code => console.log(`[dsh-desktop] dsh exited ${code}`))
  return proc
}

function createWindow() {
  if (win && !win.isDestroyed()) {
    if (!win.isVisible()) win.show()
    win.focus()
    return win
  }
  const iconPath = resolveIcon()
  // Use native dsh icon for window; fallback to packager icon
  const winIcon = iconPath ? nativeImage.createFromPath(iconPath) : undefined
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
    icon: winIcon,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  win.once('ready-to-show', () => { if (!isQuiting) win.show() })
  win.on('closed', () => { win = null })

  // Only dsh desktop hides to tray; packager (builder) quits directly — tray only for dsh
  win.on('close', (e) => {
    if (!isQuiting) {
      e.preventDefault()
      win.hide()
    }
  })

  // Tray only for dsh desktop (not for builder)
  if (!tray && iconPath) {
    try {
      const trayImg = nativeImage.createFromPath(iconPath)
      // Ensure 16x16 for tray visibility on Windows
      const resized = trayImg.getSize().width > 16 ? trayImg.resize({ width: 16, height: 16 }) : trayImg
      // Windows requires template image false for color
      if (process.platform === 'win32') resized.setTemplateImage(false)
      tray = new Tray(resized)
      tray.setToolTip('dsh desktop — 双击显示，右键退出')
      const contextMenu = Menu.buildFromTemplate([
        { label: '显示窗口', click: () => { if (win && !win.isDestroyed()) { win.show(); win.focus() } else createWindow() } },
        { type: 'separator' },
        { label: '退出 dsh', click: () => { isQuiting = true; app.quit() } },
      ])
      tray.setContextMenu(contextMenu)
      tray.on('double-click', () => { if (win && !win.isDestroyed()) { win.show(); win.focus() } else createWindow() })
      tray.on('click', () => { if (win && !win.isDestroyed() && !win.isVisible()) { win.show(); win.focus() } })
    } catch (e) {
      console.error('[tray] create failed', e)
    }
  }

  // Single load with TCP port-ready check — no infinite data-url loop, no duplicate windows
  const url = 'http://127.0.0.1:3080'
  let loadTimer = null
  let loaded = false
  let retries = 0
  function waitForPort(host, port, timeoutMs) {
    return new Promise((resolve) => {
      const socket = createConnection({ host, port }, () => { socket.end(); resolve(true) })
      socket.on('error', () => resolve(false))
      setTimeout(() => { try { socket.destroy(); } catch {} resolve(false) }, timeoutMs)
    })
  }
  const tryLoad = async () => {
    if (!win || win.isDestroyed() || isQuiting || loaded) return
    if (retries >= 30) {
      win.loadURL(`data:text/html,<body style="background:#0f0f0f;color:#eee;font-family:system-ui;padding:24px"><h3>dsh 未就绪</h3><p>已重试 30 次（3080 端口未开），请检查 dsh 日志</p><button onclick="location.reload()">重试</button>`)
      return
    }
    retries++
    const ready = await waitForPort('127.0.0.1', 3080, 400)
    if (!ready) { loadTimer = setTimeout(tryLoad, 700); return }
    try {
      await win.loadURL(url)
      loaded = true
    } catch {
      loadTimer = setTimeout(tryLoad, 700)
    }
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
  const iconPath = resolveIcon()
  builderWin = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f0f0f', symbolColor: '#ffffff', height: 28 },
    backgroundColor: '#0f0f0f',
    icon: iconPath ? nativeImage.createFromPath(iconPath) : undefined,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.mjs'),
    },
  })
  builderWin.once('ready-to-show', () => builderWin.show())
  builderWin.loadFile(join(__dirname, 'builder.html'))
  // Builder close quits (not hide to tray)
  builderWin.on('close', (e) => {
    if (!isQuiting) {
      // allow close to quit builder
    }
  })
  return builderWin
}

// IPC for builder — external catalog (dsh-hub + user custom) + DSH version
ipcMain.handle('builder:listPlugins', async (_e, dshDir) => {
  // Prefer bundled catalog (for installed packager where dsh-hub/plugins not present)
  try {
    const catalogPath = join(__dirname, '../plugins.catalog.json')
    if (existsSync(catalogPath)) {
      const cached = JSON.parse(readFileSync(catalogPath, 'utf8'))
      if (Array.isArray(cached) && cached.length) return cached
    }
  } catch {}
  try {
    const { listPlugins } = await import('../scripts/list-plugins.mjs')
    const dir = dshDir ? resolve(dshDir) : resolve(join(__dirname, '../../deepseek-harness'))
    const live = listPlugins(dir)
    if (live.length) return live
  } catch (e) {
    console.error('[builder] listPlugins live failed', e)
  }
  // Fallback to bundled catalog
  try {
    const catalogPath = join(__dirname, '../plugins.catalog.json')
    if (existsSync(catalogPath)) return JSON.parse(readFileSync(catalogPath, 'utf8'))
  } catch {}
  return []
})

ipcMain.handle('builder:dsh-version', async (_e, dshDir) => {
  try {
    const dir = dshDir ? resolve(dshDir) : resolve(join(__dirname, '../../deepseek-harness'))
    const m = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return `${m.name}@${m.version}`
  } catch { return null }
})

ipcMain.handle('builder:build', async (_e, payload) => {
  const { dshDir, productName, mode, plugins } = payload
  const configPath = join(__dirname, '../agent.config.yml')
  // Validate unique: at most one per category for unique plugins is enforced in UI; here double-check id uniqueness
  const ids = new Set()
  for (const p of plugins) {
    if (ids.has(p.id)) throw new Error(`duplicate id ${p.id} — unique plugin id must be globally unique (vendor/include/src/index.ts:66)`)
    ids.add(p.id)
  }
  // Write agent.config.yml for fixed mode; compat mode also records for reproducibility
  const yamlLines = [
    `dshDir: ${dshDir}`,
    `productName: ${productName}`,
    `appId: com.example.${productName.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`,
    `mode: ${mode}`,
    `catalogSources:`,
    `  - type: dsh-hub`,
    `    path: ../../plugins`,
    `  - type: user`,
    `plugins:`,
    ...plugins.flatMap(p => [`  - id: ${p.id}`, `    name: ${p.name}`]),
  ]
  writeFileSync(configPath, yamlLines.join('\n') + '\n')
  const script = mode === 'fixed' ? 'scripts/build-fixed.mjs' : 'scripts/build.mjs'
  const args = mode === 'fixed' ? ['--config', configPath] : ['--dsh-dir', dshDir]
  const { spawn } = await import('node:child_process')
  return new Promise((resolvePromise) => {
    let log = ''
    const proc = spawn('node', [join(__dirname, `../${script}`), ...args], { stdio: 'pipe', shell: process.platform === 'win32' })
    proc.stdout.on('data', d => { log += d.toString(); console.log(d.toString()) })
    proc.stderr.on('data', d => { log += d.toString(); console.error(d.toString()) })
    proc.on('close', (code) => resolvePromise({ log: log + `\nbuild ${mode} exited ${code}`, code }))
  })
})

app.whenReady().then(async () => {
  if (isBuilderMode()) {
    createBuilderWindow()
    app.on('activate', () => {
      if (builderWin && !builderWin.isDestroyed()) builderWin.show()
      else createBuilderWindow()
    })
  } else {
    dshProc = await startDsh()
    createWindow()
    app.on('activate', () => {
      if (win && !win.isDestroyed()) win.show()
      else createWindow()
    })
  }
})

app.on('window-all-closed', () => {
  // keep builder and dsh in tray; don't quit
})

app.on('before-quit', () => {
  isQuiting = true
  if (dshProc) dshProc.kill()
  if (tray) tray.destroy()
})
