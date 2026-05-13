import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Bot, Info, TriangleAlert, User2, Wrench, CheckCircle2, ChevronDown } from 'lucide-react'
import katex from 'katex'
import type { Message, ToolCallState } from '@/store/chat'
import { cn } from '@/lib/utils'

type MarkdownBlock =
  | { type: 'heading'; depth: number; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'code'; language?: string; code: string }
  | { type: 'math'; math: string; display: boolean }

const KEYWORD_COLORS = {
  keyword: 'text-sky-300',
  type: 'text-violet-300',
  string: 'text-emerald-300',
  number: 'text-amber-300',
  comment: 'text-slate-500',
  function: 'text-cyan-200',
  punctuation: 'text-slate-400',
} as const

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []

  let index = 0
  while (index < lines.length) {
    const line = lines[index]

    if (!line.trim()) {
      index += 1
      continue
    }

    const trimmedLine = line.trim()
    const inlineDisplayMath = trimmedLine.match(/^\$\$([\s\S]+)\$\$$/)
    if (inlineDisplayMath) {
      blocks.push({ type: 'math', math: inlineDisplayMath[1].trim(), display: true })
      index += 1
      continue
    }

    if (trimmedLine === '$$' || trimmedLine === '\\[') {
      const endMarker = trimmedLine === '$$' ? '$$' : '\\]'
      const mathLines: string[] = []
      index += 1
      while (index < lines.length && lines[index].trim() !== endMarker) {
        mathLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      blocks.push({ type: 'math', math: mathLines.join('\n').trim(), display: true })
      continue
    }

    const fence = line.match(/^```([\w-]+)?\s*$/)
    if (fence) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) {
        index += 1
      }
      blocks.push({ type: 'code', language: fence[1], code: codeLines.join('\n') })
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      blocks.push({ type: 'heading', depth: heading[1].length, text: heading[2] })
      index += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'blockquote', lines: quoteLines })
      continue
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*+]\s+/, ''))
        index += 1
      }
      blocks.push({ type: 'unordered-list', items })
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ''))
        index += 1
      }
      blocks.push({ type: 'ordered-list', items })
      continue
    }

    const paragraphLines: string[] = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```([\w-]+)?\s*$/.test(lines[index]) &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !/^[-*+]\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index])
      index += 1
    }
    blocks.push({ type: 'paragraph', lines: paragraphLines })
  }

  return blocks
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /(\\\([^\n]+?\\\)|\$[^$\n]+\$|\[[^\]]+\]\([^\)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const token = match[0]
    const tokenKey = `${keyPrefix}-${match.index}`

    if (token.startsWith('\\(') && token.endsWith('\\)')) {
      parts.push(renderMath(token.slice(2, -2), false, tokenKey))
    } else if (token.startsWith('$') && token.endsWith('$')) {
      parts.push(renderMath(token.slice(1, -1), false, tokenKey))
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={tokenKey} className="rounded-md bg-black/25 px-1.5 py-0.5 font-mono text-[0.85em] text-inherit">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={tokenKey}>{renderInlineMarkdown(token.slice(2, -2), tokenKey)}</strong>)
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={tokenKey}>{renderInlineMarkdown(token.slice(1, -1), tokenKey)}</em>)
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^\)]+)\)$/)
      if (link) {
        parts.push(
          <a
            key={tokenKey}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-200 underline underline-offset-4"
          >
            {link[1]}
          </a>,
        )
      } else {
        parts.push(token)
      }
    }

    lastIndex = pattern.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}

