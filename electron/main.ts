import { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain } from 'electron'
import type { Event as ElectronEvent, OpenDialogOptions, WebContentsConsoleMessageEventParams } from 'electron'
import { access, readFile, rename, rm, stat } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HermesBridge, type HermesBridgeEvent, type HermesPermissionOption, type HermesPermissionOutcome, type HermesPermissionRequest } from './hermes-bridge.js'
import { loadMod, reloadMod, scanModsDirectory } from './mod-loader.js'
import {
  canPreviewFile,
  FILE_PREVIEW_MAX_CHARS,
  inferLanguageFromPath,
  looksBinary,
} from './file-preview.js'
import { readWindowState, writeWindowState } from './window-state.js'
import { isPathInside } from './workspace-security.js'
import { readWorkspaceState, writeWorkspaceState } from './workspace-state.js'
import { readWorkspaceDirectory, type WorkspaceFileNode } from './workspace-tree.js'
import {
  getWindowsInteropSnapshot,
  openPathWithDefaultApp,
  readWindowsClipboard,
  revealInExplorer,
  runWslCommand,
  windowsPathToWslPath,
  wslPathToUncPath,
  wslPathToWindowsPath,
  writeWindowsClipboard,
} from './windows-interop.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const hermesBridge = new HermesBridge()
hermesBridge.setPermissionHandler((payload) => requestHermesPermission(payload))
const pendingPermissionRequests = new Map<string, (outcome: HermesPermissionOutcome) => void>()
let permissionRequestSequence = 0
let bridgeBound = false
let isQuitting = false
let workspaceRoot = process.cwd()
let lastSessionId: string | undefined
let currentSessionTitle: string | null = null

type HermesConfigSnapshot = {
  provider: string
  model: string
  source: string
}

type HermesSkillSnapshot = {
  id: string
  name: string
  category: string
  description: string
  enabled: boolean
}

type HermesWorktreeInfo = {
  path: string
  branch: string
  head: string
  detached: boolean
  current: boolean
  name: string
}

type CreateWorktreeOptions = {
  name?: string
  directory?: string
}

function createTray() {
  if (tray) {
    return
  }

  tray = new Tray(getAppIconPath())
  tray.setToolTip('Hermes 桌面助手')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 / 隐藏', click: () => toggleWindowVisibility() },
      {
        label: '窗口置顶',
        type: 'checkbox',
        checked: mainWindow?.isAlwaysOnTop() ?? false,
        click: (menuItem) => {
          mainWindow?.setAlwaysOnTop(menuItem.checked)
          void persistCurrentWindowState()
        },
      },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]),
  )
  tray.on('click', () => toggleWindowVisibility())
}

async function createWindow() {
  const state = await readWindowState(app.getPath('userData'))

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1080,
    minHeight: 680,
    frame: false,
    transparent: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0b1018',
    alwaysOnTop: state.alwaysOnTop,
    fullscreenable: false,
    autoHideMenuBar: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  }

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error('[electron] did-fail-load', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      })
    },
  )

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[electron] render-process-gone', details)
  })

  mainWindow.webContents.on('console-message', (details: ElectronEvent<WebContentsConsoleMessageEventParams>) => {
    console.log('[renderer]', {
      level: details.level,
      message: details.message,
      line: details.lineNumber,
      sourceId: details.sourceId,
    })
  })

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[electron] did-finish-load', mainWindow?.webContents.getURL())
  })

  if (!bridgeBound) {
    hermesBridge.on('event', (event: HermesBridgeEvent) => {
      mainWindow?.webContents.send('hermes:event', event)
    })
    bridgeBound = true
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return
    }

    event.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.on('resize', () => {
    void persistCurrentWindowState()
  })
  mainWindow.on('move', () => {
    void persistCurrentWindowState()
  })
  mainWindow.on('always-on-top-changed', () => {
    void persistCurrentWindowState()
  })

  updateTrayMenu()
}

function registerShortcuts() {
  globalShortcut.register('Super+H', () => {
    toggleWindowVisibility()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showAndFocusWindow()
  })
}

app.whenReady().then(async () => {
  await restoreWorkspaceRoot()
  void createWindow()
  createTray()
  registerShortcuts()

  void hermesBridge.start().then(async () => {
    // Auto-load previously enabled MODs
    await autoEnableMods()

    if (lastSessionId && hermesBridge.getSessionId() !== lastSessionId) {
      try {
        await hermesBridge.loadSession(lastSessionId, workspaceRoot)
        currentSessionTitle = await lookupSessionTitle(lastSessionId)
        queuePersistWorkspaceRoot(lastSessionId)
        const snapshot = await createWorkspaceSnapshot()
        mainWindow?.webContents.send('hermes:event', {
          type: 'workspace:snapshot',
          payload: snapshot,
        } satisfies HermesBridgeEvent)
      } catch (error) {
        console.warn('[hermes] failed to auto-resume session', error instanceof Error ? error.message : error)
      }
    }
  }).catch((error) => {
    console.warn('[hermes] backend warm-up failed', error instanceof Error ? error.message : error)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
      return
    }

    showAndFocusWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep the tray-resident app alive until the user explicitly quits.
  }
})

