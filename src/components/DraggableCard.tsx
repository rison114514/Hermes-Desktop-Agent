import { useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'

interface DraggableCardProps {
  id: string
  children: ReactNode
  onMove: (dragId: string, overId: string) => void
}

export function DraggableCard({ id, children, onMove }: DraggableCardProps) {
  const [dragOver, setDragOver] = useState(false)
  const [canDrag, setCanDrag] = useState(true)

  const isInteractiveTarget = (target: EventTarget | null) => {
    return target instanceof HTMLElement && Boolean(target.closest(
      'input, textarea, select, button, a, [contenteditable="true"], [data-no-card-drag]',
    ))
  }

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    setCanDrag(!isInteractiveTarget(e.target))
  }

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(e.target) || !canDrag) {
      e.preventDefault()
      return
    }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
  }

  const handleDragEnd = (e: DragEvent<HTMLDivElement>) => {
    ;(e.currentTarget as HTMLElement).style.opacity = '1'
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
    const dragId = e.dataTransfer.getData('text/plain')
    if (dragId && dragId !== id) {
      onMove(dragId, id)
    }
  }

  return (
    <div
      draggable={canDrag}
      onMouseDown={handleMouseDown}
      onMouseUp={() => setCanDrag(true)}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative transition-all duration-150 ${
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
