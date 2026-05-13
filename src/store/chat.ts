import { create } from 'zustand'

export interface ToolCallState {
  toolName: string
  callId?: string
  args?: string
  result?: string
  status: 'running' | 'completed'
  updatedAt?: number
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
  tools?: ToolCallState[]
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
  addSessionMarker: (label: string) => void
  resetForSession: (label: string) => void
}

function upsertTool(tools: ToolCallState[] | undefined, toolMessage: ToolCallState) {
  const nextTools = [...(tools ?? [])]
  const existingIndex = nextTools.findIndex((tool) =>
    toolMessage.callId ? tool.callId === toolMessage.callId : tool.toolName === toolMessage.toolName,
  )

  if (existingIndex === -1) {
    return [...nextTools, toolMessage]
  }

  nextTools[existingIndex] = {
    ...nextTools[existingIndex],
    ...toolMessage,
  }

  return nextTools
}

function findToolHostMessageId(messages: Message[], activeAssistantId: string | null) {
  if (activeAssistantId && messages.some((message) => message.id === activeAssistantId)) {
    return activeAssistantId
  }

  const streamingAssistant = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.streaming)
  if (streamingAssistant) {
    return streamingAssistant.id
  }

  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.id !== 'welcome')

  return latestAssistant?.id ?? null
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
      const normalizedTool = {
        ...toolMessage,
        updatedAt: toolMessage.updatedAt ?? Date.now(),
      }
      const targetAssistantId = findToolHostMessageId(state.messages, state.activeAssistantId)

      if (targetAssistantId) {
        return {
          messages: state.messages.map((message) =>
            message.id === targetAssistantId
              ? {
                  ...message,
                  tools: upsertTool(message.tools, normalizedTool),
                }
              : message,
          ),
        }
      }

      return {
        messages: [
          ...state.messages,
          {
            id: `assistant-tools-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: 'assistant',
            content: '',
            tone: 'muted',
            label: 'Tool activity',
            kind: 'text',
            tools: [normalizedTool],
          },
        ],
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
  addSessionMarker: (label) =>
    set((state) => ({
      messages: [
        ...state.messages.map((message) =>
          message.streaming ? { ...message, streaming: false, label: undefined } : message,
        ),
        {
          id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'system',
          content: label,
          tone: 'muted',
          label: 'Session',
          kind: 'text',
        },
      ],
      draft: '',
      activeAssistantId: null,
      connectionLabel: 'Ready',
    })),
  resetForSession: (label) =>
    set({
      messages: [
        {
          id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'system',
          content: label,
          tone: 'muted',
          label: 'Session',
          kind: 'text',
        },
      ],
      draft: '',
      activeAssistantId: null,
      connectionLabel: 'Ready',
    }),
}))
