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
  const setLastRefreshedAt = useWorkspaceStore((state) => state.setLastRefreshedAt)
  const selectedFilePath = useWorkspaceStore((state) => state.selectedFilePath)
  const setPreview = useWorkspaceStore((state) => state.setPreview)
  const setPreviewLoading = useWorkspaceStore((state) => state.setPreviewLoading)
  const setHermesConfig = useSkillsStore((state) => state.setHermesConfig)
  const setSkills = useSkillsStore((state) => state.setSkills)
  const addMessage = useChatStore((state) => state.addMessage)
  const appendChunk = useChatStore((state) => state.appendChunk)
  const finalizeMessage = useChatStore((state) => state.finalizeMessage)
  const replaceMessage = useChatStore((state) => state.replaceMessage)
  const upsertToolMessage = useChatStore((state) => state.upsertToolMessage)
  const setActiveAssistant = useChatStore((state) => state.setActiveAssistant)
  const setConnectionLabel = useChatStore((state) => state.setConnectionLabel)
  const touchAssistantMessage = useChatStore((state) => state.touchAssistantMessage)
  const setWindowState = useDesktopWindowStore((state) => state.setState)

  useEffect(() => {
    if (!window.hermesDesktop) {
      return
    }

    void window.hermesDesktop.getWorkspaceSnapshot().then((snapshot) => {
      setSnapshot(snapshot)
      setLastRefreshedAt(Date.now())
    }).catch(() => {
      // 当 IPC 不可用时，保留默认占位数据。
    })
    void window.hermesDesktop.getHermesConfig().then(setHermesConfig).catch(() => {
      // 当 preload bridge 不可用时，保留默认配置展示。
    })
    void window.hermesDesktop.getHermesSkills().then(setSkills).catch(() => {
      // 当 preload bridge 不可用时，保留默认技能列表。
    })

    void window.hermesDesktop.getWindowState().then(setWindowState).catch(() => {
      // 当 IPC 不可用时，保留默认窗口状态。
    })
  }, [setHermesConfig, setSkills, setSnapshot, setLastRefreshedAt, setWindowState])

  useEffect(() => {
    if (!window.hermesDesktop || !selectedFilePath) {
      return
    }

    let cancelled = false
    setPreviewLoading(true)

    void window.hermesDesktop.readWorkspaceFile(selectedFilePath).then((result) => {
      if (cancelled) {
        return
      }

      if (!result.ok || !result.path || typeof result.content !== 'string' || !result.language) {
        setPreview(null)
        return
      }

      setPreview({
        path: result.path,
        content: result.content,
        language: result.language,
        truncated: Boolean(result.truncated),
      })
    }).catch(() => {
      if (!cancelled) {
        setPreview(null)
      }
    }).finally(() => {
      if (!cancelled) {
        setPreviewLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [selectedFilePath, setPreview, setPreviewLoading])

  useEffect(() => {
    if (!window.hermesDesktop) {
      return
    }

    return window.hermesDesktop.onHermesEvent((event) => {
      if (event.type === 'assistant:start') {
        touchAssistantMessage(event.payload.id ?? null)
        setConnectionLabel(event.payload.model ? `正在通过 ${event.payload.model} 响应` : 'Hermes 正在响应')
        return
      }

      if (event.type === 'assistant:delta') {
        const targetId = touchAssistantMessage(event.payload.id ?? null)
        if (!targetId) {
          return
        }

        appendChunk(targetId, event.payload.delta)
        setConnectionLabel('正在流式输出')
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
        setConnectionLabel(event.payload.reason ? `已完成：${event.payload.reason}` : '空闲')
        return
      }

      if (event.type === 'tool') {
        upsertToolMessage({
          toolName: event.payload.name,
          callId: event.payload.id,
          args: event.payload.args,
          result: event.payload.result,
          status: event.payload.status,
        })
        setConnectionLabel(event.payload.status === 'completed' ? `工具 ${event.payload.name} 已完成` : `正在调用工具 ${event.payload.name}`)
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
          label: '错误输出',
        })
        setConnectionLabel('Hermes 返回了错误信息')
        return
      }

      if (event.type === 'exit') {
        addMessage({
          id: `exit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'system',
          content: `Hermes 进程已退出${event.payload.code === null ? '' : `，退出码 ${event.payload.code}`}`,
          tone: event.payload.code === 0 ? 'muted' : 'error',
          label: '进程状态',
        })
        setActiveAssistant(null)
        setConnectionLabel('离线')
        return
      }

      addMessage({
        id: `raw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'system',
        content: JSON.stringify(event.payload, null, 2),
        tone: 'muted',
        label: '原始事件',
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
    upsertToolMessage,
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
