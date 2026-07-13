import { type DragEvent, type MouseEvent } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WorkbenchGroupNode, WorkbenchTab } from '@/store/sessions'

type WorkbenchTabsProps = {
  group: WorkbenchGroupNode
  tabs: WorkbenchTab[]
  activeId: string | null
  initializingIds: Set<string>
  dragOverTabId: string | null
  canCloseTabs: boolean
  onActivate: (tabId: string, groupId: string) => void
  onClose: (tabId: string, event: MouseEvent) => void
  onNew: (groupId: string) => void
  onDragOverTab: (tabId: string | null) => void
  onMoveTab: (dragId: string, overId: string, groupId: string) => void
}

export function WorkbenchTabs({
  group,
  tabs,
  activeId,
  initializingIds,
  dragOverTabId,
  canCloseTabs,
  onActivate,
  onClose,
  onNew,
  onDragOverTab,
  onMoveTab,
}: WorkbenchTabsProps) {
  const handleDragStart = (event: DragEvent<HTMLButtonElement>, tabId: string) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-hermes-tab', tabId)
    event.dataTransfer.setData('text/plain', tabId)
  }

  return (
    <div className="flex items-center border-b border-white/10 bg-slate-950/60 px-2">
      <div
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1"
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          event.preventDefault()
          onDragOverTab(null)
          const dragId = event.dataTransfer.getData('application/x-hermes-tab')
          if (dragId && !group.tabIds.includes(dragId)) onMoveTab(dragId, '', group.id)
        }}
      >
        {tabs.map((tab) => {
          const isInit = initializingIds.has(tab.id)
          const isActive = tab.id === group.activeTabId || tab.id === activeId
          return (
            <button
              key={tab.id}
              type="button"
              draggable={!isInit}
              onDragStart={(event) => handleDragStart(event, tab.id)}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                onDragOverTab(tab.id)
              }}
              onDragLeave={() => onDragOverTab(null)}
              onDrop={(event) => {
                event.preventDefault()
                onDragOverTab(null)
                const dragId = event.dataTransfer.getData('application/x-hermes-tab')
                if (dragId && dragId !== tab.id) onMoveTab(dragId, tab.id, group.id)
              }}
              onClick={() => onActivate(tab.id, group.id)}
              className={cn(
                'group flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-xs transition',
                isActive
                  ? 'border-t border-x border-white/10 bg-[var(--gradient-chat)] text-slate-100'
                  : 'text-slate-500 hover:bg-white/5 hover:text-slate-300',
                isInit && 'opacity-60',
                dragOverTabId === tab.id && 'ring-1 ring-cyan-300/40',
              )}
              title={tab.cwd ? `${tab.name} - ${tab.cwd}` : tab.name}
            >
              {isInit ? <Loader2 className="h-3 w-3 animate-spin text-cyan-200" /> : null}
              <span className="max-w-[140px] truncate">{isInit ? '启动中...' : tab.name}</span>
              {canCloseTabs && !isInit ? (
                <span
                  onClick={(event) => onClose(tab.id, event)}
                  onMouseDown={(event) => event.stopPropagation()}
                  draggable={false}
                  className="grid h-4 w-4 place-items-center rounded-full opacity-0 transition hover:bg-white/10 group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => onNew(group.id)}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-slate-300"
        title="新建会话"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