function renderMath(math: string, display: boolean, key: string) {
  const html = katex.renderToString(math, {
    displayMode: display,
    throwOnError: false,
    strict: false,
  })

  const Element = display ? 'div' : 'span'
  return (
    <Element
      key={key}
      className={display ? 'my-3 overflow-x-auto rounded-xl bg-slate-950/45 px-3 py-2 text-slate-100' : 'text-cyan-50'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function tokenizeCode(code: string, language?: string) {
  const normalizedLanguage = language?.toLowerCase()
  const keywords =
    normalizedLanguage === 'json'
      ? /\b(true|false|null)\b/g
      : /\b(async|await|break|case|catch|class|const|continue|default|delete|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|switch|throw|try|typeof|var|while|yield)\b/g
  const typeKeywords = /\b(Array|Boolean|Date|Error|Map|Number|Object|Promise|Record|Set|String|any|boolean|number|string|unknown|void)\b/g
  const functionPattern = /\b([A-Za-z_$][\w$]*)(?=\()/g
  const stringPattern = /("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`)/g
  const numberPattern = /\b(0x[\da-fA-F]+|\d+(?:\.\d+)?)\b/g
  const commentPattern = normalizedLanguage === 'bash' ? /(#[^\n]*)/g : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g
  const punctuationPattern = /([{}()[\].,;:+\-*/=%<>!?|&])/g

  const matches = [
    { type: 'comment', pattern: commentPattern },
    { type: 'string', pattern: stringPattern },
    { type: 'keyword', pattern: keywords },
    { type: 'type', pattern: typeKeywords },
    { type: 'function', pattern: functionPattern },
    { type: 'number', pattern: numberPattern },
    { type: 'punctuation', pattern: punctuationPattern },
  ].flatMap(({ type, pattern }) =>
    Array.from(code.matchAll(pattern)).map((match) => ({
      type,
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      value: match[0],
    })),
  )

  matches.sort((left, right) => left.start - right.start || right.end - left.end)

  const tokens: Array<{ type?: keyof typeof KEYWORD_COLORS; value: string }> = []
  let cursor = 0

  for (const match of matches) {
    if (match.start < cursor) {
      continue
    }
    if (match.start > cursor) {
      tokens.push({ value: code.slice(cursor, match.start) })
    }
    tokens.push({ type: match.type as keyof typeof KEYWORD_COLORS, value: match.value })
    cursor = match.end
  }

  if (cursor < code.length) {
    tokens.push({ value: code.slice(cursor) })
  }

  return tokens
}

function renderCodeBlock(code: string, language?: string) {
  const lines = code.split('\n')

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/85">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
        <span>{language ?? '代码'}</span>
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-[13px] leading-6 text-slate-100">
        <code className="font-mono">
          {lines.map((line, lineIndex) => (
            <div key={`code-line-${lineIndex}`}>
              {tokenizeCode(line, language).map((token, tokenIndex) => (
                <span
                  key={`code-token-${lineIndex}-${tokenIndex}`}
                  className={token.type ? KEYWORD_COLORS[token.type] : undefined}
                >
                  {token.value}
                </span>
              ))}
              {lineIndex < lines.length - 1 ? '\n' : null}
            </div>
          ))}
        </code>
      </pre>
    </div>
  )
}

function renderMarkdown(content: string) {
  return parseMarkdown(content).map((block, index) => {
    const key = `markdown-block-${index}`

    switch (block.type) {
      case 'heading': {
        const sizes = { 1: 'text-2xl', 2: 'text-xl', 3: 'text-lg', 4: 'text-base', 5: 'text-sm', 6: 'text-sm' } as const

        return (
          <p key={key} className={cn('font-semibold text-white', sizes[block.depth as keyof typeof sizes])}>
            {renderInlineMarkdown(block.text, key)}
          </p>
        )
      }
      case 'paragraph':
        return (
          <p key={key} className="whitespace-pre-wrap">
            {block.lines.map((line, lineIndex) => (
              <span key={`${key}-${lineIndex}`}>
                {lineIndex > 0 ? <br /> : null}
                {renderInlineMarkdown(line, `${key}-${lineIndex}`)}
              </span>
            ))}
          </p>
        )
      case 'blockquote':
        return (
          <blockquote key={key} className="border-l-2 border-white/15 pl-4 italic text-slate-300">
            {block.lines.map((line, lineIndex) => (
              <p key={`${key}-${lineIndex}`} className={lineIndex > 0 ? 'mt-2' : undefined}>
                {renderInlineMarkdown(line, `${key}-${lineIndex}`)}
              </p>
            ))}
          </blockquote>
        )
      case 'unordered-list':
        return (
          <ul key={key} className="list-disc space-y-1 pl-5 marker:text-slate-400">
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>{renderInlineMarkdown(item, `${key}-${itemIndex}`)}</li>
            ))}
          </ul>
        )
      case 'ordered-list':
        return (
          <ol key={key} className="list-decimal space-y-1 pl-5 marker:text-slate-400">
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>{renderInlineMarkdown(item, `${key}-${itemIndex}`)}</li>
            ))}
          </ol>
        )
      case 'code':
        return <div key={key}>{renderCodeBlock(block.code, block.language)}</div>
      case 'math':
        return renderMath(block.math, block.display, key)
      default:
        return null
    }
  })
}

