import { ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { normalizeMaybeText } from './text-normalization.js'
import { createUtf8ProcessEnv } from './wsl-paths.js'
import { getBackendProvider, type BackendProvider, type ProxyConfig } from './backend.js'

export type HermesBridgeEvent =
  | { type: 'status'; payload: { stage: string; detail: string } }
  | { type: 'user:message'; payload: { id?: string; text: string; replay?: boolean } }
  | { type: 'assistant:start'; payload: { id?: string; model?: string } }
  | { type: 'assistant:delta'; payload: { id?: string; delta: string } }
  | { type: 'assistant:done'; payload: { id?: string; reason?: string; text?: string } }
  | { type: 'tool'; payload: { id?: string; name: string; args?: string; result?: string; status: 'running' | 'completed' } }
  | { type: 'permission:request'; payload: HermesPermissionRequest }
  | { type: 'commands'; payload: HermesCommandInfo[] }
  | { type: 'stderr'; payload: string }
  | { type: 'raw'; payload: unknown }
  | { type: 'workspace:snapshot'; payload: unknown }
  | { type: 'mods:ready' }
  | { type: 'todo:updated' }
  | { type: 'exit'; payload: { code: number | null } }

export type HermesSessionInfo = {
  sessionId: string
  cwd: string
  title?: string
  updatedAt?: string
}

export type HermesCommandInfo = {
  id: string
  name: string
  description: string
}

export type HermesPermissionOutcome =
  | { outcome: { outcome: 'selected'; option_id: string } }
  | { outcome: { outcome: 'cancelled' } }

export type HermesPermissionHandler = (payload: unknown) => Promise<HermesPermissionOutcome> | HermesPermissionOutcome

export type HermesPermissionOption = {
  optionId: string
  name: string
  kind?: string
}

export type HermesPermissionRequest = {
  requestId: string
  sessionId?: string
  toolCallId?: string
  title: string
  description?: string
  command?: string
  toolKind?: string
  options: HermesPermissionOption[]
  detail: string
}

type JsonRpcMessage = {
  jsonrpc?: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout?: NodeJS.Timeout
}

type HistoryTurn =
  | { role: 'user'; id: string; text: string }
  | { role: 'assistant'; id: string; text: string; tools: Array<HermesBridgeEvent & { type: 'tool' }> }

const HERMES_DIAGNOSTIC_PREVIEW_CHARS = 20_000

export class HermesBridge extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private nextRequestId = 1
  private pending = new Map<number | string, PendingRequest>()
  private sessionId: string | null = null
  private startPromise: Promise<void> | null = null
  private activeMessageIds = new Set<string>()
  private promptInFlight = false
  private loadingSessionHistory = false
  private historyTurns: HistoryTurn[] = []
  private historyTurnCounter = 0
  private historyFlushTimer: NodeJS.Timeout | null = null
  private historyMaxTimeout: NodeJS.Timeout | null = null
  private stderrBuffer: string[] = []
  private recentStderrLines: string[] = []
  private stderrFlushTimer: NodeJS.Timeout | null = null
  private workspacePath = process.cwd()
  private permissionHandler: HermesPermissionHandler | null = null
  private promptCancelRequested = false
  private cachedCommands: HermesCommandInfo[] = []
  private proxyConfig: ProxyConfig | null = null
  private backend: BackendProvider | null = null
  private stopGeneration = 0

  getWorkspacePath() {
    return this.workspacePath
  }

  /** Sync workspace path BEFORE starting — avoids unnecessary stop/restart cycle. */
  initWorkspacePath(workspacePath: string) {
    if (!this.process) {
      this.workspacePath = workspacePath
    }
  }

  setProxyConfig(config: ProxyConfig | null) {
    this.proxyConfig = config
  }

  setPermissionHandler(handler: HermesPermissionHandler | null) {
    this.permissionHandler = handler
  }

  getSessionId() {
    return this.sessionId
  }

  getCachedCommands(): HermesCommandInfo[] {
    return this.cachedCommands
  }

  async switchWorkspace(workspacePath: string) {
    if (workspacePath === this.workspacePath) {
      return
    }

    this.workspacePath = workspacePath
    this.stop()
    this.emitEvent({
      type: 'status',
      payload: { stage: 'workspace', detail: `Workspace switched to ${workspacePath}` },
    })
  }

  /** Soft workspace switch — updates path WITHOUT killing the ACP process.
   *  Use this when the user wants to change workspace but keep the conversation
   *  context alive.  The next sendMessage call will still use the active ACP
   *  session; the model has shell access and can navigate to the new directory. */
  updateWorkspace(workspacePath: string) {
    if (workspacePath === this.workspacePath) return

    this.workspacePath = workspacePath
    this.emitEvent({
      type: 'status',
      payload: { stage: 'workspace', detail: `Workspace updated to ${workspacePath} (session preserved)` },
    })
  }

  async start() {
    await this.ensureBackend()
    await this.ensureSession()
  }

  async sendMessage(text: string) {
    const message = text.trim()
    if (!message) {
      return
    }

    await this.start()

    if (!this.sessionId) {
      throw new Error('Hermes ACP session is not ready.')
    }

    this.promptInFlight = true
    this.promptCancelRequested = false
    this.emitEvent({
      type: 'status',
      payload: { stage: 'queued', detail: 'Message queued through ACP.' },
    })

    try {
      // No timeout: a turn can block arbitrarily long while the agent waits for a
      // human permission decision. A client-side timeout here would abandon the
      // turn mid-approval and surface as a spurious auto-deny. The turn ends only
      // when Hermes replies or the user explicitly cancels (cancelActivePrompt).
      const result = await this.sendRequest('session/prompt', {
        sessionId: this.sessionId,
        messageId: randomUUID(),
        prompt: [{ type: 'text', text: message }],
      }, 0)

      if (!this.promptCancelRequested) {
        const stopReason = this.readString(result, 'stopReason') ?? this.readString(result, 'stop_reason') ?? 'end_turn'
        this.emitEvent({
          type: 'assistant:done',
          payload: { reason: stopReason },
        })
      }
    } finally {
      this.promptInFlight = false
      this.promptCancelRequested = false
    }
  }

  async cancelActivePrompt() {
    if (!this.promptInFlight) {
      return { ok: true, cancelled: false }
    }

    this.promptCancelRequested = true
    this.emitEvent({
      type: 'status',
      payload: { stage: 'cancelling', detail: 'Cancelling current Hermes turn.' },
    })

    if (this.process && this.sessionId) {
      try {
        await this.sendRequest('session/cancel', { sessionId: this.sessionId }, 5_000)
      } catch {
        this.stop()
      }
    } else {
      this.stop()
    }

    this.emitEvent({
      type: 'assistant:done',
      payload: { reason: 'cancelled', text: '已终止本轮对话。' },
    })

    return { ok: true, cancelled: true }
  }

  async listSessions(): Promise<HermesSessionInfo[]> {
    await this.ensureBackend()

    const sessions: HermesSessionInfo[] = []
    let cursor: string | null = null

    do {
      const result = await this.sendRequest('session/list', cursor ? { cursor } : {})
      const page = this.readSessionPage(result)
      sessions.push(...page.sessions)
      cursor = page.nextCursor
    } while (cursor)

    return sessions
  }

  async loadSession(sessionId: string, workspacePath: string) {
    await this.switchWorkspace(workspacePath)
    await this.ensureBackend()

    const cwd = this.backend!.toBackendPath(this.workspacePath)
    this.clearHistoryReplay()
    this.loadingSessionHistory = true
    this.historyTurns = []
    this.historyTurnCounter = 0
    let result: unknown
    result = await this.sendRequest('session/load', {
      cwd,
      sessionId,
      mcpServers: [],
    })

    if (result === null || result === undefined) {
      throw new Error(`Hermes could not load session ${sessionId}.`)
    }

    this.emitEvent({
      type: 'raw',
      payload: createDiagnosticPayload('session/load', result, { sessionId }),
    })

    this.sessionId = sessionId
    this.activeMessageIds.clear()
    this.scheduleHistoryFlush(3000)
    this.historyMaxTimeout = setTimeout(() => {
      if (this.loadingSessionHistory && this.historyTurns.length > 0) {
        console.warn('[hermes] history flush max timeout reached, forcing flush with', this.historyTurns.length, 'turns')
        this.flushHistoryTurns()
      }
    }, 10000)
  }

  async startNewSession(workspacePath?: string) {
    if (this.promptInFlight) {
      throw new Error('Cancel the current Hermes turn before starting a new session.')
    }

    if (workspacePath) {
      await this.switchWorkspace(workspacePath)
    }

    await this.ensureBackend()
    this.clearHistoryReplay()
    this.sessionId = null
    this.activeMessageIds.clear()
    await this.ensureSession()
  }

  stop() {
    this.stopGeneration += 1
    this.clearHistoryReplay()
    if (this.stderrFlushTimer) {
      clearTimeout(this.stderrFlushTimer)
      this.stderrFlushTimer = null
    }
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Hermes ACP backend stopped.'))
      this.pending.delete(id)
    }

    const child = this.process
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM')
      } catch {
        // Process may already be gone.
      }

      const forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL') } catch { /* noop */ }
        }
      }, 1500)
      forceKillTimer.unref?.()
    }

    this.process = null
    this.stdoutBuffer = ''
    this.sessionId = null
    this.startPromise = null
    this.activeMessageIds.clear()
    this.promptInFlight = false
    this.promptCancelRequested = false
  }

  private async ensureBackend() {
    if (this.startPromise) {
      return this.startPromise
    }

    this.startPromise = this.startBackend()
    return this.startPromise
  }

  private async ensureSession() {
    if (this.sessionId) {
      return
    }

    const cwd = this.backend!.toBackendPath(this.workspacePath)
    const session = await this.sendRequest('session/new', {
      cwd,
      mcpServers: [],
    })

    this.sessionId = this.readString(session, 'sessionId') ?? this.readString(session, 'session_id')

    if (!this.sessionId) {
      throw new Error('Hermes ACP did not return sessionId.')
    }

    this.emitEvent({
      type: 'status',
      payload: { stage: 'ready', detail: `Hermes ACP session ready: ${this.sessionId}` },
    })
  }

  private async startBackend() {
    if (this.process) {
      return
    }

    const startGeneration = this.stopGeneration

    if (!this.backend) {
      this.backend = getBackendProvider()
    }

    const backendType = this.backend.type

    this.emitEvent({
      type: 'status',
      payload: { stage: 'checking-backend', detail: `Checking Hermes (${backendType} backend).` },
    })

    try {
      await this.backend.ensureHermesInstalled(this.proxyConfig)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Hermes is not available (${backendType} backend). ${detail}`)
    }

    if (startGeneration !== this.stopGeneration) {
      throw new Error('Hermes ACP backend stopped.')
    }

    const child = await this.backend.spawnAcp(this.workspacePath, this.proxyConfig)
    if (startGeneration !== this.stopGeneration) {
      try { child.kill('SIGTERM') } catch { /* noop */ }
      throw new Error('Hermes ACP backend stopped.')
    }
    this.process = child

    this.emitEvent({
      type: 'status',
      payload: {
        stage: 'boot',
        detail: `Starting Hermes ACP (${backendType} backend).`,
      },
    })

    child.stdout.on('data', (chunk: Buffer) => {
      if (this.process !== child) {
        return
      }
      this.stdoutBuffer += chunk.toString('utf8')
      this.flushStdout()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      if (this.process !== child) {
        return
      }
      const lines = chunk.toString('utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      if (lines.length === 0) return

      this.stderrBuffer.push(...lines)
      this.recentStderrLines.push(...lines)
      if (this.recentStderrLines.length > 20) {
        this.recentStderrLines = this.recentStderrLines.slice(-20)
      }

      if (this.stderrFlushTimer) {
        clearTimeout(this.stderrFlushTimer)
      }
      this.stderrFlushTimer = setTimeout(() => {
        this.stderrFlushTimer = null
        this.flushStderr()
      }, 100)
    })

    child.on('close', (code) => {
      if (this.process !== child) {
        return
      }

      this.emitEvent({ type: 'exit', payload: { code } })
      this.process = null
      this.stdoutBuffer = ''
      this.sessionId = null
      this.startPromise = null
      this.activeMessageIds.clear()
      this.flushStderr()
      const recentStderr = this.recentStderrLines.join('\n').trim()
      this.recentStderrLines = []

      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout)
        pending.reject(new Error(
          `Hermes ACP backend exited${code === null ? '' : ` with code ${code}`}.${recentStderr ? `\n${recentStderr}` : ''}`,
        ))
        this.pending.delete(id)
      }
    })

    child.on('error', (error) => {
      if (this.process !== child) {
        return
      }
      this.emitEvent({ type: 'stderr', payload: error.message })
    })

    const init = await this.sendRequest('initialize', {
      protocolVersion: 1,
      clientInfo: {
        name: 'hermes-desktop-agent',
        version: '0.1.0',
      },
      clientCapabilities: {
        terminal: false,
        fs: {
          readTextFile: false,
          writeTextFile: false,
        },
        auth: {
          terminal: false,
        },
      },
    })

    const initCommands = extractAvailableCommands(init as Record<string, unknown>)
    if (initCommands.length > 0) {
      this.cachedCommands = initCommands
      this.emitEvent({ type: 'commands', payload: initCommands })
    }

    const model = this.extractCurrentModel(init)
    this.emitEvent({
      type: 'status',
      payload: {
        stage: 'initialized',
        detail: model ? `Hermes ACP initialized with ${model}.` : 'Hermes ACP initialized.',
      },
    })
  }

  // Pass timeoutMs <= 0 (or non-finite) for requests that must wait indefinitely,
  // e.g. session/prompt, which can legitimately block for a long time while the
  // agent waits on a human permission decision (session/request_permission).
  private sendRequest(method: string, params: unknown, timeoutMs = 30_000) {
    if (!this.process) {
      return Promise.reject(new Error('Hermes ACP backend has not started.'))
    }

    const id = this.nextRequestId++
    const payload = { jsonrpc: '2.0', id, method, params }

    return new Promise<unknown>((resolve, reject) => {
      const timeout = timeoutMs > 0 && Number.isFinite(timeoutMs)
        ? setTimeout(() => {
            this.pending.delete(id)
            reject(new Error(`ACP request timed out: ${method}`))
          }, timeoutMs)
        : undefined

      this.pending.set(id, { resolve, reject, timeout })
      this.process?.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8')
    })
  }

  private sendResponse(id: number | string, result: unknown) {
    this.process?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`, 'utf8')
  }

  private sendError(id: number | string, message: string) {
    this.process?.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message },
    })}\n`, 'utf8')
  }

  private flushStdout() {
    while (this.stdoutBuffer) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n')
      if (newlineIndex === -1) {
        break
      }

      const rawLine = this.stdoutBuffer.slice(0, newlineIndex)
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)

      const line = rawLine.trim()
      if (!line) {
        continue
      }

      try {
        this.handleJsonRpcMessage(JSON.parse(line) as JsonRpcMessage)
      } catch {
        this.emitEvent({ type: 'raw', payload: line })
      }
    }
  }

  private handleJsonRpcMessage(message: JsonRpcMessage) {
    if (message.id !== undefined && !message.method) {
      this.handleResponse(message)
      return
    }

    if (message.method) {
      void this.handleRequestOrNotification(message)
      return
    }

    this.emitEvent({ type: 'raw', payload: message })
  }

  private handleResponse(message: JsonRpcMessage) {
    const id = message.id
    if (id === undefined) {
      return
    }

    const pending = this.pending.get(id)
    if (!pending) {
      return
    }

    clearTimeout(pending.timeout)
    this.pending.delete(id)

    if (message.error) {
      const messageText = message.error.message ?? 'ACP request failed'
      const detailText = extractErrorDetails(message.error.data)
      pending.reject(new Error(detailText && detailText !== messageText ? `${messageText}\n${detailText}` : messageText))
      return
    }

    pending.resolve(message.result)
  }

  private flushStderr() {
    const lines = this.stderrBuffer
    this.stderrBuffer = []

    if (lines.length === 0) return

    const filtered: string[] = []
    const warnings: string[] = []

    for (const line of lines) {
      if (/\s\[INFO\]\s/.test(line) || /\s\[DEBUG\]\s/.test(line)) {
        continue
      }

      if (/\s\[WARNING\]\s/.test(line)) {
        warnings.push(line)
        continue
      }

      if (isStatusLine(line)) {
        continue
      }

      filtered.push(line)
    }

    for (const warn of warnings) {
      this.emitEvent({
        type: 'status',
        payload: { stage: 'backend-warning', detail: warn },
      })
    }

    if (filtered.length > 0) {
      const payload = normalizeMaybeText(filtered.join('\n'), 'stderr') ?? filtered.join('\n')
      this.emitEvent({ type: 'stderr', payload })
    }
  }

  private async handleRequestOrNotification(message: JsonRpcMessage) {
    const method = message.method
    if (!method) {
      return
    }

    try {
      if (method === 'session/update') {
        this.handleSessionUpdate(message.params)
        return
      }

      if (method === 'session/request_permission') {
        if (message.id !== undefined) {
          this.sendResponse(message.id, await this.resolvePermissionRequest(message.params))
        }
        return
      }

      if (method.startsWith('terminal/')) {
        if (message.id !== undefined) {
          this.sendResponse(message.id, null)
        }
        return
      }

      if (method === 'fs/read_text_file' || method === 'fs/write_text_file') {
        if (message.id !== undefined) {
          this.sendError(message.id, 'Hermes Desktop Agent does not expose ACP filesystem proxying yet.')
        }
        return
      }

      this.emitEvent({ type: 'raw', payload: message })

      if (message.id !== undefined) {
        this.sendResponse(message.id, null)
      }
    } catch (error) {
      if (message.id !== undefined) {
        this.sendError(message.id, error instanceof Error ? error.message : 'ACP client handler failed')
      }
    }
  }

  private async resolvePermissionRequest(payload: unknown): Promise<HermesPermissionOutcome> {
    if (!this.permissionHandler) {
      return { outcome: { outcome: 'cancelled' } }
    }

    try {
      return await this.permissionHandler(payload)
    } catch (error) {
      this.emitEvent({
        type: 'status',
        payload: {
          stage: 'permission-error',
          detail: error instanceof Error ? error.message : 'Permission request failed.',
        },
      })
      return { outcome: { outcome: 'cancelled' } }
    }
  }

  private handleSessionUpdate(payload: unknown) {
    if (!payload || typeof payload !== 'object') {
      return
    }

    const record = payload as Record<string, unknown>
    const update = record.update
    if (!update || typeof update !== 'object') {
      return
    }

    const updateRecord = update as Record<string, unknown>
    const kind = this.readString(updateRecord, 'sessionUpdate') ?? this.readString(updateRecord, 'session_update')

    if (kind === 'user_message_chunk') {
      const messageId = this.readString(updateRecord, 'messageId') ?? this.readString(updateRecord, 'message_id') ?? undefined
      const text = normalizeMaybeText(extractAcpText(updateRecord.content) ?? undefined, 'assistant')
      if (text) {
        if (this.isReplayMode()) {
          this.pushHistoryUserTurn(messageId, text)
          this.scheduleHistoryFlush()
          return
        }

        this.emitEvent({
          type: 'user:message',
          payload: { id: messageId, text },
        })
      }
      return
    }

    if (kind === 'agent_message_chunk') {
      const messageId = this.readString(updateRecord, 'messageId') ?? this.readString(updateRecord, 'message_id') ?? undefined
      const delta = normalizeMaybeText(extractAcpText(updateRecord.content) ?? undefined, 'assistant')
      if (!delta) {
        return
      }

      if (this.isReplayMode()) {
        this.pushHistoryAssistantChunk(messageId, delta)
        this.scheduleHistoryFlush()
        return
      }

      if (messageId && !this.activeMessageIds.has(messageId)) {
        this.activeMessageIds.add(messageId)
        this.emitEvent({ type: 'assistant:start', payload: { id: messageId } })
      }

      this.emitEvent({
        type: 'assistant:delta',
        payload: { id: messageId, delta },
      })
      return
    }

    if (kind === 'agent_thought_chunk') {
      const delta = normalizeMaybeText(extractAcpText(updateRecord.content) ?? undefined, 'assistant')
      if (delta) {
        this.emitEvent({ type: 'status', payload: { stage: 'thinking', detail: delta } })
      }
      return
    }

    if (kind === 'tool_call') {
      const event: HermesBridgeEvent = {
        type: 'tool',
        payload: {
          id: this.readString(updateRecord, 'toolCallId') ?? this.readString(updateRecord, 'tool_call_id') ?? undefined,
          name: this.readString(updateRecord, 'title') ?? this.readString(updateRecord, 'kind') ?? 'tool',
          args: normalizeMaybeText(stringifyMaybe(updateRecord.rawInput), 'tool-args'),
          status: 'running',
        },
      }
      if (this.isReplayMode()) {
        this.pushHistoryTool(event)
        this.scheduleHistoryFlush()
        return
      }

      this.emitEvent(event)
      return
    }

    if (kind === 'tool_call_update') {
      const event: HermesBridgeEvent = {
        type: 'tool',
        payload: {
          id: this.readString(updateRecord, 'toolCallId') ?? this.readString(updateRecord, 'tool_call_id') ?? undefined,
          name: this.readString(updateRecord, 'title') ?? this.readString(updateRecord, 'kind') ?? 'tool',
          args: normalizeMaybeText(stringifyMaybe(updateRecord.rawInput), 'tool-args'),
          result: normalizeMaybeText(stringifyMaybe(updateRecord.rawOutput) ?? extractToolContent(updateRecord.content), 'tool-result'),
          status: 'completed',
        },
      }
      if (this.isReplayMode()) {
        this.pushHistoryTool(event)
        this.scheduleHistoryFlush()
        return
      }

      this.emitEvent(event)
      return
    }

    if (kind === 'available_commands_update') {
      this.cachedCommands = extractAvailableCommands(updateRecord)
      this.emitEvent({ type: 'commands', payload: this.cachedCommands })
      return
    }

    if (kind === 'usage_update') {
      return
    }

    // Log unknown session update kinds to diagnose missing messages
    if (kind) {
      console.warn('[hermes] unknown session update kind:', kind, 'keys:', Object.keys(updateRecord).slice(0, 5))
    }

    this.emitEvent({
      type: 'raw',
      payload: createDiagnosticPayload('session/update', payload, { kind: kind ?? 'unknown' }),
    })
  }

  private readSessionPage(payload: unknown) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const rawSessions = Array.isArray(record.sessions) ? record.sessions : []
    const sessions = rawSessions
      .map((item): HermesSessionInfo | null => {
        if (!item || typeof item !== 'object') {
          return null
        }

        const row = item as Record<string, unknown>
        const sessionId = this.readString(row, 'sessionId') ?? this.readString(row, 'session_id')
        const cwd = this.readString(row, 'cwd')
        if (!sessionId || !cwd) {
          return null
        }

        return {
          sessionId,
          cwd,
          title: this.readString(row, 'title') ?? undefined,
          updatedAt: this.readString(row, 'updatedAt') ?? this.readString(row, 'updated_at') ?? undefined,
        }
      })
      .filter((item): item is HermesSessionInfo => Boolean(item))

    return {
      sessions,
      nextCursor: this.readString(record, 'nextCursor') ?? this.readString(record, 'next_cursor'),
    }
  }

  // Stream chunks (session/update) only ever arrive in two situations: a real
  // user prompt is in flight (promptInFlight), or we are replaying a loaded
  // session's history. Anything NOT tied to an in-flight prompt must be treated
  // as history — even after a premature flush flipped loadingSessionHistory to
  // false — otherwise the tail of a large session's history leaks into the live
  // path and produces assistant messages that never receive assistant:done
  // (stuck "输出中" bubbles + label frozen on "正在流式输出" + UI freeze).
  private isReplayMode() {
    return this.loadingSessionHistory || !this.promptInFlight
  }

  private clearHistoryReplay() {
    if (this.historyFlushTimer) {
      clearTimeout(this.historyFlushTimer)
      this.historyFlushTimer = null
    }
    if (this.historyMaxTimeout) {
      clearTimeout(this.historyMaxTimeout)
      this.historyMaxTimeout = null
    }
    this.loadingSessionHistory = false
    this.historyTurns = []
  }

  private scheduleHistoryFlush(delayMs = 500) {
    if (this.historyFlushTimer) {
      clearTimeout(this.historyFlushTimer)
    }

    this.historyFlushTimer = setTimeout(() => {
      this.historyFlushTimer = null
      this.flushHistoryTurns()
    }, delayMs)
  }

  private createHistoryId(prefix: string, candidate?: string) {
    return candidate ?? `history-${prefix}-${++this.historyTurnCounter}`
  }

  private pushHistoryUserTurn(candidateId: string | undefined, text: string) {
    const last = this.historyTurns.at(-1)
    if (last?.role === 'user' && last.id === candidateId) {
      last.text += text
      return
    }

    this.historyTurns.push({
      role: 'user',
      id: this.createHistoryId('user', candidateId),
      text,
    })
  }

  private pushHistoryAssistantChunk(candidateId: string | undefined, text: string) {
    const last = this.historyTurns.at(-1)
    if (last?.role === 'assistant' && (!candidateId || last.id === candidateId)) {
      last.text += text
      return
    }

    this.historyTurns.push({
      role: 'assistant',
      id: this.createHistoryId('assistant', candidateId),
      text,
      tools: [],
    })
  }

  private pushHistoryTool(event: HermesBridgeEvent & { type: 'tool' }) {
    const last = this.historyTurns.at(-1)
    if (last?.role === 'assistant') {
      last.tools.push(event)
      return
    }

    this.historyTurns.push({
      role: 'assistant',
      id: this.createHistoryId('assistant'),
      text: '',
      tools: [event],
    })
  }

  private flushHistoryTurns() {
    if (this.historyMaxTimeout) {
      clearTimeout(this.historyMaxTimeout)
      this.historyMaxTimeout = null
    }
    const turns = this.historyTurns
    this.historyTurns = []
    this.loadingSessionHistory = false

    for (const turn of turns) {
      if (turn.role === 'user') {
        this.emitEvent({
          type: 'user:message',
          payload: { id: turn.id, text: turn.text, replay: true },
        })
        continue
      }

      this.emitEvent({ type: 'assistant:start', payload: { id: turn.id } })
      if (turn.text) {
        this.emitEvent({
          type: 'assistant:delta',
          payload: { id: turn.id, delta: turn.text },
        })
      }
      for (const tool of turn.tools) {
        this.emitEvent(tool)
      }
      this.emitEvent({
        type: 'assistant:done',
        payload: { id: turn.id, reason: 'history_replay' },
      })
    }

    if (this.sessionId) {
      this.emitEvent({
        type: 'status',
        payload: { stage: 'ready', detail: `Loaded Hermes ACP session ${this.sessionId}` },
      })
    }
  }

  private extractCurrentModel(payload: unknown) {
    if (!payload || typeof payload !== 'object') {
      return null
    }

    const record = payload as Record<string, unknown>
    const models = record.models
    if (models && typeof models === 'object') {
      return this.readString(models as Record<string, unknown>, 'currentModelId')
        ?? this.readString(models as Record<string, unknown>, 'current_model_id')
    }

    return null
  }

  private readString(payload: unknown, key: string) {
    if (!payload || typeof payload !== 'object') {
      return null
    }

    const value = (payload as Record<string, unknown>)[key]
    return typeof value === 'string' && value.trim() ? value : null
  }

  private emitEvent(event: HermesBridgeEvent) {
    this.emit('event', event)
  }
}

function extractAcpText(content: unknown): string | null {
  if (!content || typeof content !== 'object') {
    return null
  }

  const record = content as Record<string, unknown>
  if (record.type === 'text' && typeof record.text === 'string') {
    return record.text
  }

  const nested = record.content
  if (nested && typeof nested === 'object') {
    return extractAcpText(nested)
  }

  return null
}

function extractToolContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined
  }

  const text = content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const itemRecord = item as Record<string, unknown>
      return extractAcpText(itemRecord.content ?? item)
    })
    .filter((item): item is string => Boolean(item))
    .join('\n')

  return text || undefined
}

function extractAvailableCommands(payload: Record<string, unknown>): HermesCommandInfo[] {
  const candidates = [
    payload.availableCommands,
    payload.available_commands,
    payload.commands,
  ]

  const rawCommands = candidates.find((candidate): candidate is unknown[] => Array.isArray(candidate)) ?? []
  const seen = new Set<string>()

  return rawCommands
    .map((item): HermesCommandInfo | null => {
      if (typeof item === 'string') {
        return createCommandInfo(item, '')
      }

      if (!item || typeof item !== 'object') {
        return null
      }

      const record = item as Record<string, unknown>
      const name = readStringValue(record.name)
        ?? readStringValue(record.command)
        ?? readStringValue(record.id)
        ?? readStringValue(record.title)
      const description = readStringValue(record.description)
        ?? readStringValue(record.summary)
        ?? readStringValue(record.title)
        ?? ''

      return name ? createCommandInfo(name, description) : null
    })
    .filter((item): item is HermesCommandInfo => {
      if (!item || seen.has(item.id)) {
        return false
      }

      seen.add(item.id)
      return true
    })
}

function createCommandInfo(name: string, description: string): HermesCommandInfo {
  const normalized = name.trim().replace(/^\/+/, '')

  return {
    id: normalized.toLowerCase(),
    name: normalized,
    description,
  }
}

function readStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function createDiagnosticPayload(source: string, payload: unknown, extra?: Record<string, unknown>) {
  return {
    source,
    ...extra,
    shape: describePayloadShape(payload),
    preview: stringifyPreview(payload),
  }
}

function describePayloadShape(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return {
      type: 'array',
      length: payload.length,
      itemShapes: payload.slice(0, 5).map((item) => describePayloadShape(item)),
    }
  }

  if (!payload || typeof payload !== 'object') {
    return { type: typeof payload }
  }

  const record = payload as Record<string, unknown>
  return {
    type: 'object',
    keys: Object.keys(record),
    children: Object.fromEntries(
      Object.entries(record)
        .slice(0, 20)
        .map(([key, value]) => [key, Array.isArray(value)
          ? { type: 'array', length: value.length }
          : value && typeof value === 'object'
            ? { type: 'object', keys: Object.keys(value as Record<string, unknown>) }
            : { type: typeof value }]),
    ),
  }
}

function stringifyPreview(payload: unknown) {
  const text = stringifyMaybe(payload) ?? String(payload)
  return text.length > HERMES_DIAGNOSTIC_PREVIEW_CHARS
    ? `${text.slice(0, HERMES_DIAGNOSTIC_PREVIEW_CHARS)}\n...[truncated ${text.length - HERMES_DIAGNOSTIC_PREVIEW_CHARS} chars]`
    : text
}

function extractErrorDetails(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') {
    return typeof data === 'string' ? data : undefined
  }

  const record = data as Record<string, unknown>
  if (typeof record.details === 'string') return record.details
  if (typeof record.detail === 'string') return record.detail
  return stringifyMaybe(data)
}

const STATUS_LINE_PATTERNS = [
  /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2B50}\u{2764}\u{2714}\u{274C}\u{26A0}\u{26A1}\u{2139}\u{269B}\u{FE0F}\u{200D}]/u,
  /^(?:\[(?:INFO|DEBUG|WARNING|ERROR|CRITICAL)\]\s*)/i,
  /^Self-improvement review:/i,
  /^Memory updated/i,
  /^(?:✓|✔|✗|✘|☐|☑|○|●|◉|◌)\s/,
  /^\s+[\^~]+\s*$/,  // Python traceback caret/tilde markers
]

function isStatusLine(line: string): boolean {
  if (!line) {
    return false
  }

  for (const pattern of STATUS_LINE_PATTERNS) {
    if (pattern.test(line)) {
      return true
    }
  }

  return false
}

function stringifyMaybe(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return undefined
  }
}
