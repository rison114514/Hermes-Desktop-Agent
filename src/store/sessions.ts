import { create } from 'zustand'

export type WorkbenchTabKind = 'session' | 'normal' | 'mod'
export type WorkbenchSplitDirection = 'horizontal' | 'vertical'
export type WorkbenchDropPosition = 'left' | 'right' | 'top' | 'bottom'

export interface WorkbenchTab {
  id: string
  kind?: WorkbenchTabKind
  name: string
  cwd?: string
  sessionId?: string
  pageId?: string
  modName?: string
  rendererType?: string
  icon?: string
  closable?: boolean
  detachable?: boolean
  payload?: Record<string, unknown>
  type?: string
}

export interface WorkbenchGroupNode {
  type: 'group'
  id: string
  tabIds: string[]
  activeTabId: string | null
}

export interface WorkbenchSplitNode {
  type: 'split'
  id: string
  direction: WorkbenchSplitDirection
  children: WorkbenchLayoutNode[]
}

export type WorkbenchLayoutNode = WorkbenchGroupNode | WorkbenchSplitNode

interface SessionStore {
  sessions: WorkbenchTab[]
  activeId: string | null
  activeGroupId: string
  layout: WorkbenchLayoutNode
  setSessions: (sessions: WorkbenchTab[]) => void
  setActive: (id: string | null, groupId?: string) => void
  openTab: (tab: WorkbenchTab, options?: { activate?: boolean; groupId?: string }) => void
  replaceTab: (oldId: string, tab: WorkbenchTab) => void
  closeTab: (id: string) => void
  addSession: (session: Partial<WorkbenchTab> & { id: string; name: string; cwd?: string }) => void
  removeSession: (id: string) => void
  renameSession: (id: string, name: string) => void
  moveTabInGroup: (dragId: string, overId: string, groupId: string) => void
  moveTabToGroup: (tabId: string, groupId: string, overId?: string) => void
  splitTabToGroup: (tabId: string, targetGroupId: string, position: WorkbenchDropPosition) => void
}

const LAYOUT_STORAGE_KEY = 'hermes-workbench-layout-v1'
const ROOT_GROUP_ID = 'group-root'

function createGroup(tabIds: string[] = [], activeTabId: string | null = tabIds[0] ?? null): WorkbenchGroupNode {
  return {
    type: 'group',
    id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tabIds,
    activeTabId,
  }
}

function createInitialLayout(): WorkbenchGroupNode {
  return { type: 'group', id: ROOT_GROUP_ID, tabIds: [], activeTabId: null }
}

function normalizeTab(tab: WorkbenchTab): WorkbenchTab {
  if (tab.kind) return tab
  if (tab.type === 'model-config' || tab.pageId === 'model-config') {
    return { ...tab, kind: 'normal', pageId: 'model-config' }
  }
  return { ...tab, kind: 'session', sessionId: tab.sessionId ?? tab.id, cwd: tab.cwd ?? '' }
}

export function getTabType(tab: WorkbenchTab | null | undefined): WorkbenchTabKind {
  return normalizeTab(tab ?? ({ id: '', name: '', kind: 'session' } as WorkbenchTab)).kind
}

function firstGroup(node: WorkbenchLayoutNode): WorkbenchGroupNode {
  if (node.type === 'group') return node
  return firstGroup(node.children[0])
}

function findGroup(node: WorkbenchLayoutNode, groupId: string): WorkbenchGroupNode | null {
  if (node.type === 'group') return node.id === groupId ? node : null
  for (const child of node.children) {
    const group = findGroup(child, groupId)
    if (group) return group
  }
  return null
}

function resolveGroupId(layout: WorkbenchLayoutNode, groupId: string | undefined): string {
  return groupId && findGroup(layout, groupId) ? groupId : firstGroup(layout).id
}

function tabExistsInLayout(node: WorkbenchLayoutNode, tabId: string): boolean {
  if (node.type === 'group') return node.tabIds.includes(tabId)
  return node.children.some((child) => tabExistsInLayout(child, tabId))
}