app.on('will-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  hermesBridge.stop()
  tray?.destroy()
})

// MOD instance registry — stores full exports for enabled MODs
const modInstances: Map<string, { exports: Record<string, unknown> }> = new Map()
// MOD hook registry — hooks registered by enabled MODs
const modHooks: Map<string, { onUserMessage?: (text: string) => string }> = new Map()

ipcMain.handle('hermes:send-message', async (_event, message: string) => {
  // Run MOD onUserMessage hooks before sending
  let processed = message
  for (const [, hooks] of modHooks) {
    if (hooks.onUserMessage) {
      try { processed = hooks.onUserMessage(processed) } catch { /* skip broken hooks */ }
    }
  }
  void hermesBridge.sendMessage(processed).catch((error) => {
    mainWindow?.webContents.send('hermes:event', {
      type: 'stderr',
      payload: error instanceof Error ? error.message : 'Failed to send Hermes message.',
    } satisfies HermesBridgeEvent)
  })
  return { ok: true }
})

ipcMain.handle('hermes:cancel-message', async () => {
  return hermesBridge.cancelActivePrompt()
})

ipcMain.handle('hermes:permission-response', async (_event, requestId: string, optionId?: string | null) => {
  const resolve = pendingPermissionRequests.get(requestId)
  if (!resolve) {
    return { ok: false, error: 'Permission request was not found or already resolved.' }
  }

  pendingPermissionRequests.delete(requestId)
  if (optionId) {
    resolve({
      outcome: {
        outcome: 'selected',
        option_id: optionId,
      },
    })
  } else {
    resolve({ outcome: { outcome: 'cancelled' } })
  }
  return { ok: true }
})

ipcMain.handle('hermes:list-sessions', async () => {
  return hermesBridge.listSessions()
})

ipcMain.handle('hermes:load-session', async (_event, sessionId: string, cwd: string) => {
  const nextWorkspaceRoot = workspaceHostPathFromHermesCwd(cwd)
  await assertWorkspaceExists(nextWorkspaceRoot)
  workspaceRoot = nextWorkspaceRoot
  await hermesBridge.loadSession(sessionId, workspaceRoot)
  currentSessionTitle = await lookupSessionTitle(sessionId)
  queuePersistWorkspaceRoot(sessionId)
  return createWorkspaceSnapshot()
})

ipcMain.handle('hermes:new-session', async () => {
  currentSessionTitle = null
  await hermesBridge.startNewSession(workspaceRoot)
  queuePersistWorkspaceRoot(hermesBridge.getSessionId() ?? undefined)
  return createWorkspaceSnapshot()
})

ipcMain.handle('proxy:set-config', async (_event, config) => {
  hermesBridge.setProxyConfig(config)
  return { ok: true }
})

ipcMain.handle('proxy:detect-host', async () => {
  try {
    const resolv = await runWslCommand(['bash', '-lc', "grep nameserver /etc/resolv.conf | head -1 | sed 's/.* //'"])
    const ip = resolv.trim()
    if (ip) return { host: ip }
  } catch { /* fall through */ }

  try {
    const route = await runWslCommand(['bash', '-lc', "ip route show default | awk '{print $3}'"])
    const ip = route.trim()
    if (ip) return { host: ip }
  } catch { /* fall through */ }

  return { host: 'host.docker.internal' }
})

ipcMain.handle('hermes:restart-backend', async () => {
  hermesBridge.stop()
  await hermesBridge.start()
  return { ok: true }
})

// --- MOD handlers ---

ipcMain.handle('mods:scan', async () => {
  const mods = await scanModsDirectory()
  // Mark auto-enabled MODs
  const enabledPath = path.join(process.cwd(), 'mods', '.hermes-mod-enabled.json')
  let enabledList: string[] = []
  try { enabledList = JSON.parse(readFileSync(enabledPath, 'utf8')) } catch { /* noop */ }

  return mods.map((m) => ({
    ...m,
    enabled: enabledList.includes(m.name) ? true : m.enabled,
  }))
})

