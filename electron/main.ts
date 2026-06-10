import { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, screen } from 'electron'
import type { Event as ElectronEvent, OpenDialogOptions, WebContentsConsoleMessageEventParams } from 'electron'
import { exec } from 'node:child_process'
import { access, readFile, rename, rm, stat } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HermesBridge, type HermesBridgeEvent, type HermesPermissionOption, type HermesPermissionOutcome, type HermesPermissionRequest } from './hermes-bridge.js'
import { getBackendProvider, type BackendProvider } from './backend.js'
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
hermesBridge.setPermissionHandler((payload) => requestHermesPermission(payload, 'default'))
const pendingPermissionRequests = new Map<string, (outcome: HermesPermissionOutcome) => void>()
let permissionRequestSequence = 0
let isQuitting = false
let workspaceRoot = process.cwd()
let lastSessionId: string | undefined
let currentSessionTitle: string | null = null
// Tracks the in-flight autoEnableMods() call. Mod IPC handlers and the data
// each mod loads in onEnable() only exist once this resolves, so mods:scan
// awaits it before returning — that way sidebar panels never render and fetch
// before their backend handlers are registered.
let modsReadyPromise: Promise<void> | null = null

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

app.whenReady().then(async () => {
  await restoreWorkspaceRoot()
  // Sync bridge workspace path before starting — prevents an unnecessary
  // stop/restart cycle if the persisted workspace differs from process.cwd().
  hermesBridge.initWorkspacePath(workspaceRoot)

  // Register the default tab BEFORE creating the window so the TabBar
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

app.on('will-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  if (_todoPollTimer) clearInterval(_todoPollTimer)
  if (_discPollTimer) clearInterval(_discPollTimer)
  // Call onDisable for all enabled MODs so they can save state
  for (const [, instance] of modInstances) {
    if (instance?.exports?.onDisable) {
      try { (instance.exports.onDisable as () => void)() } catch { /* noop */ }
    }
  }
  sessionManager.closeAll()
  tray?.destroy()
})

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
// WSL so the agent can read them. No-op when neither mod is enabled.
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
  for (const [, hooks] of modHooks) {
    if (hooks.onUserMessage) {
      try { processed = hooks.onUserMessage(processed) } catch { /* skip broken hooks */ }
    }
  }

  // Mod → Agent bridge: apply any edits the agent queued last turn, then
  // refresh the data files so this turn reads current mod data.
  const todoApplied = await applyTodoCommands()
  const discApplied = await applyDisciplineCommands()
  await syncModBridgeNow()

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
  if (!bridgeInjectedSessions.has(injectKey)) {
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

  // 3. For WSL backend, detect via WSL DNS resolver
  if (backend.type === 'wsl') {
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
  const session = await sessionManager.createSession(name, cwd || workspaceRoot)
  // Each session bridge needs its own permission handler, otherwise tool
  // permission prompts in non-default tabs are silently auto-cancelled.
  session.bridge.setPermissionHandler((payload) => requestHermesPermission(payload, session.id))
  // Wire up event forwarding for this session's bridge
  session.bridge.on('event', (event: HermesBridgeEvent) => {
    mainWindow?.webContents.send('hermes:event', { ...event, sessionId: session.id } as HermesBridgeEvent & { sessionId: string })
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
  const mods = await scanModsDirectory()
  const enabledPath = path.join(process.cwd(), 'mods', '.hermes-mod-enabled.json')
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
    // Refresh the WSL bridge so a newly enabled todo/SSH mod is visible to agent.
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
  const worktree = await createHermesWorktree(workspaceRoot, workspaceRoot, options)
  workspaceRoot = workspaceHostPathFromHermesCwd(worktree.path)
  const bridge = getActiveBridge()
  // Soft switch — preserve the active session/conversation
  bridge.updateWorkspace(workspaceRoot)
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
  workspaceRoot = nextWorkspaceRoot
  const bridge = getActiveBridge()
  await bridge.startNewSession(workspaceRoot)
  currentSessionTitle = null
  bridgeInjectedSessions.clear()
  sessionManager.updateActive({ cwd: workspaceRoot, title: null })
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
  workspaceRoot = hostPath
  const bridge = getActiveBridge()
  bridge.updateWorkspace(workspaceRoot)
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

ipcMain.handle('hermes:set-model-config', async (_event, config: { provider?: string; model?: string }) => {
  const backend = getBackendProvider()
  try {
    if (config.provider) {
      await backend.execCommand(['hermes', 'config', 'set', 'model.provider', config.provider])
    }
    if (config.model) {
      await backend.execCommand(['hermes', 'config', 'set', 'model.default', config.model])
    }
    return { ok: true, config: await readHermesConfigSnapshot() }
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
    // Find the providers block under model:
    const providersBlock = content.match(/(^|\n)\s{2}providers:\n([\s\S]*?)(\n\S\s{0,1}\w|$)/)
    const block = providersBlock?.[2] ?? ''

    const masked: Record<string, string | null> = {}
    for (const providerId of KNOWN_PROVIDER_IDS) {
      const regex = new RegExp(`^\\s{4}${providerId}:\\n((?:\\s{6}[\\w-]+:.*\\n?)*)`, 'm')
      const m = block.match(regex)
      if (m) {
        const keyMatch = m[1].match(/^\s{6}api_key:\s*(.+)$/m)
        masked[providerId] = maskApiKey(keyMatch?.[1]?.trim() || null)
      } else {
        masked[providerId] = null
      }
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
    await backend.execCommand([
      'hermes', 'config', 'set',
      `model.providers.${config.provider}.api_key`,
      config.apiKey,
    ])
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
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
  isQuitting = true
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
    session: getActiveBridge().getSessionId() ?? 'Local desktop session',
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
  // Find the model: block
  const modelBlock = content.match(/(^|\n)model:\n([\s\S]*?)(\n\S|$)/)
  const block = modelBlock?.[2] ?? ''
  const regex = new RegExp(`^\\s{2}${key}:\\s*(.+)$`, 'm')
  return block.match(regex)?.[1]?.trim() ?? ''
}

function maskApiKey(key: string | null): string | null {
  if (!key) return null
  if (key.length <= 8) return key.slice(0, 1) + '···' + key.slice(-1)
  return key.slice(0, 4) + '···' + key.slice(-4)
}

const KNOWN_PROVIDER_IDS = [
  'anthropic', 'openai', 'deepseek', 'openrouter',
  'google', 'groq', 'xai', 'nous', 'custom',
]

async function readHermesConfigSnapshot(): Promise<HermesConfigSnapshot> {
  const backend = getBackendProvider()
  const configPath = path.join(backend.hermesHome, 'config.yaml')
  try {
    const raw = await readFile(configPath, 'utf8')
    const content = raw.replace(/\r\n/g, '\n')
    return {
      provider: parseModelYamlKey(content, 'provider') || 'unknown',
      model: parseModelYamlKey(content, 'default') || 'unknown',
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
