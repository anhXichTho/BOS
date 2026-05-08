/**
 * ProjectWorkspacePanel — right-side workspace shown next to the project
 * chat thread. Round-10.
 *
 * Three sections (top→bottom):
 *   1. Top — quick tasks linked to this project. Up to 5 visible; the row
 *      itself is a small card with a tick-to-complete checkbox + title +
 *      created-time. Click → opens TaskView side panel for full detail.
 *   2. Middle — toggle: Workflows | Tài liệu (documents).
 *   3. Bottom — workflows runs + templates for this project (when on
 *      Workflows view) OR project's chat-attachment files (Tài liệu view)
 *      + an "Đính kèm" button to upload a file directly to the project chat.
 *
 * Behaviour:
 *   - Default: open. User can collapse via the chevron at top.
 *   - Collapse state persisted per-user in localStorage:
 *     `bos_project_panel_collapsed_<userId>`.
 *   - Re-renders cheaply: each section uses its own React-Query subscription.
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  ChevronRight, ChevronLeft, CheckSquare, Square, Plus, FileText,
  GitBranch, Paperclip, Loader2,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'
import { openPanel } from '../../lib/sidePanelStore'
import QuickTaskModal from '../tasks/QuickTaskModal'
import StartWorkflowFromChatModal from '../chat/StartWorkflowFromChatModal'
import ProjectWorkflowShortlist from '../projects/ProjectWorkflowShortlist'
import type { QuickTask } from '../../types'

interface Props {
  projectId: string
  projectTitle?: string
}

type ViewMode = 'workflows' | 'documents'

const COLLAPSE_KEY = (uid: string) => `bos_project_panel_collapsed_${uid}`

export default function ProjectWorkspacePanel({ projectId, projectTitle }: Props) {
  const { user, isAdmin, isEditor } = useAuth()
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (!user?.id) return false
    return localStorage.getItem(COLLAPSE_KEY(user.id)) === '1'
  })
  const [view, setView] = useState<ViewMode>('workflows')
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [showStartWorkflow, setShowStartWorkflow] = useState(false)
  const [showTaskListExpanded, setShowTaskListExpanded] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    localStorage.setItem(COLLAPSE_KEY(user.id), collapsed ? '1' : '0')
  }, [collapsed, user?.id])

  if (collapsed) {
    return (
      <div className="hidden md:flex w-9 shrink-0 border-l border-neutral-100 bg-neutral-25 flex-col items-center py-2">
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 text-neutral-500 hover:text-primary-700 hover:bg-primary-50 rounded transition-colors"
          title="Mở panel dự án"
        >
          <ChevronLeft size={14} />
        </button>
        <span
          className="mt-2 text-[10px] tracking-widest text-neutral-400 uppercase"
          style={{ writingMode: 'vertical-rl' }}
        >
          Dự án
        </span>
      </div>
    )
  }

  return (
    <aside className="hidden md:flex w-[352px] shrink-0 border-l border-neutral-100 bg-neutral-25 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.04)] bg-white">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 truncate">
          Workspace · {projectTitle ?? 'Dự án'}
        </span>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 text-neutral-400 hover:text-neutral-700 rounded transition-colors"
          title="Thu gọn"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Tasks section — always at top */}
      <TasksSection
        projectId={projectId}
        canManage={!!(user?.id) && (isAdmin || isEditor || true /* creator/assignee handled via RLS */)}
        onCreateTask={() => setShowCreateTask(true)}
        expanded={showTaskListExpanded}
        onToggleExpanded={() => setShowTaskListExpanded(e => !e)}
        onToggleStatus={async (task) => {
          const next = task.status === 'done' ? 'open' : 'done'
          const { error } = await supabase.from('quick_tasks').update({
            status:       next,
            completed_at: next === 'done' ? new Date().toISOString() : null,
            updated_at:   new Date().toISOString(),
          }).eq('id', task.id)
          if (error) { toastError(error.message); return }
          success(next === 'done' ? 'Đã đánh dấu xong' : 'Đã hoàn tác')
          qc.invalidateQueries({ queryKey: ['project-tasks', projectId] })
        }}
      />

      {/* View toggle */}
      <div className="flex border-t border-neutral-100 px-3 py-2 gap-1 shrink-0">
        <button
          onClick={() => setView('workflows')}
          className={`flex-1 px-2 py-1 text-[13px] rounded transition-colors inline-flex items-center justify-center gap-1.5 ${
            view === 'workflows' ? 'bg-primary-100 text-primary-700 font-semibold' : 'text-neutral-500 hover:bg-neutral-50'
          }`}
        >
          <GitBranch size={12} /> Nghiệp vụ
        </button>
        <button
          onClick={() => setView('documents')}
          className={`flex-1 px-2 py-1 text-[13px] rounded transition-colors inline-flex items-center justify-center gap-1.5 ${
            view === 'documents' ? 'bg-primary-100 text-primary-700 font-semibold' : 'text-neutral-500 hover:bg-neutral-50'
          }`}
        >
          <FileText size={12} /> Tài liệu
        </button>
      </div>

      {/* Bottom section */}
      <div className="flex-1 overflow-y-auto">
        {view === 'workflows' ? (
          <WorkflowsSection
            projectId={projectId}
            onStartWorkflow={() => setShowStartWorkflow(true)}
          />
        ) : (
          <DocumentsSection projectId={projectId} />
        )}
      </div>

      {/* Modals */}
      {showCreateTask && (
        <QuickTaskModal
          open
          onClose={() => setShowCreateTask(false)}
          projectId={projectId}
          chatContext={{ type: 'project', id: projectId }}
        />
      )}
      {showStartWorkflow && (
        <StartWorkflowFromChatModal
          open
          onClose={() => setShowStartWorkflow(false)}
          contextType="project"
          contextId={projectId}
        />
      )}
    </aside>
  )
}