ipcMain.handle('mods:toggle', async (_event, modName: string, enabled: boolean) => {
  const enabledPath = path.join(process.cwd(), 'mods', '.hermes-mod-enabled.json')

  if (enabled) {
    const mod = await loadMod(path.join(process.cwd(), 'mods', modName))
    if (mod.exports?.main?.ipcHandlers) {
      for (const [channel, handler] of Object.entries(mod.exports.main.ipcHandlers)) {
        const prefixedChannel = `mod:${modName}:${channel}`
        ipcMain.handle(prefixedChannel, (_e, ...args) => (handler as (...a: unknown[]) => unknown)(_e, ...args))
      }
    }
    // Register MOD instance and hooks
    modInstances.set(modName, { exports: (mod.exports ?? {}) as Record<string, unknown> })
    if (mod.exports?.hooks) {
      modHooks.set(modName, mod.exports.hooks as { onUserMessage?: (text: string) => string })
    }
    // Call onEnable with mod context
    if (mod.exports?.onEnable) {
      const ctx = createModContext(modName, mod.path)
      mod.exports.onEnable(ctx)
    }
    // Persist enabled MOD names
    try {
      const list: string[] = (() => { try { return JSON.parse(readFileSync(enabledPath, 'utf8')) } catch { return [] } })()
      if (!list.includes(modName)) {
        list.push(modName)
        writeFileSync(enabledPath, JSON.stringify(list), 'utf8')
      }
    } catch { /* noop */ }

    // Strip functions before IPC transfer
    const serializable: Record<string, unknown> = {
      name: mod.name, path: mod.path, manifest: mod.manifest, enabled: true,
    }
    if (mod.exports) {
      const safe: Record<string, unknown> = {}
      if (mod.exports.panels) safe.panels = mod.exports.panels
      if (mod.exports.skills) safe.skills = mod.exports.skills
      if (mod.exports.commands) safe.commands = mod.exports.commands
      if (mod.exports.defaultConfig) safe.defaultConfig = mod.exports.defaultConfig
      serializable.exports = safe
    }
    return { ok: true, mod: serializable }
  } else {
    const instance = modInstances.get(modName)
    modInstances.delete(modName)
    modHooks.delete(modName)
    if (instance?.exports?.onDisable) {
      ;(instance.exports.onDisable as () => void)()
    }
    reloadMod(modName)
    // Remove from persisted enabled list
    try {
      const list: string[] = (() => { try { return JSON.parse(readFileSync(enabledPath, 'utf8')) } catch { return [] } })()
      writeFileSync(enabledPath, JSON.stringify(list.filter((n) => n !== modName)), 'utf8')
    } catch { /* noop */ }
    return { ok: true }
  }
})

ipcMain.handle('mods:uninstall', async (_event, modPath: string) => {
  await rm(modPath, { recursive: true, force: true })
  return { ok: true }
})

ipcMain.handle('mods:persona-list', async () => {
  const instance = modInstances.get('hermes-persona')
  if (!instance?.exports?.getPersonas) return []
  return (instance.exports.getPersonas as () => Array<Record<string, unknown>>)()
})

ipcMain.handle('mods:persona-switch', async (_event, personaId: string) => {
  const instance = modInstances.get('hermes-persona')
  if (!instance?.exports?.setActivePersona) return { ok: false }
  ;(instance.exports.setActivePersona as (id: string) => void)(personaId || '')
  // Save to mod config
  const configPath = path.join(process.cwd(), 'mods', '.hermes-mod-config.json')
  try {
    const { readFileSync, writeFileSync } = await import('node:fs')
    const configs = (() => { try { return JSON.parse(readFileSync(configPath, 'utf8')) } catch { return {} } })()
    if (!configs['hermes-persona']) configs['hermes-persona'] = {}
    configs['hermes-persona'].activePersona = personaId || ''
    writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8')
  } catch { /* noop */ }
  return { ok: true, activeId: personaId || null }
})

ipcMain.handle('workspace:create-worktree', async (_event, options?: CreateWorktreeOptions) => {
  const worktree = await createHermesWorktree(workspaceRoot, options)
  workspaceRoot = workspaceHostPathFromHermesCwd(worktree.path)
  await hermesBridge.startNewSession(workspaceRoot)
  queuePersistWorkspaceRoot(hermesBridge.getSessionId() ?? undefined)
  return {
    worktree,
    snapshot: await createWorkspaceSnapshot(),
  }
})

ipcMain.handle('workspace:list-worktrees', async () => {
  return listHermesWorktrees(workspaceRoot)
})

ipcMain.handle('workspace:switch-worktree', async (_event, worktreePath: string) => {
  const nextWorkspaceRoot = workspaceHostPathFromHermesCwd(worktreePath)
  await assertWorkspaceExists(nextWorkspaceRoot)
  workspaceRoot = nextWorkspaceRoot
  await hermesBridge.startNewSession(workspaceRoot)
  queuePersistWorkspaceRoot(hermesBridge.getSessionId() ?? undefined)
  return createWorkspaceSnapshot()
})

ipcMain.handle('workspace:select-directory', async () => {
  return selectDirectory('Select workspace directory', workspaceRoot)
})

