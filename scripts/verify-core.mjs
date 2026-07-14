import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  canPreviewFile,
  FILE_PREVIEW_MAX_BYTES,
  inferLanguageFromPath,
  looksBinary,
} from '../dist-electron/electron/file-preview.js'
import { HermesBridge } from '../dist-electron/electron/hermes-bridge.js'
import { createSkillsCatalogPrompt, isInstalledSkillInvocation, readHermesSkills } from '../dist-electron/electron/hermes-skills.js'
import { looksLikeMojibake, normalizeTextForDisplay } from '../dist-electron/electron/text-normalization.js'
import { isPathInside } from '../dist-electron/electron/workspace-security.js'
import { readWorkspaceDirectory } from '../dist-electron/electron/workspace-tree.js'
import { createHermesWorktree, listHermesWorktrees } from '../dist-electron/electron/worktree.js'
import { PreviewManager, detectPreviewConfigurations, isAllowedPreviewUrl } from '../dist-electron/electron/preview-manager.js'
import { createNativeHermesEnvironment } from '../dist-electron/electron/backend.js'
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

const execFileAsync = promisify(execFile)

const nativeHermesHome = await mkdtemp(path.join(os.tmpdir(), 'hermes-native-home-'))
try {
  await writeFile(path.join(nativeHermesHome, 'config.yaml'), [
    'model:',
    '  provider: "deepseek"',
    '  default: "deepseek-v4-pro"',
    'custom_providers:',
    '  - name: "deepseek"',
    '    base_url: "https://api.example.test"',
    '    api_key: "test-key"',
    '    api_mode: "chat_completions"',
  ].join('\n'))
  const nativeEnv = createNativeHermesEnvironment(nativeHermesHome, {})
  assert.equal(nativeEnv.HERMES_HOME, nativeHermesHome)
  assert.equal(nativeEnv.DEEPSEEK_API_KEY, 'test-key')
  assert.equal(nativeEnv.DEEPSEEK_BASE_URL, 'https://api.example.test')
} finally {
  await rm(nativeHermesHome, { recursive: true, force: true })
}

