import { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, screen } from 'electron'
import type { Event as ElectronEvent, OpenDialogOptions, WebContentsConsoleMessageEventParams } from 'electron'
import { exec } from 'node:child_process'
import { access, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HermesBridge, type HermesBridgeEvent, type HermesPermissionOption, type HermesPermissionOutcome, type HermesPermissionRequest } from './hermes-bridge.js'
import { getBackendProvider, type BackendProvider, type ProxyConfig } from './backend.js'
import { sessionManager, type SessionInfo } from './session-manager.js'
import { loadMod, reloadMod, scanModsDirectory } from './mod-loader.js'
import { syncModBridge, drainTodoCommands, drainDisciplineCommands, type ModBridgeData } from './mod-bridge.js'
import { createHermesWorktree, listHermesWorktrees, normalizeWorktreeName, type HermesWorktreeInfo } from './worktree.js'
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
import { PreviewManager, isAllowedPreviewUrl } from './preview-manager.js'
import { detectInstalledBrowsers, openInBrowser } from './browser-discovery.js'
import { createSkillsCatalogPrompt, readHermesSkills, skillsFingerprint, type HermesSkillSnapshot } from './hermes-skills.js'
import {
  getWindowsInteropSnapshot,
  openPathWithDefaultApp,
  readWindowsClipboard,
  revealInExplorer,
  wslPathToUncPath,
  wslPathToWindowsPath,
  writeWindowsClipboard,
} from './windows-interop.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const hermesBridge = new HermesBridge()
const previewManager = new PreviewManager()
hermesBridge.setPermissionHandler((payload) => requestHermesPermission(payload, 'default'))
const pendingPermissionRequests = new Map<string, (outcome: HermesPermissionOutcome) => void>()
let permissionRequestSequence = 0
let isQuitting = false
let workspaceRoot = process.cwd()
let lastSessionId: string | undefined
let currentSessionTitle: string | null = null
let shutdownStarted = false
let currentProxyConfig: ProxyConfig | null = null
// Tracks the in-flight autoEnableMods() call. Mod IPC handlers and the data
// each mod loads in onEnable() only exist once this resolves, so mods:scan
// awaits it before returning — that way sidebar panels never render and fetch
// before their backend handlers are registered.
let modsReadyPromise: Promise<void> | null = null

type HermesConfigSnapshot = {
  provider: string
  model: string
  baseUrl?: string
  apiMode?: HermesApiMode
  source: string
  providers?: Record<string, HermesProviderConfigSnapshot>
}

type HermesProviderConfigSnapshot = {
  provider: string
  baseUrl?: string
  apiMode?: HermesApiMode
  models?: Array<{ id: string; name: string; contextLength?: number }>
  hasApiKey?: boolean
}

type HermesApiMode = 'chat_completions' | 'anthropic_messages' | 'codex_responses' | 'bedrock_converse'

type HermesModelConfigRequest = {
  provider?: string
  model?: string
  baseUrl?: string
  apiMode?: HermesApiMode | string
  apiKey?: string
  models?: Array<{ id?: string; contextLength?: number }>
}

type HermesFetchModelsRequest = {
  provider?: string
  baseUrl?: string
  apiKey?: string
}

type CreateWorktreeOptions = {
  name?: string
  directory?: string
}

function createTray() {
  if (tray) {
    return
  }

  try {
    tray = new Tray(getAppIconPath())
  } catch (error) {
    console.warn('[tray] failed to create tray icon:', error instanceof Error ? error.message : error)
    return
  }
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

  // Validate saved coordinates are still on an active display (e.g. external
  // monitor unplugged since last session). If not, fall back to defaults so
  // the window is visible rather than stranded off-screen.
  let winX = state.x
  let winY = state.y
  if (winX !== undefined && winY !== undefined) {
    const displays = screen.getAllDisplays()
    const onScreen = displays.some((d) => {
      const { x, y, width, height } = d.workArea
      // Title bar must be within bounds — just check the top-left corner
      // falls inside at least one display.
      return winX! >= x && winX! < x + width && winY! >= y && winY! < y + height
    })
    if (!onScreen) {
      console.log('[window] saved position', winX, winY, 'is off-screen — resetting to defaults')
      winX = undefined
      winY = undefined
    }
  }

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: winX,
    y: winY,
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
      webviewTag: true,
    },
  })

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isAllowedPreviewUrl(params.src)) {
      event.preventDefault()
      return
    }
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
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

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return
    }

    event.preventDefault()
    beginShutdown()
    app.quit()
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

// Independent always-on-top memo widget. Loads the same renderer with a
// '#todo-widget' hash so the React entry mounts only the compact TodoWidget.
// It stays on top even when the main window is hidden/minimized, and talks to
// the same hermes-todo mod instance over the shared mod IPC handlers.
let todoWidgetWindow: BrowserWindow | null = null

function openTodoWidgetWindow() {
  if (todoWidgetWindow && !todoWidgetWindow.isDestroyed()) {
    todoWidgetWindow.show()
    todoWidgetWindow.focus()
    return
  }

  todoWidgetWindow = new BrowserWindow({
    width: 360,
    height: 540,
    minWidth: 280,
    minHeight: 320,
    frame: false,
    transparent: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    backgroundColor: '#0b1018',
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 'screen-saver' level keeps it above full-screen apps, not just normal windows.
  todoWidgetWindow.setAlwaysOnTop(true, 'screen-saver')

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    void todoWidgetWindow.loadURL(`${devServerUrl}#todo-widget`)
  } else {
    void todoWidgetWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), { hash: 'todo-widget' })
  }

  todoWidgetWindow.on('closed', () => {
    todoWidgetWindow = null
  })
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

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedPreviewUrl(url)) event.preventDefault()
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
})

