import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface PersistedWorkspaceState {
  workspaceRoot?: string
  lastSessionId?: string
  version?: number
}

const WORKSPACE_STATE_VERSION = 1

export async function readWorkspaceState(userDataPath: string): Promise<PersistedWorkspaceState> {
  try {
    const content = await readFile(getStatePath(userDataPath), 'utf8')
    const parsed = JSON.parse(content) as Partial<PersistedWorkspaceState>

    if (parsed.version !== WORKSPACE_STATE_VERSION) {
      return {}
    }

    return {
      workspaceRoot: typeof parsed.workspaceRoot === 'string' ? parsed.workspaceRoot : undefined,
      lastSessionId: typeof parsed.lastSessionId === 'string' ? parsed.lastSessionId : undefined,
      version: WORKSPACE_STATE_VERSION,
    }
  } catch {
    return {}
  }
}

export async function writeWorkspaceState(userDataPath: string, state: PersistedWorkspaceState) {
  const statePath = getStatePath(userDataPath)
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(
    statePath,
    `${JSON.stringify({ ...state, version: WORKSPACE_STATE_VERSION }, null, 2)}\n`,
    'utf8',
  )
}

function getStatePath(userDataPath: string) {
  return path.join(userDataPath, 'workspace-state.json')
}
