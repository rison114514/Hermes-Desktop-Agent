import { ClipboardEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ClipboardPaste, Sparkles, Square } from 'lucide-react'
import { useChatStore } from '@/store/chat'
import { useSkillsStore } from '@/store/skills'
import { cn } from '@/lib/utils'

type SlashSuggestion = {
  id: string
  name: string
  description: string
  source: 'command' | 'skill'
}

const PASTE_SUMMARY_THRESHOLD = 800
const INPUT_MIN_HEIGHT = 48
const INPUT_MAX_HEIGHT = 260

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function parseSlashDraft(value: string) {
  const match = value.match(/^\s*\/([^\s/]*)?(?:\s+([\s\S]*))?$/)
  if (!match) {
    return null
  }

  return {
    query: match[1] ?? '',
    args: match[2]?.trimStart() ?? '',
  }
}

function describeSource(source: SlashSuggestion['source']) {
  return source === 'command' ? 'command' : 'skill'
}

export function InputBar() {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)
  const [showSlashSuggestions, setShowSlashSuggestions] = useState(false)
  const draft = useChatStore((state) => state.draft)
  const setDraft = useChatStore((state) => state.setDraft)
  const addMessage = useChatStore((state) => state.addMessage)
  const replaceMessage = useChatStore((state) => state.replaceMessage)
  const finalizeMessage = useChatStore((state) => state.finalizeMessage)
  const activeAssistantId = useChatStore((state) => state.activeAssistantId)
  const setActiveAssistant = useChatStore((state) => state.setActiveAssistant)
  const setConnectionLabel = useChatStore((state) => state.setConnectionLabel)
  const skills = useSkillsStore((state) => state.skills)
  const commands = useSkillsStore((state) => state.commands)

  const slashDraft = parseSlashDraft(draft)
  const suggestions = useMemo(() => {
    if (!slashDraft) {
      return []
    }

    const query = slashDraft.query.toLowerCase()
    const rows: SlashSuggestion[] = [
      ...commands.map((command) => ({
        id: `command-${command.id}`,
        name: command.name.replace(/^\/+/, ''),
        description: command.description || 'Hermes built-in command',
        source: 'command' as const,
      })),
      ...skills.map((skill) => ({
        id: `skill-${skill.id}`,
        name: skill.name.replace(/^\/+/, ''),
        description: skill.category ? `${skill.category}: ${skill.description}` : skill.description,
        source: 'skill' as const,
      })),
    ]

    return rows
      .filter((item) => {
        if (!query) {
          return true
        }

        return item.name.toLowerCase().includes(query) || item.description.toLowerCase().includes(query)
      })
      .slice(0, 8)
  }, [commands, slashDraft, skills])

  useEffect(() => {
    setActiveSuggestionIndex(0)
    setShowSlashSuggestions(Boolean(slashDraft))
  }, [slashDraft?.query])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    textarea.style.height = `${INPUT_MIN_HEIGHT}px`
    textarea.style.height = `${Math.min(textarea.scrollHeight, INPUT_MAX_HEIGHT)}px`
    textarea.style.overflowY = textarea.scrollHeight > INPUT_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [draft])

  const completeSuggestion = (suggestion: SlashSuggestion) => {
    const slash = parseSlashDraft(draft)
    const nextDraft = `/${suggestion.name}${slash?.args ? ` ${slash.args}` : ' '}`
    setDraft(nextDraft)
    setShowSlashSuggestions(false)

    window.setTimeout(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextDraft.length, nextDraft.length)
    }, 0)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()

    const content = draft.trim()
    if (!content) {
      return
    }

    const slash = parseSlashDraft(content)
    if (slash && !slash.query) {
      setConnectionLabel('Please choose or type a Hermes command after /.')
      return
    }

    const userId = createId('user')
    const assistantId = createId('assistant')

    addMessage({ id: userId, role: 'user', content })
    addMessage({
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
      label: 'Waiting',
    })
    setActiveAssistant(assistantId)
    setConnectionLabel(slash ? `Sending Hermes command /${slash.query}` : 'Sending message to Hermes')
    setDraft('')

    if (!window.hermesDesktop) {
      replaceMessage(assistantId, 'Desktop bridge is not available.')
      finalizeMessage(assistantId)
      setActiveAssistant(null)
      setConnectionLabel('Desktop bridge unavailable')
      return
    }

    try {
      await window.hermesDesktop.sendMessage(content)
    } catch (error) {
      replaceMessage(
        assistantId,
        `Unable to connect to Hermes: ${error instanceof Error ? error.message : 'unknown error'}`,
      )
      finalizeMessage(assistantId)
      setActiveAssistant(null)
      setConnectionLabel('Send failed')
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text')
    if (text.length < PASTE_SUMMARY_THRESHOLD) {
      return
    }

    event.preventDefault()

    const target = event.currentTarget
    const summary = `[pasted ${text.length} chars]`
    const selectionStart = target.selectionStart
    const selectionEnd = target.selectionEnd
    const nextDraft = `${draft.slice(0, selectionStart)}${summary}${draft.slice(selectionEnd)}`
    const nextCursor = selectionStart + summary.length

    setDraft(nextDraft)
    setShowSlashSuggestions(Boolean(parseSlashDraft(nextDraft)))
    window.setTimeout(() => {
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
    }, 0)
  }

  const handleCancel = async () => {
    if (!window.hermesDesktop || !activeAssistantId) {
      return
    }

    setConnectionLabel('Cancelling current Hermes turn')
    try {
      await window.hermesDesktop.cancelMessage()
    } catch (error) {
      setConnectionLabel(error instanceof Error ? error.message : 'Cancel failed')
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return
    }

    if (slashDraft && showSlashSuggestions && suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveSuggestionIndex((index) => (index + 1) % suggestions.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveSuggestionIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        completeSuggestion(suggestions[activeSuggestionIndex] ?? suggestions[0])
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setShowSlashSuggestions(false)
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative border-t border-white/10 px-6 py-5">
      {slashDraft && showSlashSuggestions ? (
        <div className="absolute bottom-[5.75rem] left-6 right-6 z-10 overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-xs text-slate-300">
            <Sparkles className="h-3.5 w-3.5 text-cyan-200" />
            <span>/</span>
            <span className="text-slate-500">Hermes commands and skills</span>
          </div>
          {suggestions.length > 0 ? (
            <div className="max-h-72 overflow-y-auto py-2">
              {suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    completeSuggestion(suggestion)
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm transition',
                    index === activeSuggestionIndex ? 'bg-cyan-300/12 text-cyan-50' : 'text-slate-200 hover:bg-white/5',
                  )}
                >
                  <span className="mt-0.5 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
                    {describeSource(suggestion.source)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">/{suggestion.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-400">{suggestion.description}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-4 py-3 text-sm text-slate-400">No matching Hermes command or skill.</div>
          )}
        </div>
      ) : null}

      <div className="flex items-end gap-3 rounded-[28px] border border-white/10 bg-slate-950/70 p-3 shadow-[0_24px_60px_rgba(0,0,0,0.24)]">
        <div className="min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setShowSlashSuggestions(Boolean(parseSlashDraft(event.target.value)))
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            placeholder="Message Hermes, or type / for commands and skills..."
            className="block min-h-12 w-full resize-none bg-transparent px-2 py-2 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500"
          />
          {draft.includes('[pasted ') ? (
            <div className="flex items-center gap-1 px-2 pt-1 text-[11px] text-slate-500">
              <ClipboardPaste className="h-3 w-3" />
              <span>Large paste summarized in the prompt.</span>
            </div>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={!draft.trim()}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cyan-300 text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          title="Send"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
        {activeAssistantId ? (
          <button
            type="button"
            onClick={() => void handleCancel()}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-rose-300/25 bg-rose-300/10 text-rose-100 transition hover:bg-rose-300/18"
            title="Cancel current turn"
          >
            <Square className="h-4 w-4 fill-current" />
          </button>
        ) : null}
      </div>
    </form>
  )
}
