import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import path from 'node:path'

export type HermesBridgeEvent =
  | { type: 'status'; payload: { stage: string; detail: string } }
  | { type: 'assistant:start'; payload: { id?: string; model?: string } }
  | { type: 'assistant:delta'; payload: { id?: string; delta: string } }
  | { type: 'assistant:done'; payload: { id?: string; reason?: string; text?: string } }
  | { type: 'tool'; payload: { id?: string; name: string; args?: string; result?: string; status: 'running' | 'completed' } }
  | { type: 'stderr'; payload: string }
  | { type: 'raw'; payload: unknown }
  | { type: 'exit'; payload: { code: number | null } }

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

const DEFAULT_WSL_DISTRO = process.env.HERMES_WSL_DISTRO || 'Ubuntu-22.04'

export class HermesBridge extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private nextRequestId = 1
  private pending = new Map<number | string, PendingRequest>()
  private sessionId: string | null = null
  private startPromise: Promise<void> | null = null
  private activeMessageIds = new Set<string>()
  private promptInFlight = false

  start() {
    if (this.startPromise) {
      return this.startPromise
    }

    this.startPromise = this.startBackend()
    return this.startPromise
  }

  async sendMessage(text: string) {
    const message = text.trim()
    if (!message) {
      return
    }

    await this.start()

    if (!this.sessionId) {
      throw new Error('Hermes ACP 会话尚未就绪。')
    }

    this.promptInFlight = true
    this.emitEvent({
      type: 'status',
      payload: { stage: 'queued', detail: '消息已通过 ACP 转发给 WSL Hermes。' },
    })

    try {
      const result = await this.sendRequest('session/prompt', {
        sessionId: this.sessionId,
        messageId: randomUUID(),
        prompt: [{ type: 'text', text: message }],
      }, 10 * 60 * 1000)

      const stopReason = this.readString(result, 'stopReason') ?? this.readString(result, 'stop_reason') ?? 'end_turn'
      this.emitEvent({
        type: 'assistant:done',
        payload: { reason: stopReason },
      })
    } finally {
      this.promptInFlight = false
    }
  }

  stop() {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Hermes ACP 后端已停止。'))
      this.pending.delete(id)
    }

    this.process?.kill()
    this.process = null
    this.stdoutBuffer = ''
    this.sessionId = null
    this.startPromise = null
    this.activeMessageIds.clear()
  }

  private async startBackend() {
    if (this.process) {
      return
    }

    const workspace = process.cwd()
    const wslWorkspace = windowsPathToWslPath(workspace)

    this.process = spawn('wsl.exe', [
      '-d',
      DEFAULT_WSL_DISTRO,
      '--cd',
      wslWorkspace,
      '--',
      'bash',
      '-lc',
      'exec hermes acp --accept-hooks',
    ], {
      stdio: 'pipe',
      windowsHide: true,
      env: { ...process.env },
    })

    this.emitEvent({
      type: 'status',
      payload: {
        stage: 'boot',
        detail: `正在通过 ${DEFAULT_WSL_DISTRO} 启动 Hermes ACP 后端。`,
      },
    })

    this.process.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString('utf8')
      this.flushStdout()
    })

    this.process.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim()
      if (text) {
        this.handleStderr(text)
      }
    })

    this.process.on('close', (code) => {
      this.emitEvent({ type: 'exit', payload: { code } })
      this.process = null
      this.stdoutBuffer = ''
      this.sessionId = null
      this.startPromise = null
      this.activeMessageIds.clear()

      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout)
        pending.reject(new Error(`Hermes ACP 后端已退出${code === null ? '' : `，退出码 ${code}`}。`))
        this.pending.delete(id)
      }
    })

    this.process.on('error', (error) => {
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
        detail: model ? `Hermes ACP 已初始化，当前模型 ${model}。` : 'Hermes ACP 已初始化。',
      },
    })

    const session = await this.sendRequest('session/new', {
      cwd: wslWorkspace,
      mcpServers: [],
    })

    this.sessionId = this.readString(session, 'sessionId') ?? this.readString(session, 'session_id')

    if (!this.sessionId) {
      throw new Error('Hermes ACP 未返回 sessionId。')
    }

    this.emitEvent({
      type: 'status',
      payload: { stage: 'ready', detail: `Hermes ACP 会话已就绪：${this.sessionId}` },
    })
  }

  private sendRequest(method: string, params: unknown, timeoutMs = 30_000) {
    if (!this.process) {
      return Promise.reject(new Error('Hermes ACP 后端尚未启动。'))
    }

    const id = this.nextRequestId++
    const payload = { jsonrpc: '2.0', id, method, params }

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`ACP 请求超时：${method}`))
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
      this.handleRequestOrNotification(message)
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

      this.emitEvent({ type: 'stderr', payload: line })
    }
  }

  private handleRequestOrNotification(message: JsonRpcMessage) {
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
          this.sendResponse(message.id, { outcome: choosePermissionOutcome(message.params) })
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
          this.sendError(message.id, 'Hermes Desktop Agent 暂未开放 ACP 文件系统代理。')
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

    if (kind === 'agent_message_chunk') {
      const messageId = this.readString(updateRecord, 'messageId') ?? this.readString(updateRecord, 'message_id') ?? undefined
      const delta = extractAcpText(updateRecord.content)
      if (!delta) {
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
      const delta = extractAcpText(updateRecord.content)
      if (delta) {
        this.emitEvent({ type: 'status', payload: { stage: 'thinking', detail: delta } })
      }
      return
    }

    if (kind === 'tool_call') {
      this.emitEvent({
        type: 'tool',
        payload: {
          id: this.readString(updateRecord, 'toolCallId') ?? this.readString(updateRecord, 'tool_call_id') ?? undefined,
          name: this.readString(updateRecord, 'title') ?? this.readString(updateRecord, 'kind') ?? 'tool',
          args: stringifyMaybe(updateRecord.rawInput),
          status: 'running',
        },
      })
      return
    }

    if (kind === 'tool_call_update') {
      this.emitEvent({
        type: 'tool',
        payload: {
          id: this.readString(updateRecord, 'toolCallId') ?? this.readString(updateRecord, 'tool_call_id') ?? undefined,
          name: this.readString(updateRecord, 'title') ?? this.readString(updateRecord, 'kind') ?? 'tool',
          args: stringifyMaybe(updateRecord.rawInput),
          result: stringifyMaybe(updateRecord.rawOutput) ?? extractToolContent(updateRecord.content),
          status: 'completed',
        },
      })
      return
    }

    if (kind === 'usage_update' || kind === 'available_commands_update') {
      return
    }

    this.emitEvent({ type: 'raw', payload })
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

function windowsPathToWslPath(workspace: string) {
  const resolved = path.resolve(workspace)
  const driveMatch = resolved.match(/^([A-Za-z]):\\(.*)$/)
  if (!driveMatch) {
    return resolved.replace(/\\/g, '/')
  }

  const drive = driveMatch[1].toLowerCase()
  const rest = driveMatch[2].replace(/\\/g, '/')
  return `/mnt/${drive}/${rest}`
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

function choosePermissionOutcome(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return { outcome: 'cancelled' }
  }

  const options = (payload as Record<string, unknown>).options
  if (!Array.isArray(options)) {
    return { outcome: 'cancelled' }
  }

  const allowOption = options.find((option) => {
    if (!option || typeof option !== 'object') {
      return false
    }
    const record = option as Record<string, unknown>
    const id = typeof record.optionId === 'string' ? record.optionId.toLowerCase() : ''
    const name = typeof record.name === 'string' ? record.name.toLowerCase() : ''
    return id.includes('allow') || name.includes('allow')
  }) ?? options[0]

  if (!allowOption || typeof allowOption !== 'object') {
    return { outcome: 'cancelled' }
  }

  const optionId = (allowOption as Record<string, unknown>).optionId
  return typeof optionId === 'string'
    ? { outcome: 'selected', optionId }
    : { outcome: 'cancelled' }
}