function ToolCard({ message }: { message: Message }) {
  const tool = message.tool
  if (!tool) {
    return null
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-cyan-200" />
          <div>
            <p className="text-sm font-semibold text-white">{tool.toolName}</p>
            <p className="text-xs text-slate-400">{tool.callId ?? '未提供调用 ID'}</p>
          </div>
        </div>
        <div className={cn('rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.22em]', tool.status === 'completed' ? 'bg-emerald-300/15 text-emerald-100' : 'bg-amber-300/15 text-amber-100')}>
          {tool.status === 'completed' ? (
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />已完成</span>
          ) : (
            '执行中'
          )}
        </div>
      </div>
      {tool.args ? renderCodeBlock(tool.args, 'json') : null}
      {tool.result ? (
        <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
          <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">工具输出</p>
          <div className="space-y-3">{renderMarkdown(tool.result)}</div>
        </div>
      ) : null}
    </div>
  )
}

function InlineToolCard({ tool, compact = false }: { tool: ToolCallState; compact?: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Wrench className="h-4 w-4 shrink-0 text-cyan-200" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{tool.toolName}</p>
            <p className="truncate text-xs text-slate-400">{tool.callId ?? 'tool call'}</p>
          </div>
        </div>
        <div className={cn('shrink-0 rounded-full px-2 py-1 text-[11px] uppercase tracking-[0.18em]', tool.status === 'completed' ? 'bg-emerald-300/15 text-emerald-100' : 'bg-amber-300/15 text-amber-100')}>
          {tool.status === 'completed' ? (
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Done</span>
          ) : (
            'Running'
          )}
        </div>
      </div>
      {!compact && tool.args ? renderCodeBlock(tool.args, 'json') : null}
      {!compact && tool.result ? (
        <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
          <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">Tool output</p>
          <div className="space-y-3">{renderMarkdown(tool.result)}</div>
        </div>
      ) : null}
    </div>
  )
}

function ToolCallShelf({ message }: { message: Message }) {
  const attachedTools = message.kind === 'tool' && message.tool ? [message.tool] : message.tools ?? []
  if (attachedTools.length === 0) {
    return null
  }

  const sortedTools = [...attachedTools].sort((left, right) => (left.updatedAt ?? 0) - (right.updatedAt ?? 0))
  const latestTool = sortedTools[sortedTools.length - 1]

  if (message.streaming) {
    return (
      <div className="mt-4 border-t border-white/10 pt-3">
        <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">Latest tool call</p>
        <InlineToolCard tool={latestTool} compact />
      </div>
    )
  }

  return (
    <details className="group mt-4 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/45">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs text-slate-300 transition hover:bg-white/5">
        <span className="inline-flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5 text-cyan-200" />
          Tool calls ({sortedTools.length})
        </span>
        <ChevronDown className="h-4 w-4 text-slate-500 transition group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-white/10 p-3">
        {sortedTools.map((tool, index) => (
          <InlineToolCard key={tool.callId ?? `${tool.toolName}-${index}`} tool={tool} />
        ))}
      </div>
    </details>
  )
}

export function MessageBubble({ message }: { message: Message }) {
  const isAssistant = message.role === 'assistant'
  const isSystem = message.role === 'system'
  const badge = message.label ?? (isAssistant ? 'assistant' : message.role)
  const Icon = isSystem ? (message.tone === 'error' ? TriangleAlert : Info) : isAssistant ? Bot : User2

  return (
    <motion.article
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className={cn('flex gap-3', isAssistant || isSystem ? 'justify-start' : 'justify-end')}
    >
      {(isAssistant || isSystem) && (
        <div
          className={cn(
            'mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl',
            isSystem
              ? message.tone === 'error'
                ? 'bg-rose-400/15 text-rose-100'
                : 'bg-amber-300/15 text-amber-100'
              : 'bg-cyan-400/15 text-cyan-100',
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      )}

      <div
        className={cn(
          'max-w-[78%] rounded-[24px] border px-4 py-3 text-sm leading-6 shadow-[0_18px_45px_rgba(0,0,0,0.18)]',
          isSystem
            ? message.tone === 'error'
              ? 'border-rose-300/20 bg-rose-400/10 text-rose-50'
              : 'border-amber-300/20 bg-amber-300/10 text-amber-50'
            : isAssistant
              ? 'border-white/10 bg-white/5 text-slate-100'
              : 'border-cyan-300/20 bg-cyan-400/15 text-cyan-50',
        )}
      >
        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
          {badge}
          {message.streaming ? <span className="text-cyan-200">输出中</span> : null}
        </div>
        {message.kind === 'tool' ? (
          <ToolCard message={message} />
        ) : (
          <div className="space-y-3">
            {renderMarkdown(message.content)}
            <ToolCallShelf message={message} />
          </div>
        )}
      </div>

      {!isAssistant && !isSystem && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-slate-200">
          <User2 className="h-4 w-4" />
        </div>
      )}
    </motion.article>
  )
}