// ─── Tasks section ────────────────────────────────────────────────────────────

function TasksSection({
  projectId, onCreateTask, expanded, onToggleExpanded, onToggleStatus,
}: {
  projectId: string
  canManage: boolean
  onCreateTask: () => void
  expanded: boolean
  onToggleExpanded: () => void
  onToggleStatus: (task: QuickTask) => void | Promise<void>
}) {
  const { data: tasks = [] } = useQuery({
    queryKey: ['project-tasks', projectId],
    queryFn: async () => {
      // Tasks linked to this project explicitly
      const { data, error } = await supabase
        .from('quick_tasks')
        .select('id, title, status, created_at, due_date, project_id')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) {
        console.warn('[ProjectWorkspacePanel] tasks query failed:', error.message)
        return [] as QuickTask[]
      }
      return (data ?? []) as QuickTask[]
    },
    staleTime: 30_000,
    retry: false,
  })

  const open = tasks.filter(t => t.status === 'open')
  const visible = expanded ? open : open.slice(0, 5)
  const overflow = open.length - visible.length

  return (
    <div className="border-b border-neutral-100">
      <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Việc cần làm ({open.length})
        </span>
        <button
          onClick={onCreateTask}
          className="text-xs inline-flex items-center gap-1 text-primary-600 hover:text-primary-700"
          title="Tạo việc mới cho dự án"
        >
          <Plus size={11} /> Tạo
        </button>
      </div>

      {open.length === 0 && (
        <p className="text-xs text-neutral-400 italic px-3 pb-3">Chưa có việc nào.</p>
      )}

      {visible.map(t => (
        <TaskRow key={t.id} task={t} onToggle={() => onToggleStatus(t)} />
      ))}

      {overflow > 0 && (
        <button
          onClick={onToggleExpanded}
          className="w-full text-xs text-primary-600 hover:bg-neutral-50 py-1.5"
        >
          {expanded ? 'Thu gọn' : `Xem thêm ${overflow} việc`}
        </button>
      )}
    </div>
  )
}

function TaskRow({ task, onToggle }: { task: QuickTask; onToggle: () => void }) {
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 hover:bg-neutral-50 transition-colors group">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        className="mt-0.5 text-neutral-400 hover:text-emerald-600 transition-colors shrink-0"
        title="Đánh dấu xong"
      >
        {task.status === 'done' ? <CheckSquare size={14} className="text-emerald-600" /> : <Square size={14} />}
      </button>
      <button
        type="button"
        onClick={() => openPanel({ id: task.id, kind: 'task_view', title: task.title })}
        className="flex-1 min-w-0 text-left"
      >
        <p className={`text-[13px] truncate ${task.status === 'done' ? 'line-through text-neutral-400' : 'text-neutral-800'}`}>
          {task.title}
        </p>
        <p className="text-[11px] text-neutral-400">
          {formatDistanceToNow(new Date(task.created_at), { addSuffix: true, locale: vi })}
          {task.due_date && ` · Hạn ${new Date(task.due_date).toLocaleDateString('vi')}`}
        </p>
      </button>
    </div>
  )
}

// ─── Workflows section ────────────────────────────────────────────────────────

