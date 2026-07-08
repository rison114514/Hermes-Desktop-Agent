import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Dirent } from 'node:fs'

// Types shared between main & renderer — defined inline to avoid cross-process import
interface ModManifest {
  name: string
  version: string
  description?: string
  author?: string
  icon?: string
  entry: string
  hermesVersion?: string
  permissions?: string[]
  config?: Record<string, { type: string; default?: unknown; label?: string }>
  skills?: Array<{ id: string; name: string; description: string; category?: string }>
  commands?: Array<{ id: string; name: string; description: string }>
}

interface ModExports {
  skills?: Array<{ id: string; name: string; description: string; enabled?: boolean; category?: string }>
  commands?: Array<{ id: string; name: string; description: string }>
  panels?: Record<string, unknown>
  hooks?: Record<string, (...args: unknown[]) => unknown>
  main?: {
    ipcHandlers?: Record<string, (...args: unknown[]) => unknown>
    onBackendStart?: () => void
    onBackendStop?: () => void
  }
  onEnable?: (ctx: Record<string, unknown>) => void
  onDisable?: (ctx: Record<string, unknown>) => void
  defaultConfig?: Record<string, unknown>
}

interface LoadedMod {
  name: string
  path: string
  manifest: ModManifest
  enabled: boolean
  error?: string
  exports?: ModExports
}

function resolveModsRoot(custom?: string): string {
  if (custom && path.isAbsolute(custom)) return custom
  return process.env.HERMES_MODS_ROOT || path.join(process.cwd(), 'mods')
}

async function safeImport(filePath: string): Promise<unknown> {
  const url = pathToFileURL(filePath).href
  // Force reload: append cache-busting query param
  return import(`${url}?t=${Date.now()}`)
}

// Strip non-serializable parts (functions) from exports for IPC transfer
function serializeExports(exports?: ModExports): ModExports | undefined {
  if (!exports) return undefined
  const safe: ModExports = {}
  if (exports.panels) safe.panels = exports.panels
  if (exports.skills) safe.skills = exports.skills
  if (exports.commands) safe.commands = exports.commands
  if (exports.defaultConfig) safe.defaultConfig = exports.defaultConfig
  return safe
}

function serializeMod(mod: LoadedMod): LoadedMod {
  return { ...mod, exports: serializeExports(mod.exports) }
}

export async function scanModsDirectory(customRoot?: string): Promise<LoadedMod[]> {
  const root = resolveModsRoot(customRoot)
  const mods: LoadedMod[] = []

  try {
    await access(root)
  } catch {
    return mods
  }

  const fs = await import('node:fs/promises')
  let entries: Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return mods
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue

    const modDir = path.join(root, entry.name)
    const manifestPath = path.join(modDir, 'hermes-mod.json')

    try {
      await access(manifestPath)
    } catch {
      continue
    }

    try {
      const loaded = await loadMod(modDir)
      mods.push(loaded)
    } catch (error) {
      mods.push({
        name: entry.name,
        path: modDir,
        manifest: { name: entry.name, version: '0.0.0', entry: 'index.js' },
        enabled: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return mods.map(serializeMod)
}

export async function loadMod(modDir: string): Promise<LoadedMod> {
  const manifestPath = path.join(modDir, 'hermes-mod.json')

  const raw = await readFile(manifestPath, 'utf8')
  let manifest: ModManifest
  try {
    manifest = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid hermes-mod.json: not valid JSON`)
  }

  const errors = validateManifest(manifest)
  if (errors.length > 0) {
    throw new Error(`Invalid manifest: ${errors.join('; ')}`)
  }

  const entryFile = path.join(modDir, manifest.entry)
  try {
    await access(entryFile)
  } catch {
    throw new Error(`Entry file not found: ${manifest.entry}`)
  }

  let exports: ModExports | undefined
  try {
    const mod = await safeImport(entryFile)
    exports = ((mod as Record<string, unknown>).default ?? mod) as ModExports
  } catch (error) {
    throw new Error(`Failed to load entry: ${error instanceof Error ? error.message : String(error)}`)
  }

  return {
    name: manifest.name,
    path: modDir,
    manifest,
    enabled: false,
    exports,
  }
}

export function reloadMod(name: string): void {
  // ESM import cache is cleared by the cache-busting query param in safeImport
}

function validateManifest(m: ModManifest): string[] {
  const errors: string[] = []

  if (!m.name || typeof m.name !== 'string') errors.push('name is required')
  if (!m.version || typeof m.version !== 'string') errors.push('version is required')
  if (!m.entry || typeof m.entry !== 'string') errors.push('entry is required')
  if (m.permissions && !Array.isArray(m.permissions)) errors.push('permissions must be an array')

  const validPermissions = ['skills', 'commands', 'panels', 'hooks', 'ipc', 'config', 'fs']
  if (m.permissions) {
    for (const p of m.permissions) {
      if (!validPermissions.includes(p)) errors.push(`unknown permission: ${p}`)
    }
  }

  return errors
}
