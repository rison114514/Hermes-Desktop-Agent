import { FileText, LoaderCircle } from 'lucide-react'
import { useWorkspaceStore } from '@/store/workspace'
import { CollapsibleSection } from './CollapsibleSection'

export function FilePreview() {
  const preview = useWorkspaceStore((state) => state.preview)
  const previewLoading = useWorkspaceStore((state) => state.previewLoading)
  const selectedFilePath = useWorkspaceStore((state) => state.selectedFilePath)

  return (
    <CollapsibleSection title="文件预览" icon={<FileText className="h-4 w-4 text-cyan-200" />}>
      {previewLoading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-white/6 bg-slate-950/50 px-3 py-4 text-sm text-slate-300">
          <LoaderCircle className="h-4 w-4 animate-spin text-cyan-200" />
          正在读取文件内容...
        </div>
      ) : preview ? (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/85">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs text-slate-300">
            <span className="truncate">{preview.path}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] uppercase tracking-[0.22em] text-cyan-200">
              {preview.language}
            </span>
          </div>
          <pre className="max-h-72 overflow-auto px-4 py-3 text-[12px] leading-6 text-slate-100">
            <code>{preview.content}</code>
          </pre>
          {preview.truncated ? (
            <div className="border-t border-white/10 px-4 py-2 text-xs text-amber-200">
              预览内容过长，当前仅展示前 12000 个字符。
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 px-3 py-4 text-sm text-slate-400">
          {selectedFilePath ? '当前文件暂无可预览内容。' : '点击左侧文件树中的文件后，可在这里查看内容预览。'}
        </div>
      )}
    </CollapsibleSection>
  )
}