function WorkflowsSection({
  projectId, onStartWorkflow,
}: {
  projectId: string
  onStartWorkflow: () => void
}) {
  const { data: runs = [] } = useQuery({
    queryKey: ['project-workflow-runs', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_runs')
        .select('id, template_name, status, started_at, run_by:profiles!run_by(full_name)')
        .eq('project_id', projectId)
        .order('started_at', { ascending: false })
        .limit(20)
      if (error) {
        console.warn('[ProjectWorkspacePanel] runs query failed:', error.message)
        return [] as Array<{ id: string; template_name: string; status: string; started_at: string }>
      }
      return (data ?? []) as Array<{ id: string; template_name: string; status: string; started_at: string }>
    },
    staleTime: 30_000,
    retry: false,
  })

  return (
    <div className="space-y-3 p-3">
      {/* Runs */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Đang & đã chạy ({runs.length})
        </span>
        <button
          onClick={onStartWorkflow}
          className="text-xs inline-flex items-center gap-1 text-primary-600 hover:text-primary-700"
        >
          <Plus size={11} /> Chạy mới
        </button>
      </div>

      {runs.length === 0 && (
        <p className="text-xs text-neutral-400 italic">Chưa có nghiệp vụ nào cho dự án này.</p>
      )}

      {runs.map(r => (
        <button
          key={r.id}
          onClick={() => openPanel({
            id: r.id, kind: 'workflow_run', title: `▶ ${r.template_name}`,
            meta: { context_type: 'project', context_id: projectId },
          })}
          className="w-full text-left bg-white border border-neutral-100 rounded p-2 hover:border-primary-200 hover:bg-primary-50/40 transition-colors"
        >
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
              r.status === 'completed' ? 'bg-green-100 text-green-700' :
              r.status === 'cancelled' ? 'bg-neutral-100 text-neutral-600' :
              'bg-[#F8E5D2] text-[#8C5022]'
            }`}>
              {r.status === 'completed' ? 'Xong' : r.status === 'cancelled' ? 'Huỷ' : 'Đang chạy'}
            </span>
            <span className="text-[11px] text-neutral-400 ml-auto">
              {formatDistanceToNow(new Date(r.started_at), { addSuffix: true, locale: vi })}
            </span>
          </div>
          <p className="text-[13px] font-medium text-neutral-800 truncate">{r.template_name}</p>
        </button>
      ))}

      {/* Round-10 follow-up: project-curated shortlist of available workflows */}
      <div className="border-t border-neutral-100 pt-3">
        <ProjectWorkflowShortlist
          projectId={projectId}
          compact
          onRunTemplate={() => onStartWorkflow()}
        />
      </div>
    </div>
  )
}

// ─── Documents section ────────────────────────────────────────────────────────

function DocumentsSection({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)

  // Pull all chat attachments tied to messages in THIS project's chat thread.
  const { data: attachments = [] } = useQuery({
    queryKey: ['project-attachments', projectId],
    queryFn: async () => {
      // 1. Get message ids in this project chat
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('id')
        .eq('context_type', 'project')
        .eq('context_id', projectId)
      const msgIds = (msgs ?? []).map((m: any) => m.id)
      if (msgIds.length === 0) return []
      // 2. Pull their attachments
      const { data, error } = await supabase
        .from('chat_attachments')
        .select('id, file_name, file_url, file_type, file_size, uploaded_at')
        .in('message_id', msgIds)
        .order('uploaded_at', { ascending: false })
        .limit(50)
      if (error) return []
      return data ?? []
    },
    staleTime: 30_000,
    retry: false,
  })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error('not signed in')
      setUploading(true)
      try {
        const path = `${projectId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${file.name}`
        const { error: upErr } = await supabase.storage
          .from('chat-attachments')
          .upload(path, file, { upsert: false })
        if (upErr) throw upErr
        const { data: pub } = supabase.storage.from('chat-attachments').getPublicUrl(path)
        // Post a message + attachment in the project chat
        const { data: msg, error: mErr } = await supabase.from('chat_messages').insert({
          context_type: 'project',
          context_id:   projectId,
          author_id:    user.id,
          message_type: 'text',
          content:      `Đính kèm tài liệu: ${file.name}`,
          mentions:     [],
        }).select('id').single()
        if (mErr) throw mErr
        const { error: aErr } = await supabase.from('chat_attachments').insert({
          message_id: msg.id,
          file_name:  file.name,
          file_url:   pub.publicUrl,
          file_type:  file.type || null,
          file_size:  file.size,
        })
        if (aErr) throw aErr
      } finally {
        setUploading(false)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-attachments', projectId] })
      qc.invalidateQueries({ queryKey: ['messages', projectId] })
      success('Đã đính kèm tài liệu')
    },
    onError: (e: any) => toastError(e?.message ?? 'Không tải lên được'),
  })

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Tài liệu ({attachments.length})
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="text-xs inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 disabled:opacity-50"
        >
          {uploading ? <Loader2 size={11} className="animate-spin" /> : <Paperclip size={11} />}
          Đính kèm
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) upload.mutate(f)
            if (fileInputRef.current) fileInputRef.current.value = ''
          }}
        />
      </div>

      {attachments.length === 0 && (
        <p className="text-xs text-neutral-400 italic">
          Chưa có tài liệu. Bấm "Đính kèm" để thêm.
        </p>
      )}

      {attachments.map((a: any) => (
        <a
          key={a.id}
          href={a.file_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block bg-white border border-neutral-100 rounded p-2 hover:border-primary-200 transition-colors"
        >
          <p className="text-[13px] text-neutral-800 truncate">{a.file_name}</p>
          <p className="text-[11px] text-neutral-400">
            {formatDistanceToNow(new Date(a.uploaded_at), { addSuffix: true, locale: vi })}
            {a.file_size && ` · ${(a.file_size / 1024).toFixed(0)} KB`}
          </p>
        </a>
      ))}
    </div>
  )
}
