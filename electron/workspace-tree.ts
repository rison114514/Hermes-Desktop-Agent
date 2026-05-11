import { readFile, readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { isPathInside } from './workspace-security.js'

export type WorkspaceFileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: WorkspaceFileNode[]
}

type IgnoreRule = {
  pattern: string
  directoryOnly: boolean
  rootAnchored: boolean
  regex: RegExp
}

const WORKSPACE_DIRECTORY_MAX_ENTRIES = 300
const DEFAULT_IGNORED_NAMES = new Set([
  '.git',
  '.vite',
  '.worktrees',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
])

export async function readWorkspaceDirectory(rootDir: string, relativeDir = ''): Promise<WorkspaceFileNode[]> {
  const absoluteDir = path.resolve(rootDir, relativeDir)
  if (!isPathInside(rootDir, absoluteDir)) {
    throw new Error('Cannot read a directory outside the workspace.')
  }

  const rules = await readIgnoreRules(rootDir)
  return readDirectoryEntries(rootDir, relativeDir, rules)
}

async function readDirectoryEntries(rootDir: string, relativeDir: string, rules: IgnoreRule[]) {
  const absoluteDir = path.resolve(rootDir, relativeDir)
  let entries: Dirent[] = []

  try {
    entries = await readdir(absoluteDir, { withFileTypes: true })
  } catch {
    return []
  }

  return entries
    .filter((entry) => !shouldIgnoreEntry(entry, relativeDir, rules))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1
      }
      return left.name.localeCompare(right.name)
    })
    .slice(0, WORKSPACE_DIRECTORY_MAX_ENTRIES)
    .map((entry): WorkspaceFileNode => {
      const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name
      return {
        name: entry.name,
        path: relativePath,
        type: entry.isDirectory() ? 'directory' : 'file',
      }
    })
}

async function readIgnoreRules(rootDir: string) {
  const gitignorePath = path.join(rootDir, '.gitignore')
  try {
    const content = await readFile(gitignorePath, 'utf8')
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
      .map(createIgnoreRule)
      .filter((rule): rule is IgnoreRule => Boolean(rule))
  } catch {
    return []
  }
}

function createIgnoreRule(rawPattern: string): IgnoreRule | null {
  const directoryOnly = rawPattern.endsWith('/')
  const rootAnchored = rawPattern.startsWith('/')
  const cleanPattern = rawPattern
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')

  if (!cleanPattern) {
    return null
  }

  return {
    pattern: cleanPattern,
    directoryOnly,
    rootAnchored,
    regex: globToRegExp(cleanPattern),
  }
}

function shouldIgnoreEntry(entry: Dirent, relativeDir: string, rules: IgnoreRule[]) {
  if (DEFAULT_IGNORED_NAMES.has(entry.name)) {
    return true
  }

  if (entry.name.startsWith('.') && entry.name !== '.env.example') {
    return true
  }

  const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name

  return rules.some((rule) => {
    if (rule.directoryOnly && !entry.isDirectory()) {
      return false
    }

    if (rule.rootAnchored) {
      return rule.regex.test(relativePath)
    }

    return rule.regex.test(relativePath) || rule.regex.test(entry.name)
  })
}

function globToRegExp(pattern: string) {
  const escaped = pattern
    .split('')
    .map((char) => {
      if (char === '*') {
        return '[^/]*'
      }
      if (char === '?') {
        return '[^/]'
      }
      return char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    })
    .join('')

  return new RegExp(`^${escaped}(?:/.*)?$`)
}
