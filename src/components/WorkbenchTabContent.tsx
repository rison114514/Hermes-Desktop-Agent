import { useMemo, useState } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'
import { getTabType, type SessionTab } from '@/store/sessions'
import { useChatStore } from '@/store/chat'
import { useWorkspaceStore } from '@/store/workspace'
import { ModelConfigPage } from '@/panels/SkillsPanel/ModelConfig'
import { MessageList } from '@/panels/ChatPanel/MessageList'
import { InputBar } from '@/panels/ChatPanel/InputBar'
import { PermissionRequestCard } from '@/panels/ChatPanel/PermissionRequestCard'
import { SessionSwitcher } from '@/panels/ChatPanel/SessionSwitcher'

type WorkbenchTabContentProps = {
  tab: SessionTab | null | undefined
}

export function WorkbenchTabContent({ tab }: WorkbenchTabContentProps) {
  if (getTabType(tab) === 'model-config') {
    return <ModelConfigPage />
  }

  return <SessionTabContent />
}

function SessionTabContent() {
  const connectionLabel = useChatStore((state) => state.connectionLabel)
  const permissionRequests = useChatStore((state) => state.permissionRequests)
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const session = useWorkspaceStore((state) => state.session)
  const sessionTitle = useWorkspaceStore((state) => state.sessionTitle)
  const [showSessionSwitcher, setShowSessionSwitcher] = useState(false)

  const visiblePermissionRequests = useMemo(
    () => permissionRequests.filter((request) => (request.sessionId ?? 'default') === activeSessionId),
    [permissionRequests, activeSessionId],
  )
  const displayName = sessionTitle || session.slice(0, 24)

  return (
    <>
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.32em] text-cyan-200/70">对话</p>
          <button
            type="button"
            onClick={() => setShowSessionSwitcher((v) => !v)}
            className="mt-1 flex items-center gap-2 text-xl font-semibold text-white transition hover:text-cyan-100"
          >
            <span className="max-w-[260px] truncate">{displayName}</span>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition ${showSessionSwitcher ? 'rotate-180' : ''}`} />
          </button>
          {showSessionSwitcher ? <SessionSwitcher onClose={() => setShowSessionSwitcher(false)} /> : null}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
          <Sparkles className="h-4 w-4 text-cyan-200" />
          {connectionLabel}
        </div>
      </div>

      <MessageList />
      {visiblePermissionRequests.length ? (
        <div className="border-t border-white/10 px-6 py-4">
          <div className="space-y-3">
            {visiblePermissionRequests.map((request) => (
              <PermissionRequestCard key={request.requestId} request={request} />
            ))}
          </div>
        </div>
      ) : null}
      <InputBar />
    </>
  )
}
