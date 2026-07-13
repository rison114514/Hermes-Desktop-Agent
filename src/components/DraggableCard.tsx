import { useRef, useState, type DragEvent, type ReactNode } from 'react'

interface DraggableCardProps {
  id: string
  children: ReactNode
  onMove: (dragId: string, overId: string) => void
}

export function DraggableCard({ id, children, onMove }: DraggableCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const isSafeTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false
    if (target.closest('input, textarea, select, [contenteditable="true"], [data-no-card-drag]')) return true
    const control = target.closest('button, a')
    if (!control) return false
    const collapsedToggle = control.closest('[data-card-toggle]') && control.closest('[data-card-open="false"]')
    return !collapsedToggle
  }

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (isSafeTarget(e.target)) {
      e.preventDefault()
      return
    }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-hermes-sidebar-card', id)
    e.dataTransfer.setData('text/plain', id)
    if (cardRef.current) cardRef.current.style.opacity = '0.55'
  }

  const handleDragEnd = () => {
    if (cardRef.current) cardRef.current.style.opacity = '1'
    setDragOver(false)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(true)
  }

  const handleDragLeave = () => {
    setDragOver(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const dragId = e.dataTransfer.getData('application/x-hermes-sidebar-card') || e.dataTransfer.getData('text/plain')
    if (dragId && dragId !== id) {
      onMove(dragId, id)
    }
  }

  return (
    <div
      ref={cardRef}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group/card relative transition-all duration-150 ${
        dragOver
          ? 'rounded-2xl ring-2 ring-cyan-300/40 ring-offset-2 ring-offset-transparent'
          : ''
      }`}
    >
      {dragOver ? (
        <div className="absolute inset-0 z-10 rounded-2xl bg-cyan-300/5 pointer-events-none" />
      ) : null}
      {children}
    </div>
  )
}
