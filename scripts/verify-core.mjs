import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  canPreviewFile,
  FILE_PREVIEW_MAX_BYTES,
  inferLanguageFromPath,
  looksBinary,
} from '../dist-electron/electron/file-preview.js'
import { HermesBridge } from '../dist-electron/electron/hermes-bridge.js'
import { looksLikeMojibake, normalizeTextForDisplay } from '../dist-electron/electron/text-normalization.js'
import { isPathInside } from '../dist-electron/electron/workspace-security.js'
import { readWorkspaceDirectory } from '../dist-electron/electron/workspace-tree.js'
import {
  createUtf8ProcessEnv,
  decodeCommandOutput,
  isSystemWslDistro,
  parseWslListVerbose,
  parseWslListVerboseEntries,
  uncPathToWslPath,
  UTF8_PROCESS_ENV,
  windowsPathToWslPath,
  wslPathToUncPath,
  wslPathToWindowsPath,
} from '../dist-electron/electron/wsl-paths.js'

assert.equal(windowsPathToWslPath('E:\\Hermes-Desktop-Agent'), '/mnt/e/Hermes-Desktop-Agent')
assert.equal(windowsPathToWslPath('/home/rison/project'), '/home/rison/project')
assert.equal(
  uncPathToWslPath('\\\\wsl.localhost\\Ubuntu-22.04\\home\\rison\\project'),
  '/home/rison/project',
)
assert.equal(wslPathToWindowsPath('/mnt/e/Hermes-Desktop-Agent'), 'E:\\Hermes-Desktop-Agent')
assert.equal(wslPathToWindowsPath('/home/rison/project'), null)
assert.equal(
  wslPathToUncPath('/home/rison/project', 'Ubuntu-22.04'),
  '\\\\wsl.localhost\\Ubuntu-22.04\\home\\rison\\project',
)
assert.equal(wslPathToUncPath('/mnt/e/Hermes-Desktop-Agent', 'Ubuntu-22.04'), null)
assert.equal(
  parseWslListVerbose('  NAME            STATE           VERSION\r\n* Ubuntu          Running         2\r\n  Debian          Stopped         2\r\n'),
  'Ubuntu',
)
assert.equal(
  parseWslListVerbose('  NAME            STATE           VERSION\r\n  Ubuntu-22.04    Stopped         2\r\n'),
  'Ubuntu-22.04',
)
assert.equal(
  parseWslListVerbose('  NAME                   STATE           VERSION\r\n* docker-desktop         Running         2\r\n  docker-desktop-data    Stopped         2\r\n'),
  null,
)
assert.equal(
  parseWslListVerbose('  NAME                   STATE           VERSION\r\n* docker-desktop         Running         2\r\n  Ubuntu                 Stopped         2\r\n'),
  'Ubuntu',
)
assert.equal(isSystemWslDistro('docker-desktop'), true)
assert.equal(isSystemWslDistro('docker-desktop-data'), true)
assert.equal(isSystemWslDistro('Ubuntu'), false)
assert.deepEqual(
  parseWslListVerboseEntries('  NAME            STATE           VERSION\r\n* Ubuntu          Running         2\r\n')[0],
  { name: 'Ubuntu', state: 'Running', version: 2, default: true, system: false },
)
assert.equal(UTF8_PROCESS_ENV.PYTHONUTF8, '1')
assert.equal(UTF8_PROCESS_ENV.PYTHONIOENCODING, 'utf-8')
assert.equal(UTF8_PROCESS_ENV.LANG, 'C.UTF-8')
assert.equal(createUtf8ProcessEnv({ PATH: 'test-path', LANG: 'zh_CN.GBK' }).LANG, 'C.UTF-8')
assert.equal(decodeCommandOutput(Buffer.from('hello • 中文', 'utf8')), 'hello • 中文')
assert.equal(decodeCommandOutput(Buffer.from([0xff, 0xfe, 0x48, 0x00]), 'utf16le'), 'H')
assert.equal(normalizeTextForDisplay('hello • 中文\nnext', 'tool-result'), 'hello • 中文\nnext')
assert.equal(normalizeTextForDisplay('hello\u0000world', 'tool-result'), 'helloworld')
assert.equal(looksLikeMojibake('PDF ҳ: 2\nѱ汾: E:\\Ӧ\\ʵ\\ʵ_verify.txt'), true)
assert.match(
  normalizeTextForDisplay('PDF ҳ: 2\nѱ汾: E:\\Ӧ\\ʵ\\ʵ_verify.txt', 'tool-result'),
  /Hermes Desktop encoding notice/,
)