app.whenReady().then(async () => {
  process.env.HERMES_DESKTOP_PYTHONPATH = app.isPackaged
    ? path.join(process.resourcesPath, 'runtime', 'python')
    : path.join(app.getAppPath(), 'runtime', 'python')
  await restoreWorkspaceRoot()
  prepareModEnvironment()
  // Sync bridge workspace path before starting — prevents an unnecessary
  // stop/restart cycle if the persisted workspace differs from process.cwd().
  hermesBridge.initWorkspacePath(workspaceRoot)

  // Register the default tab BEFORE creating the window so the workbench
  // picks it up on its very first poll. The bridge starts in background
  // and the tab updates once the ACP handshake completes.
  sessionManager.registerSession('default', '主会话', workspaceRoot, hermesBridge)

  void createWindow()
  createTray()
  registerShortcuts()

  // Wire default bridge events with sessionId
  hermesBridge.on('event', (event: HermesBridgeEvent) => {
    mainWindow?.webContents.send('hermes:event', { ...event, sessionId: 'default' } as HermesBridgeEvent & { sessionId: string })
  })

  // Auto-load previously enabled MODs immediately — this only needs the mods
  // directory, so it must not be gated behind the (slow) bridge warm-up below,
  // or the renderer would scan and render panels before the mod IPC handlers
  // are registered. Broadcast mods:ready so already-mounted panels re-fetch.
  modsReadyPromise = autoEnableMods()
    .then(() => {
      mainWindow?.webContents.send('hermes:event', { type: 'mods:ready' } satisfies HermesBridgeEvent)
    })
    .catch((error) => {
      console.warn('[mods] auto-enable failed', error instanceof Error ? error.message : error)
    })

  // Start the bridge in background. Once the ACP handshake completes,
  // resume the last session if one was persisted.
  void hermesBridge.start().then(async () => {
    sessionManager.updateSession('default', { cwd: workspaceRoot, title: currentSessionTitle })

    if (lastSessionId && hermesBridge.getSessionId() !== lastSessionId) {
      try {
        await hermesBridge.loadSession(lastSessionId, workspaceRoot)
        currentSessionTitle = await lookupSessionTitle(lastSessionId)
        sessionManager.updateSession('default', { cwd: workspaceRoot, title: currentSessionTitle })
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

app.on('before-quit', () => {
  beginShutdown()
})

app.on('will-quit', () => {
  beginShutdown()
})

function beginShutdown() {
  if (shutdownStarted) return
  shutdownStarted = true
  isQuitting = true
  globalShortcut.unregisterAll()
  if (_todoPollTimer) clearInterval(_todoPollTimer)
  void previewManager.stopAll()
  if (_discPollTimer) clearInterval(_discPollTimer)
  // Call onDisable for all enabled MODs so they can save state
  for (const [, instance] of modInstances) {
    if (instance?.exports?.onDisable) {
      try { (instance.exports.onDisable as () => void)() } catch { /* noop */ }
    }
  }
  sessionManager.closeAll()
  hermesBridge.stop()
  if (todoWidgetWindow && !todoWidgetWindow.isDestroyed()) {
    todoWidgetWindow.destroy()
  }
  tray?.destroy()
}

// MOD instance registry — stores full exports for enabled MODs
const modInstances: Map<string, { exports: Record<string, unknown> }> = new Map()
// MOD hook registry — hooks registered by enabled MODs
const modHooks: Map<string, { onUserMessage?: (text: string) => string }> = new Map()

// Helper: get the currently active bridge, falling back to default
function getActiveBridge(): HermesBridge {
  return sessionManager.activeBridge ?? hermesBridge
}

// ---- Mod → Agent bridge helpers -------------------------------------------
// Sessions that already received the composed mod guidance injection. Keyed by
// the resolved session id, so each new/loaded session gets the guidance once.
const bridgeInjectedSessions = new Set<string>()
const skillCatalogFingerprints = new Map<string, string>()

// Call a mod's raw IPC handler directly (modInstances keeps the un-serialized
// exports, so the handler functions are intact). Returns null if unavailable.
function callModHandler(modName: string, method: string, args?: unknown): unknown {
  const handlers = (modInstances.get(modName)?.exports as {
    main?: { ipcHandlers?: Record<string, (...a: unknown[]) => unknown> }
  } | undefined)?.main?.ipcHandlers
  const fn = handlers?.[method]
  if (typeof fn !== 'function') return null
  try { return fn(null, args) } catch { return null }
}

// Compose every enabled mod's systemPrompt hook (each does `base + '...'`).
function composeModSystemPrompt(): string {
  let out = ''
  for (const [, inst] of modInstances) {
    const fn = (inst.exports as { hooks?: { systemPrompt?: (base: string) => string } }).hooks?.systemPrompt
    if (typeof fn === 'function') {
      try { out = fn(out) } catch { /* skip broken hook */ }
    }
  }
  return out.trim()
}

// Apply the agent's queued todo commands back into the hermes-todo mod.
// Returns the number of commands applied (0 = no changes).
async function applyTodoCommands(): Promise<number> {
  if (!modInstances.has('hermes-todo')) return 0
  const commands = await drainTodoCommands()
  for (const cmd of commands) {
    const op = String(cmd.op || '')
    if (op === 'add') callModHandler('hermes-todo', 'add', cmd)
    else if (op === 'toggle') callModHandler('hermes-todo', 'toggle', { index: cmd.index })
    else if (op === 'remove') callModHandler('hermes-todo', 'remove', { index: cmd.index })
    else if (op === 'clear-done') callModHandler('hermes-todo', 'clear-done')
  }
  return commands.length
}

// Apply the agent's queued discipline commands back into the hermes-discipline mod.
async function applyDisciplineCommands(): Promise<number> {
  if (!modInstances.has('hermes-discipline')) return 0
  const commands = await drainDisciplineCommands()
  for (const cmd of commands) {
    const op = String(cmd.op || '')
    if (op === 'update-schedule') callModHandler('hermes-discipline', 'update-schedule', cmd)
    else if (op === 'update-goal') callModHandler('hermes-discipline', 'update-goal', cmd)
    else if (op === 'save-summary') callModHandler('hermes-discipline', 'save-summary', cmd)
  }
  return commands.length
}

// Poll the todo-commands.jsonl file periodically so the agent's task edits are
// applied promptly even when the user hasn't sent a follow-up message yet.
let _discPollTimer: ReturnType<typeof setInterval> | null = null
let _todoPollTimer: ReturnType<typeof setInterval> | null = null

function startDisciplinePolling() {
  if (_discPollTimer) return
  _discPollTimer = setInterval(async () => {
    try {
      const count = await applyDisciplineCommands()
      if (count > 0) {
        await syncModBridgeNow()
        mainWindow?.webContents.send('hermes:event', { type: 'discipline:updated' })
      }
    } catch { /* silent */ }
  }, 2000)
}

function startTodoPolling() {
  if (_todoPollTimer) return
  _todoPollTimer = setInterval(async () => {
    try {
      const count = await applyTodoCommands()
      if (count > 0) {
        await syncModBridgeNow()
        mainWindow?.webContents.send('hermes:event', { type: 'todo:updated' })
      }
    } catch {
      // Silently ignore poll errors — the file may not exist yet
    }
  }, 2000)
}

// Push the current todo list + SSH configs (incl. secrets) and skill docs into
// the native Hermes skills directory so the agent can read them. No-op when
// neither mod is enabled.
async function syncModBridgeNow(): Promise<void> {
  const hasTodo = modInstances.has('hermes-todo')
  const hasSsh = modInstances.has('hermes-ssh')
  const hasDiscipline = modInstances.has('hermes-discipline')
  if (!hasTodo && !hasSsh && !hasDiscipline) return
  const discData = hasDiscipline ? (callModHandler('hermes-discipline', 'list-plans') as { plans?: unknown[]; templates?: unknown[] } | null) : null
  const data: ModBridgeData = {
    todos: hasTodo ? ((callModHandler('hermes-todo', 'list') as unknown[]) ?? []) : [],
    sshServers: hasSsh ? ((callModHandler('hermes-ssh', 'get-configs') as unknown[]) ?? []) : [],
    disciplinePlans: discData?.plans ?? [],
    disciplineTemplates: discData?.templates ?? [],
  }
  try { await syncModBridge(data) } catch (err) {
    console.warn('[mod-bridge] sync failed:', err instanceof Error ? err.message : err)
  }
}

ipcMain.handle('hermes:send-message', async (_event, message: string, sessionId?: string) => {
  // Run MOD onUserMessage hooks before sending
  let processed = message
  const isSlashCommand = message.trimStart().startsWith('/')
  if (!isSlashCommand) {
    for (const [, hooks] of modHooks) {
      if (hooks.onUserMessage) {
        try { processed = hooks.onUserMessage(processed) } catch { /* skip broken hooks */ }
      }
    }
  }

  // Mod → Agent bridge: apply any edits the agent queued last turn, then
  // refresh the data files so this turn reads current mod data.
  const todoApplied = await applyTodoCommands()
  const discApplied = await applyDisciplineCommands()
  await syncModBridgeNow()

  const installedSkills = await readHermesSkillsSnapshot()
  const skillsKey = sessionId || sessionManager.activeSession?.id || 'default'
  const fingerprint = skillsFingerprint(installedSkills)
  if (skillCatalogFingerprints.get(skillsKey) !== fingerprint) {
    const catalogPrompt = createSkillsCatalogPrompt(installedSkills)
    if (catalogPrompt && !isSlashCommand) {
      processed = `${catalogPrompt}\n\n---\n\n${processed}`
      skillCatalogFingerprints.set(skillsKey, fingerprint)
    }
    mainWindow?.webContents.send('hermes:event', {
      type: 'skills:updated',
      payload: installedSkills,
    } satisfies HermesBridgeEvent)
  }

  // Notify the renderer so UI panels can re-fetch updated lists.
  if (todoApplied > 0) {
    mainWindow?.webContents.send('hermes:event', { type: 'todo:updated' })
  }
  if (discApplied > 0) {
    mainWindow?.webContents.send('hermes:event', { type: 'discipline:updated' })
  }

  // Inject the composed mod guidance once per session, so the agent is told the
  // bridge files / hermes-mods skills exist even if it hasn't browsed skills.
  const injectKey = sessionId || sessionManager.activeSession?.id || 'default'
  if (!processed.trimStart().startsWith('/') && !bridgeInjectedSessions.has(injectKey)) {
    const guidance = composeModSystemPrompt()
    if (guidance) processed = `${guidance}\n\n---\n\n${processed}`
    bridgeInjectedSessions.add(injectKey)
  }

  const bridge = sessionId ? sessionManager.getSession(sessionId)?.bridge : getActiveBridge()
  void (bridge ?? getActiveBridge()).sendMessage(processed).catch((error) => {
    mainWindow?.webContents.send('hermes:event', {
      type: 'stderr',
      payload: error instanceof Error ? error.message : 'Failed to send Hermes message.',
      sessionId: sessionId || sessionManager.activeSession?.id || 'default',
    } satisfies HermesBridgeEvent & { sessionId: string })
  })
  return { ok: true }
})

ipcMain.handle('hermes:cancel-message', async () => {
  return getActiveBridge().cancelActivePrompt()
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
  try {
    return await getActiveBridge().listSessions()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('backend stopped') || message.includes('has not started')) {
      return [] // backend not ready yet — return empty list
    }
    throw error
  }
})

ipcMain.handle('hermes:load-session', async (_event, sessionId: string, cwd: string) => {
  const nextWorkspaceRoot = workspaceHostPathFromHermesCwd(cwd)
  await assertWorkspaceExists(nextWorkspaceRoot)
  workspaceRoot = nextWorkspaceRoot
  bridgeInjectedSessions.clear()
  const bridge = getActiveBridge()
  await bridge.loadSession(sessionId, workspaceRoot)
  currentSessionTitle = await lookupSessionTitle(sessionId)
  sessionManager.updateActive({ cwd: workspaceRoot, title: currentSessionTitle })
  queuePersistWorkspaceRoot(sessionId)
  return createWorkspaceSnapshot()
})

ipcMain.handle('hermes:new-session', async () => {
  currentSessionTitle = null
  bridgeInjectedSessions.clear()
  const bridge = getActiveBridge()
  await bridge.startNewSession(workspaceRoot)
  sessionManager.updateActive({ cwd: workspaceRoot, title: null })
  queuePersistWorkspaceRoot(bridge.getSessionId() ?? undefined)
  return createWorkspaceSnapshot()
})

ipcMain.handle('hermes:delete-session', async (_event, sessionId: string) => {
  const backend = getBackendProvider()
  try {
    await backend.execCommand(['hermes', 'sessions', 'delete', sessionId])
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('hermes:rename-session', async (_event, sessionId: string, newTitle: string) => {
  const backend = getBackendProvider()
  try {
    await backend.execCommand(['hermes', 'sessions', 'rename', sessionId, newTitle])
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('proxy:set-config', async (_event, config) => {
  currentProxyConfig = config
  getActiveBridge().setProxyConfig(config)
  return { ok: true }
})

ipcMain.handle('proxy:detect-host', async () => {
  const backend = getBackendProvider()

  // 1. Check environment variables first (works for both backends)
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy
  const proxyUrl = httpProxy || httpsProxy
  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl)
      if (u.hostname) return { host: u.hostname }
    } catch { /* not a valid URL, continue */ }
  }

  // 2. For native Windows, try system proxy settings
  if (backend.type === 'native') {
    try {
      const { execFileSync } = await import('node:child_process')
      const output = execFileSync('netsh', ['winhttp', 'show', 'proxy'], {
        encoding: 'utf8',
        windowsHide: true,
      })
      const match = output.match(/代理服务器地址\s*:\s*([^\s]+)/) || output.match(/Proxy Server\s*:\s*([^\s]+)/)
      if (match) {
        const addr = match[1]
        // netsh returns format like "127.0.0.1:7890" or "http=127.0.0.1:7890;https=..."
        const hostPart = addr.includes('=') ? addr.split(';')[0].split('=')[1] || addr.split(';')[0] : addr
        try {
          // strip protocol prefix if present
          const clean = hostPart.replace(/^https?:\/\//, '')
          const host = clean.split(':')[0]
          if (host && host !== '=') return { host }
        } catch { /* fall through */ }
      }
    } catch { /* netsh not available or system proxy not set */ }
  }

  return { host: '127.0.0.1' }
})

ipcMain.handle('hermes:restart-backend', async () => {
  const bridge = getActiveBridge()
  bridge.stop()
  await bridge.start()
  return { ok: true }
})

// --- Session (multi-tab) handlers ---

ipcMain.handle('session:create', async (_event, name: string, cwd?: string) => {
  const session = await sessionManager.createSession(name, cwd || workspaceRoot, {
    configureBridge: (bridge, sessionId) => {
      // Each session bridge needs its own permission handler, otherwise tool
      // permission prompts in non-default tabs are silently auto-cancelled.
      bridge.setPermissionHandler((payload) => requestHermesPermission(payload, sessionId))
      bridge.setProxyConfig(currentProxyConfig)
      // Wire up event forwarding before the ACP process starts so early stderr
      // and initialization failures are visible in the correct tab.
      bridge.on('event', (event: HermesBridgeEvent) => {
        mainWindow?.webContents.send('hermes:event', { ...event, sessionId } as HermesBridgeEvent & { sessionId: string })
      })
    },
  })
  return { id: session.id, name: session.name, cwd: session.cwd }
})

ipcMain.handle('session:close', async (_event, sessionId: string) => {
  await sessionManager.closeSession(sessionId)
  // Follow the active session's workspace after a close re-selects another tab.
  const active = sessionManager.activeSession
  if (active) {
    workspaceRoot = active.cwd
    currentSessionTitle = active.title
  }
  return { ok: true }
})

ipcMain.handle('session:switch', async (_event, sessionId: string) => {
  const ok = sessionManager.setActive(sessionId)
  if (!ok) {
    return { ok: false, sessions: sessionManager.listSessions() }
  }

  // Switching a tab must also switch the workspace context: cwd, file tree,
  // and the cached slash-commands all belong to the newly-active session.
  const active = sessionManager.activeSession
  if (active) {
    workspaceRoot = active.cwd
    currentSessionTitle = active.title
    queuePersistWorkspaceRoot(active.bridge.getSessionId() ?? undefined)
  }

  const snapshot = await createWorkspaceSnapshot()
  const commands = getActiveBridge().getCachedCommands()
  return { ok, sessions: sessionManager.listSessions(), snapshot, commands }
})

ipcMain.handle('session:list', async () => {
  return sessionManager.listSessions()
})

// Hot-reload: rebuild the Electron main process + rescan mods + sync bridge +
// reload the renderer window.  Similar to what start-hermes-desktop does, but
// without killing the entire process.
ipcMain.handle('hermes:hot-reload', async () => {
  const projectDir = app.getAppPath()

  // 1. Rebuild Electron main process (tsc)
  try {
    await new Promise<void>((resolve, reject) => {
      exec('npx tsc -p tsconfig.electron.json', { cwd: projectDir }, (err, stdout, stderr) => {
        if (stdout) console.log('[hot-reload] tsc:', stdout.trim())
        if (stderr) console.warn('[hot-reload] tsc stderr:', stderr.trim())
        if (err) reject(err)
        else resolve()
      })
    })
  } catch (err) {
    console.warn('[hot-reload] tsc rebuild failed:', err instanceof Error ? err.message : err)
    // Continue anyway — the window reload will still pick up current build
  }

  // 2. Re-scan mods directory
  const mods = await scanInstalledMods()
  const enabledPath = getEnabledModsPath()
  let enabledList: string[] = []
  try { enabledList = JSON.parse(readFileSync(enabledPath, 'utf8')) } catch { /* ok */ }

  const scanned = mods.map((m) => ({
    name: m.name,
    path: m.path,
    manifest: m.manifest,
    enabled: enabledList.includes(m.name),
    error: m.error,
  }))

  // 3. Apply pending todo commands + sync bridge
  const todoApplied = await applyTodoCommands()
  await syncModBridgeNow()

  // 4. Reload the renderer window (picks up rebuilt frontend + mod changes)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reload()
  }

  return { mods: scanned, todoApplied, rebuilt: true }
})

// --- MOD handlers ---

ipcMain.handle('mods:scan', async () => {
  // Wait for auto-enable to finish registering mod IPC handlers and loading
  // each mod's saved data, so panels rendered from this scan can fetch
  // successfully on mount instead of racing an unregistered handler.
  if (modsReadyPromise) {
    try { await modsReadyPromise } catch { /* noop */ }
  }
  const mods = await scanInstalledMods()
  // Mark auto-enabled MODs
  const enabledPath = getEnabledModsPath()
  let enabledList: string[] = []
  try { enabledList = JSON.parse(readFileSync(enabledPath, 'utf8')) } catch { /* noop */ }

  return mods.map((m) => ({
    ...m,
    enabled: enabledList.includes(m.name) ? true : m.enabled,
  }))
})

ipcMain.handle('mods:toggle', async (_event, modName: string, enabled: boolean) => {
  const enabledPath = getEnabledModsPath()

  if (enabled) {
    const mod = await loadMod(resolveModDirectory(modName))
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
    // Refresh the mod bridge so a newly enabled todo/SSH mod is visible to agent.
    if (modName === 'hermes-todo' || modName === 'hermes-ssh' || modName === 'hermes-discipline') void syncModBridgeNow()
    // Start polling for agent-written todo commands if the todo mod was just enabled.
    if (modName === 'hermes-todo') startTodoPolling()
    if (modName === 'hermes-discipline') startDisciplinePolling()
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
      if (mod.exports.tabs) safe.tabs = mod.exports.tabs
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
  const modsRoot = path.resolve(getUserModsRoot())
  const target = path.resolve(modPath)
  if (target === modsRoot || !isPathInside(modsRoot, target)) {
    return { ok: false, error: '只能卸载用户 MOD 目录内的扩展。' }
  }

  await rm(target, { recursive: true, force: true })
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
  const configPath = getModConfigPath()
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
  const worktree = await createHermesWorktree(workspaceRoot, workspaceRoot, options)
  const nextWorkspaceRoot = workspaceHostPathFromHermesCwd(worktree.path)
  const bridge = getActiveBridge()
  await bridge.updateWorkspace(nextWorkspaceRoot)
  workspaceRoot = nextWorkspaceRoot
  sessionManager.updateActive({ cwd: workspaceRoot })
  queuePersistWorkspaceRoot(bridge.getSessionId() ?? undefined)
  return {
    worktree,
    snapshot: await createWorkspaceSnapshot(),
  }
})

ipcMain.handle('workspace:list-worktrees', async () => {
  return listHermesWorktrees(workspaceRoot, workspaceRoot)
})

ipcMain.handle('workspace:switch-worktree', async (_event, worktreePath: string) => {
  const nextWorkspaceRoot = workspaceHostPathFromHermesCwd(worktreePath)
  await assertWorkspaceExists(nextWorkspaceRoot)
  const bridge = getActiveBridge()
  await bridge.updateWorkspace(nextWorkspaceRoot)
  workspaceRoot = nextWorkspaceRoot
  sessionManager.updateActive({ cwd: workspaceRoot })
  queuePersistWorkspaceRoot(bridge.getSessionId() ?? undefined)
  return createWorkspaceSnapshot()
})

ipcMain.handle('workspace:select-directory', async () => {
  return selectDirectory('Select workspace directory', workspaceRoot)
})

ipcMain.handle('workspace:switch-root', async (_event, hostPath: string) => {
  await assertWorkspaceExists(hostPath)
  workspaceRoot = hostPath
  const bridge = getActiveBridge()
  await bridge.startNewSession(workspaceRoot)
  currentSessionTitle = null
  bridgeInjectedSessions.clear()
  sessionManager.updateActive({ cwd: workspaceRoot, title: null })
  queuePersistWorkspaceRoot(bridge.getSessionId() ?? undefined)
  return createWorkspaceSnapshot()
})

// Soft workspace switch — preserves the active ACP session and conversation
// context while only updating the workspace directory and file tree.
ipcMain.handle('workspace:soft-switch', async (_event, hostPath: string) => {
  await assertWorkspaceExists(hostPath)
  const bridge = getActiveBridge()
  await bridge.updateWorkspace(hostPath)
  workspaceRoot = hostPath
  sessionManager.updateActive({ cwd: workspaceRoot })
  queuePersistWorkspaceRoot(bridge.getSessionId() ?? undefined)
  return createWorkspaceSnapshot()
})

ipcMain.handle('workspace:select-worktree-directory', async () => {
  return selectDirectory('Select worktree parent directory', workspaceRoot)
})

ipcMain.handle('workspace:get-snapshot', async () => {
  return createWorkspaceSnapshot()
})

ipcMain.handle('preview:list-configurations', async (_event, requestedWorkspace?: string) => {
  const previewWorkspace = resolvePreviewWorkspace(requestedWorkspace)
  return previewManager.list(previewWorkspace)
})

ipcMain.handle('preview:start', async (_event, requestedWorkspace: string | undefined, configurationId: string) => {
  try {
    const previewWorkspace = resolvePreviewWorkspace(requestedWorkspace)
    return { ok: true, status: await previewManager.start(previewWorkspace, configurationId) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '启动预览失败。' }
  }
})

ipcMain.handle('preview:get-status', async (_event, requestedWorkspace: string | undefined, configurationId: string) => {
  try {
    const previewWorkspace = resolvePreviewWorkspace(requestedWorkspace)
    return { ok: true, status: previewManager.status(previewWorkspace, configurationId) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '读取预览状态失败。' }
  }
})

ipcMain.handle('preview:stop', async (_event, requestedWorkspace: string | undefined, configurationId: string) => {
  try {
    const previewWorkspace = resolvePreviewWorkspace(requestedWorkspace)
    return { ok: true, status: await previewManager.stop(previewWorkspace, configurationId) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '停止预览失败。' }
  }
})

ipcMain.handle('preview:list-browsers', async () => detectInstalledBrowsers())

ipcMain.handle('preview:open-browser', async (_event, url: string, browserId: string) => {
  if (!isAllowedPreviewUrl(url)) return { ok: false, error: '只能打开本机预览地址。' }
  try {
    await openInBrowser(url, browserId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '打开浏览器失败。' }
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

ipcMain.handle('hermes:set-model-config', async (_event, config: HermesModelConfigRequest) => {
  const backend = getBackendProvider()
  try {
    applyHermesModelConfig(backend, config)
    return { ok: true, config: await readHermesConfigSnapshot() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('hermes:fetch-provider-models', async (_event, config: HermesFetchModelsRequest) => {
  const backend = getBackendProvider()
  try {
    const models = await fetchProviderModels(backend, config)
    return { ok: true, models }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('hermes:validate-model-config', async (_event, config: HermesModelConfigRequest) => {
  const backend = getBackendProvider()
  try {
    const model = normalizeRequiredValue(config.model, 'Model ID')
    const models = await fetchProviderModels(backend, config)
    if (!models.some((item) => item.id === model)) {
      return {
        ok: false,
        error: `接口可访问，但没有找到模型 ${model}`,
        models,
      }
    }
    return { ok: true, models }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('hermes:get-api-keys', async () => {
  const backend = getBackendProvider()
  const configPath = path.join(backend.hermesHome, 'config.yaml')
  try {
    const raw = await readFile(configPath, 'utf8')
    const content = raw.replace(/\r\n/g, '\n')

    const masked: Record<string, string | null> = {}
    for (const providerId of KNOWN_PROVIDER_IDS) {
      const providerEntry = findCustomProviderEntry(content, providerId)
      masked[providerId] = maskApiKey(readProviderScalar(providerEntry ?? '', 'api_key'))
    }
    return { keys: masked }
  } catch {
    const empty: Record<string, string | null> = {}
    for (const id of KNOWN_PROVIDER_IDS) empty[id] = null
    return { keys: empty }
  }
})

ipcMain.handle('hermes:set-api-key', async (_event, config: { provider: string; apiKey: string }) => {
  const backend = getBackendProvider()
  try {
    applyHermesModelConfig(backend, {
      provider: config.provider,
      apiKey: config.apiKey,
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

function createModContext(modName: string, modDir?: string) {
  const configPath = getModConfigPath()
  return {
    modName,
    modDir: modDir || resolveModDirectory(modName),
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
  return getActiveBridge().getCachedCommands()
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
  beginShutdown()
  app.quit()
  return { ok: true }
})

ipcMain.handle('todo-widget:open', async () => {
  openTodoWidgetWindow()
  return { ok: true }
})

ipcMain.handle('todo-widget:close', async () => {
  if (todoWidgetWindow && !todoWidgetWindow.isDestroyed()) todoWidgetWindow.close()
  return { ok: true }
})

ipcMain.handle('todo-widget:set-pin', async (_event, pinned: boolean) => {
  if (todoWidgetWindow && !todoWidgetWindow.isDestroyed()) {
    todoWidgetWindow.setAlwaysOnTop(pinned, pinned ? 'screen-saver' : 'normal')
    todoWidgetWindow.setSkipTaskbar(pinned)
  }
  return { ok: true, pinned }
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

async function requestHermesPermission(payload: unknown, tabSessionId = 'default'): Promise<HermesPermissionOutcome> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { outcome: { outcome: 'cancelled' } }
  }

  const request = createPermissionRequest(payload, tabSessionId)
  return new Promise((resolve) => {
    pendingPermissionRequests.set(request.requestId, (outcome) => {
      resolve(outcome)
    })

    mainWindow?.webContents.send('hermes:event', {
      type: 'permission:request',
      payload: request,
      sessionId: tabSessionId,
    } as HermesBridgeEvent & { sessionId: string })
  })
}

function createPermissionRequest(payload: unknown, tabSessionId: string): HermesPermissionRequest {
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
    sessionId: tabSessionId,
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
  const assetDir = path.join(app.getAppPath(), 'assets')
  const candidates = process.platform === 'win32'
    ? ['icon.ico', 'icon.png']
    : ['icon.png', 'icon-256.png', 'icon.ico']

  for (const file of candidates) {
    const candidate = path.join(assetDir, file)
    if (existsSync(candidate)) return candidate
  }

  return path.join(assetDir, candidates[0])
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
    session: getActiveBridge().getSessionId() ?? 'Local desktop session',
    sessionTitle: currentSessionTitle,
    files: await readWorkspaceDirectory(workspaceRoot),
    tasks: [
      { id: 'task-layout', title: 'Desktop three-panel shell', done: true },
      { id: 'task-bridge', title: 'Native Hermes ACP bridge', done: true },
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
  const backend = getBackendProvider()

  // Native backend: paths are already Windows paths, no conversion needed.
  if (backend.type === 'native') {
    return cwd
  }

  // Already a Windows drive-letter path — pass through unchanged.
  // This handles sessions that were saved with a Windows-style cwd,
  // preventing corruption by wslPathToUncPath below.
  if (/^[A-Za-z]:[\\/]/.test(cwd)) {
    return cwd
  }

  // UNC path from WSL — pass through as-is.
  if (cwd.startsWith('\\\\wsl')) {
    return cwd
  }

  const windowsPath = wslPathToWindowsPath(cwd)
  if (windowsPath) {
    return windowsPath
  }

  return wslPathToUncPath(cwd) ?? cwd
}

async function assertWorkspaceExists(hostPath: string) {
  await access(hostPath)
}

function getBundledModsRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'mods')
  }

  return path.join(app.getAppPath(), 'mods')
}

function getUserModsRoot() {
  const dir = path.join(getModStateDir(), 'installed')
  mkdirSync(dir, { recursive: true })
  return dir
}

function getModStateDir() {
  const dir = path.join(app.getPath('userData'), 'mods')
  mkdirSync(dir, { recursive: true })
  return dir
}

function getEnabledModsPath() {
  return path.join(getModStateDir(), '.hermes-mod-enabled.json')
}

function getModConfigPath() {
  return path.join(getModStateDir(), '.hermes-mod-config.json')
}

function prepareModEnvironment() {
  process.env.HERMES_MODS_ROOT = getBundledModsRoot()
  process.env.HERMES_USER_MODS_ROOT = getUserModsRoot()
  process.env.HERMES_MOD_CONFIG_PATH = getModConfigPath()
}

async function scanInstalledMods() {
  const bundled = await scanModsDirectory(getBundledModsRoot())
  const user = await scanModsDirectory(getUserModsRoot())
  const byName = new Map<string, typeof bundled[number]>()

  for (const mod of bundled) byName.set(mod.name, mod)
  for (const mod of user) byName.set(mod.name, mod)

  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function resolveModDirectory(modName: string) {
  const safeName = modName.trim()
  if (!safeName || safeName.includes('/') || safeName.includes('\\') || safeName === '.' || safeName === '..') {
    throw new Error('MOD name must be a single directory name.')
  }

  const candidates = [getUserModsRoot(), getBundledModsRoot()]
  for (const root of candidates) {
    const modDir = path.resolve(root, safeName)
    if (!isPathInside(root, modDir)) continue
    if (existsSync(modDir)) {
      return modDir
    }
  }

  throw new Error(`MOD not found: ${safeName}`)
}

async function autoEnableMods() {
  const enabledPath = getEnabledModsPath()
  let enabledList: string[] = []
  try { enabledList = JSON.parse(readFileSync(enabledPath, 'utf8')) } catch { return }

  if (!enabledList.length) return

  for (const modName of enabledList) {
    try {
      const mod = await loadMod(resolveModDirectory(modName))
      modInstances.set(modName, { exports: (mod.exports ?? {}) as Record<string, unknown> })
      if (mod.exports?.hooks) {
        modHooks.set(modName, mod.exports.hooks as { onUserMessage?: (text: string) => string })
      }
      // Register MOD IPC handlers
      if (mod.exports?.main?.ipcHandlers) {
        for (const [channel, handler] of Object.entries(mod.exports.main.ipcHandlers)) {
          const prefixedChannel = `mod:${modName}:${channel}`
          ipcMain.handle(prefixedChannel, (_e, ...args) => (handler as (...a: unknown[]) => unknown)(_e, ...args))
        }
      }
      if (mod.exports?.onEnable) {
        mod.exports.onEnable(createModContext(modName, mod.path))
      }
      console.log(`[mods] auto-enabled: ${modName}`)
    } catch (error) {
      console.warn(`[mods] failed to auto-enable ${modName}:`, error instanceof Error ? error.message : error)
    }
  }

  // Install the bridge skill docs + initial data so the agent discovers the
  // hermes-mods skills at its very first session/new, not only after a prompt.
  await syncModBridgeNow()

  // Begin polling for agent-written todo commands so edits take effect
  // promptly, even before the user sends the next message.
  startTodoPolling()
}

async function lookupSessionTitle(sessionId: string): Promise<string | null> {
  try {
    const sessions = await getActiveBridge().listSessions()
    const match = sessions.find((s) => s.sessionId === sessionId)
    return match?.title ?? null
  } catch {
    return null
  }
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

function resolvePreviewWorkspace(requestedWorkspace?: string) {
  const candidate = path.resolve(requestedWorkspace || workspaceRoot)
  if (!isPathInside(workspaceRoot, candidate)) {
    throw new Error('只能预览当前工作区中的项目。')
  }
  return candidate
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



/**
 * Read a scalar value from the model: block in hermes config.yaml.
 * Looks for "  key: value" lines inside the "model:" section.
 */
function parseModelYamlKey(content: string, key: string): string {
  const modelBlock = content.match(/(^|\n)model:\n([\s\S]*?)(\n\S|$)/)
  const block = modelBlock?.[2] ?? ''
  const regex = new RegExp(`^\\s{2}${key}:\\s*(.+)$`, 'm')
  return parseYamlScalar(block.match(regex)?.[1]?.trim() ?? '')
}

const VALID_API_MODES = new Set<HermesApiMode>([
  'chat_completions',
  'anthropic_messages',
  'codex_responses',
  'bedrock_converse',
])

function normalizeProviderName(provider?: string): string {
  const value = (provider ?? '').trim()
  if (!value) throw new Error('Provider 不能为空')
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Provider 只能包含字母、数字、下划线和短横线')
  }
  return value
}

function normalizeRequiredValue(value: string | undefined, label: string): string {
  const normalized = (value ?? '').trim()
  if (!normalized) throw new Error(`${label} 不能为空`)
  return normalized
}

function normalizeApiMode(value?: string): HermesApiMode {
  return VALID_API_MODES.has(value as HermesApiMode) ? value as HermesApiMode : 'chat_completions'
}

function parseYamlScalar(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  if (!value) return ''
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function readProviderScalar(entry: string, key: string): string {
  const regex = new RegExp(`^\\s{4}${key}:\\s*(.+)$`, 'm')
  return parseYamlScalar(entry.match(regex)?.[1])
}

function findRootBlock(content: string, key: string): { start: number; end: number; block: string } | null {
  const normalized = content.replace(/\r\n/g, '\n')
  const marker = `${key}:\n`
  const start = normalized.indexOf(marker)
  if (start < 0) return null
  const afterMarker = start + marker.length
  const nextRoot = normalized.slice(afterMarker).search(/\n\S/)
  const end = nextRoot >= 0 ? afterMarker + nextRoot : normalized.length
  return { start, end, block: normalized.slice(afterMarker, end) }
}

function splitCustomProviderEntries(block: string): string[] {
  const lines = block.split('\n')
  const entries: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (/^\s{2}-\s/.test(line)) {
      if (current.length > 0) entries.push(current.join('\n').replace(/\n?$/, '\n'))
      current = [line]
    } else if (current.length > 0) {
      current.push(line)
    }
  }

  if (current.length > 0) entries.push(current.join('\n').replace(/\n?$/, '\n'))
  return entries
}

function readProviderName(entry: string): string {
  const direct = entry.match(/^\s{2}-\s+name:\s*(.+)$/m)?.[1]
  if (direct) return parseYamlScalar(direct)
  return readProviderScalar(entry, 'name')
}

function findCustomProviderEntry(content: string, provider: string): string | null {
  const customProviders = findRootBlock(content, 'custom_providers')
  if (!customProviders) return null
  return splitCustomProviderEntries(customProviders.block)
    .find((entry) => readProviderName(entry) === provider) ?? null
}

function readProviderModels(entry: string): Array<{ id: string; name: string; contextLength?: number }> {
  const lines = entry.split('\n')
  const models: Array<{ id: string; name: string; contextLength?: number }> = []
  let insideModels = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s{4}models:\s*$/.test(line)) {
      insideModels = true
      continue
    }
    if (insideModels && /^\s{4}\S/.test(line)) break
    if (!insideModels) continue

    const modelMatch = line.match(/^\s{6}(.+?):(?:\s*\{\})?\s*$/)
    if (!modelMatch) continue

    const id = parseYamlScalar(modelMatch[1])
    if (!id) continue

    let contextLength: number | undefined
    const nextLine = lines[index + 1] ?? ''
    const contextMatch = nextLine.match(/^\s{8}context_length:\s*(\d+)\s*$/)
    if (contextMatch) contextLength = Number.parseInt(contextMatch[1], 10)

    models.push({
      id,
      name: id,
      ...(contextLength ? { contextLength } : {}),
    })
  }

  return models
}

function readProviderConfigSnapshots(content: string): Record<string, HermesProviderConfigSnapshot> {
  const customProviders = findRootBlock(content, 'custom_providers')
  if (!customProviders) return {}

  const configs: Record<string, HermesProviderConfigSnapshot> = {}
  for (const entry of splitCustomProviderEntries(customProviders.block)) {
    const provider = readProviderName(entry)
    if (!provider) continue

    const apiModeRaw = readProviderScalar(entry, 'api_mode')
    configs[provider] = {
      provider,
      baseUrl: readProviderScalar(entry, 'base_url') || undefined,
      apiMode: apiModeRaw ? normalizeApiMode(apiModeRaw) : undefined,
      models: readProviderModels(entry),
      hasApiKey: Boolean(readProviderScalar(entry, 'api_key')),
    }
  }

  return configs
}

function buildCustomProviderEntry(config: {
  provider: string
  baseUrl: string
  apiMode: HermesApiMode
  apiKey?: string
  models: Array<{ id: string; contextLength?: number }>
}): string {
  const lines = [
    `  - name: ${yamlString(config.provider)}`,
    `    base_url: ${yamlString(config.baseUrl)}`,
  ]
  if (config.apiKey) {
    lines.push(`    api_key: ${yamlString(config.apiKey)}`)
  }
  lines.push(`    api_mode: ${yamlString(config.apiMode)}`)
  if (config.models.length > 0) {
    lines.push('    models:')
    for (const model of config.models) {
      if (model.contextLength && Number.isFinite(model.contextLength)) {
        lines.push(`      ${yamlString(model.id)}:`)
        lines.push(`        context_length: ${Math.trunc(model.contextLength)}`)
      } else {
        lines.push(`      ${yamlString(model.id)}: {}`)
      }
    }
  }
  return `${lines.join('\n')}\n`
}

function upsertModelBlock(content: string, provider: string, model: string): string {
  const normalized = content.replace(/\r\n/g, '\n')
  const block = findRootBlock(normalized, 'model')
  const providerLine = `  provider: ${yamlString(provider)}`
  const modelLine = `  default: ${yamlString(model)}`

  if (!block) {
    const prefix = normalized.trimEnd()
    return `${prefix}${prefix ? '\n\n' : ''}model:\n${providerLine}\n${modelLine}\n`
  }

  const lines = block.block.split('\n').filter((line) => line.length > 0)
  const rest = lines.filter((line) => !/^\s{2}(provider|default):/.test(line))
  const replacement = `model:\n${providerLine}\n${modelLine}\n${rest.join('\n')}${rest.length ? '\n' : ''}`
  return normalized.slice(0, block.start) + replacement + normalized.slice(block.end)
}

function upsertCustomProvider(content: string, entry: string, provider: string): string {
  const normalized = content.replace(/\r\n/g, '\n')
  const block = findRootBlock(normalized, 'custom_providers')
  if (!block) {
    const prefix = normalized.trimEnd()
    return `${prefix}${prefix ? '\n\n' : ''}custom_providers:\n${entry}`
  }

  const entries = splitCustomProviderEntries(block.block)
    .filter((item) => readProviderName(item) !== provider)
  entries.push(entry)
  const replacement = `custom_providers:\n${entries.join('')}`
  return normalized.slice(0, block.start) + replacement + normalized.slice(block.end)
}

function applyHermesModelConfig(backend: BackendProvider, request: HermesModelConfigRequest) {
  const configPath = path.join(backend.hermesHome, 'config.yaml')
  const existingContent = existsSync(configPath) ? readFileSync(configPath, 'utf8').replace(/\r\n/g, '\n') : ''
  const currentProvider = parseModelYamlKey(existingContent, 'provider')
  const currentModel = parseModelYamlKey(existingContent, 'default')

  const provider = normalizeProviderName(request.provider ?? currentProvider)
  const model = normalizeRequiredValue(request.model ?? currentModel, 'Model ID')
  const existingEntry = findCustomProviderEntry(existingContent, provider)
  const baseUrl = normalizeRequiredValue(request.baseUrl ?? readProviderScalar(existingEntry ?? '', 'base_url'), 'Base URL')
  const apiMode = normalizeApiMode(request.apiMode ?? readProviderScalar(existingEntry ?? '', 'api_mode'))
  const nextApiKey = request.apiKey?.trim()
  const existingApiKey = readProviderScalar(existingEntry ?? '', 'api_key')
  const apiKey = nextApiKey || existingApiKey
  const requestedModels = (request.models ?? [])
    .map((item) => ({ id: (item.id ?? '').trim(), contextLength: item.contextLength }))
    .filter((item) => Boolean(item.id))
  const selectedModel = requestedModels.find((item) => item.id === model) ?? { id: model }
  const models = [
    selectedModel,
    ...requestedModels.filter((item) => item.id !== model),
  ]

  const providerEntry = buildCustomProviderEntry({ provider, baseUrl, apiMode, apiKey, models })
  let nextContent = upsertModelBlock(existingContent, provider, model)
  nextContent = upsertCustomProvider(nextContent, providerEntry, provider)

  mkdirSync(path.dirname(configPath), { recursive: true })
  writeFileSync(configPath, nextContent)
}

async function fetchProviderModels(backend: BackendProvider, request: HermesFetchModelsRequest) {
  const baseUrl = normalizeRequiredValue(request.baseUrl, 'Base URL')
  const urls = buildModelListUrls(baseUrl)
  const apiKey = getProviderFetchApiKey(backend, request)
  let lastError = ''

  for (const url of urls) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!response.ok) {
        lastError = `${response.status} ${response.statusText}`.trim()
        continue
      }

      const payload = await response.json() as unknown
      const models = parseModelsResponse(payload)
      if (models.length === 0) {
        throw new Error('接口返回成功，但没有发现模型列表')
      }
      return models
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }

  throw new Error(lastError || '无法获取模型列表')
}

function getProviderFetchApiKey(backend: BackendProvider, request: HermesFetchModelsRequest): string {
  const direct = request.apiKey?.trim()
  if (direct) return direct
  const provider = request.provider?.trim()
  if (!provider) return ''

  const configPath = path.join(backend.hermesHome, 'config.yaml')
  if (!existsSync(configPath)) return ''
  const content = readFileSync(configPath, 'utf8').replace(/\r\n/g, '\n')
  return readProviderScalar(findCustomProviderEntry(content, provider) ?? '', 'api_key')
}

function buildModelListUrls(baseUrl: string): string[] {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  const urls = [`${normalized}/models`]
  if (!/\/v\d+(?:\/|$)/.test(normalized)) {
    urls.push(`${normalized}/v1/models`)
  }
  return [...new Set(urls)]
}

function parseModelsResponse(payload: unknown): Array<{ id: string; name: string; contextLength?: number }> {
  const records = getModelsArray(payload)
  const byId = new Map<string, { id: string; name: string; contextLength?: number }>()

  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const item = record as Record<string, unknown>
    const id = typeof item.id === 'string'
      ? item.id
      : typeof item.name === 'string'
        ? item.name
        : ''
    if (!id || byId.has(id)) continue

    const displayName = typeof item.name === 'string' && item.name.trim() ? item.name : id
    const contextLengthValue = item.context_length ?? item.contextLength ?? item.max_context_length
    const contextLength = typeof contextLengthValue === 'number' && Number.isFinite(contextLengthValue)
      ? Math.trunc(contextLengthValue)
      : undefined

    byId.set(id, {
      id,
      name: displayName,
      ...(contextLength ? { contextLength } : {}),
    })
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function getModelsArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const data = payload as Record<string, unknown>
  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data.models)) return data.models
  if (data.data && typeof data.data === 'object' && Array.isArray((data.data as Record<string, unknown>).models)) {
    return (data.data as Record<string, unknown>).models as unknown[]
  }
  return []
}

function maskApiKey(key: string | null): string | null {
  if (!key) return null
  if (key.length <= 8) return key.slice(0, 1) + '···' + key.slice(-1)
  return key.slice(0, 4) + '···' + key.slice(-4)
}

const KNOWN_PROVIDER_IDS = [
  'openrouter', 'deepseek', 'bailian', 'bailian_coding', 'kimi',
  'kimi_coding', 'zhipu_glm', 'zhipu_glm_en', 'stepfun', 'modelscope',
  'longcat', 'minimax', 'minimax_en', 'bailing', 'siliconflow',
  'siliconflow_en', 'together', 'nous', 'ark_agentplan', 'doubao_seed',
  'aihubmix', 'therouter', 'novita', 'nvidia', 'xiaomi_mimo',
  'anthropic', 'openai', 'google', 'xai', 'groq', 'custom',
]

async function readHermesConfigSnapshot(): Promise<HermesConfigSnapshot> {
  const backend = getBackendProvider()
  const configPath = path.join(backend.hermesHome, 'config.yaml')
  try {
    const raw = await readFile(configPath, 'utf8')
    const content = raw.replace(/\r\n/g, '\n')
    const provider = parseModelYamlKey(content, 'provider') || 'unknown'
    const providerEntry = findCustomProviderEntry(content, provider)
    const apiModeRaw = providerEntry ? readProviderScalar(providerEntry, 'api_mode') : ''
    const providers = readProviderConfigSnapshots(content)
    return {
      provider,
      model: parseModelYamlKey(content, 'default') || 'unknown',
      baseUrl: readProviderScalar(providerEntry ?? '', 'base_url') || undefined,
      apiMode: apiModeRaw ? normalizeApiMode(apiModeRaw) : undefined,
      source: configPath,
      providers,
    }
  } catch {
    return {
      provider: '未知',
      model: '不可用',
      source: configPath,
      providers: {},
    }
  }
}

async function readHermesSkillsSnapshot(): Promise<HermesSkillSnapshot[]> {
  const backend = getBackendProvider()
  return readHermesSkills(path.join(backend.hermesHome, 'skills')).catch(() => [])
}
