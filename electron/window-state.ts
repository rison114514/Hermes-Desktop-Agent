import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface PersistedWindowState {
  width: number
  height: number
  x?: number
  y?: number
  alwaysOnTop: boolean
  version?: number
}

const WINDOW_STATE_VERSION = 2

const DEFAULT_STATE: PersistedWindowState = {
  width: 1360,
  height: 840,
  alwaysOnTop: false,
  version: WINDOW_STATE_VERSION,
}

export async function readWindowState(userDataPath: string): Promise<PersistedWindowState> {
  try {
    const content = await readFile(getStatePath(userDataPath), 'utf8')
    const parsed = JSON.parse(content) as Partial<PersistedWindowState>

    const hasCurrentVersion = parsed.version === WINDOW_STATE_VERSION

    return {
      width: parsed.width ?? DEFAULT_STATE.width,
      height: parsed.height ?? DEFAULT_STATE.height,
      x: parsed.x,
      y: parsed.y,
      alwaysOnTop: hasCurrentVersion ? parsed.alwaysOnTop ?? DEFAULT_STATE.alwaysOnTop : DEFAULT_STATE.alwaysOnTop,
      version: WINDOW_STATE_VERSION,
    }
  } catch {
    return DEFAULT_STATE
  }
}

export async function writeWindowState(userDataPath: string, state: PersistedWindowState) {
  const statePath = getStatePath(userDataPath)
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify({ ...state, version: WINDOW_STATE_VERSION }, null, 2)}\n`, 'utf8')
}

function getStatePath(userDataPath: string) {
  return path.join(userDataPath, 'window-state.json')
}