assert.equal(isPathInside('E:\\repo', 'E:\\repo'), true)
assert.equal(isPathInside('E:\\repo', 'E:\\repo\\src\\app.tsx'), true)
assert.equal(isPathInside('E:\\repo', 'E:\\repo-other\\file.txt'), false)
assert.equal(isPathInside('E:\\repo', 'E:\\outside\\file.txt'), false)
assert.equal(isPathInside('/mnt/e/repo', '/mnt/e/repo/src/app.tsx'), true)
assert.equal(isPathInside('/mnt/e/repo', '/mnt/e/repo-other/file.txt'), false)

assert.deepEqual(canPreviewFile('E:\\repo\\src\\app.tsx', 1024), { ok: true })
assert.equal(canPreviewFile('E:\\repo\\large.log', FILE_PREVIEW_MAX_BYTES + 1).ok, false)
assert.equal(canPreviewFile('E:\\repo\\image.png', 1024).ok, false)
assert.equal(looksBinary(Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f])), false)
assert.equal(looksBinary(Buffer.from([0x48, 0x00, 0x6c])), true)
assert.equal(inferLanguageFromPath('src/app.tsx'), 'tsx')
assert.equal(inferLanguageFromPath('README.md'), 'markdown')
assert.equal(inferLanguageFromPath('unknown'), 'text')

const tempRoot = await mkdtemp(path.join(process.cwd(), '.verify-core-'))
try {
  await mkdir(path.join(tempRoot, 'node_modules'))
  await mkdir(path.join(tempRoot, 'dist'))
  await mkdir(path.join(tempRoot, '.hidden'))
  await mkdir(path.join(tempRoot, 'build'))
  await mkdir(path.join(tempRoot, 'visible'))
  await writeFile(path.join(tempRoot, '.env.example'), 'KEY=value\n')
  await writeFile(path.join(tempRoot, '.gitignore'), 'ignored.log\nbuild/\n*.tmp\n')
  await writeFile(path.join(tempRoot, 'ignored.log'), 'ignored\n')
  await writeFile(path.join(tempRoot, 'scratch.tmp'), 'ignored\n')
  await writeFile(path.join(tempRoot, 'visible', 'child.ts'), 'export {}\n')

  const rootEntries = await readWorkspaceDirectory(tempRoot)
  const rootNames = rootEntries.map((entry) => entry.name)
  assert.deepEqual(rootNames, ['visible', '.env.example'])
  assert.equal(rootEntries.find((entry) => entry.name === 'visible')?.children, undefined)

  const visibleEntries = await readWorkspaceDirectory(tempRoot, 'visible')
  assert.deepEqual(visibleEntries.map((entry) => entry.path), ['visible/child.ts'])
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

const bridge = new HermesBridge()
const defaultPermissionOutcome = await bridge.resolvePermissionRequest({ options: [{ optionId: 'allow' }] })
assert.deepEqual(defaultPermissionOutcome, { outcome: 'cancelled' })
bridge.setPermissionHandler(() => ({ outcome: 'selected', optionId: 'allow-once' }))
const selectedPermissionOutcome = await bridge.resolvePermissionRequest({})
assert.deepEqual(selectedPermissionOutcome, { outcome: 'selected', optionId: 'allow-once' })
bridge.stop()

console.log('Core verification passed.')