ipcMain.handle('workspace:switch-root', async (_event, hostPath: string) => {
  await assertWorkspaceExists(hostPath)
  workspaceRoot = hostPath
  await hermesBridge.startNewSession(workspaceRoot)
  queuePersistWorkspaceRoot(hermesBridge.getSessionId() ?? undefined)
  return createWorkspaceSnapshot()
})

ipcMain.handle('workspace:select-worktree-directory', async () => {
  return selectDirectory('Select worktree parent directory', workspaceRoot)
})

ipcMain.handle('workspace:get-snapshot', async () => {
  const cwd = workspaceRoot
  const windows = await getWindowsInteropSnapshot(cwd)

  return {
    cwd,
    session: hermesBridge.getSessionId() ?? 'Local desktop session',
    files: await readWorkspaceDirectory(cwd),
    tasks: [
      { id: 'task-layout', title: '完成三栏布局骨架', done: true },
      { id: 'task-bridge', title: '接通 WSL Hermes ACP 桥接', done: true },
      { id: 'task-workspace', title: '接入真实工作区文件树', done: true },
      { id: 'task-preview', title: '支持文件内容预览', done: true },
      { id: 'task-tools', title: '支持工具调用卡片', done: true },
      { id: 'task-windows', title: '启用 Windows 原生互操作', done: windows.available },
      { id: 'task-acp', title: '通过 wsl.exe 启动 Hermes ACP 后端', done: true },
      { id: 'task-clipboard', title: '打通 Windows 剪贴板能力', done: true },
    ],
    windows: {
      ...windows,
      clipboardPreview: '',
    },
  }
})

ipcMain.handle('workspace:read-directory', async (_event, directoryPath: string) => {
  const cwd = workspaceRoot
  const normalized = path.normalize(directoryPath || '')
  const absolutePath = path.resolve(cwd, normalized)

  if (!isPathInside(cwd, absolutePath)) {
    return { ok: false, error: '禁止读取工作区之外的目录。' }
  }

  try {
    return {
      ok: true,
      path: normalized === '.' ? '' : normalized.replace(/\\/g, '/'),
      files: await readWorkspaceDirectory(cwd, normalized),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '读取目录失败。',
    }
  }
})

ipcMain.handle('workspace:read-file', async (_event, filePath: string) => {
  const cwd = workspaceRoot
  const normalized = path.normalize(filePath)
  const absolutePath = path.resolve(cwd, normalized)

  if (!isPathInside(cwd, absolutePath)) {
    return { ok: false, error: '禁止读取工作区之外的文件。' }
  }

  try {
    const metadata = await stat(absolutePath)
    if (!metadata.isFile()) {
      return { ok: false, error: 'Only regular files can be previewed.' }
    }

    const previewable = canPreviewFile(absolutePath, metadata.size)
    if (!previewable.ok) {
      return { ok: false, error: previewable.error }
    }

    const buffer = await readFile(absolutePath)
    if (looksBinary(buffer)) {
      return { ok: false, error: 'Binary files are not previewed.' }
    }

    const content = buffer.toString('utf8')
    return {
      ok: true,
      path: normalized,
      content: content.slice(0, FILE_PREVIEW_MAX_CHARS),
      language: inferLanguageFromPath(normalized),
      truncated: content.length > FILE_PREVIEW_MAX_CHARS,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '读取文件失败。',
    }
  }
})

ipcMain.handle('workspace:reveal-item', async (_event, itemPath: string) => {
  try {
    const { absolutePath } = resolveWorkspaceItemPath(itemPath)
    const windowsPath = await revealInExplorer(absolutePath)
    return { ok: true, windowsPath }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to reveal workspace item.' }
  }
})

ipcMain.handle('workspace:open-item', async (_event, itemPath: string) => {
  try {
    const { absolutePath } = resolveWorkspaceItemPath(itemPath)
    const windowsPath = await openPathWithDefaultApp(absolutePath)
    return { ok: true, windowsPath }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to open workspace item.' }
  }
})

