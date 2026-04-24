import { create } from 'zustand'

export interface WorkspaceTask {
  id: string
  title: string
  done: boolean
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
  files: string[]
  tasks: WorkspaceTask[]
  windows: WindowsInteropState
  setSnapshot: (snapshot: {
    cwd: string
    session: string
    tasks: WorkspaceTask[]
    windows: WindowsInteropState
  }) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  cwd: '/home/rison/hermes-desktop-agent',
  session: 'booting',
  files: ['electron/', 'src/', 'PLAN.md', 'changelog/'],
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
      tasks: snapshot.tasks,
      windows: {
        ...snapshot.windows,
        clipboardPreview: snapshot.windows.clipboardPreview ?? '',
      },
      files: ['electron/', 'src/', 'package.json', 'PLAN.md', 'changelog/'],
    }),
}))
