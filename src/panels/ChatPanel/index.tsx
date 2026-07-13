import { useEffect, useMemo, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { WorkbenchTabs } from '@/components/WorkbenchTabs'
import { WorkbenchTabContent } from '@/components/WorkbenchTabContent'
import { useChatStore } from '@/store/chat'
import { getTabType, type WorkbenchDropPosition, type WorkbenchGroupNode, type WorkbenchLayoutNode, type WorkbenchTab, useSessionStore } from '@/store/sessions'
import { useSkillsStore } from '@/store/skills'
import { useWorkspaceStore } from '@/store/workspace'
import { cn } from '@/lib/utils'

type DropHint = {
  groupId: string
  position: WorkbenchDropPosition | 'center'
}

export function ChatPanel() {
  const layout = useSessionStore((state) => state.layout)
  const sessions = useSessionStore((state) => state.sessions)
  const activeId = useSessionStore((state) => state.activeId)
  const setSessions = useSessionStore((state) => state.setSessions)
  const setActive = useSessionStore((state) => state.setActive)
  const openTab = useSessionStore((state) => state.openTab)
  const replaceTab = useSessionStore((state) => state.replaceTab)
  const closeTab = useSessionStore((state) => state.closeTab)
  const moveTabInGroup = useSessionStore((state) => state.moveTabInGroup)
  const moveTabToGroup = useSessionStore((state) => state.moveTabToGroup)
  const splitTabToGroup = useSessionStore((state) => state.splitTabToGroup)
  const setActiveSession = useChatStore((state) => state.setActiveSession)
  const resetForSession = useChatStore((state) => state.resetForSession)
  const moveSessionMessages = useChatStore((state) => state.moveSessionMessages)
  const setSnapshot = useWorkspaceStore((state) => state.setSnapshot)
  const setCommands = useSkillsStore((state) => state.setCommands)
  const [initializing, setInitializing] = useState<Set<string>>(new Set())
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<DropHint | null>(null)

  const tabsById = useMemo(() => new Map(sessions.map((tab) => [tab.id, tab])), [sessions])

  useEffect(() => {
    if (!window.hermesDesktop?.listSessions) return
    let cancelled = false
    let attempts = 0

    const load = () => {
      window.hermesDesktop.listSessions().then((list) => {
        if (cancelled) return
        if (list.length > 0) {
          const existing = useSessionStore.getState().sessions
          const normalized = list.map((session) => ({
            ...session,
            kind: 'session' as const,
            sessionId: session.id,
          }))
          const merged = [
            ...normalized,
            ...existing.filter((tab) => getTabType(tab) !== 'session' || !normalized.some((session) => session.id === tab.id)),
          ]
          setSessions(merged)
          if (!useSessionStore.getState().activeId && merged[0]?.id) {
            activateTab(merged[0], undefined)
          }
          return
        }
        if (attempts++ < 20) window.setTimeout(load, 300)
      }).catch(() => {
        if (!cancelled && attempts++ < 20) window.setTimeout(load, 300)
      })
    }

    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSessions])

  const activateTab = (tab: WorkbenchTab, groupId?: string) => {
    setActive(tab.id, groupId)
    syncSessionBackend(tab)
  }

  const syncSessionBackend = (tab: WorkbenchTab) => {
    if (getTabType(tab) !== 'session') return
    setActiveSession(tab.sessionId ?? tab.id)
    window.hermesDesktop?.switchSession?.(tab.sessionId ?? tab.id).then((result) => {
      if (result?.snapshot) setSnapshot(result.snapshot)
      if (result?.commands) setCommands(result.commands)
    }).catch(() => {})
  }

  const createSessionInGroup = (groupId: string) => {
    const tempId = `new-${Date.now()}`
    const tempTab: WorkbenchTab = { id: tempId, kind: 'session', sessionId: tempId, name: '新会话', cwd: '' }
    openTab(tempTab, { groupId })
    setActiveSession(tempId)
    resetForSession('新会话', tempId)
    setInitializing((current) => new Set(current).add(tempId))

    window.hermesDesktop?.createSession?.(`会话 ${sessions.length + 1}`)
      .then(async (session) => {
        if (!session) return
        const realTab: WorkbenchTab = {
          id: session.id,
          kind: 'session',
          sessionId: session.id,
          name: session.name,
          cwd: session.cwd,
        }
        moveSessionMessages(tempId, session.id)
        replaceTab(tempId, realTab)
        setActiveSession(session.id)
        const switchResult = await window.hermesDesktop?.switchSession?.(session.id)
        if (switchResult?.snapshot) setSnapshot(switchResult.snapshot)
        if (switchResult?.commands) setCommands(switchResult.commands)
        const snapshot = await window.hermesDesktop?.newHermesSession?.()
        if (snapshot) setSnapshot(snapshot)
      })
      .catch(() => closeTab(tempId))
      .finally(() => setInitializing((current) => {
        const next = new Set(current)
        next.delete(tempId)
        return next
      }))
  }

  const closeWorkbenchTab = async (tabId: string, event: MouseEvent) => {
    event.stopPropagation()
    if (sessions.length <= 1) return
    const tab = tabsById.get(tabId)
    if (getTabType(tab) === 'session') {
      await window.hermesDesktop?.closeSession?.(tab?.sessionId ?? tabId)
    }
    closeTab(tabId)
  }

  const handleGroupDrop = (event: DragEvent<HTMLDivElement>, groupId: string) => {
    event.preventDefault()
    const tabId = event.dataTransfer.getData('application/x-hermes-tab')
    if (!tabId) return
    if (!dropHint || dropHint.groupId !== groupId || dropHint.position === 'center') {
      moveTabToGroup(tabId, groupId)
    } else {
      splitTabToGroup(tabId, groupId, dropHint.position)
    }
    const tab = tabsById.get(tabId)
    if (tab) syncSessionBackend(tab)
    setDropHint(null)
  }

  const renderNode = (node: WorkbenchLayoutNode): ReactNode => {
    if (node.type === 'split') {
      return (
        <div
          key={node.id}
          className={cn('flex min-h-0 min-w-0 flex-1 overflow-hidden', node.direction === 'horizontal' ? 'flex-row' : 'flex-col')}
        >
          {node.children.map((child, index) => (
            <div key={child.id} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              {index > 0 ? (
                <div className={cn('shrink-0 bg-white/10', node.direction === 'horizontal' ? 'w-px' : 'h-px w-full')} />
              ) : null}
              {renderNode(child)}
            </div>
          ))}
        </div>
      )
    }

    const groupTabs = node.tabIds.map((id) => tabsById.get(id)).filter(Boolean) as WorkbenchTab[]
    const activeTab = tabsById.get(node.activeTabId ?? '') ?? groupTabs[0] ?? null

    return (
      <div key={node.id} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <WorkbenchTabs
          group={node}
          tabs={groupTabs}
          activeId={activeId}
          initializingIds={initializing}
          dragOverTabId={dragOverTabId}
          canCloseTabs={sessions.length > 1}
          onActivate={(tabId, groupId) => {
            const tab = tabsById.get(tabId)
            if (tab) activateTab(tab, groupId)
          }}
          onClose={closeWorkbenchTab}
          onNew={createSessionInGroup}
          onDragOverTab={setDragOverTabId}
          onMoveTab={(dragId, overId, groupId) => {
            if (overId) moveTabInGroup(dragId, overId, groupId)
            else moveTabToGroup(dragId, groupId)
          }}
        />
        <WorkbenchDropSurface
          group={node}
          hint={dropHint?.groupId === node.id ? dropHint.position : null}
          onHint={(position) => setDropHint(position ? { groupId: node.id, position } : null)}
          onDrop={(event) => handleGroupDrop(event, node.id)}
        >
          <WorkbenchTabContent tab={activeTab} />
        </WorkbenchDropSurface>
      </div>
    )
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[var(--gradient-chat)]">
      {renderNode(layout)}
    </section>
  )
}

function WorkbenchDropSurface({
  group,
  hint,
  onHint,
  onDrop,
  children,
}: {
  group: WorkbenchGroupNode
  hint: WorkbenchDropPosition | 'center' | null
  onHint: (position: WorkbenchDropPosition | 'center' | null) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  children: ReactNode
}) {
  const detectPosition = (event: DragEvent<HTMLDivElement>): WorkbenchDropPosition | 'center' => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    const edge = 0.24
    if (x < edge) return 'left'
    if (x > 1 - edge) return 'right'
    if (y < edge) return 'top'
    if (y > 1 - edge) return 'bottom'
    return 'center'
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('application/x-hermes-tab')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onHint(detectPosition(event))
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onHint(null)
      }}
      onDrop={onDrop}
      data-group-id={group.id}
    >
      {children}
      {hint ? <DropOverlay hint={hint} /> : null}
    </div>
  )
}

function DropOverlay({ hint }: { hint: WorkbenchDropPosition | 'center' }) {
  const className = (() => {
    if (hint === 'left') return 'left-0 top-0 h-full w-1/2'
    if (hint === 'right') return 'right-0 top-0 h-full w-1/2'
    if (hint === 'top') return 'left-0 top-0 h-1/2 w-full'
    if (hint === 'bottom') return 'bottom-0 left-0 h-1/2 w-full'
    return 'inset-[18%]'
  })()

  return (
    <div className="pointer-events-none absolute inset-0 z-30 bg-cyan-300/5">
      <div className={`absolute rounded-2xl border border-cyan-300/50 bg-cyan-300/12 ${className}`} />
    </div>
  )
}