function mapLayout(node: WorkbenchLayoutNode, fn: (group: WorkbenchGroupNode) => WorkbenchGroupNode): WorkbenchLayoutNode {
  if (node.type === 'group') return fn(node)
  return { ...node, children: node.children.map((child) => mapLayout(child, fn)) }
}

function removeTabFromLayout(node: WorkbenchLayoutNode, tabId: string): WorkbenchLayoutNode {
  return mapLayout(node, (group) => {
    const tabIds = group.tabIds.filter((id) => id !== tabId)
    const activeTabId = group.activeTabId === tabId ? (tabIds[0] ?? null) : group.activeTabId
    return { ...group, tabIds, activeTabId }
  })
}

function pruneLayout(node: WorkbenchLayoutNode): WorkbenchLayoutNode | null {
  if (node.type === 'group') return node.tabIds.length > 0 ? node : null
  const children = node.children.map(pruneLayout).filter(Boolean) as WorkbenchLayoutNode[]
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...node, children }
}

function reconcileLayout(layout: WorkbenchLayoutNode, tabs: WorkbenchTab[]): WorkbenchLayoutNode {
  const validIds = new Set(tabs.map((tab) => tab.id))
  let next = mapLayout(layout, (group) => {
    const tabIds = group.tabIds.filter((id) => validIds.has(id))
    return {
      ...group,
      tabIds,
      activeTabId: group.activeTabId && tabIds.includes(group.activeTabId) ? group.activeTabId : (tabIds[0] ?? null),
    }
  })

  const pruned = pruneLayout(next)
  next = pruned ?? createInitialLayout()
  const targetGroup = firstGroup(next)
  const missing = tabs.filter((tab) => !tabExistsInLayout(next, tab.id)).map((tab) => tab.id)
  if (missing.length > 0) {
    next = mapLayout(next, (group) => group.id === targetGroup.id
      ? { ...group, tabIds: [...group.tabIds, ...missing], activeTabId: group.activeTabId ?? missing[0] }
      : group)
  }
  return next
}

function loadLayout(): WorkbenchLayoutNode {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as WorkbenchLayoutNode
      if (parsed?.type === 'group' || parsed?.type === 'split') return parsed
    }
  } catch { /* noop */ }
  return createInitialLayout()
}

function persistLayout(layout: WorkbenchLayoutNode) {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout)) } catch { /* noop */ }
}

function insertTabInGroup(layout: WorkbenchLayoutNode, groupId: string, tabId: string, overId?: string): WorkbenchLayoutNode {
  return mapLayout(layout, (group) => {
    if (group.id !== groupId) return group
    const without = group.tabIds.filter((id) => id !== tabId)
    const index = overId ? without.indexOf(overId) : -1
    const tabIds = [...without]
    tabIds.splice(index >= 0 ? index : tabIds.length, 0, tabId)
    return { ...group, tabIds, activeTabId: tabId }
  })
}

