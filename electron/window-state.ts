import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface PersistedWindowState {
  width: number
  height: number
  x?: number
  y?: number
  alwaysOnTop: boolean
}

const DEFAULT_STATE: PersistedWindowState = {
  width: 1360,
  height: 840,
  alwaysOnTop: true,
}

export async function readWindowState(userDataPath: string): Promise<PersistedWindowState> {
  try {
    const content = await readFile(getStatePath(userDataPath), 'utf8')
    const parsed = JSON.parse(content) as Partial<PersistedWindowState>

    return {
      width: parsed.width ?? DEFAULT_STATE.width,
      height: parsed.height ?? DEFAULT_STATE.height,
      x: parsed.x,
      y: parsed.y,
      alwaysOnTop: parsed.alwaysOnTop ?? DEFAULT_STATE.alwaysOnTop,
    }
  } catch {
    return DEFAULT_STATE
  }
}

export async function writeWindowState(userDataPath: string, state: PersistedWindowState) {
  const statePath = getStatePath(userDataPath)
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function getStatePath(userDataPath: string) {
  return path.join(userDataPath, 'window-state.json')
}
