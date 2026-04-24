import { create } from 'zustand'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  streaming?: boolean
  tone?: 'default' | 'muted' | 'error'
  label?: string
}

interface ChatStore {
  messages: Message[]
  draft: string
  activeAssistantId: string | null
  connectionLabel: string
  setDraft: (draft: string) => void
  addMessage: (message: Message) => void
  setActiveAssistant: (id: string | null) => void
  touchAssistantMessage: (id?: string | null) => string | null
  appendChunk: (id: string, chunk: string) => void
  replaceMessage: (id: string, content: string) => void
  finalizeMessage: (id: string) => void
  setConnectionLabel: (label: string) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Hermes Desktop shell is ready. Start with a task, repo question, or workspace command.',
      label: 'ready',
    },
  ],
  draft: '',
  activeAssistantId: null,
  connectionLabel: 'Idle',
  setDraft: (draft) => set({ draft }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setActiveAssistant: (id) => set({ activeAssistantId: id }),
  touchAssistantMessage: (id) => {
    let resolvedId: string | null = null

    set((state) => {
      const fallbackId = id ?? state.activeAssistantId
      if (!fallbackId) {
        return state
      }

      const existing = state.messages.find((message) => message.id === fallbackId)
      resolvedId = fallbackId

      if (existing) {
        return {
          messages: state.messages.map((message) =>
            message.id === fallbackId
              ? { ...message, streaming: true, tone: message.tone ?? 'default' }
              : message,
          ),
          activeAssistantId: fallbackId,
        }
      }

      return {
        messages: [
          ...state.messages,
          {
            id: fallbackId,
            role: 'assistant',
            content: '',
            streaming: true,
            tone: 'default',
            label: 'live',
          },
        ],
        activeAssistantId: fallbackId,
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
              label: 'live',
            }
          : message,
      ),
    })),
  replaceMessage: (id, content) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id ? { ...message, content, streaming: true, label: 'live' } : message,
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