ipcMain.handle('workspace:get-item-paths', async (_event, itemPath: string) => {
  try {
    const { absolutePath, relativePath } = resolveWorkspaceItemPath(itemPath)
    return {
      ok: true,
      path: absolutePath,
      relativePath,
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to resolve workspace item path.' }
  }
})

ipcMain.handle('workspace:rename-item', async (_event, itemPath: string, nextName: string) => {
  try {
    const { absolutePath, relativePath } = resolveWorkspaceItemPath(itemPath)
    const safeName = normalizeRenameTarget(nextName)
    const nextRelativePath = path.join(path.dirname(relativePath), safeName)
    const nextAbsolutePath = path.resolve(workspaceRoot, nextRelativePath)

    if (!isPathInside(workspaceRoot, nextAbsolutePath)) {
      return { ok: false, error: 'Cannot rename workspace item outside the workspace.' }
    }

    await rename(absolutePath, nextAbsolutePath)
    return {
      ok: true,
      path: nextRelativePath.replace(/\\/g, '/'),
      snapshot: await createWorkspaceSnapshot(),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to rename workspace item.' }
  }
})

ipcMain.handle('hermes:get-config', async () => {
  return readHermesConfigSnapshot()
})

function createModContext(modName: string, modDir?: string) {
  const configPath = path.join(process.cwd(), 'mods', '.hermes-mod-config.json')
  return {
    modName,
    modDir: modDir || path.join(process.cwd(), 'mods', modName),
    getConfig(key: string) {
      try {
        const raw = readFileSync(configPath, 'utf8')
        const configs = JSON.parse(raw)
        return configs[modName]?.[key]
      } catch { return undefined }
    },
    setConfig(key: string, value: unknown) {
      try {
        const configs = (() => { try { return JSON.parse(readFileSync(configPath, 'utf8')) } catch { return {} } })()
        if (!configs[modName]) configs[modName] = {}
        if (value === undefined) delete configs[modName][key]
        else configs[modName][key] = value
        writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8')
      } catch { /* noop */ }
    },
    logger: {
      info: (...args: unknown[]) => console.log(`[mod:${modName}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[mod:${modName}]`, ...args),
      error: (...args: unknown[]) => console.error(`[mod:${modName}]`, ...args),
    },
  }
}

ipcMain.handle('hermes:get-skills', async () => {
  return readHermesSkillsSnapshot()
})

ipcMain.handle('hermes:get-commands', async () => {
  return hermesBridge.getCachedCommands()
})

ipcMain.handle('windows:reveal-workspace', async () => {
  const cwd = workspaceRoot

  try {
    const windowsPath = await revealInExplorer(cwd)
    return { ok: true, windowsPath }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to reveal workspace in Windows Explorer.',
    }
  }
})

ipcMain.handle('windows:open-workspace', async () => {
  const cwd = workspaceRoot

  try {
    const windowsPath = await openPathWithDefaultApp(cwd)
    return { ok: true, windowsPath }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to open workspace with the default Windows app.',
    }
  }
})

ipcMain.handle('windows:read-clipboard', async () => {
  try {
    const text = await readWindowsClipboard()
    return { ok: true, text }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to read the Windows clipboard.',
    }
  }
})

ipcMain.handle('windows:write-clipboard', async (_event, text: string) => {
  try {
    await writeWindowsClipboard(text)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to write to the Windows clipboard.',
    }
  }
})

ipcMain.handle('window:get-state', async () => {
  return {
    visible: mainWindow?.isVisible() ?? false,
    alwaysOnTop: mainWindow?.isAlwaysOnTop() ?? false,
  }
})

ipcMain.handle('window:set-always-on-top', async (_event, alwaysOnTop: boolean) => {
  mainWindow?.setAlwaysOnTop(alwaysOnTop)
  updateTrayMenu()
  await persistCurrentWindowState()
  return {
    visible: mainWindow?.isVisible() ?? false,
    alwaysOnTop: mainWindow?.isAlwaysOnTop() ?? alwaysOnTop,
  }
})

ipcMain.handle('window:minimize', async () => {
  mainWindow?.minimize()
  return { ok: true }
})

ipcMain.handle('window:hide', async () => {
  mainWindow?.hide()
  return { ok: true }
})

ipcMain.handle('window:close', async () => {
  isQuitting = true
  app.quit()
  return { ok: true }
})

function toggleWindowVisibility() {
  if (!mainWindow) {
    return
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide()
    return
  }

  showAndFocusWindow()
}

function showAndFocusWindow() {
  if (!mainWindow) {
    return
  }

  mainWindow.show()
  mainWindow.focus()
}

async function persistCurrentWindowState() {
  if (!mainWindow) {
    return
  }

  const bounds = mainWindow.getBounds()
  await writeWindowState(app.getPath('userData'), {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    alwaysOnTop: mainWindow.isAlwaysOnTop(),
  })
}

async function restoreWorkspaceRoot() {
  const state = await readWorkspaceState(app.getPath('userData'))
  if (!state.workspaceRoot) {
    return
  }

  try {
    await assertWorkspaceExists(state.workspaceRoot)
    workspaceRoot = state.workspaceRoot
  } catch (error) {
    console.warn('[workspace] failed to restore workspace root', {
      workspaceRoot: state.workspaceRoot,
      error: error instanceof Error ? error.message : error,
    })
  }

  lastSessionId = state.lastSessionId
}

async function persistWorkspaceRoot(lastSessionId?: string) {
  await writeWorkspaceState(app.getPath('userData'), {
    workspaceRoot,
    lastSessionId,
  })
}

function queuePersistWorkspaceRoot(lastSessionId?: string) {
  void persistWorkspaceRoot(lastSessionId).catch((error) => {
    console.warn('[workspace] failed to persist workspace root', error)
  })
}

