// Worktree management — backend-agnostic git worktree operations.
//
// Native Windows: uses simple-git (spawns git.exe from Git for Windows).
// WSL: uses runWslCommand (git inside the WSL distro via wsl.exe).
//
// The porcelain output format of `git worktree list` is identical on both
// platforms, so the parsing logic is shared.

import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { getBackendProvider } from './backend.js'
import { runWslCommand, windowsPathToWslPath } from './wsl-paths.js'

export type HermesWorktreeInfo = {
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

// ============================================================================
// Public API
// ============================================================================

export async function createHermesWorktree(
  hostPath: string,
  currentWorkspacePath: string,
  options: CreateWorktreeOptions = {},
) {
  const backend = getBackendProvider()

  if (backend.type === 'wsl') {
    return createWorktreeWsl(hostPath, options)
  }

  const gitAvailable = await backend.gitAvailable()
  if (!gitAvailable) {
    throw new Error(
      'Git is not available on this system. Install Git (https://git-scm.com) to use worktrees.',
    )
  }

  return createWorktreeNative(hostPath, currentWorkspacePath, options)
}

export async function listHermesWorktrees(
  hostPath: string,
  currentWorkspacePath: string,
): Promise<HermesWorktreeInfo[]> {
  const backend = getBackendProvider()

  if (backend.type === 'wsl') {
    return listWorktreesWsl(hostPath, currentWorkspacePath)
  }

  const gitAvailable = await backend.gitAvailable()
  if (!gitAvailable) {
    return []
  }

  return listWorktreesNative(hostPath, currentWorkspacePath)
}

// ============================================================================
// Native Windows implementation (simple-git)
// ============================================================================

async function createWorktreeNative(
  hostPath: string,
  currentWorkspacePath: string,
  options: CreateWorktreeOptions,
) {
  const repository = await ensureNativeGitRepository(hostPath)
  const root = repository.root
  const short = await gitRevParse(root, '--short', 'HEAD')
  const stamp = dateStamp()
  const baseName = normalizeWorktreeName(options.name) ?? `hermes-${stamp}-${short}`
  const { name, branch, worktreePath } = await resolveAvailableWorktreeTargetNative(
    root, baseName, options.directory,
  )

  const git = simpleGit(root)
  mkdirSync(path.dirname(worktreePath), { recursive: true })
  await git.raw(['worktree', 'add', worktreePath, '-b', branch, 'HEAD'])
  await finalizeWorktreeNative(root, worktreePath)

  return {
    path: worktreePath,
    branch,
    name,
    root,
    initialized: repository.initialized,
  }
}

async function ensureNativeGitRepository(hostPath: string) {
  const workspacePath = path.resolve(hostPath)
  let root = ''
  let initialized = false

  try {
    root = await gitRevParse(workspacePath, '--show-toplevel')
  } catch (error) {
    if (!isNotGitRepositoryError(error)) throw error
    await simpleGit(workspacePath).init()
    root = await gitRevParse(workspacePath, '--show-toplevel')
    initialized = true
  }

  ensureWorktreeIgnoreNative(root)
  if (!await gitHasHeadNative(root)) {
    await createInitialCommitNative(root)
    initialized = true
  }

  return { root, initialized }
}

async function gitHasHeadNative(root: string) {
  try {
    await simpleGit(root).raw(['rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

async function createInitialCommitNative(root: string) {
  const git = simpleGit(root)
  await git.raw(['add', '-A'])

  const [userName, userEmail] = await Promise.all([
    git.raw(['config', 'user.name']).then((value) => value.trim()).catch(() => ''),
    git.raw(['config', 'user.email']).then((value) => value.trim()).catch(() => ''),
  ])
  const identityArgs = userName && userEmail
    ? []
    : ['-c', 'user.name=Hermes Desktop', '-c', 'user.email=hermes-desktop@localhost']

  try {
    await git.raw([
      ...identityArgs,
      'commit',
      '--allow-empty',
      '-m',
      'Initial workspace snapshot',
    ])
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to create the initial Git snapshot for this workspace. ${detail}`)
  }
}

async function listWorktreesNative(
  hostPath: string,
  currentWorkspacePath: string,
): Promise<HermesWorktreeInfo[]> {
  const git = simpleGit(hostPath)
  let output = ''

  try {
    output = await git.raw(['worktree', 'list', '--porcelain'])
  } catch (error) {
    if (isNotGitRepositoryError(error)) return []
    throw error
  }

  return parseWorktreePorcelain(output, currentWorkspacePath)
}

async function resolveAvailableWorktreeTargetNative(
  root: string,
  baseName: string,
  directory?: string,
) {
  for (let index = 1; index <= 100; index += 1) {
    const name = index === 1 ? baseName : `${baseName}-${index}`
    const branch = `hermes/${name}`
    const worktreePath = resolveWorktreePathNative(root, name, directory)

    const [branchExists, pathExists] = await Promise.all([
      gitBranchExistsNative(root, branch),
      Promise.resolve(existsSync(worktreePath)),
    ])

    if (!branchExists && !pathExists) {
      return { name, branch, worktreePath }
    }
  }

  throw new Error(`Could not find an available worktree name for ${baseName}.`)
}

function resolveWorktreePathNative(root: string, name: string, directory?: string) {
  const raw = directory?.trim()
  if (!raw) {
    return path.join(root, '.worktrees', name)
  }

  return path.join(path.resolve(raw), name)
}

async function gitBranchExistsNative(root: string, branch: string) {
  try {
    const git = simpleGit(root)
    await git.raw(['show-ref', '--verify', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

async function finalizeWorktreeNative(root: string, worktreePath: string) {
  ensureWorktreeIgnoreNative(root)

  // Copy .worktreeinclude files
  const worktreeIncludePath = path.join(root, '.worktreeinclude')
  let includeContent = ''
  try {
    includeContent = readFileSync(worktreeIncludePath, 'utf8')
  } catch {
    return // no includes to copy
  }

  const lines = includeContent.split(/\r?\n/)
  for (const rawLine of lines) {
    let include = rawLine.replace(/#.*$/, '').trim()
    if (!include) continue

    const sourcePath = path.resolve(root, include)
    const relativePath = path.relative(root, sourcePath)
    if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      continue
    }
    if (!existsSync(sourcePath)) continue

    const destPath = path.join(worktreePath, relativePath)
    mkdirSync(path.dirname(destPath), { recursive: true })
    cpSync(sourcePath, destPath, { recursive: true, force: true })
  }
}

function ensureWorktreeIgnoreNative(root: string) {
  const gitignorePath = path.join(root, '.gitignore')
  const marker = '.worktrees/'

  // Ensure .gitignore has .worktrees/ entry
  let gitignoreContent = ''
  try {
    gitignoreContent = readFileSync(gitignorePath, 'utf8')
  } catch {
    // no .gitignore yet — create it
  }

  if (!gitignoreContent.split(/\r?\n/).some((line) => {
    const entry = line.trim().replace(/\/$/, '')
    return entry === marker.replace(/\/$/, '')
  })) {
    const suffix = gitignoreContent && !gitignoreContent.endsWith('\n') ? '\n' : ''
    appendFileSync(gitignorePath, `${suffix}${marker}\n`, 'utf8')
  }
}

// ============================================================================
// WSL implementation (existing logic, moved from main.ts)
// ============================================================================

async function createWorktreeWsl(hostPath: string, options: CreateWorktreeOptions) {
  const wslRoot = windowsPathToWslPath(hostPath)
  const root = await runWslCommand(['git', '-C', wslRoot, 'rev-parse', '--show-toplevel'])
  const short = await runWslCommand(['git', '-C', root, 'rev-parse', '--short', 'HEAD'])
  const stamp = await runWslCommand(['date', '+%Y%m%d-%H%M%S'])
  const baseName = normalizeWorktreeName(options.name) ?? `hermes-${stamp}-${short}`
  const { name, branch, worktreePath } = await resolveAvailableWorktreeTargetWsl(root, baseName, options.directory)

  await runWslCommand(['mkdir', '-p', path.posix.dirname(worktreePath)])
  await runWslCommand(['git', '-C', root, 'worktree', 'add', worktreePath, '-b', branch, 'HEAD'])
  await finalizeWorktreeWsl(root, worktreePath)

  return {
    path: worktreePath,
    branch,
    name,
    root,
  }
}

async function listWorktreesWsl(
  hostPath: string,
  currentWorkspacePath: string,
): Promise<HermesWorktreeInfo[]> {
  const wslRoot = windowsPathToWslPath(hostPath)
  let output = ''

  try {
    output = await runWslCommand(['git', '-C', wslRoot, 'worktree', 'list', '--porcelain'])
  } catch (error) {
    if (isNotGitRepositoryError(error)) return []
    throw error
  }

  const currentWslPath = windowsPathToWslPath(currentWorkspacePath)
  return parseWorktreePorcelainWsl(output, currentWslPath)
}

async function resolveAvailableWorktreeTargetWsl(root: string, baseName: string, directory?: string) {
  for (let index = 1; index <= 100; index += 1) {
    const name = index === 1 ? baseName : `${baseName}-${index}`
    const branch = `hermes/${name}`
    const worktreePath = resolveWorktreePathWsl(root, name, directory)
    const [branchExists, pathExists] = await Promise.all([
      gitBranchExistsWsl(root, branch),
      wslPathExists(worktreePath),
    ])

    if (!branchExists && !pathExists) {
      return { name, branch, worktreePath }
    }
  }

  throw new Error(`Could not find an available worktree name for ${baseName}.`)
}

function resolveWorktreePathWsl(root: string, name: string, directory?: string) {
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

async function gitBranchExistsWsl(root: string, branch: string) {
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

async function finalizeWorktreeWsl(root: string, worktreePath: string) {
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

// ============================================================================
// Shared helpers
// ============================================================================

function gitRevParse(cwd: string, ...args: string[]) {
  // Use simple-git but in raw mode to avoid any repo-detection issues
  return simpleGit(cwd).raw(['rev-parse', ...args]).then((s) => s.trim())
}

function dateStamp() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function normalizeWorktreeName(value?: string) {
  const raw = value?.trim()
  if (!raw) return null

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

function parseWorktreePorcelain(
  output: string,
  currentHostPath: string,
): HermesWorktreeInfo[] {
  // Normalize for cross-platform path comparison
  const currentNormalized = normalizeNativePath(currentHostPath)
  const worktrees: HermesWorktreeInfo[] = []
  let current: Partial<HermesWorktreeInfo> | null = null

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      if (current?.path) {
        worktrees.push(normalizeWorktreeInfoNative(current, currentNormalized))
      }
      current = null
      continue
    }

    const spaceIdx = line.indexOf(' ')
    const key = spaceIdx === -1 ? line : line.slice(0, spaceIdx)
    const value = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1)

    if (key === 'worktree') {
      if (current?.path) {
        worktrees.push(normalizeWorktreeInfoNative(current, currentNormalized))
      }
      current = { path: value }
      continue
    }

    if (!current) continue

    if (key === 'HEAD') {
      current.head = value
    } else if (key === 'branch') {
      current.branch = value.replace(/^refs\/heads\//, '')
    } else if (key === 'detached') {
      current.detached = true
    }
  }

  if (current?.path) {
    worktrees.push(normalizeWorktreeInfoNative(current, currentNormalized))
  }

  return worktrees
}

function normalizeWorktreeInfoNative(
  info: Partial<HermesWorktreeInfo>,
  currentNormalized: string,
): HermesWorktreeInfo {
  const worktreePath = info.path ?? ''
  const worktreeNormalized = normalizeNativePath(worktreePath)
  return {
    path: worktreePath,
    branch: info.detached ? 'detached' : info.branch ?? '',
    head: info.head ?? '',
    detached: Boolean(info.detached),
    current: worktreeNormalized === currentNormalized,
    name: path.basename(worktreePath),
  }
}

function normalizeNativePath(value: string) {
  let normalized = ''
  try {
    normalized = realpathSync.native(value)
  } catch {
    normalized = path.resolve(value)
  }

  normalized = normalized.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

// WSL-specific porcelain parser (uses POSIX path comparison)
function parseWorktreePorcelainWsl(
  output: string,
  currentWslPath: string,
): HermesWorktreeInfo[] {
  const worktrees: HermesWorktreeInfo[] = []
  let current: Partial<HermesWorktreeInfo> | null = null

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      if (current?.path) {
        worktrees.push(normalizeWorktreeInfoWsl(current, currentWslPath))
      }
      current = null
      continue
    }

    const spaceIdx = line.indexOf(' ')
    const key = spaceIdx === -1 ? line : line.slice(0, spaceIdx)
    const value = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1)

    if (key === 'worktree') {
      if (current?.path) {
        worktrees.push(normalizeWorktreeInfoWsl(current, currentWslPath))
      }
      current = { path: value }
      continue
    }

    if (!current) continue

    if (key === 'HEAD') {
      current.head = value
    } else if (key === 'branch') {
      current.branch = value.replace(/^refs\/heads\//, '')
    } else if (key === 'detached') {
      current.detached = true
    }
  }

  if (current?.path) {
    worktrees.push(normalizeWorktreeInfoWsl(current, currentWslPath))
  }

  return worktrees
}

function normalizeWorktreeInfoWsl(
  info: Partial<HermesWorktreeInfo>,
  currentWslPath: string,
): HermesWorktreeInfo {
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

function isNotGitRepositoryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('not a git repository')
}
