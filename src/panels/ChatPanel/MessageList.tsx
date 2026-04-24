import { useEffect, useRef } from 'react'
import { useChatStore } from '@/store/chat'
import { MessageBubble } from './MessageBubble'

export function MessageList() {
  const messages = useChatStore((state) => state.messages)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    container.scrollTop = container.scrollHeight
  }, [messages])

  return (
    <div ref={containerRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  )
}
