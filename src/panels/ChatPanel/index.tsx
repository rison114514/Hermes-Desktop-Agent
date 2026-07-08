import { useEffect } from 'react'
import { TabBar } from '@/components/TabBar'
import { WorkbenchTabContent } from '@/components/WorkbenchTabContent'
import { useChatStore } from '@/store/chat'
import { getTabType, useSessionStore } from '@/store/sessions'

export function ChatPanel() {
  const setActiveSession = useChatStore((state) => state.setActiveSession)
  const activeTabId = useSessionStore((state) => state.activeId)
  const activeTab = useSessionStore((state) => state.sessions.find((session) => session.id === state.activeId))

  useEffect(() => {
    if (getTabType(activeTab) !== 'session') return
    if (activeTabId && activeTabId !== useChatStore.getState().activeSessionId) {
      setActiveSession(activeTabId)
    }
  }, [activeTabId, activeTab, setActiveSession])

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[var(--gradient-chat)]">
      <TabBar />
      <WorkbenchTabContent tab={activeTab} />
    </section>
  )
}