function splitLayout(
  node: WorkbenchLayoutNode,
  targetGroupId: string,
  newGroup: WorkbenchGroupNode,
  position: WorkbenchDropPosition,
): WorkbenchLayoutNode {
  if (node.type === 'group') {
    if (node.id !== targetGroupId) return node
    const direction: WorkbenchSplitDirection = position === 'left' || position === 'right' ? 'horizontal' : 'vertical'
    const children = position === 'left' || position === 'top' ? [newGroup, node] : [node, newGroup]
    return { type: 'split', id: `split-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, direction, children }
  }
  return { ...node, children: node.children.map((child) => splitLayout(child, targetGroupId, newGroup, position)) }
}

function nextActiveId(layout: WorkbenchLayoutNode): string | null {
  const group = firstGroup(layout)
  return group.activeTabId ?? group.tabIds[0] ?? null
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeId: null,
  activeGroupId: ROOT_GROUP_ID,
  layout: loadLayout(),

  setSessions: (sessions) =>
    set((state) => {
      const normalized = sessions.map(normalizeTab)
      const layout = reconcileLayout(state.layout, normalized)
      persistLayout(layout)
      return {
        sessions: normalized,
        layout,
        activeGroupId: resolveGroupId(layout, state.activeGroupId),
        activeId: state.activeId && normalized.some((tab) => tab.id === state.activeId)
          ? state.activeId
          : nextActiveId(layout),
      }
    }),

  setActive: (id, groupId) =>
    set((state) => {
      const resolvedGroupId = resolveGroupId(state.layout, groupId ?? state.activeGroupId)
      const layout = mapLayout(state.layout, (group) =>
        group.id === resolvedGroupId && (!id || group.tabIds.includes(id))
          ? { ...group, activeTabId: id }
          : group)
      persistLayout(layout)
      return { activeId: id, activeGroupId: resolvedGroupId, layout }
    }),

  openTab: (tab, options) =>
    set((state) => {
      const nextTab = normalizeTab(tab)
      const tabs = [...state.sessions.filter((item) => item.id !== nextTab.id), nextTab]
      const reconciled = reconcileLayout(state.layout, tabs)
      const groupId = resolveGroupId(reconciled, options?.groupId ?? state.activeGroupId)
      let layout = tabExistsInLayout(state.layout, nextTab.id)
        ? state.layout
        : insertTabInGroup(reconciled, groupId, nextTab.id)
      if (options?.activate !== false) {
        layout = mapLayout(layout, (group) => group.id === groupId ? { ...group, activeTabId: nextTab.id } : group)
      }
      persistLayout(layout)
      return {
        sessions: tabs,
        layout,
        activeId: options?.activate === false ? state.activeId : nextTab.id,
        activeGroupId: groupId,
      }
    }),

  replaceTab: (oldId, tab) =>
    set((state) => {
      const nextTab = normalizeTab(tab)
      const sessions = state.sessions.map((item) => (item.id === oldId ? nextTab : item))
      const layout = mapLayout(state.layout, (group) => ({
        ...group,
        tabIds: group.tabIds.map((id) => (id === oldId ? nextTab.id : id)),
        activeTabId: group.activeTabId === oldId ? nextTab.id : group.activeTabId,
      }))
      persistLayout(layout)
      return {
        sessions,
        layout,
        activeId: state.activeId === oldId ? nextTab.id : state.activeId,
      }
    }),

  closeTab: (id) =>
    set((state) => {
      const tabs = state.sessions.filter((tab) => tab.id !== id)
      const layout = reconcileLayout(removeTabFromLayout(state.layout, id), tabs)
      persistLayout(layout)
      const activeId = state.activeId === id ? nextActiveId(layout) : state.activeId
      return { sessions: tabs, layout, activeId }
    }),

  addSession: (session) => get().openTab({
    ...session,
    kind: 'session',
    sessionId: session.sessionId ?? session.id,
    cwd: session.cwd ?? '',
  }),

  removeSession: (id) => get().closeTab(id),

  renameSession: (id, name) =>
    set((state) => ({
      sessions: state.sessions.map((tab) => (tab.id === id ? { ...tab, name } : tab)),
    })),

  moveTabInGroup: (dragId, overId, groupId) =>
    set((state) => {
      const layout = mapLayout(state.layout, (group) => {
        if (group.id !== groupId || !group.tabIds.includes(dragId) || !group.tabIds.includes(overId)) return group
        const without = group.tabIds.filter((id) => id !== dragId)
        const index = without.indexOf(overId)
        const tabIds = [...without]
        tabIds.splice(index, 0, dragId)
        return { ...group, tabIds, activeTabId: dragId }
      })
      persistLayout(layout)
      return { layout, activeId: dragId, activeGroupId: groupId }
    }),

  moveTabToGroup: (tabId, groupId, overId) =>
    set((state) => {
      let layout = removeTabFromLayout(state.layout, tabId)
      layout = insertTabInGroup(layout, groupId, tabId, overId)
      layout = reconcileLayout(layout, state.sessions)
      persistLayout(layout)
      return { layout, activeId: tabId, activeGroupId: groupId }
    }),

  splitTabToGroup: (tabId, targetGroupId, position) =>
    set((state) => {
      const sourceRemoved = removeTabFromLayout(state.layout, tabId)
      const newGroup = createGroup([tabId], tabId)
      const layout = reconcileLayout(splitLayout(sourceRemoved, targetGroupId, newGroup, position), state.sessions)
      persistLayout(layout)
      return { layout, activeId: tabId, activeGroupId: newGroup.id }
    }),
}))
