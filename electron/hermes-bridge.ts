import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

export type HermesBridgeEvent =
  | { type: 'status'; payload: { stage: string; detail: string } }
  | { type: 'assistant:start'; payload: { id?: string; model?: string } }
  | { type: 'assistant:delta'; payload: { id?: string; delta: string } }
  | { type: 'assistant:done'; payload: { id?: string; reason?: string; text?: string } }
  | { type: 'tool'; payload: { id?: string; name: string; args?: string; result?: string; status: 'running' | 'completed' } }
  | { type: 'stderr'; payload: string }
  | { type: 'raw'; payload: unknown }
  | { type: 'exit'; payload: { code: number | null } }

type ToolExtraction = {
  id?: string
  name: string
  args?: string
  result?: string
  status: 'running' | 'completed'
}

export class HermesBridge extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private streamIndex = 0

  start() {
    if (this.process) {
      return
    }

    this.process = spawn('hermes', ['chat', '--source', 'desktop'], {
      stdio: 'pipe',
      env: { ...process.env },
    })

    this.emitEvent({
      type: 'status',
      payload: { stage: 'boot', detail: 'Hermes 进程已启动。' },
    })

    this.process.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString('utf8')
      this.flushStdout()
    })

    this.process.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim()
      if (text) {
        this.emitEvent({ type: 'stderr', payload: text })
      }
    })

    this.process.on('close', (code) => {
      this.emitEvent({ type: 'exit', payload: { code } })
      this.process = null
      this.stdoutBuffer = ''
    })

    this.process.on('error', (error) => {
      this.emitEvent({ type: 'stderr', payload: error.message })
    })
  }

  sendMessage(text: string) {
    if (!this.process) {
      this.start()
    }

    const message = text.trim()
    if (!message) {
      return
    }

    this.emitEvent({
      type: 'status',
      payload: { stage: 'queued', detail: '消息已转发给 Hermes。' },
    })
    this.process?.stdin.write(`${message}\n`)
  }

  stop() {
    this.process?.kill()
    this.process = null
    this.stdoutBuffer = ''
  }

  private flushStdout() {
    while (this.stdoutBuffer) {
      const framed = this.readContentLengthFrame()
      if (framed) {
        this.handlePayloadText(framed)
        continue
      }

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

      this.handlePayloadText(line)
    }
  }

  private readContentLengthFrame() {
    const headerMatch = this.stdoutBuffer.match(/^Content-Length:\s*(\d+)\r?\n/i)
    if (!headerMatch) {
      return null
    }

    const headerEnd = this.stdoutBuffer.indexOf('\r\n\r\n') >= 0
      ? this.stdoutBuffer.indexOf('\r\n\r\n') + 4
      : this.stdoutBuffer.indexOf('\n\n') >= 0
        ? this.stdoutBuffer.indexOf('\n\n') + 2
        : -1

    if (headerEnd === -1) {
      return null
    }

    const contentLength = Number.parseInt(headerMatch[1], 10)
    const frameEnd = headerEnd + contentLength
    if (this.stdoutBuffer.length < frameEnd) {
      return null
    }

    const body = this.stdoutBuffer.slice(headerEnd, frameEnd)
    this.stdoutBuffer = this.stdoutBuffer.slice(frameEnd)
    return body.trim()
  }

  private handlePayloadText(text: string) {
    const parsed = this.tryParseJson(text)

    if (parsed === undefined) {
      this.emitEvent({
        type: 'assistant:delta',
        payload: { delta: this.normalizeTextChunk(text) },
      })
      return
    }

    this.emitNormalizedEvents(parsed)
  }

  private emitNormalizedEvents(payload: unknown) {
    const events = this.normalizePayload(payload)

    if (!events.length) {
      this.emitEvent({ type: 'raw', payload })
      return
    }

    for (const event of events) {
      this.emitEvent(event)
    }
  }

  private normalizePayload(payload: unknown): HermesBridgeEvent[] {
    if (typeof payload === 'string') {
      return [
        {
          type: 'assistant:delta',
          payload: { delta: this.normalizeTextChunk(payload) },
        },
      ]
    }

    if (!payload || typeof payload !== 'object') {
      return []
    }

    const record = payload as Record<string, unknown>
    const method = typeof record.method === 'string' ? record.method : ''
    const params = this.unwrapJsonRpcPayload(record)
    const role = this.extractRole(params)
    const explicitText = this.extractTextCandidate(params)
    const toolEvent = this.extractToolEvent(method, params) ?? this.extractToolEvent(method, record)

    if (toolEvent) {
      return [{ type: 'tool', payload: toolEvent }]
    }

    if (Array.isArray(record.content)) {
      const text = this.extractTextCandidate(record.content)
      if (text) {
        return this.normalizeAssistantTextPayload(record, text)
      }
    }

    if (method) {
      return this.normalizeRpcEvent(method, params, role, explicitText)
    }

    if (role === 'assistant' && explicitText) {
      return this.normalizeAssistantTextPayload(params, explicitText)
    }

    if (explicitText && this.looksStreamy(record)) {
      return this.normalizeAssistantTextPayload(record, explicitText)
    }

    const stage =
      typeof record.status === 'string'
        ? record.status
        : typeof record.event === 'string'
          ? record.event
          : typeof record.type === 'string'
            ? record.type
            : null

    if (stage && explicitText) {
      return [
        {
          type: 'status',
          payload: { stage, detail: explicitText },
        },
      ]
    }

    return []
  }

  private normalizeRpcEvent(
    method: string,
    payload: unknown,
    role: string | null,
    explicitText: string | null,
  ): HermesBridgeEvent[] {
    const lowerMethod = method.toLowerCase()
    const id = this.extractMessageId(payload)
    const events: HermesBridgeEvent[] = []

    if (
      lowerMethod.includes('assistant') &&
      (lowerMethod.includes('start') || lowerMethod.includes('begin'))
    ) {
      events.push({
        type: 'assistant:start',
        payload: { id, model: this.extractModel(payload) ?? undefined },
      })
    }

    if (
      (lowerMethod.includes('assistant') || role === 'assistant') &&
      (lowerMethod.includes('delta') || lowerMethod.includes('stream') || lowerMethod.includes('chunk'))
    ) {
      if (explicitText) {
        events.push({
          type: 'assistant:delta',
          payload: { id, delta: this.normalizeTextChunk(explicitText) },
        })
      }
      return events
    }

    if (
      (lowerMethod.includes('assistant') || role === 'assistant') &&
      (lowerMethod.includes('done') || lowerMethod.includes('complete') || lowerMethod.includes('final'))
    ) {
      events.push({
        type: 'assistant:done',
        payload: {
          id,
          reason: this.extractFinishReason(payload) ?? undefined,
          text: explicitText ? this.normalizeTextChunk(explicitText) : undefined,
        },
      })
      return events
    }

    if ((lowerMethod.includes('assistant') || role === 'assistant') && explicitText) {
      return this.normalizeAssistantTextPayload(payload, explicitText)
    }

    if (explicitText) {
      return [
        {
          type: 'status',
          payload: { stage: method, detail: explicitText },
        },
      ]
    }

    return events
  }

  private normalizeAssistantTextPayload(payload: unknown, text: string): HermesBridgeEvent[] {
    const id = this.extractMessageId(payload)
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
    const isDone = record ? this.isDonePayload(record) : false
    const events: HermesBridgeEvent[] = []

    if (this.looksLikeFreshAssistantPayload(record)) {
      events.push({ type: 'assistant:start', payload: { id, model: this.extractModel(payload) ?? undefined } })
    }

    if (isDone) {
      events.push({
        type: 'assistant:done',
        payload: {
          id,
          reason: this.extractFinishReason(payload) ?? undefined,
          text: this.normalizeTextChunk(text),
        },
      })
    } else {
      events.push({
        type: 'assistant:delta',
        payload: {
          id,
          delta: this.normalizeTextChunk(text),
        },
      })
    }

    return events
  }

  private unwrapJsonRpcPayload(record: Record<string, unknown>) {
    if ('params' in record) {
      return record.params
    }

    if ('result' in record) {
      return record.result
    }

    return record
  }

  private extractRole(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null
    }

    const record = payload as Record<string, unknown>
    if (typeof record.role === 'string') {
      return record.role
    }

    if (typeof record.sender === 'string') {
      return record.sender
    }

    if (record.message && typeof record.message === 'object') {
      return this.extractRole(record.message)
    }

    return null
  }

  private extractTextCandidate(payload: unknown): string | null {
    if (typeof payload === 'string') {
      return payload
    }

    if (Array.isArray(payload)) {
      const joined = payload
        .map((item) => this.extractTextCandidate(item))
        .filter((item): item is string => Boolean(item))
        .join('')
      return joined || null
    }

    if (!payload || typeof payload !== 'object') {
      return null
    }

    const record = payload as Record<string, unknown>
    const directKeys = ['delta', 'text', 'content', 'message', 'body', 'output']
    for (const key of directKeys) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) {
        return value
      }

      if (Array.isArray(value)) {
        const nested = this.extractTextCandidate(value)
        if (nested) {
          return nested
        }
      }

      if (value && typeof value === 'object') {
        const nested = this.extractTextCandidate(value)
        if (nested) {
          return nested
        }
      }
    }

    if (typeof record.type === 'string' && record.type === 'text' && typeof record.text === 'string') {
      return record.text
    }

    return null
  }

  private extractToolEvent(method: string, payload: unknown): ToolExtraction | null {
    if (!payload || typeof payload !== 'object') {
      return null
    }

    const record = payload as Record<string, unknown>
    const marker = [method, this.readString(record, 'type'), this.readString(record, 'event'), this.readString(record, 'role')]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLowerCase()

    const nestedFunction = record.function && typeof record.function === 'object' ? (record.function as Record<string, unknown>) : null
    const nestedTool = record.tool && typeof record.tool === 'object' ? (record.tool as Record<string, unknown>) : null
    const name =
      this.readString(record, 'tool_name') ??
      this.readString(record, 'toolName') ??
      this.readString(record, 'name') ??
      this.readString(nestedFunction, 'name') ??
      this.readString(nestedTool, 'name')

    const args =
      this.stringifyStructured(record.arguments) ??
      this.stringifyStructured(record.args) ??
      this.stringifyStructured(record.input) ??
      this.stringifyStructured(record.parameters) ??
      this.stringifyStructured(nestedFunction?.arguments)

    const result =
      this.stringifyStructured(record.output) ??
      this.stringifyStructured(record.result) ??
      this.stringifyStructured(record.response)

    const callId =
      this.readString(record, 'call_id') ??
      this.readString(record, 'tool_call_id') ??
      this.readString(record, 'id')

    const looksToolish =
      marker.includes('tool') ||
      marker.includes('function_call') ||
      marker.includes('function call') ||
      (Boolean(name) && (args !== null || result !== null))

    if (!looksToolish || !name) {
      return null
    }

    const status: 'running' | 'completed' =
      marker.includes('output') || marker.includes('result') || marker.includes('complete') || marker.includes('done') || result
        ? 'completed'
        : 'running'

    return {
      id: callId ?? undefined,
      name,
      args: args ?? undefined,
      result: result ?? undefined,
      status,
    }
  }

  private readString(record: Record<string, unknown> | null, key: string) {
    if (!record) {
      return null
    }

    const value = record[key]
    return typeof value === 'string' && value.trim() ? value : null
  }

  private stringifyStructured(value: unknown): string | null {
    if (typeof value === 'string') {
      return value.trim() ? value : null
    }

    if (value === undefined || value === null) {
      return null
    }

    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return null
    }
  }

  private extractMessageId(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object') {
      return undefined
    }

    const record = payload as Record<string, unknown>
    const candidateKeys = ['messageId', 'message_id', 'id', 'turnId', 'turn_id', 'response_id']
    for (const key of candidateKeys) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) {
        return value
      }
    }

    if (record.message && typeof record.message === 'object') {
      return this.extractMessageId(record.message)
    }

    return undefined
  }

  private extractModel(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null
    }

    const record = payload as Record<string, unknown>
    if (typeof record.model === 'string') {
      return record.model
    }

    if (record.message && typeof record.message === 'object') {
      return this.extractModel(record.message)
    }

    return null
  }

  private extractFinishReason(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null
    }

    const record = payload as Record<string, unknown>
    const candidateKeys = ['finishReason', 'finish_reason', 'reason', 'stopReason', 'stop_reason']
    for (const key of candidateKeys) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) {
        return value
      }
    }

    if (record.message && typeof record.message === 'object') {
      return this.extractFinishReason(record.message)
    }

    return null
  }

  private looksStreamy(record: Record<string, unknown>) {
    return ['delta', 'chunk', 'stream'].some((key) => key in record)
  }

  private looksLikeFreshAssistantPayload(record: Record<string, unknown> | null) {
    if (!record) {
      return true
    }

    const marker = typeof record.event === 'string' ? record.event.toLowerCase() : ''
    const type = typeof record.type === 'string' ? record.type.toLowerCase() : ''
    return marker.includes('start') || type.includes('start')
  }

  private isDonePayload(record: Record<string, unknown>) {
    const boolKeys = ['done', 'completed', 'complete', 'final']
    for (const key of boolKeys) {
      if (record[key] === true) {
        return true
      }
    }

    const markerKeys = ['event', 'type', 'status']
    for (const key of markerKeys) {
      const value = record[key]
      if (typeof value === 'string') {
        const lower = value.toLowerCase()
        if (lower.includes('done') || lower.includes('complete') || lower.includes('final')) {
          return true
        }
      }
    }

    return false
  }

  private tryParseJson(text: string) {
    if (!/^[\[{]/.test(text)) {
      return undefined
    }

    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }

  private normalizeTextChunk(text: string) {
    if (!text) {
      return ''
    }

    const normalized = text.replace(/\r\n/g, '\n')
    return this.streamIndex++ === 0 ? normalized : normalized
  }

  private emitEvent(event: HermesBridgeEvent) {
    this.emit('event', event)
  }
}
