import path from 'node:path'

export const FILE_PREVIEW_MAX_BYTES = 256 * 1024
export const FILE_PREVIEW_MAX_CHARS = 12000

const BINARY_EXTENSIONS = new Set([
  '.7z',
  '.avif',
  '.bmp',
  '.dll',
  '.dmg',
  '.exe',
  '.gif',
  '.gz',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.mov',
  '.mp3',
  '.mp4',
  '.pdf',
  '.png',
  '.rar',
  '.so',
  '.tar',
  '.webp',
  '.zip',
])

export function canPreviewFile(filePath: string, size: number) {
  if (size > FILE_PREVIEW_MAX_BYTES) {
    return {
      ok: false,
      error: `File is too large to preview (${formatBytes(size)}).`,
    }
  }

  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return {
      ok: false,
      error: 'Binary files are not previewed.',
    }
  }

  return { ok: true }
}

export function looksBinary(buffer: Buffer) {
  if (buffer.length === 0) {
    return false
  }

  const sampleLength = Math.min(buffer.length, 4096)
  let suspicious = 0

  for (let index = 0; index < sampleLength; index += 1) {
    const value = buffer[index]
    if (value === 0) {
      return true
    }

    if (value < 7 || (value > 14 && value < 32)) {
      suspicious += 1
    }
  }

  return suspicious / sampleLength > 0.3
}

export function inferLanguageFromPath(filePath: string) {
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

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
