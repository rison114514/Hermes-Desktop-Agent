import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Puzzle, Save, Sparkles } from 'lucide-react'
import { getTabType, type WorkbenchTab } from '@/store/sessions'
import { useChatStore } from '@/store/chat'
import { useWorkspaceStore } from '@/store/workspace'
import { ModelConfigPage } from '@/panels/SkillsPanel/ModelConfig'
import { MessageList } from '@/panels/ChatPanel/MessageList'
import { InputBar } from '@/panels/ChatPanel/InputBar'
import { PermissionRequestCard } from '@/panels/ChatPanel/PermissionRequestCard'
import { SessionSwitcher } from '@/panels/ChatPanel/SessionSwitcher'
import { SSHPanel } from '@/components/SSHPanel'
import { useModsStore } from '@/store/mods'
import { ProjectPreviewPage } from '@/components/ProjectPreviewPage'

type WorkbenchTabContentProps = {
  tab: WorkbenchTab | null | undefined
}

export function WorkbenchTabContent({ tab }: WorkbenchTabContentProps) {
  const kind = getTabType(tab)
  if (!tab) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        暂无标签页
      </div>
    )
  }

  if (kind === 'normal') {
    if (tab.pageId === 'model-config') return <ModelConfigPage />
    if (tab.pageId === 'project-preview') return <ProjectPreviewPage tab={tab} />
    return <UnknownPage title={tab.name} />
  }

  if (kind === 'mod') {
    if (tab.rendererType === 'ssh-manager') return <SSHPanel variant="page" />
    if (tab.rendererType === 'persona-editor') return <PersonaEditorPage tab={tab} />
    return <UnknownPage title={tab.name} />
  }

  return <SessionTabContent tab={tab} />
}

function SessionTabContent({ tab }: { tab: WorkbenchTab }) {
  const connectionLabel = useChatStore((state) => state.connectionLabel)
  const permissionRequests = useChatStore((state) => state.permissionRequests)
  const session = useWorkspaceStore((state) => state.session)
  const sessionTitle = useWorkspaceStore((state) => state.sessionTitle)
  const [showSessionSwitcher, setShowSessionSwitcher] = useState(false)
  const sessionId = tab.sessionId ?? tab.id

  const visiblePermissionRequests = useMemo(
    () => permissionRequests.filter((request) => (request.sessionId ?? 'default') === sessionId),
    [permissionRequests, sessionId],
  )
  const displayName = tab.name || sessionTitle || session.slice(0, 24)

  return (
    <>
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.32em] text-cyan-200/70">对话</p>
          <button
            type="button"
            onClick={() => setShowSessionSwitcher((value) => !value)}
            className="mt-1 flex items-center gap-2 text-xl font-semibold text-white transition hover:text-cyan-100"
          >
            <span className="max-w-[260px] truncate">{displayName}</span>
            <ChevronDown className={`h-4 w-4 text-slate-400 transition ${showSessionSwitcher ? 'rotate-180' : ''}`} />
          </button>
          {showSessionSwitcher ? <SessionSwitcher onClose={() => setShowSessionSwitcher(false)} /> : null}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
          <Sparkles className="h-4 w-4 text-cyan-200" />
          {connectionLabel}
        </div>
      </div>

      <MessageList sessionId={sessionId} />
      {visiblePermissionRequests.length ? (
        <div className="border-t border-white/10 px-6 py-4">
          <div className="space-y-3">
            {visiblePermissionRequests.map((request) => (
              <PermissionRequestCard key={request.requestId} request={request} />
            ))}
          </div>
        </div>
      ) : null}
      <InputBar sessionId={sessionId} />
    </>
  )
}

function UnknownPage({ title }: { title: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center">
      <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
        <Puzzle className="mx-auto mb-3 h-5 w-5 text-slate-500" />
        <p className="text-sm text-slate-300">{title}</p>
        <p className="mt-1 text-xs text-slate-500">此标签页暂未提供渲染器。</p>
      </div>
    </div>
  )
}

type PersonaDetail = {
  id: string
  name: string
  icon: string
  description: string
  activation: string
}

function PersonaEditorPage({ tab }: { tab: WorkbenchTab }) {
  const personaId = String(tab.payload?.personaId ?? '')
  const [detail, setDetail] = useState<PersonaDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const markModsReady = useModsStore((state) => state.markModsReady)

  useEffect(() => {
    if (!personaId || !window.hermesDesktop?.callModIpc) return
    setLoading(true)
    window.hermesDesktop.callModIpc('hermes-persona', 'get-persona-detail', { id: personaId })
      .then((result) => {
        const payload = result as { ok?: boolean; persona?: PersonaDetail; error?: string }
        if (payload.ok && payload.persona) setDetail(payload.persona)
        else setStatus(payload.error ?? '读取人格失败')
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : '读取人格失败'))
      .finally(() => setLoading(false))
  }, [personaId])

  const save = async () => {
    if (!detail || !window.hermesDesktop?.callModIpc) return
    setSaving(true)
    setStatus('')
    try {
      const result = await window.hermesDesktop.callModIpc('hermes-persona', 'save-persona', { persona: detail })
      const payload = result as { ok?: boolean; error?: string }
      setStatus(payload.ok ? '已保存人格提示词' : payload.error ?? '保存失败')
      if (payload.ok) markModsReady()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !detail) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        {status || '正在读取人格...'}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-fuchsia-200/70">人格编辑</p>
          <h2 className="mt-1 text-xl font-semibold text-white">{detail.name}</h2>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="flex items-center gap-2 rounded-full border border-fuchsia-300/25 bg-fuchsia-300/10 px-4 py-2 text-sm text-fuchsia-100 transition hover:bg-fuchsia-300/18 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <input
            value={detail.icon}
            onChange={(event) => setDetail({ ...detail, icon: event.target.value })}
            className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-fuchsia-300/50"
            placeholder="图标"
          />
          <input
            value={detail.name}
            onChange={(event) => setDetail({ ...detail, name: event.target.value })}
            className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-fuchsia-300/50"
            placeholder="人格名称"
          />
        </div>
        <input
          value={detail.description}
          onChange={(event) => setDetail({ ...detail, description: event.target.value })}
          className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-fuchsia-300/50"
          placeholder="描述"
        />
        <textarea
          value={detail.activation}
          onChange={(event) => setDetail({ ...detail, activation: event.target.value })}
          className="min-h-[420px] w-full resize-none rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm leading-6 text-slate-100 outline-none focus:border-fuchsia-300/50"
          placeholder="人格提示词"
        />
        {status ? <p className="text-sm text-slate-400">{status}</p> : null}
      </div>
    </div>
  )
}
