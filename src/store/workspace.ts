import { create } from 'zustand'

export interface WorkspaceTask {
  id: string
  title: string
  done: boolean
}

export interface WorkspaceFileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: WorkspaceFileNode[]
}

export interface WindowsInteropState {
  available: boolean
  wslPath: string
  windowsPath: string | null
  clipboardPreview: string
}

interface WorkspaceStore {
  cwd: string
  session: string
  files: WorkspaceFileNode[]
  tasks: WorkspaceTask[]
  windows: WindowsInteropState
  setSnapshot: (snapshot: {
    cwd: string
    session: string
    files: WorkspaceFileNode[]
    tasks: WorkspaceTask[]
    windows: WindowsInteropState
  }) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  cwd: '/home/rison/hermes-desktop-agent',
  session: '启动中',
  files: [
    { name: 'electron', path: 'electron', type: 'directory' },
    { name: 'src', path: 'src', type: 'directory' },
    { name: 'PLAN.md', path: 'PLAN.md', type: 'file' },
    { name: 'changelog', path: 'changelog', type: 'directory' },
  ],
  tasks: [],
  windows: {
    available: false,
    wslPath: '/home/rison/hermes-desktop-agent',
    windowsPath: null,
    clipboardPreview: '',
  },
  setSnapshot: (snapshot) =>
    set({
      cwd: snapshot.cwd,
      session: snapshot.session,
      files: snapshot.files,
      tasks: snapshot.tasks,
      windows: {
        ...snapshot.windows,
        clipboardPreview: snapshot.windows.clipboardPreview ?? '',
      },
    }),
}))
