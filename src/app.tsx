import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { ChatPanel } from '@/panels/ChatPanel'
import { SkillsPanel } from '@/panels/SkillsPanel'
import { WorkspacePanel } from '@/panels/WorkspacePanel'
import { TitleBar } from '@/components/TitleBar'
import { useChatStore } from '@/store/chat'
import { getTabType, useSessionStore } from '@/store/sessions'
import { useDesktopWindowStore } from '@/store/window'
import { useSkillsStore } from '@/store/skills'
import { useModelStore } from '@/store/model'
import { useModsStore } from '@/store/mods'
import { useWorkspaceStore } from '@/store/workspace'
import { useThemeStore } from '@/store/theme'

function looksLikeError(content: string): boolean {
  if (!content) {
    return false
  }

  const errorPatterns = [
    /\b\w*(?:Error|Exception)\b/,
    /\b(?:Traceback|FAILED|Fatal|CRITICAL)\b/,
    /^Traceback\s*\(most recent call last\):/m,
    /^\s*File\s+"[^"]+",\s+line\s+\d+/m,
    /\b(?:failed|error|exception|traceback|fatal|critical)\b/i,
    /[✗✘]/,
    /\bstatus\s*(?:code\s*)?[1-9]\d{2}\b/,
  ]

  for (const pattern of errorPatterns) {
    if (pattern.test(content)) {
      return true
    }
  }

  return false
}

const LEFT_PANEL_MIN = 240
const LEFT_PANEL_MAX = 560
const RIGHT_PANEL_MIN = 260
const RIGHT_PANEL_MAX = 620

function readStoredWidth(key: string, fallback: number, min: number, max: number) {
  try {
    const value = Number(localStorage.getItem(key))
    if (Number.isFinite(value)) {
      return Math.min(max, Math.max(min, value))
    }
  } catch { /* noop */ }
  return fallback
}

function persistWidth(key: string, value: number) {
  try { localStorage.setItem(key, String(Math.round(value))) } catch { /* noop */ }
}

