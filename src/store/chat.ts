import { create } from 'zustand'

export interface ToolCallState {
  toolName: string
  callId?: string
  args?: string
  result?: string
  status: 'running' | 'completed'
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  streaming?: boolean
  tone?: 'default' | 'muted' | 'error'
  label?: string
  kind?: 'text' | 'tool'
  tool?: ToolCallState
}

interface ChatStore {
  messages: Message[]
  draft: string
  activeAssistantId: string | null
  connectionLabel: string
  setDraft: (draft: string) => void
  addMessage: (message: Message) => void
  upsertToolMessage: (toolMessage: ToolCallState) => void
  setActiveAssistant: (id: string | null) => void
  touchAssistantMessage: (id?: string | null) => string | null
  appendChunk: (id: string, chunk: string) => void
  replaceMessage: (id: string, content: string) => void
  finalizeMessage: (id: string) => void
  setConnectionLabel: (label: string) => void
}

function createToolSummary(tool: ToolCallState) {
  if (tool.status === 'completed') {
    return `工具 ${tool.toolName} 已完成。`
  }

  return `工具 ${tool.toolName} 调用中...`
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hermes 桌面助手已就绪。你可以直接描述代码任务、仓库问题，或让它分析当前工作区。',
      label: '已就绪',
      kind: 'text',
    },
  ],
  draft: '',
  activeAssistantId: null,
  connectionLabel: '空闲',
  setDraft: (draft) => set({ draft }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, { kind: 'text', ...message }] })),
  upsertToolMessage: (toolMessage) =>
    set((state) => {
      const messageId = `tool-${toolMessage.callId ?? toolMessage.toolName}`
      const existing = state.messages.find((message) => message.id === messageId)
      const nextMessage: Message = {
        id: messageId,
        role: 'system',
        content: createToolSummary(toolMessage),
        tone: 'muted',
        label: toolMessage.status === 'completed' ? '工具结果' : '工具调用',
        kind: 'tool',
        tool: toolMessage,
      }

      if (!existing) {
        return { messages: [...state.messages, nextMessage] }
      }

      return {
        messages: state.messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                ...nextMessage,
                tool: {
                  ...message.tool,
                  ...toolMessage,
                },
                content: createToolSummary({ ...(message.tool ?? {}), ...toolMessage, toolName: toolMessage.toolName, status: toolMessage.status } as ToolCallState),
              }
            : message,
        ),
      }
    }),
  setActiveAssistant: (id) => set({ activeAssistantId: id }),
  touchAssistantMessage: (id) => {
    let resolvedId: string | null = null

    set((state) => {
      const fallbackId = id ?? state.activeAssistantId
      const nextId = fallbackId ?? `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      const existing = state.messages.find((message) => message.id === nextId)
      resolvedId = nextId

      if (existing) {
        return {
          messages: state.messages.map((message) =>
            message.id === nextId
              ? { ...message, streaming: true, tone: message.tone ?? 'default' }
              : message,
          ),
          activeAssistantId: nextId,
        }
      }

      return {
        messages: [
          ...state.messages,
          {
            id: nextId,
            role: 'assistant',
            content: '',
            streaming: true,
            tone: 'default',
            label: '进行中',
            kind: 'text',
          },
        ],
        activeAssistantId: nextId,
      }
    })

    return resolvedId
  },
  appendChunk: (id, chunk) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id
          ? {
              ...message,
              content: `${message.content}${chunk}`,
              streaming: true,
              tone: message.tone ?? 'default',
              label: '进行中',
            }
          : message,
      ),
    })),
  replaceMessage: (id, content) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, content, streaming: true, label: '进行中' } : message,
      ),
    })),
  finalizeMessage: (id) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, streaming: false, label: undefined } : message,
      ),
      activeAssistantId: state.activeAssistantId === id ? null : state.activeAssistantId,
    })),
  setConnectionLabel: (label) => set({ connectionLabel: label }),
}))
