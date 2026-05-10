import { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { access, readdir, readFile } from 'node:fs/promises'
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
let bridgeBound = false
let isQuitting = false
let workspaceRoot = process.cwd()

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

  tray = new Tray(nativeImage.createFromDataURL(getTrayIconDataUrl()))
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

ipcMain.handle('hermes:list-sessions', async () => {
  return hermesBridge.listSessions()
})

ipcMain.handle('hermes:load-session', async (_event, sessionId: string, cwd: string) => {
  const nextWorkspaceRoot = workspaceHostPathFromHermesCwd(cwd)
  await assertWorkspaceExists(nextWorkspaceRoot)
  workspaceRoot = nextWorkspaceRoot
  await hermesBridge.loadSession(sessionId, workspaceRoot)
  return createWorkspaceSnapshot()
})

ipcMain.handle('workspace:create-worktree', async (_event, options?: CreateWorktreeOptions) => {
  const worktree = await createHermesWorktree(workspaceRoot, options)
  workspaceRoot = workspaceHostPathFromHermesCwd(worktree.path)
  await hermesBridge.startNewSession(workspaceRoot)
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
  return createWorkspaceSnapshot()
})

ipcMain.handle('workspace:select-directory', async () => {
  return selectDirectory('Select workspace directory', workspaceRoot)
})

ipcMain.handle('workspace:switch-root', async (_event, hostPath: string) => {
  await assertWorkspaceExists(hostPath)
  workspaceRoot = hostPath
  await hermesBridge.startNewSession(workspaceRoot)
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
    files: await readWorkspaceTree(cwd),
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

ipcMain.handle('workspace:read-file', async (_event, filePath: string) => {
  const cwd = workspaceRoot
  const normalized = path.normalize(filePath)
  const absolutePath = path.resolve(cwd, normalized)

  if (!isPathInside(cwd, absolutePath)) {
    return { ok: false, error: '禁止读取工作区之外的文件。' }
  }

  try {
    const content = await readFile(absolutePath, 'utf8')
    const maxChars = 12000
    return {
      ok: true,
      path: normalized,
      content: content.slice(0, maxChars),
      language: inferLanguageFromPath(normalized),
      truncated: content.length > maxChars,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '读取文件失败。',
    }
  }
})

ipcMain.handle('hermes:get-config', async () => {
  return readHermesConfigSnapshot()
})

ipcMain.handle('hermes:get-skills', async () => {
  return readHermesSkillsSnapshot()
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

function getTrayIconDataUrl() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAwUlEQVR4AWOgH2DgPxQMDP9nYGBg+A8E8R8GhoZ/GP5jYGA4gKkGJYbi/6OhoWE4gWQxMDBg+I8RkYHhP0YGBsY/gKQDmRgeIPmPkcHhP8bAwPAfSAbCwPD/MPzHwMDA8B8jAwPDfwyMDAwM/0EwmIGBkf8wMDAw/AdkYGj4j5GBgWE4w2mB4T9GRgaG/xgYGBj+AzIYGBj+Y2BgYPgPZGB4g+Q/RkYGhv8YGhgY/gMyMDB8x8DAwPAfIwMDw38MDAwMDP8B0m0gGQbqYVMAAAAASUVORK5CYII='
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
    files: await readWorkspaceTree(workspaceRoot),
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
  const output = await runWslCommand([
    'git',
    '-C',
    wslRoot,
    'worktree',
    'list',
    '--porcelain',
  ])
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

const WORKSPACE_TREE_MAX_DEPTH = 4
const WORKSPACE_TREE_MAX_ENTRIES = 120
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

function inferLanguageFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.json': 'json',
    '.md': 'markdown',
    '.css': 'css',
    '.html': 'html',
    '.sh': 'bash',
    '.yml': 'yaml',
    '.yaml': 'yaml',
  }
  return map[ext] ?? (ext.slice(1) || 'text')
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
      'find ~/.hermes/skills -mindepth 2 -maxdepth 2 -type d -printf "%P\\n" 2>/dev/null',
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

function isPathInside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
