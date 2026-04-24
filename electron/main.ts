import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage } from 'electron'
import { readdir, readFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HermesBridge, type HermesBridgeEvent } from './hermes-bridge.js'
import { readWindowState, writeWindowState } from './window-state.js'
import {
  getWindowsInteropSnapshot,
  openPathWithDefaultApp,
  readWindowsClipboard,
  revealInExplorer,
  writeWindowsClipboard,
} from './windows-interop.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const hermesBridge = new HermesBridge()
let bridgeBound = false
let isQuitting = false

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

type WorkspaceFileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: WorkspaceFileNode[]
}

function createTray() {
  if (tray) {
    return
  }

  tray = new Tray(nativeImage.createFromDataURL(getTrayIconDataUrl()))
  tray.setToolTip('Hermes 桌面助手')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 / 隐藏', click: () => toggleWindowVisibility() },
      {
        label: '窗口置顶',
        type: 'checkbox',
        checked: mainWindow?.isAlwaysOnTop() ?? true,
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

  mainWindow.webContents.on(
    'render-process-gone',
    (_event, details) => {
      console.error('[electron] render-process-gone', details)
    },
  )

  mainWindow.webContents.on('console-message', (_event, detailsOrLevel, message, line, sourceId) => {
    if (typeof detailsOrLevel === 'object' && detailsOrLevel !== null) {
      console.log('[renderer]', {
        level: (detailsOrLevel as { level?: number }).level,
        message: (detailsOrLevel as { message?: string }).message,
        line: (detailsOrLevel as { lineNumber?: number }).lineNumber,
        sourceId: (detailsOrLevel as { sourceId?: string }).sourceId,
      })
      return
    }

    console.log('[renderer]', {
      level: detailsOrLevel,
      message,
      line,
      sourceId,
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

app.whenReady().then(() => {
  void createWindow()
  createTray()
  registerShortcuts()

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

ipcMain.handle('hermes:send-message', async (_event, message: string) => {
  hermesBridge.sendMessage(message)
  return { ok: true }
})

ipcMain.handle('workspace:get-snapshot', async () => {
  const cwd = process.cwd()
  const windows = await getWindowsInteropSnapshot(cwd)

  return {
    cwd,
    session: '本地桌面会话',
    files: await readWorkspaceTree(cwd),
    tasks: [
      { id: 'task-layout', title: '完成三栏布局骨架', done: true },
      { id: 'task-bridge', title: '接通 Hermes stdio 桥接', done: true },
      { id: 'task-workspace', title: '接入真实工作区文件树', done: true },
      { id: 'task-windows', title: '启用 WSL 到 Windows 互操作', done: windows.available },
      { id: 'task-clipboard', title: '打通 Windows 剪贴板能力', done: windows.available },
    ],
    windows: {
      ...windows,
      clipboardPreview: '',
    },
  }
})

ipcMain.handle('hermes:get-config', async () => {
  return readHermesConfigSnapshot()
})

ipcMain.handle('hermes:get-skills', async () => {
  return readHermesSkillsSnapshot()
})

ipcMain.handle('windows:reveal-workspace', async () => {
  const cwd = process.cwd()

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
  const cwd = process.cwd()

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
  mainWindow?.close()
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
        checked: mainWindow?.isAlwaysOnTop() ?? true,
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

function getTrayIconDataUrl() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAwUlEQVR4AWOgH2DgPxQMDP9nYGBg+A8E8R8GhoZ/GP5jYGA4gKkGJYbi/6OhoWE4gWQxMDBg+I8RkYHhP0YGBsY/gKQDmRgeIPmPkcHhP8bAwPAfSAbCwPD/MPzHwMDA8B8jAwPDfwyMDAwM/0EwmIGBkf8wMDAw/AdkYGj4j5GBgWE4w2mB4T9GRgaG/xgYGBj+AzIYGBj+Y2BgYPgPZGB4g+Q/RkYGhv8YGhgY/gMyMDB8x8DAwPAfIwMDw38MDAwMDP8B0m0gGQbqYVMAAAAASUVORK5CYII='
}


const WORKSPACE_TREE_MAX_DEPTH = 3
const WORKSPACE_TREE_MAX_ENTRIES = 80
const IGNORED_WORKSPACE_NAMES = new Set(['.git', 'node_modules', 'dist', 'dist-electron'])

async function readWorkspaceTree(rootDir: string): Promise<WorkspaceFileNode[]> {
  const counter = { value: 0 }
  return readWorkspaceDirectory(rootDir, '', 0, counter)
}

async function readWorkspaceDirectory(
  absoluteDir: string,
  relativeDir: string,
  depth: number,
  counter: { value: number },
): Promise<WorkspaceFileNode[]> {
  if (depth > WORKSPACE_TREE_MAX_DEPTH || counter.value >= WORKSPACE_TREE_MAX_ENTRIES) {
    return []
  }

  let entries: Dirent[] = []
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true })
  } catch {
    return []
  }

  const visibleEntries = entries
    .filter((entry) => !entry.name.startsWith('.') || entry.name === '.env.example')
    .filter((entry) => !IGNORED_WORKSPACE_NAMES.has(entry.name))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })

  const nodes: WorkspaceFileNode[] = []

  for (const entry of visibleEntries) {
    if (counter.value >= WORKSPACE_TREE_MAX_ENTRIES) {
      break
    }

    const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name
    const absolutePath = path.join(absoluteDir, entry.name)
    counter.value += 1

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        type: 'directory',
        children: await readWorkspaceDirectory(absolutePath, relativePath, depth + 1, counter),
      })
      continue
    }

    nodes.push({
      name: entry.name,
      path: relativePath,
      type: 'file',
    })
  }

  return nodes
}

async function readHermesConfigSnapshot(): Promise<HermesConfigSnapshot> {
  const configPath = path.join(app.getPath('home'), '.hermes', 'config.yaml')

  try {
    const content = await readFile(configPath, 'utf8')
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
  const skillsRoot = path.join(app.getPath('home'), '.hermes', 'skills')

  try {
    const categories = await readdir(skillsRoot, { withFileTypes: true })
    const skills = await Promise.all(
      categories
        .filter((entry) => entry.isDirectory())
        .map(async (categoryEntry) => {
          const categoryPath = path.join(skillsRoot, categoryEntry.name)
          const children = await readdir(categoryPath, { withFileTypes: true })

          return children
            .filter((entry) => entry.isDirectory())
            .map((entry) => ({
              id: `${categoryEntry.name}/${entry.name}`,
              name: entry.name,
              category: categoryEntry.name,
              description: `来自 ${categoryEntry.name} 分类的已安装 Hermes 技能。`,
              enabled: true,
            }))
        }),
    )

    return skills.flat().sort((left, right) => left.name.localeCompare(right.name))
  } catch {
    return []
  }
}
