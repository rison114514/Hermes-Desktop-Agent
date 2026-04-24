import { execFile } from 'node:child_process'

export interface WindowsInteropSnapshot {
  available: boolean
  wslPath: string
  windowsPath: string | null
}

export interface WindowsInteropResult {
  ok: boolean
  error?: string
}

function execFileAsync(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message))
        return
      }

      resolve(stdout.trim())
    })
  })
}

export async function toWindowsPath(pathInWsl: string) {
  return execFileAsync('wslpath', ['-w', pathInWsl])
}

export async function revealInExplorer(pathInWsl: string) {
  const windowsPath = await toWindowsPath(pathInWsl)

  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Start-Process explorer.exe '${windowsPath.replace(/'/g, "''")}'`,
  ])

  return windowsPath
}

export async function openPathWithDefaultApp(pathInWsl: string) {
  const windowsPath = await toWindowsPath(pathInWsl)

  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Start-Process '${windowsPath.replace(/'/g, "''")}'`,
  ])

  return windowsPath
}

export async function readWindowsClipboard() {
  return execFileAsync('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard'])
}

export async function writeWindowsClipboard(text: string) {
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Set-Clipboard -Value @'\n${text}\n'@`,
  ])
}

export async function getWindowsInteropSnapshot(pathInWsl: string): Promise<WindowsInteropSnapshot> {
  try {
    const windowsPath = await toWindowsPath(pathInWsl)

    return {
      available: true,
      wslPath: pathInWsl,
      windowsPath,
    }
  } catch {
    return {
      available: false,
      wslPath: pathInWsl,
      windowsPath: null,
    }
  }
}