function updateTrayMenu() {
  if (!tray) {
    return
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 / 隐藏', click: () => toggleWindowVisibility() },
      {
        label: '窗口置顶',
        type: 'checkbox',
        checked: mainWindow?.isAlwaysOnTop() ?? false,
        click: (menuItem) => {
          mainWindow?.setAlwaysOnTop(menuItem.checked)
          void persistCurrentWindowState()
        },
      },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]),
  )
}

async function requestHermesPermission(payload: unknown): Promise<HermesPermissionOutcome> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { outcome: { outcome: 'cancelled' } }
  }

  const request = createPermissionRequest(payload)
  return new Promise((resolve) => {
    pendingPermissionRequests.set(request.requestId, (outcome) => {
      resolve(outcome)
    })

    mainWindow?.webContents.send('hermes:event', {
      type: 'permission:request',
      payload: request,
    } satisfies HermesBridgeEvent)
  })
}

function createPermissionRequest(payload: unknown): HermesPermissionRequest {
  const record = asRecord(payload)
  const toolCall = asRecord(readUnknown(record, 'toolCall', 'tool_call'))
  const rawInput = asRecord(readUnknown(toolCall, 'rawInput', 'raw_input'))
  const options = readPermissionOptions(record)
  const requestId = `permission-${++permissionRequestSequence}-${Date.now()}`
  const title = readString(toolCall, 'title') ?? readString(record, 'title') ?? 'Permission required'
  const description = readString(rawInput, 'description') ?? readString(toolCall, 'description') ?? readString(record, 'description')
  const command = readString(rawInput, 'command')
  const detail = createPermissionDetail(payload)

  return {
    requestId,
    sessionId: readString(record, 'sessionId', 'session_id'),
    toolCallId: readString(toolCall, 'toolCallId', 'tool_call_id'),
    title,
    description,
    command,
    toolKind: readString(toolCall, 'kind'),
    options,
    detail,
  }
}

function readPermissionOptions(record: Record<string, unknown> | null): HermesPermissionOption[] {
  if (!record) {
    return []
  }

  const options = record.options
  if (!Array.isArray(options)) {
    return []
  }

  return options.flatMap((option) => {
    if (!option || typeof option !== 'object') {
      return []
    }

    const record = option as Record<string, unknown>
    const optionId = readString(record, 'optionId', 'option_id')
    return optionId
      ? [{
          optionId,
          name: readString(record, 'name') ?? optionId,
          kind: readString(record, 'kind'),
        }]
      : []
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readUnknown(record: Record<string, unknown> | null, ...keys: string[]) {
  if (!record) {
    return undefined
  }

  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key]
    }
  }

  return undefined
}

function readString(record: Record<string, unknown> | null, ...keys: string[]) {
  const value = readUnknown(record, ...keys)
  return typeof value === 'string' ? value : undefined
}

function createPermissionDetail(payload: unknown) {
  const text = stringifyPermissionPayload(payload)
  return text.length > 4000 ? `${text.slice(0, 4000)}\n...` : text
}

function stringifyPermissionPayload(payload: unknown) {
  if (!payload) {
    return 'No permission details were provided by Hermes.'
  }

  if (typeof payload === 'string') {
    return payload
  }

  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return 'Hermes provided permission details that could not be displayed.'
  }
}

function getAppIconPath() {
  return path.join(app.getAppPath(), 'assets', 'icon.ico')
}

async function selectDirectory(title: string, defaultPath: string) {
  const options: OpenDialogOptions = {
    title,
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true }
  }

  return {
    canceled: false,
    path: result.filePaths[0],
  }
}

async function createWorkspaceSnapshot() {
  const windows = await getWindowsInteropSnapshot(workspaceRoot)

  return {
    cwd: workspaceRoot,
    session: hermesBridge.getSessionId() ?? 'Local desktop session',
    sessionTitle: currentSessionTitle,
    files: await readWorkspaceDirectory(workspaceRoot),
    tasks: [
      { id: 'task-layout', title: 'Desktop three-panel shell', done: true },
      { id: 'task-bridge', title: 'WSL Hermes ACP bridge', done: true },
      { id: 'task-workspace', title: 'Workspace file tree and preview', done: true },
      { id: 'task-windows', title: 'Windows native interop', done: windows.available },
      { id: 'task-acp-session', title: 'ACP historical session loading', done: true },
      { id: 'task-worktree', title: 'Git worktree workspace switching', done: true },
    ],
    windows: {
      ...windows,
      clipboardPreview: '',
    },
  }
}

function workspaceHostPathFromHermesCwd(cwd: string) {
  const windowsPath = wslPathToWindowsPath(cwd)
  if (windowsPath) {
    return windowsPath
  }

  return wslPathToUncPath(cwd) ?? cwd
}

async function assertWorkspaceExists(hostPath: string) {
  await access(hostPath)
}

