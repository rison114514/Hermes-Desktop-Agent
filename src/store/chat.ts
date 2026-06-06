import { create } from 'zustand'
import type { HermesPermissionRequest } from '../../electron/hermes-bridge'

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
  allMessages: Record<string, Message[]>
  draft: string
  activeAssistantId: string | null
  activeSessionId: string
  connectionLabel: string
  permissionRequests: HermesPermissionRequest[]
  setDraft: (draft: string) => void
  setActiveSession: (id: string) => void
  addMessage: (message: Message, sessionId?: string) => void
  addPermissionRequest: (request: HermesPermissionRequest) => void
  removePermissionRequest: (requestId: string) => void
  upsertToolMessage: (toolMessage: ToolCallState, sessionId?: string) => void
  setActiveAssistant: (id: string | null) => void
  touchAssistantMessage: (id?: string | null, sessionId?: string) => string | null
  appendChunk: (id: string, chunk: string, sessionId?: string) => void
  replaceMessage: (id: string, content: string, sessionId?: string) => void
  finalizeMessage: (id: string, sessionId?: string) => void
  setConnectionLabel: (label: string) => void
  addSessionMarker: (label: string, sessionId?: string) => void
  resetForSession: (label: string, sessionId?: string) => void
}

function sessionMessages(state: ChatStore, sessionId?: string): Message[] {
  const sid = sessionId || state.activeSessionId || 'default'
  return state.allMessages[sid] || []
}

function updateAllMessages(
  state: ChatStore,
  sessionId: string | undefined,
  fn: (msgs: Message[]) => Message[],
): Record<string, Message[]> {
  const sid = sessionId || state.activeSessionId || 'default'
  return { ...state.allMessages, [sid]: fn(sessionMessages(state, sid)) }
}

// Sync messages field after allMessages update for active session
function syncAfterUpdate(
  state: ChatStore,
  sessionId: string | undefined,
  allMessages: Record<string, Message[]>,
): { messages: Message[]; allMessages: Record<string, Message[]> } {
  const sid = sessionId || state.activeSessionId || 'default'
  return {
    allMessages,
    messages: sid === state.activeSessionId ? (allMessages[sid] || []) : state.messages,
  }
}

function warmWelcome(): Message[] {
  return [{ id: 'welcome', role: 'assistant' as const, content: 'Hermes 桌面助手已就绪。', label: '已就绪', kind: 'text' as const }]
}

function upsertTool(tools: ToolCallState[] | undefined, toolMessage: ToolCallState) {
  const nextTools = [...(tools ?? [])]
  const idx = nextTools.findIndex((t) => (toolMessage.callId ? t.callId === toolMessage.callId : t.toolName === toolMessage.toolName))
  if (idx === -1) return [...nextTools, toolMessage]
  nextTools[idx] = { ...nextTools[idx], ...toolMessage }
  return nextTools
}

