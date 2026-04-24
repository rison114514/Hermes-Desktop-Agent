import { Sparkles } from 'lucide-react'
import { useChatStore } from '@/store/chat'
import { MessageList } from './MessageList'
import { InputBar } from './InputBar'

export function ChatPanel() {
  const connectionLabel = useChatStore((state) => state.connectionLabel)

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_42%)]">
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-cyan-200/70">Chat</p>
          <h1 className="mt-1 text-xl font-semibold text-white">Live coding control room</h1>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
          <Sparkles className="h-4 w-4 text-cyan-200" />
          {connectionLabel}
        </div>
      </div>

      <MessageList />
      <InputBar />
    </section>
  )
}
