import path from 'node:path'

export function isPathInside(root: string, target: string) {
  const pathApi = isWindowsLikePath(root) || isWindowsLikePath(target) ? path.win32 : path
  const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !pathApi.isAbsolute(relative))
}

function isWindowsLikePath(value: string) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}