async function autoEnableMods() {
  const enabledPath = path.join(process.cwd(), 'mods', '.hermes-mod-enabled.json')
  let enabledList: string[] = []
  try { enabledList = JSON.parse(readFileSync(enabledPath, 'utf8')) } catch { return }

  if (!enabledList.length) return

  for (const modName of enabledList) {
    try {
      const mod = await loadMod(path.join(process.cwd(), 'mods', modName))
      modInstances.set(modName, { exports: (mod.exports ?? {}) as Record<string, unknown> })
      if (mod.exports?.hooks) {
        modHooks.set(modName, mod.exports.hooks as { onUserMessage?: (text: string) => string })
      }
      if (mod.exports?.onEnable) {
        mod.exports.onEnable(createModContext(modName, mod.path))
      }
      console.log(`[mods] auto-enabled: ${modName}`)
    } catch (error) {
      console.warn(`[mods] failed to auto-enable ${modName}:`, error instanceof Error ? error.message : error)
    }
  }
}

async function lookupSessionTitle(sessionId: string): Promise<string | null> {
  try {
    const sessions = await hermesBridge.listSessions()
    const match = sessions.find((s) => s.sessionId === sessionId)
    return match?.title ?? null
  } catch {
    return null
  }
}

async function createHermesWorktree(hostPath: string, options: CreateWorktreeOptions = {}) {
  const wslRoot = windowsPathToWslPath(hostPath)
  const root = await runWslCommand(['git', '-C', wslRoot, 'rev-parse', '--show-toplevel'])
  const short = await runWslCommand(['git', '-C', root, 'rev-parse', '--short', 'HEAD'])
  const stamp = await runWslCommand(['date', '+%Y%m%d-%H%M%S'])
  const baseName = normalizeWorktreeName(options.name) ?? `hermes-${stamp}-${short}`
  const { name, branch, worktreePath } = await resolveAvailableWorktreeTarget(root, baseName, options.directory)

  await runWslCommand(['mkdir', '-p', path.posix.dirname(worktreePath)])
  await runWslCommand(['git', '-C', root, 'worktree', 'add', worktreePath, '-b', branch, 'HEAD'])
  await finalizeHermesWorktree(root, worktreePath)

  return {
    path: worktreePath,
    branch,
    name,
    root,
  }
}

async function resolveAvailableWorktreeTarget(root: string, baseName: string, directory?: string) {
  for (let index = 1; index <= 100; index += 1) {
    const name = index === 1 ? baseName : `${baseName}-${index}`
    const branch = `hermes/${name}`
    const worktreePath = resolveWorktreePath(root, name, directory)
    const [branchExists, pathExists] = await Promise.all([
      gitBranchExists(root, branch),
      wslPathExists(worktreePath),
    ])

    if (!branchExists && !pathExists) {
      return { name, branch, worktreePath }
    }
  }

  throw new Error(`Could not find an available worktree name for ${baseName}.`)
}

function normalizeWorktreeName(value?: string) {
  const raw = value?.trim()
  if (!raw) {
    return null
  }

  const normalized = raw
    .replace(/[\\/\s]+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')

  if (!normalized) {
    throw new Error('Worktree name must contain letters, numbers, dots, underscores, or hyphens.')
  }

  return normalized
}

function resolveWorktreePath(root: string, name: string, directory?: string) {
  const raw = directory?.trim()
  if (!raw) {
    return `${root}/.worktrees/${name}`
  }

  let resolved = ''
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\wsl')) {
    resolved = windowsPathToWslPath(raw)
  } else if (raw.startsWith('/')) {
    resolved = raw
  } else {
    resolved = `${root}/${raw}`
  }

  const parent = path.posix.normalize(resolved.replace(/\\/g, '/'))
  return path.posix.join(parent, name)
}

