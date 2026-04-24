import { FormEvent, KeyboardEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import { useChatStore } from '@/store/chat'

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function InputBar() {
  const draft = useChatStore((state) => state.draft)
  const setDraft = useChatStore((state) => state.setDraft)
  const addMessage = useChatStore((state) => state.addMessage)
  const replaceMessage = useChatStore((state) => state.replaceMessage)
  const finalizeMessage = useChatStore((state) => state.finalizeMessage)
  const setActiveAssistant = useChatStore((state) => state.setActiveAssistant)
  const setConnectionLabel = useChatStore((state) => state.setConnectionLabel)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()

    const content = draft.trim()
    if (!content) {
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
      label: 'pending',
    })
    setActiveAssistant(assistantId)
    setConnectionLabel('Sending prompt to Hermes')
    setDraft('')

    if (!window.hermesDesktop) {
      replaceMessage(assistantId, 'Desktop bridge is unavailable in this renderer context.')
      finalizeMessage(assistantId)
      setActiveAssistant(null)
      setConnectionLabel('Bridge unavailable')
      return
    }

    try {
      await window.hermesDesktop.sendMessage(content)
    } catch (error) {
      replaceMessage(
        assistantId,
        `Unable to reach Hermes process: ${error instanceof Error ? error.message : 'unknown error'}`,
      )
      finalizeMessage(assistantId)
      setActiveAssistant(null)
      setConnectionLabel('Failed to send prompt')
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-white/10 px-6 py-5">
      <div className="flex items-end gap-3 rounded-[28px] border border-white/10 bg-slate-950/70 p-3 shadow-[0_24px_60px_rgba(0,0,0,0.24)]">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="输入消息，描述你想让 Hermes 处理的代码任务..."
          className="max-h-40 min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-300 text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      </div>
    </form>
  )
}