const windowsSetupScript = await readFile(path.join(process.cwd(), 'scripts', 'setup-windows-env.ps1'), 'utf8')
assert.match(windowsSetupScript, /npm_config_registry\)\) \{\s*\$env:npm_config_registry = "https:\/\/registry\.npmmirror\.com"/)
assert.match(windowsSetupScript, /PLAYWRIGHT_DOWNLOAD_HOST\)\) \{\s*\$env:PLAYWRIGHT_DOWNLOAD_HOST = "https:\/\/npmmirror\.com\/mirrors\/playwright"/)
assert.match(windowsSetupScript, /-File \$InstallerPath -Stage \$Name -NonInteractive/)
assert.match(windowsSetupScript, /if \(\$InstallBrowserTools\) \{\s*\$stages \+= "node-deps"/)

const windowsStartScript = await readFile(path.join(process.cwd(), 'scripts', 'start-windows.ps1'), 'utf8')
assert.match(windowsStartScript, /\$env:npm_config_registry = "https:\/\/registry\.npmmirror\.com"/)
assert.match(windowsStartScript, /\$env:ELECTRON_MIRROR = "https:\/\/npmmirror\.com\/mirrors\/electron\/"/)
assert.match(windowsStartScript, /Invoke-NativeHermesSetup/)

const macStartScript = await readFile(path.join(process.cwd(), 'start-hermes-desktop.command'), 'utf8')
assert.match(macStartScript, /command -v hermes/)
assert.match(macStartScript, /\/bin\/zsh \.\/setup-hermes-environment\.command/)
const macSetupScript = await readFile(path.join(process.cwd(), 'setup-hermes-environment.command'), 'utf8')
assert.match(macSetupScript, /HERMES_RUNTIME_DIR:-\$repo_root\/\.hermes-runtime/)

const packageConfig = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8'))
assert.equal(packageConfig.build.extraResources.some((resource) => (
  resource.from === 'node_modules/ssh2'
  && resource.to === 'mods/hermes-ssh/node_modules/ssh2'
)), true)
assert.equal(packageConfig.build.win.extraFiles.some((file) => (
  file.from === 'setup-hermes-environment.cmd'
  && file.to === 'setup-hermes-environment.cmd'
)), true)
assert.equal(packageConfig.build.win.extraFiles.some((file) => (
  file.from === 'scripts/setup-windows-env.ps1'
  && file.to === 'scripts/setup-windows-env.ps1'
)), true)
assert.equal(packageConfig.build.mac.extraResources.some((resource) => (
  resource.from === 'setup-hermes-environment.command'
  && resource.to === 'setup/setup-hermes-environment.command'
)), true)

const skillsRoot = await mkdtemp(path.join(os.tmpdir(), 'hermes-skills-'))
try {
  await mkdir(path.join(skillsRoot, 'flat-skill'), { recursive: true })
  await writeFile(path.join(skillsRoot, 'flat-skill', 'SKILL.md'), [
    '---',
    'name: flat-skill',
    'description: |',
    '  First description line.',
    '  Second description line.',
    '---',
    '# Flat skill',
  ].join('\n'))
  await mkdir(path.join(skillsRoot, 'writing', 'nested-skill'), { recursive: true })
  await writeFile(path.join(skillsRoot, 'writing', 'nested-skill', 'SKILL.md'), [
    '---',
    'name: nested-skill',
    'description: Nested description.',
    '---',
    '# Nested skill',
  ].join('\n'))

  const skills = await readHermesSkills(skillsRoot)
  assert.deepEqual(skills.map((skill) => skill.id), ['flat-skill', 'writing/nested-skill'])
  assert.equal(skills[0].description, 'First description line.\nSecond description line.')
  assert.equal(skills[1].category, 'writing')
  assert.match(createSkillsCatalogPrompt(skills), /flat-skill: First description line\. Second description line\./)
  assert.equal(isInstalledSkillInvocation('/flat-skill do the task', skills), true)
  assert.equal(isInstalledSkillInvocation('/flat_skill do the task', skills), true)
  assert.equal(isInstalledSkillInvocation('/help', skills), false)
} finally {
  await rm(skillsRoot, { recursive: true, force: true })
}

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

const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), 'hermes-worktree-'))
const customWorktreeParent = await mkdtemp(path.join(os.tmpdir(), 'hermes-worktree-custom-'))
try {
  await execFileAsync('git', ['init', worktreeRoot])
  await execFileAsync('git', ['-C', worktreeRoot, 'config', 'user.email', 'hermes-test@example.com'])
  await execFileAsync('git', ['-C', worktreeRoot, 'config', 'user.name', 'Hermes Test'])
  await writeFile(path.join(worktreeRoot, 'README.md'), 'Hermes worktree test\n')
  await execFileAsync('git', ['-C', worktreeRoot, 'add', 'README.md'])
  await execFileAsync('git', ['-C', worktreeRoot, 'commit', '-m', 'Initial commit'])

  await mkdir(path.join(worktreeRoot, 'shared', 'nested'), { recursive: true })
  await writeFile(path.join(worktreeRoot, 'shared', 'nested', 'config.txt'), 'copied\n')
  await writeFile(path.join(worktreeRoot, '.worktreeinclude'), 'shared\n')

  const initialWorktrees = await listHermesWorktrees(worktreeRoot, worktreeRoot)
  assert.equal(initialWorktrees.length, 1)
  assert.equal(initialWorktrees[0].current, true)

  const createdWorktree = await createHermesWorktree(worktreeRoot, worktreeRoot, { name: 'core-test' })
  assert.equal(createdWorktree.branch, 'hermes/core-test')
  assert.equal(
    await readFile(path.join(createdWorktree.path, 'shared', 'nested', 'config.txt'), 'utf8'),
    'copied\n',
  )

  const secondWorktree = await createHermesWorktree(worktreeRoot, worktreeRoot, {
    name: 'core-test',
    directory: customWorktreeParent,
  })
  assert.equal(secondWorktree.branch, 'hermes/core-test-2')
  assert.equal(path.dirname(secondWorktree.path), customWorktreeParent)
  assert.equal(
    (await readFile(path.join(worktreeRoot, '.gitignore'), 'utf8'))
      .split(/\r?\n/)
      .filter((line) => line === '.worktrees/').length,
    1,
  )

  const listedWorktrees = await listHermesWorktrees(secondWorktree.path, secondWorktree.path)
  assert.equal(listedWorktrees.length, 3)
  assert.equal(listedWorktrees.find((item) => item.branch === secondWorktree.branch)?.current, true)
} finally {
  await rm(worktreeRoot, { recursive: true, force: true })
  await rm(customWorktreeParent, { recursive: true, force: true })
}

