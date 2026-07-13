import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shell } from 'electron'

export type InstalledBrowser = {
  id: string
  name: string
  path?: string
}

export async function detectInstalledBrowsers(): Promise<InstalledBrowser[]> {
  const browsers: InstalledBrowser[] = [{ id: 'default', name: '系统默认浏览器' }]

  if (process.platform === 'darwin') {
    const candidates = [
      ['safari', 'Safari', '/Applications/Safari.app'],
      ['chrome', 'Google Chrome', '/Applications/Google Chrome.app'],
      ['edge', 'Microsoft Edge', '/Applications/Microsoft Edge.app'],
      ['firefox', 'Firefox', '/Applications/Firefox.app'],
      ['brave', 'Brave', '/Applications/Brave Browser.app'],
      ['arc', 'Arc', '/Applications/Arc.app'],
      ['opera', 'Opera', '/Applications/Opera.app'],
      ['vivaldi', 'Vivaldi', '/Applications/Vivaldi.app'],
    ] as const
    for (const [id, name, appPath] of candidates) {
      const userPath = path.join(os.homedir(), 'Applications', path.basename(appPath))
      const detectedPath = existsSync(appPath) ? appPath : existsSync(userPath) ? userPath : null
      if (detectedPath) browsers.push({ id, name, path: detectedPath })
    }
  }

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? ''
    const programFiles = process.env.ProgramFiles ?? ''
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? ''
    const candidates: Array<[string, string, string[]]> = [
      ['chrome', 'Google Chrome', [path.join(programFiles, 'Google/Chrome/Application/chrome.exe'), path.join(local, 'Google/Chrome/Application/chrome.exe')]],
      ['edge', 'Microsoft Edge', [path.join(programFilesX86, 'Microsoft/Edge/Application/msedge.exe'), path.join(programFiles, 'Microsoft/Edge/Application/msedge.exe')]],
      ['firefox', 'Firefox', [path.join(programFiles, 'Mozilla Firefox/firefox.exe'), path.join(programFilesX86, 'Mozilla Firefox/firefox.exe')]],
      ['brave', 'Brave', [path.join(programFiles, 'BraveSoftware/Brave-Browser/Application/brave.exe'), path.join(local, 'BraveSoftware/Brave-Browser/Application/brave.exe')]],
      ['opera', 'Opera', [path.join(local, 'Programs/Opera/opera.exe')]],
      ['vivaldi', 'Vivaldi', [path.join(local, 'Vivaldi/Application/vivaldi.exe'), path.join(programFiles, 'Vivaldi/Application/vivaldi.exe')]],
    ]
    for (const [id, name, paths] of candidates) {
      const detectedPath = paths.find((candidate) => candidate && existsSync(candidate))
      if (detectedPath) browsers.push({ id, name, path: detectedPath })
    }
  }

  return browsers
}

export async function openInBrowser(url: string, browserId: string) {
  const browsers = await detectInstalledBrowsers()
  const browser = browsers.find((item) => item.id === browserId)
  if (!browser) throw new Error('所选浏览器未安装或已不可用。')
  if (browser.id === 'default' || !browser.path) {
    await shell.openExternal(url)
    return
  }

  await new Promise<void>((resolve, reject) => {
    const child = process.platform === 'darwin'
      ? spawn('/usr/bin/open', ['-a', browser.path!, url], { detached: true, stdio: 'ignore' })
      : spawn(browser.path!, [url], { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