async function gitBranchExists(root: string, branch: string) {
  try {
    await runWslCommand(['git', '-C', root, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

async function wslPathExists(wslPath: string) {
  try {
    await runWslCommand(['bash', '-lc', 'test -e "$1"', 'hermes-path-exists', wslPath])
    return true
  } catch {
    return false
  }
}

async function finalizeHermesWorktree(root: string, worktreePath: string) {
  const script = [
    'set -euo pipefail',
    'root="$1"',
    'worktree_path="$2"',
    'gitignore="$root/.gitignore"',
    'touch "$gitignore"',
    'grep -qxF ".worktrees/" "$gitignore" || printf "\\n.worktrees/\\n" >> "$gitignore"',
    'if [ -f "$root/.worktreeinclude" ]; then',
    '  while IFS= read -r include || [ -n "$include" ]; do',
    '    include="${include%%#*}"',
    '    include="${include#"${include%%[![:space:]]*}"}"',
    '    include="${include%"${include##*[![:space:]]}"}"',
    '    [ -z "$include" ] && continue',
    '    [ -e "$root/$include" ] || continue',
    '    mkdir -p "$worktree_path/$(dirname "$include")"',
    '    cp -a "$root/$include" "$worktree_path/$include"',
    '  done < "$root/.worktreeinclude"',
    'fi',
  ].join('\n')

  await runWslCommand(['bash', '-lc', script, 'hermes-worktree-finalize', root, worktreePath])
}

async function listHermesWorktrees(hostPath: string): Promise<HermesWorktreeInfo[]> {
  const wslRoot = windowsPathToWslPath(hostPath)
  let output = ''

  try {
    output = await runWslCommand([
      'git',
      '-C',
      wslRoot,
      'worktree',
      'list',
      '--porcelain',
    ])
  } catch (error) {
    if (isNotGitRepositoryError(error)) {
      return []
    }

    throw error
  }

  const currentWslPath = windowsPathToWslPath(workspaceRoot)
  const worktrees: HermesWorktreeInfo[] = []
  let current: Partial<HermesWorktreeInfo> | null = null

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      if (current?.path) {
        worktrees.push(normalizeWorktreeInfo(current, currentWslPath))
      }
      current = null
      continue
    }

    const [key, ...valueParts] = line.split(' ')
    const value = valueParts.join(' ')

    if (key === 'worktree') {
      if (current?.path) {
        worktrees.push(normalizeWorktreeInfo(current, currentWslPath))
      }
      current = { path: value }
      continue
    }

    if (!current) {
      continue
    }

    if (key === 'HEAD') {
      current.head = value
    } else if (key === 'branch') {
      current.branch = value.replace(/^refs\/heads\//, '')
    } else if (key === 'detached') {
      current.detached = true
    }
  }

  if (current?.path) {
    worktrees.push(normalizeWorktreeInfo(current, currentWslPath))
  }

  return worktrees
}

function isNotGitRepositoryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('not a git repository')
}

function resolveWorkspaceItemPath(itemPath: string) {
  const normalized = path.normalize(itemPath || '')
  const absolutePath = path.resolve(workspaceRoot, normalized)

  if (!isPathInside(workspaceRoot, absolutePath)) {
    throw new Error('Cannot access workspace item outside the workspace.')
  }

  return {
    absolutePath,
    relativePath: normalized === '.' ? '' : normalized,
  }
}

function normalizeRenameTarget(nextName: string) {
  const safeName = nextName.trim()
  if (!safeName) {
    throw new Error('Name cannot be empty.')
  }

  if (safeName.includes('/') || safeName.includes('\\') || safeName === '.' || safeName === '..') {
    throw new Error('Name must be a single file or directory name.')
  }

  return safeName
}

function normalizeWorktreeInfo(info: Partial<HermesWorktreeInfo>, currentWslPath: string): HermesWorktreeInfo {
  const worktreePath = info.path ?? ''
  return {
    path: worktreePath,
    branch: info.detached ? 'detached' : info.branch ?? '',
    head: info.head ?? '',
    detached: Boolean(info.detached),
    current: normalizeWslPath(worktreePath) === normalizeWslPath(currentWslPath),
    name: path.posix.basename(worktreePath),
  }
}

function normalizeWslPath(value: string) {
  return value.replace(/\/+$/, '')
}

async function readHermesConfigSnapshot(): Promise<HermesConfigSnapshot> {
  const configPath = '~/.hermes/config.yaml'

  try {
    const content = await runWslCommand(['bash', '-lc', 'cat ~/.hermes/config.yaml'])
    const modelBlock = content.match(/(^|\n)model:\n([\s\S]*?)(\n[A-Za-z_][\w-]*:|\n?$)/)
    const block = modelBlock?.[2] ?? ''
    const provider = block.match(/^\s{2}provider:\s*(.+)$/m)?.[1]?.trim() ?? 'unknown'
    const model = block.match(/^\s{2}default:\s*(.+)$/m)?.[1]?.trim() ?? 'unknown'

    return {
      provider,
      model,
      source: configPath,
    }
  } catch {
    return {
      provider: '未知',
      model: '不可用',
      source: configPath,
    }
  }
}

async function readHermesSkillsSnapshot(): Promise<HermesSkillSnapshot[]> {
  try {
    const content = await runWslCommand([
      'bash',
      '-lc',
      `find ~/.hermes/skills -mindepth 2 -maxdepth 2 -type d -not -name .git -not -path '*/.git/*' -printf "%P\\n" 2>/dev/null`,
    ])

    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((id) => {
        const [category, name] = id.split('/')
        return {
          id,
          name: name ?? id,
          category: category ?? 'skills',
          description: `来自 WSL ~/.hermes/skills/${category ?? ''} 分类的已安装 Hermes 技能。`,
          enabled: true,
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name))
  } catch {
    return []
  }
}