const uninitializedRoot = await mkdtemp(path.join(os.tmpdir(), 'hermes-worktree-init-'))
try {
  await writeFile(path.join(uninitializedRoot, 'project.txt'), 'uninitialized workspace\n')
  const createdWorktree = await createHermesWorktree(uninitializedRoot, uninitializedRoot, {
    name: 'first-worktree',
  })

  assert.equal(createdWorktree.initialized, true)
  assert.equal(
    await realpath(createdWorktree.path),
    await realpath(path.join(uninitializedRoot, '.worktrees', 'first-worktree')),
  )
  assert.equal(await readFile(path.join(createdWorktree.path, 'project.txt'), 'utf8'), 'uninitialized workspace\n')
  assert.match(
    (await execFileAsync('git', ['-C', uninitializedRoot, 'log', '-1', '--format=%s'])).stdout,
    /Initial workspace snapshot/,
  )
} finally {
  await rm(uninitializedRoot, { recursive: true, force: true })
}

const bridge = new HermesBridge()
const idleWorkspace = path.join(process.cwd(), 'workspace-switch-check')
await bridge.updateWorkspace(idleWorkspace)
assert.equal(bridge.getWorkspacePath(), idleWorkspace)
const defaultPermissionOutcome = await bridge.resolvePermissionRequest({ options: [{ optionId: 'allow' }] })
assert.deepEqual(defaultPermissionOutcome, { outcome: { outcome: 'cancelled' } })
bridge.setPermissionHandler(() => ({ outcome: { outcome: 'selected', option_id: 'allow-once' } }))
const selectedPermissionOutcome = await bridge.resolvePermissionRequest({})
assert.deepEqual(selectedPermissionOutcome, { outcome: { outcome: 'selected', option_id: 'allow-once' } })
bridge.stop()

assert.equal(isAllowedPreviewUrl('http://127.0.0.1:5173/'), true)
assert.equal(isAllowedPreviewUrl('https://localhost:3000/path'), true)
assert.equal(isAllowedPreviewUrl('https://example.com/'), false)
assert.equal(isAllowedPreviewUrl('file:///tmp/index.html'), false)

const previewRoot = await mkdtemp(path.join(process.cwd(), '.verify-preview-'))
try {
  await writeFile(path.join(previewRoot, 'package.json'), JSON.stringify({
    scripts: {
      dev: 'concurrently "vite" "electron ."',
      'dev:renderer': 'vite',
    },
    devDependencies: { vite: '^7.0.0' },
  }))
  await writeFile(path.join(previewRoot, 'package-lock.json'), '{}')
  await writeFile(path.join(previewRoot, 'index.html'), '<h1>Hermes preview</h1>')

  const configurations = await detectPreviewConfigurations(previewRoot)
  assert.deepEqual(configurations.map((item) => item.id), ['script:dev:renderer', 'static:index'])
  assert.equal(configurations[0].framework, 'vite')

  const previews = new PreviewManager()
  const started = await previews.start(previewRoot, 'static:index')
  assert.equal(started.state, 'running')
  assert.match(await (await fetch(started.url)).text(), /Hermes preview/)
  const stopped = await previews.stop(previewRoot, 'static:index')
  assert.equal(stopped.state, 'stopped')
} finally {
  await rm(previewRoot, { recursive: true, force: true })
}

console.log('Core verification passed.')
