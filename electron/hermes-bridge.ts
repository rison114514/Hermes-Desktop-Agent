import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { normalizeMaybeText } from './text-normalization.js'
import { createUtf8ProcessEnv, resolveWslDistro, runWslCommand, windowsPathToWslPath } from './wsl-paths.js'

export type HermesBridgeEvent =
  | { type: 'status'; payload: { stage: string; detail: string } }
  | { type: 'user:message'; payload: { id?: string; text: string; replay?: boolean } }
  | { type: 'assistant:start'; payload: { id?: string; model?: string } }
  | { type: 'assistant:delta'; payload: { id?: string; delta: string } }
  | { type: 'assistant:done'; payload: { id?: string; reason?: string; text?: string } }
  | { type: 'tool'; payload: { id?: string; name: string; args?: string; result?: string; status: 'running' | 'completed' } }
  | { type: 'commands'; payload: HermesCommandInfo[] }
  | { type: 'stderr'; payload: string }
  | { type: 'raw'; payload: unknown }
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
  | { outcome: 'selected'; optionId: string }
  | { outcome: 'cancelled' }

export type HermesPermissionHandler = (payload: unknown) => Promise<HermesPermissionOutcome> | HermesPermissionOutcome

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
  timeout: NodeJS.Timeout
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
  private workspacePath = process.cwd()
  private permissionHandler: HermesPermissionHandler | null = null
  private promptCancelRequested = false

  getWorkspacePath() {
    return this.workspacePath
  }

  setPermissionHandler(handler: HermesPermissionHandler | null) {
    this.permissionHandler = handler
  }

  getSessionId() {
    return this.sessionId
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
      const result = await this.sendRequest('session/prompt', {
        sessionId: this.sessionId,
        messageId: randomUUID(),
        prompt: [{ type: 'text', text: message }],
      }, 10 * 60 * 1000)

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

    const cwd = windowsPathToWslPath(this.workspacePath)
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
    this.scheduleHistoryFlush(600)
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
    this.clearHistoryReplay()
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Hermes ACP backend stopped.'))
      this.pending.delete(id)
    }

    this.process?.kill()
    this.process = null
    this.stdoutBuffer = ''
    this.sessionId = null
    this.startPromise = null
    this.activeMessageIds.clear()
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

    const cwd = windowsPathToWslPath(this.workspacePath)
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

    const wslWorkspace = windowsPathToWslPath(this.workspacePath)
    const distro = await resolveWslDistro()
    await this.ensureHermesInstalled(distro)

    const child = spawn('wsl.exe', [
      '-d',
      distro,
      '--cd',
      wslWorkspace,
      '--',
      'bash',
      '-lc',
      [
        'export LANG=C.UTF-8',
        'export LC_ALL=C.UTF-8',
        'export PYTHONUTF8=1',
        'export PYTHONIOENCODING=utf-8',
        'export HERMES_TEXT_ENCODING=utf-8',
        'exec hermes acp --accept-hooks',
      ].join('; '),
    ], {
      stdio: 'pipe',
      windowsHide: true,
      env: createUtf8ProcessEnv({ ...process.env, HERMES_WSL_DISTRO: distro }),
    })
    this.process = child

    this.emitEvent({
      type: 'status',
      payload: {
        stage: 'boot',
        detail: `Starting Hermes ACP in ${distro}.`,
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
      const text = chunk.toString('utf8').trim()
      if (text) {
        this.handleStderr(text)
      }
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

      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout)
        pending.reject(new Error(`Hermes ACP backend exited${code === null ? '' : ` with code ${code}`}.`))
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

    const model = this.extractCurrentModel(init)
    this.emitEvent({
      type: 'status',
      payload: {
        stage: 'initialized',
        detail: model ? `Hermes ACP initialized with ${model}.` : 'Hermes ACP initialized.',
      },
    })
  }

  private async ensureHermesInstalled(distro: string) {
    this.emitEvent({
      type: 'status',
      payload: { stage: 'checking-backend', detail: `Checking Hermes in ${distro}.` },
    })

    try {
      await runWslCommand(['bash', '-lc', 'export PATH="$HOME/.local/bin:$PATH"; command -v hermes >/dev/null 2>&1 && hermes --version >/dev/null 2>&1'], distro)
      return
    } catch {
      this.emitEvent({
        type: 'status',
        payload: { stage: 'installing-backend', detail: `Hermes was not found in ${distro}. Installing Hermes now.` },
      })
    }

    const installerScript = [
      'set -e',
      'export PATH="$HOME/.local/bin:$PATH"',
      'export PYTHONUTF8=1',
      'export PYTHONIOENCODING=utf-8',
      'export LANG=C.UTF-8',
      'export LC_ALL=C.UTF-8',
      'export PIP_INDEX_URL="${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"',
      'export UV_INDEX_URL="${UV_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"',
      'export npm_config_registry="${npm_config_registry:-https://registry.npmmirror.com}"',
      'install_urls="',
      'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh',
      'https://gh-proxy.com/https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh',
      'https://ghfast.top/https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh',
      '"',
      'installed=0',
      'for url in $install_urls; do',
      '  echo "Trying Hermes installer: $url"',
      '  if curl -fsSL "$url" -o /tmp/hermes-install.sh; then',
      '    bash /tmp/hermes-install.sh',
      '    rm -f /tmp/hermes-install.sh',
      '    installed=1',
      '    break',
      '  fi',
      'done',
      'if [ "$installed" != "1" ]; then',
      '  echo "Unable to download Hermes installer." >&2',
      '  exit 1',
      'fi',
      'command -v hermes >/dev/null 2>&1',
      'hermes --version >/dev/null 2>&1',
    ].join('\n')

    try {
      await runWslCommand(['bash', '-lc', installerScript], distro)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`Hermes is not installed in ${distro}, and automatic installation failed. Check WSL network/proxy access, then install Hermes manually and restart Hermes Desktop Agent. ${detail}`)
    }
  }

  private sendRequest(method: string, params: unknown, timeoutMs = 30_000) {
    if (!this.process) {
      return Promise.reject(new Error('Hermes ACP backend has not started.'))
    }

    const id = this.nextRequestId++
    const payload = { jsonrpc: '2.0', id, method, params }

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`ACP request timed out: ${method}`))
      }, timeoutMs)

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
      pending.reject(new Error(message.error.message ?? 'ACP request failed'))
      return
    }

    pending.resolve(message.result)
  }

  private handleStderr(text: string) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

    for (const line of lines) {
      if (/\s\[INFO\]\s/.test(line)) {
        continue
      }

      if (/\s\[WARNING\]\s/.test(line)) {
        this.emitEvent({
          type: 'status',
          payload: { stage: 'backend-warning', detail: line },
        })
        continue
      }

      this.emitEvent({ type: 'stderr', payload: normalizeMaybeText(line, 'stderr') ?? line })
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
      return { outcome: 'cancelled' }
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
      return { outcome: 'cancelled' }
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
        if (this.loadingSessionHistory) {
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

      if (this.loadingSessionHistory) {
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
      if (this.loadingSessionHistory) {
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
      if (this.loadingSessionHistory) {
        this.pushHistoryTool(event)
        this.scheduleHistoryFlush()
        return
      }

      this.emitEvent(event)
      return
    }

    if (kind === 'available_commands_update') {
      this.emitEvent({ type: 'commands', payload: extractAvailableCommands(updateRecord) })
      return
    }

    if (kind === 'usage_update') {
      return
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

  private clearHistoryReplay() {
    if (this.historyFlushTimer) {
      clearTimeout(this.historyFlushTimer)
      this.historyFlushTimer = null
    }
    this.loadingSessionHistory = false
    this.historyTurns = []
  }

  private scheduleHistoryFlush(delayMs = 350) {
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
