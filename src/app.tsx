import { useEffect } from 'react'
import { ChatPanel } from '@/panels/ChatPanel'
import { SkillsPanel } from '@/panels/SkillsPanel'
import { WorkspacePanel } from '@/panels/WorkspacePanel'
import { TitleBar } from '@/components/TitleBar'
import { useChatStore } from '@/store/chat'
import { useDesktopWindowStore } from '@/store/window'
import { useSkillsStore } from '@/store/skills'
import { useWorkspaceStore } from '@/store/workspace'

export default function App() {
  const setSnapshot = useWorkspaceStore((state) => state.setSnapshot)
  const setHermesConfig = useSkillsStore((state) => state.setHermesConfig)
  const setSkills = useSkillsStore((state) => state.setSkills)
  const addMessage = useChatStore((state) => state.addMessage)
  const appendChunk = useChatStore((state) => state.appendChunk)
  const finalizeMessage = useChatStore((state) => state.finalizeMessage)
  const replaceMessage = useChatStore((state) => state.replaceMessage)
  const setActiveAssistant = useChatStore((state) => state.setActiveAssistant)
  const setConnectionLabel = useChatStore((state) => state.setConnectionLabel)
  const touchAssistantMessage = useChatStore((state) => state.touchAssistantMessage)
  const setWindowState = useDesktopWindowStore((state) => state.setState)

  useEffect(() => {
    if (!window.hermesDesktop) {
      return
    }

    void window.hermesDesktop.getWorkspaceSnapshot().then(setSnapshot).catch(() => {
      // Keep default placeholder snapshot when the IPC bridge is unavailable.
    })
    void window.hermesDesktop.getHermesConfig().then(setHermesConfig).catch(() => {
      // Keep placeholder Hermes config if the preload bridge is unavailable.
    })
    void window.hermesDesktop.getHermesSkills().then(setSkills).catch(() => {
      // Keep placeholder skill list if the preload bridge is unavailable.
    })

    void window.hermesDesktop.getWindowState().then(setWindowState).catch(() => {
      // Keep default window state when the IPC bridge is unavailable.
    })
  }, [setHermesConfig, setSkills, setSnapshot, setWindowState])

  useEffect(() => {
    if (!window.hermesDesktop) {
      return
    }

    return window.hermesDesktop.onHermesEvent((event) => {
      if (event.type === 'assistant:start') {
        touchAssistantMessage(event.payload.id ?? null)
        setConnectionLabel(
          event.payload.model ? `Responding via ${event.payload.model}` : 'Hermes is responding',
        )
        return
      }

      if (event.type === 'assistant:delta') {
        const targetId = touchAssistantMessage(event.payload.id ?? null)
        if (!targetId) {
          return
        }

        appendChunk(targetId, event.payload.delta)
        setConnectionLabel('Streaming response')
        return
      }

      if (event.type === 'assistant:done') {
        const targetId = touchAssistantMessage(event.payload.id ?? null)
        if (targetId && event.payload.text) {
          replaceMessage(targetId, event.payload.text)
        }
        if (targetId) {
          finalizeMessage(targetId)
        }
        setActiveAssistant(null)
        setConnectionLabel(event.payload.reason ? `Completed: ${event.payload.reason}` : 'Idle')
        return
      }

      if (event.type === 'status') {
        setConnectionLabel(event.payload.detail)
        return
      }

      if (event.type === 'stderr') {
        addMessage({
          id: `stderr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'system',
          content: event.payload,
          tone: 'error',
          label: 'stderr',
        })
        setConnectionLabel('Hermes reported an error')
        return
      }

      if (event.type === 'exit') {
        addMessage({
          id: `exit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'system',
          content: `Hermes process exited${event.payload.code === null ? '' : ` with code ${event.payload.code}`}.`,
          tone: event.payload.code === 0 ? 'muted' : 'error',
          label: 'process',
        })
        setActiveAssistant(null)
        setConnectionLabel('Offline')
        return
      }

      addMessage({
        id: `raw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'system',
        content: JSON.stringify(event.payload, null, 2),
        tone: 'muted',
        label: 'raw',
      })
    })
  }, [
    addMessage,
    appendChunk,
    finalizeMessage,
    replaceMessage,
    setActiveAssistant,
    setConnectionLabel,
    touchAssistantMessage,
  ])

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#061018] text-slate-100">
      <TitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SkillsPanel />
        <ChatPanel />
        <WorkspacePanel />
      </div>
    </div>
  )
}
