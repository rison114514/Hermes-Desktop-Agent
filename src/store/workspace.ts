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

export interface WorkspaceFilePreview {
  path: string
  content: string
  language: string
  truncated: boolean
}

export interface WindowsInteropState {
  available: boolean
  hostPlatform?: string
  distro?: string
  workspaceMode?: 'windows-workspace' | 'wsl-workspace'
  wslPath: string
  windowsPath: string | null
  uncPath?: string | null
  clipboardPreview: string
}

interface WorkspaceStore {
  cwd: string
  session: string
  files: WorkspaceFileNode[]
  expandedPaths: string[]
  selectedFilePath: string | null
  preview: WorkspaceFilePreview | null
  previewLoading: boolean
  tasks: WorkspaceTask[]
  windows: WindowsInteropState
  autoRefreshEnabled: boolean
  autoRefreshInterval: number
  lastRefreshedAt: number | null
  setSnapshot: (snapshot: {
    cwd: string
    session: string
    files: WorkspaceFileNode[]
    tasks: WorkspaceTask[]
    windows: WindowsInteropState
  }) => void
  toggleExpandedPath: (path: string) => void
  setSelectedFilePath: (path: string | null) => void
  setPreview: (preview: WorkspaceFilePreview | null) => void
  setPreviewLoading: (loading: boolean) => void
  setAutoRefreshEnabled: (enabled: boolean) => void
  setAutoRefreshInterval: (interval: number) => void
  setLastRefreshedAt: (time: number | null) => void
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
  expandedPaths: ['src', 'electron'],
  selectedFilePath: null,
  preview: null,
  previewLoading: false,
  tasks: [],
  windows: {
    available: false,
    hostPlatform: 'win32',
    distro: 'Ubuntu',
    workspaceMode: 'windows-workspace',
    wslPath: '/home/rison/hermes-desktop-agent',
    windowsPath: null,
    uncPath: null,
    clipboardPreview: '',
  },
  autoRefreshEnabled: false,
  autoRefreshInterval: 10000,
  lastRefreshedAt: null,
  setSnapshot: (snapshot) =>
    set((state) => ({
      cwd: snapshot.cwd,
      session: snapshot.session,
      files: snapshot.files,
      tasks: snapshot.tasks,
      windows: {
        ...snapshot.windows,
        clipboardPreview: snapshot.windows.clipboardPreview ?? '',
      },
      expandedPaths: state.cwd === snapshot.cwd && state.expandedPaths.length ? state.expandedPaths : ['src', 'electron'],
      selectedFilePath: state.cwd === snapshot.cwd ? state.selectedFilePath : null,
      preview: state.cwd === snapshot.cwd ? state.preview : null,
    })),
  toggleExpandedPath: (path) =>
    set((state) => ({
      expandedPaths: state.expandedPaths.includes(path)
        ? state.expandedPaths.filter((item) => item !== path)
        : [...state.expandedPaths, path],
    })),
  setSelectedFilePath: (path) => set({ selectedFilePath: path }),
  setPreview: (preview) => set({ preview }),
  setPreviewLoading: (previewLoading) => set({ previewLoading }),
  setAutoRefreshEnabled: (enabled) => set({ autoRefreshEnabled: enabled }),
  setAutoRefreshInterval: (interval) => set({ autoRefreshInterval: interval }),
  setLastRefreshedAt: (time) => set({ lastRefreshedAt: time }),
}))