export default function App() {
  const theme = useThemeStore((state) => state.theme)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() =>
    readStoredWidth('hermes-left-panel-width', 320, LEFT_PANEL_MIN, LEFT_PANEL_MAX),
  )
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    readStoredWidth('hermes-right-panel-width', 384, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX),
  )
  const setSnapshot = useWorkspaceStore((state) => state.setSnapshot)
  const selectedFilePath = useWorkspaceStore((state) => state.selectedFilePath)
  const setPreview = useWorkspaceStore((state) => state.setPreview)
  const setPreviewLoading = useWorkspaceStore((state) => state.setPreviewLoading)
  const setModelConfig = useModelStore((state) => state.setConfig)
  const setSkills = useSkillsStore((state) => state.setSkills)
  const setCommands = useSkillsStore((state) => state.setCommands)
  const addMessage = useChatStore((state) => state.addMessage)
  const addPermissionRequest = useChatStore((state) => state.addPermissionRequest)
  const appendChunk = useChatStore((state) => state.appendChunk)
  const finalizeMessage = useChatStore((state) => state.finalizeMessage)
  const replaceMessage = useChatStore((state) => state.replaceMessage)
  const upsertToolMessage = useChatStore((state) => state.upsertToolMessage)
  const setActiveAssistant = useChatStore((state) => state.setActiveAssistant)
  const setConnectionLabel = useChatStore((state) => state.setConnectionLabel)
  const touchAssistantMessage = useChatStore((state) => state.touchAssistantMessage)
  const setWindowState = useDesktopWindowStore((state) => state.setState)
  const setMods = useModsStore((state) => state.setMods)

  useEffect(() => {
    if (!window.hermesDesktop) {
      return
    }

    void window.hermesDesktop.getWorkspaceSnapshot().then(setSnapshot).catch(() => {
      // 当 IPC 不可用时，保留默认占位数据。
    })
    void window.hermesDesktop.getHermesConfig().then(setModelConfig).catch(() => {
      // 当 preload bridge 不可用时，保留默认配置展示。
    })
    void window.hermesDesktop.getHermesSkills().then(setSkills).catch(() => {
      // 当 preload bridge 不可用时，保留默认技能列表。
    })
    void window.hermesDesktop.getHermesCommands().then(setCommands).catch(() => {
      // 当 preload bridge 不可用时，保留默认命令列表。
    })
    void window.hermesDesktop.scanMods().then((result) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMods(result as any)
    }).catch(() => {
      // 当 preload bridge 不可用时，保留默认模组列表。
    })

    void window.hermesDesktop.getWindowState().then(setWindowState).catch(() => {
      // 当 IPC 不可用时，保留默认窗口状态。
    })
  }, [setModelConfig, setSkills, setMods, setSnapshot, setWindowState])

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
      const sid = (event as Record<string, unknown>).sessionId as string | undefined
      // Workspace context (file tree, cwd, slash-commands) is a single global
      // store shared by all tabs. Only the active session may write to it, or a
      // background tab running a task would clobber the panel you're viewing.
      // On switch, switchSession re-fetches an authoritative snapshot anyway.
      const sessionState = useSessionStore.getState()
      const activeTab = sessionState.sessions.find((tab) => tab.id === sessionState.activeId)
      const activeSid = getTabType(activeTab) === 'session'
        ? sessionState.activeId
        : useChatStore.getState().activeSessionId
      const isForActiveSession = !sid || !activeSid || sid === activeSid

      if (event.type === 'user:message') {
        const currentAssistantId = useChatStore.getState().activeAssistantId
        if (event.payload.replay && currentAssistantId) {
          finalizeMessage(currentAssistantId, sid)
          setActiveAssistant(null)
        }
        addMessage({
          id: event.payload.id ?? `history-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'user',
          content: event.payload.text,
        }, sid)
        setConnectionLabel(event.payload.replay ? 'Loaded historical user message' : 'User message received')
        return
      }

      if (event.type === 'assistant:start') {
        touchAssistantMessage(event.payload.id ?? null, sid)
        setConnectionLabel(event.payload.model ? `正在通过 ${event.payload.model} 响应` : 'Hermes 正在响应')
        return
      }

      if (event.type === 'assistant:delta') {
        const targetId = touchAssistantMessage(event.payload.id ?? null, sid)
        if (!targetId) {
          return
        }

        appendChunk(targetId, event.payload.delta, sid)
        setConnectionLabel('正在流式输出')
        return
      }

      if (event.type === 'assistant:done') {
        const targetId = touchAssistantMessage(event.payload.id ?? null, sid)
        if (targetId && event.payload.text) {
          replaceMessage(targetId, event.payload.text, sid)
        }
        if (targetId) {
          finalizeMessage(targetId, sid)
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
          updatedAt: Date.now(),
        }, sid)
        setConnectionLabel(event.payload.status === 'completed' ? `工具 ${event.payload.name} 已完成` : `正在调用工具 ${event.payload.name}`)
        return
      }

      if (event.type === 'commands') {
        if (isForActiveSession) {
          setCommands(event.payload)
        }
        return
      }

      if (event.type === 'skills:updated') {
        setSkills(event.payload)
        return
      }

      if (event.type === 'permission:request') {
        addPermissionRequest(event.payload)
        setConnectionLabel('Hermes is waiting for permission')
        return
      }

      if (event.type === 'status') {
        const currentAssistantId = useChatStore.getState().activeAssistantId
        if (event.payload.stage === 'ready' && event.payload.detail.startsWith('Loaded Hermes ACP session') && currentAssistantId) {
          finalizeMessage(currentAssistantId)
          setActiveAssistant(null)
        }
        setConnectionLabel(event.payload.detail)
        return
      }

      if (event.type === 'stderr') {
        const isError = looksLikeError(event.payload)
        addMessage({
          id: `stderr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'system',
          content: event.payload,
          tone: isError ? 'error' : 'muted',
          label: isError ? '错误输出' : '后台输出',
        }, sid)
        setConnectionLabel(isError ? 'Hermes 返回了错误信息' : 'Hermes 后台输出')
        return
      }

      if (event.type === 'workspace:snapshot') {
        if (isForActiveSession) {
          setSnapshot(event.payload as DesktopWorkspaceSnapshot)
        }
        return
      }

      if (event.type === 'mods:ready') {
        // Backend finished enabling MODs and registering their IPC handlers.
        // Bump the nonce so any already-mounted sidebar panels re-fetch.
        useModsStore.getState().markModsReady()
        return
      }

      if (event.type === 'exit') {
        addMessage({
          id: `exit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'system',
          content: `Hermes 进程已退出${event.payload.code === null ? '' : `，退出码 ${event.payload.code}`}`,
          tone: event.payload.code === 0 ? 'muted' : 'error',
          label: '进程状态',
        }, sid)
        setActiveAssistant(null)
        setConnectionLabel('离线')
        return
      }

      // Raw/diagnostic events — suppress noise but log in dev
      if (event.type === 'raw' || (event as Record<string, unknown>).type === 'raw') {
        return
      }
    })
  }, [
    addMessage,
    addPermissionRequest,
    appendChunk,
    finalizeMessage,
    replaceMessage,
    setActiveAssistant,
    setCommands,
    setConnectionLabel,
    touchAssistantMessage,
    upsertToolMessage,
  ])

  const beginResize = (side: 'left' | 'right', event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = side === 'left' ? leftPanelWidth : rightPanelWidth

    const handleMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX
      if (side === 'left') {
        const next = Math.min(LEFT_PANEL_MAX, Math.max(LEFT_PANEL_MIN, startWidth + delta))
        setLeftPanelWidth(next)
        persistWidth('hermes-left-panel-width', next)
      } else {
        const next = Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, startWidth - delta))
        setRightPanelWidth(next)
        persistWidth('hermes-right-panel-width', next)
      }
    }

    const handleUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }

  return (
    <div data-theme={theme} className="flex h-screen flex-col overflow-hidden rounded-[28px] border border-white/10 bg-app-bg text-slate-100">
      <TitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SkillsPanel width={leftPanelWidth} />
        <PanelResizeHandle side="left" onMouseDown={(event) => beginResize('left', event)} />
        <ChatPanel />
        <PanelResizeHandle side="right" onMouseDown={(event) => beginResize('right', event)} />
        <WorkspacePanel width={rightPanelWidth} />
      </div>
    </div>
  )
}

function PanelResizeHandle({
  side,
  onMouseDown,
}: {
  side: 'left' | 'right'
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? '调整左侧栏宽度' : '调整右侧栏宽度'}
      onMouseDown={onMouseDown}
      className="group relative z-20 w-1.5 shrink-0 cursor-col-resize bg-transparent"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10 transition group-hover:bg-cyan-300/50" />
    </div>
  )
}
