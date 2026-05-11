/**
 * TaskView — side-panel reader for a single Quick Task.
 * Round-9 Phase 6.
 */
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, RotateCcw, Trash2, ExternalLink, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import RichTextDisplay from '../ui/RichTextDisplay'
import { useToast } from '../ui/Toast'
import { closePanel } from '../../lib/sidePanelStore'
import type { QuickTask } from '../../types'

interface Props {
  taskId: string
}

export default function TaskView({ taskId }: Props) {
  const qc = useQueryClient()
  const { user, isAdmin, isEditor } = useAuth()
  const navigate = useNavigate()
  const { success, error: toastError } = useToast()

  const { data: task, isLoading } = useQuery({
    queryKey: ['quick-task', taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quick_tasks')
        .select('*, creator:profiles!created_by(full_name), assignee_user:profiles!assignee_user_id(full_name), assignee_group:user_groups!assignee_group_id(name)')
        .eq('id', taskId)
        .single()
      if (error) throw error
      return data as QuickTask
    },
  })

  const setStatus = useMutation({
    mutationFn: async (status: 'open' | 'done' | 'cancelled') => {
      const { error } = await supabase
        .from('quick_tasks')
        .update({
          status,
          completed_at: status === 'done' ? new Date().toISOString() : null,
          updated_at:   new Date().toISOString(),
        })
        .eq('id', taskId)
      if (error) throw error
    },
    onSuccess: (_d, status) => {
      qc.invalidateQueries({ queryKey: ['quick-task', taskId] })
      qc.invalidateQueries({ queryKey: ['quick-tasks'] })
      success(status === 'done' ? 'Đã đánh dấu xong' : 'Đã hoàn tác')
    },
    onError: (e: any) => toastError(e?.message ?? 'Có lỗi'),
  })

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('quick_tasks').delete().eq('id', taskId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quick-tasks'] })
      success('Đã xoá việc')
      closePanel()
    },
    onError: (e: any) => toastError(e?.message ?? 'Có lỗi'),
  })

  if (isLoading || !task) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-neutral-400" size={20} />
      </div>
    )
  }

  const isCreator = task.created_by === user?.id
  const isAssignee = task.assignee_user_id === user?.id
  const canManage = isCreator || isAssignee || isAdmin || isEditor
  const canDelete = isCreator || isAdmin || isEditor

  async function openSourceMessage() {
    if (!task!.source_message_id) return
    // Look up the source message's context to navigate
    const { data: msg } = await supabase
      .from('chat_messages')
      .select('context_type, context_id')
      .eq('id', task!.source_message_id)
      .maybeSingle()
    if (!msg) {
      toastError('Tin nhắn gốc không tồn tại')
      return
    }
    // Resolve the display name of the channel/project for the header
    let ctxName = ''
    if (msg.context_type === 'channel') {
      const { data: ch } = await supabase
        .from('chat_channels')
        .select('name')
        .eq('id', msg.context_id)
        .maybeSingle()
      ctxName = ch?.name ?? ''
    } else if (msg.context_type === 'project') {
      const { data: proj } = await supabase
        .from('projects')
        .select('title')
        .eq('id', msg.context_id)
        .maybeSingle()
      ctxName = (proj as any)?.title ?? ''
    }
    navigate(`/chat?ctx_type=${msg.context_type}&ctx_id=${msg.context_id}&ctx_name=${encodeURIComponent(ctxName)}&msg_id=${task!.source_message_id}`)
    closePanel()
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <h2 className="text-lg font-semibold text-neutral-900 mb-2">{task.title}</h2>

        {/* Metadata row */}
        <div className="flex flex-wrap gap-2 mb-3">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
            task.status === 'done' ? 'bg-green-100 text-green-700' :
            task.status === 'cancelled' ? 'bg-neutral-100 text-neutral-500' :
            'bg-amber-100 text-amber-700'
          }`}>
            {task.status === 'done' ? 'Đã xong' : task.status === 'cancelled' ? 'Đã huỷ' : 'Đang làm'}
          </span>
          {task.due_date && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-700">
              Hạn: {new Date(task.due_date).toLocaleDateString('vi')}
            </span>
          )}
        </div>

        {/* Assignee */}
        <div className="text-[13px] text-neutral-600 mb-1">
          <strong>Phụ trách:</strong>{' '}
          {task.assignee_user?.full_name && <>👤 {task.assignee_user.full_name}</>}
          {task.assignee_group?.name && <>🏷 {task.assignee_group.name}</>}
        </div>

        {/* Creator + time */}
        <div className="text-[12px] text-neutral-400 mb-4">
          Tạo bởi {task.creator?.full_name ?? '—'} · {formatDistanceToNow(new Date(task.created_at), { addSuffix: true, locale: vi })}
        </div>

        {/* Description */}
        {task.description_html && (
          <div className="mb-4">
            <p className="text-[11px] uppercase tracking-wider text-neutral-500 font-semibold mb-1">Mô tả</p>
            <RichTextDisplay content={task.description_html} className="text-[13px] text-neutral-700" />
          </div>
        )}

        {/* Source message link */}
        {task.source_message_id && (
          <button
            onClick={openSourceMessage}
            className="text-[12px] inline-flex items-center gap-1 text-primary-600 hover:underline"
          >
            <ExternalLink size={11} /> Mở tin nhắn gốc
          </button>
        )}
      </div>

      {/* Action bar */}
      {canManage && (
        <div className="border-t border-neutral-100 px-4 py-2 flex flex-wrap gap-2">
          {task.status !== 'done' && (
            <button
              onClick={() => setStatus.mutate('done')}
              className="text-[12px] px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 inline-flex items-center gap-1"
            >
              <CheckCircle2 size={12} /> Đánh dấu xong
            </button>
          )}
          {task.status === 'done' && (
            <button
              onClick={() => setStatus.mutate('open')}
              className="text-[12px] px-3 py-1.5 rounded bg-neutral-100 text-neutral-700 hover:bg-neutral-200 inline-flex items-center gap-1"
            >
              <RotateCcw size={12} /> Hoàn tác
            </button>
          )}
          {task.status !== 'cancelled' && task.status !== 'done' && (
            <button
              onClick={() => setStatus.mutate('cancelled')}
              className="text-[12px] px-3 py-1.5 rounded bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
            >
              Huỷ
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => {
                if (window.confirm('Xoá việc này? Không thể hoàn tác.')) remove.mutate()
              }}
              className="text-[12px] px-3 py-1.5 rounded bg-red-50 text-red-600 hover:bg-red-100 inline-flex items-center gap-1 ml-auto"
            >
              <Trash2 size={12} /> Xoá
            </button>
          )}
        </div>
      )}
    </div>
  )
}