// Anchor every tool call from one turn onto the FIRST assistant bubble of that
// turn (the run of messages after the most recent user message). This merges a
// multi-step turn's tool calls into a single folded shelf instead of producing
// one "Tool calls (1)" bubble per step, so the assistant's text stays easy to find.
function findToolHost(messages: Message[], activeId: string | null) {
  let lastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break }
  }
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'assistant' && m.id !== 'welcome') return m.id
  }
  // No assistant bubble exists yet this turn (e.g. a tool fired before any
  // assistant text): only reuse the active bubble if it belongs to this turn,
  // otherwise return null so a fresh in-turn tool host is created.
  if (activeId) {
    const idx = messages.findIndex((m) => m.id === activeId)
    if (idx > lastUserIdx) return activeId
  }
  return null
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: warmWelcome(),
  allMessages: { default: warmWelcome() },
  draft: '',
  activeAssistantId: null,
  activeSessionId: 'default',
  connectionLabel: '空闲',
  permissionRequests: [],

  setDraft: (draft) => set({ draft }),

  setActiveSession: (id) =>
    set((state) => {
      const sid = id || 'default'
      if (!state.allMessages[sid]) state.allMessages[sid] = warmWelcome()
      // Do NOT clear permissionRequests here: a background tab may have a
      // pending prompt that must survive tab switches. ChatPanel filters the
      // list down to the active session for display.
      return { activeSessionId: sid, messages: state.allMessages[sid], activeAssistantId: null }
    }),

  addMessage: (message, sessionId) =>
    set((state) => syncAfterUpdate(state, sessionId,
      updateAllMessages(state, sessionId, (msgs) => [...msgs, { kind: 'text' as const, ...message }]),
    )),

  addPermissionRequest: (request) =>
    set((state) => ({
      permissionRequests: [...state.permissionRequests.filter((r) => r.requestId !== request.requestId), request],
    })),

  removePermissionRequest: (requestId) =>
    set((state) => ({ permissionRequests: state.permissionRequests.filter((r) => r.requestId !== requestId) })),

  upsertToolMessage: (toolMessage, sessionId) =>
    set((state) => {
      const msgs = sessionMessages(state, sessionId)
      const nt = { ...toolMessage, updatedAt: toolMessage.updatedAt ?? Date.now() }
      const target = findToolHost(msgs, state.activeAssistantId)
      const updated = updateAllMessages(state, sessionId, (m) =>
        target
          ? m.map((msg) => (msg.id === target ? { ...msg, tools: upsertTool(msg.tools, nt) } : msg))
          : [...m, { id: `at-${Date.now()}`, role: 'assistant' as const, content: '', tone: 'muted' as const, label: 'Tool', kind: 'text' as const, tools: [nt] }],
      )
      return syncAfterUpdate(state, sessionId, updated)
    }),

  setActiveAssistant: (id) => set({ activeAssistantId: id }),

  touchAssistantMessage: (id, sessionId) => {
    let resolved: string | null = null
    set((state) => {
      const msgs = sessionMessages(state, sessionId)
      const nextId = id ?? state.activeAssistantId ?? `asst-${Date.now()}`
      const exists = msgs.find((m) => m.id === nextId)
      resolved = nextId
      const updated = updateAllMessages(state, sessionId, (m) =>
        exists
          ? m.map((msg) => (msg.id === nextId ? { ...msg, streaming: true, tone: msg.tone ?? 'default' as const } : msg))
          : [...m, { id: nextId, role: 'assistant' as const, content: '', streaming: true, tone: 'default' as const, label: '进行中', kind: 'text' as const }],
      )
      return { ...syncAfterUpdate(state, sessionId, updated), activeAssistantId: nextId }
    })
    return resolved
  },

  appendChunk: (id, chunk, sessionId) =>
    set((state) => syncAfterUpdate(state, sessionId,
      updateAllMessages(state, sessionId, (msgs) =>
        msgs.map((m) => (m.id === id ? { ...m, content: m.content + chunk, streaming: true, tone: m.tone ?? 'default' as const, label: '进行中' } : m)),
      ),
    )),

  replaceMessage: (id, content, sessionId) =>
    set((state) => syncAfterUpdate(state, sessionId,
      updateAllMessages(state, sessionId, (msgs) =>
        msgs.map((m) => (m.id === id ? { ...m, content, streaming: true, label: '进行中' } : m)),
      ),
    )),

  finalizeMessage: (id, sessionId) =>
    set((state) => ({
      ...syncAfterUpdate(state, sessionId,
        updateAllMessages(state, sessionId, (msgs) =>
          msgs.map((m) => (m.id === id ? { ...m, streaming: false, label: undefined } : m)),
        ),
      ),
      activeAssistantId: state.activeAssistantId === id ? null : state.activeAssistantId,
    })),

  setConnectionLabel: (label) => set({ connectionLabel: label }),

  addSessionMarker: (label, sessionId) =>
    set((state) => {
      const sid = sessionId || state.activeSessionId || 'default'
      const msgs = (state.allMessages[sid] || []).map((m) =>
        m.streaming ? { ...m, streaming: false, label: undefined } : m,
      )
      msgs.push({ id: `sm-${Date.now()}`, role: 'system' as const, content: label, tone: 'muted' as const, label: 'Session', kind: 'text' as const })
      return { allMessages: { ...state.allMessages, [sid]: msgs } }
    }),

  resetForSession: (label, sessionId) =>
    set((state) => {
      const sid = sessionId || state.activeSessionId || 'default'
      return { allMessages: { ...state.allMessages, [sid]: [{ id: `rs-${Date.now()}`, role: 'system' as const, content: label, tone: 'muted' as const, label: 'Session', kind: 'text' as const }] } }
    }),
}))
