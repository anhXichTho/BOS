/**
 * QuickTaskModal — create or edit a Quick Task.
 *
 * Round-9. Lightweight: title required, description optional (rich text on
 * demand), assignee = single user OR group (mutually exclusive), optional
 * due date, optional source_message_id pre-fill from chat hover-action.
 */
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Type } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import RichTextEditor from '../ui/RichTextEditor'

interface Props {
  open: boolean
  onClose: () => void
  /** Pre-fill title (e.g. from a chat message hover-create flow). */
  initialTitle?: string
  /** Optional source message link. */
  sourceMessageId?: string | null
  /** When set, modal edits this task instead of creating. */
  editingTaskId?: string | null
  /** Round-10: when set, the modal posts a quick_task rich card to that
   *  chat thread after a successful CREATE (not edit). */
  chatContext?: { type: 'channel' | 'project'; id: string } | null
  /** Round-10: when set, the task gets quick_tasks.project_id = projectId so
   *  it shows up in the project workspace's task list. */
  projectId?: string | null
}

export default function QuickTaskModal({ open, onClose, initialTitle, sourceMessageId, editingTaskId, chatContext, projectId }: Props) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()

  const [title, setTitle] = useState('')
  const [richMode, setRichMode] = useState(false)
  const [description, setDescription] = useState('')
  const [assigneeKind, setAssigneeKind] = useState<'user' | 'group'>('user')
  const [assigneeUserId, setAssigneeUserId] = useState<string>('')
  const [assigneeGroupId, setAssigneeGroupId] = useState<string>('')
  const [dueDate, setDueDate] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  // Reset on open
  useEffect(() => {
    if (!open) return
    setTitle(initialTitle ?? '')
    setRichMode(false)
    setDescription('')
    setAssigneeKind('user')
    setAssigneeUserId(user?.id ?? '')
    setAssigneeGroupId('')
    setDueDate('')
  }, [open, initialTitle, user?.id])

  // If editing, load task data
  const { data: editing } = useQuery({
    queryKey: ['quick-task-edit', editingTaskId],
    queryFn: async () => {
      if (!editingTaskId) return null
      const { data, error } = await supabase.from('quick_tasks').select('*').eq('id', editingTaskId).single()
      if (error) throw error
      return data
    },
    enabled: !!editingTaskId && open,
  })

  useEffect(() => {
    if (!editing) return
    setTitle(editing.title ?? '')
    setRichMode(!!editing.description_html)
    setDescription(editing.description_html ?? '')
    if (editing.assignee_group_id) {
      setAssigneeKind('group')
      setAssigneeGroupId(editing.assignee_group_id)
    } else {
      setAssigneeKind('user')
      setAssigneeUserId(editing.assignee_user_id ?? '')
    }
    setDueDate(editing.due_date ?? '')
  }, [editing])

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles-brief'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name').order('full_name')
      return (data ?? []) as { id: string; full_name: string }[]
    },
    staleTime: 300_000,
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['user-groups-brief'],
    queryFn: async () => {
      const { data } = await supabase.from('user_groups').select('id, name').order('name')
      return (data ?? []) as { id: string; name: string }[]
    },
    staleTime: 300_000,
  })

  const upsertTask = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Phải đăng nhập')
      const trimmed = title.trim()
      if (!trimmed) throw new Error('Vui lòng nhập tiêu đề')
      if (assigneeKind === 'user' && !assigneeUserId) throw new Error('Chọn người phụ trách')
      if (assigneeKind === 'group' && !assigneeGroupId) throw new Error('Chọn nhóm phụ trách')

      const row: Record<string, unknown> = {
        title:             trimmed,
        description_html:  richMode && description.trim() ? description : null,
        assignee_user_id:  assigneeKind === 'user' ? assigneeUserId : null,
        assignee_group_id: assigneeKind === 'group' ? assigneeGroupId : null,
        due_date:          dueDate || null,
        updated_at:        new Date().toISOString(),
      }

      if (editingTaskId) {
        const { error } = await supabase.from('quick_tasks').update(row).eq('id', editingTaskId)
        if (error) throw error
      } else {
        row.created_by = user.id
        if (sourceMessageId) row.source_message_id = sourceMessageId
        // Round-10: project linkage. Either explicitly via prop OR auto-derived
        // when the chat context is a project.
        const finalProjectId = projectId ?? (chatContext?.type === 'project' ? chatContext.id : null)
        if (finalProjectId) row.project_id = finalProjectId

        // Try insert. If migration #34 hasn't run yet (project_id column not in
        // PostgREST schema cache), retry without the project_id so task
        // creation still succeeds. Same shape for the schema-cache error.
        async function tryInsert(payload: Record<string, unknown>) {
          return await supabase
            .from('quick_tasks')
            .insert(payload)
            .select('id, title, due_date, assignee_user:profiles!assignee_user_id(full_name), assignee_group:user_groups!assignee_group_id(name)')
            .single()
        }
        let { data: created, error } = await tryInsert(row)
        if (error && /project_id/i.test(error.message) && /schema cache|column/i.test(error.message)) {
          console.warn('[QuickTaskModal] project_id column missing — retrying without it. Run migration_phase_quick_task_project_link.sql to enable project-scoped tasks.')
          const { project_id: _drop, ...rest } = row as any
          ;({ data: created, error } = await tryInsert(rest))
        }
        if (error) throw error

        // Round-10: post a quick_task rich card so the team sees the new task
        // inline. Only on CREATE; edits don't re-post.
        if (chatContext && created?.id) {
          const assigneeLabel =
            (created as any).assignee_user?.full_name
              ? `👤 ${(created as any).assignee_user.full_name}`
              : (created as any).assignee_group?.name
                ? `🏷 ${(created as any).assignee_group.name}`
                : undefined
          const { error: cardErr } = await supabase.from('chat_messages').insert({
            context_type: chatContext.type,
            context_id:   chatContext.id,
            author_id:    user.id,
            message_type: 'rich_card',
            content:      null,
            payload: {
              kind:           'quick_task',
              task_id:        created.id,
              title:          (created as any).title,
              assignee_label: assigneeLabel,
              due_date:       (created as any).due_date ?? null,
              status:         'open',
            },
          })
          if (cardErr) console.warn('[QuickTaskModal] post card failed:', cardErr.message)
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quick-tasks'] })
      qc.invalidateQueries({ queryKey: ['quick-task'] })
      success(editingTaskId ? 'Đã cập nhật việc' : 'Đã tạo việc mới')
      onClose()
    },
    onError: (e: any) => toastError(e?.message ?? 'Có lỗi'),
  })

  async function submit() {
    setSubmitting(true)
    try { await upsertTask.mutateAsync() } finally { setSubmitting(false) }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingTaskId ? 'Sửa việc' : 'Tạo việc mới'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} disabled={submitting || !title.trim()}>
            {submitting ? 'Đang lưu...' : (editingTaskId ? 'Lưu' : 'Tạo việc')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Tiêu đề
          </label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="VD: Mua giấy in cho VP"
            className="mt-1 w-full px-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-100"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Mô tả (tuỳ chọn)
            </label>
            <button
              onClick={() => setRichMode(r => !r)}
              className={`text-[11px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${richMode ? 'bg-primary-100 text-primary-700' : 'text-neutral-500 hover:bg-neutral-100'}`}
              title="Bật/tắt rich text"
            >
              <Type size={10} /> Rich
            </button>
          </div>
          {richMode ? (
            <RichTextEditor value={description} onChange={setDescription} placeholder="Mô tả chi tiết..." />
          ) : (
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Mô tả ngắn (có thể bỏ trống)"
              rows={3}
              className="w-full px-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-100"
            />
          )}
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Phụ trách
          </label>
          <div className="mt-1 flex gap-3">
            <label className="text-[12px] flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                checked={assigneeKind === 'user'}
                onChange={() => setAssigneeKind('user')}
                className="accent-primary-600"
              />
              Cá nhân
            </label>
            <label className="text-[12px] flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                checked={assigneeKind === 'group'}
                onChange={() => setAssigneeKind('group')}
                className="accent-primary-600"
              />
              Nhóm
            </label>
          </div>
          {assigneeKind === 'user' ? (
            <select
              value={assigneeUserId}
              onChange={e => setAssigneeUserId(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300"
            >
              <option value="">— chọn người —</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          ) : (
            <select
              value={assigneeGroupId}
              onChange={e => setAssigneeGroupId(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300"
            >
              <option value="">— chọn nhóm —</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Hạn (tuỳ chọn)
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300"
          />
        </div>

        {sourceMessageId && (
          <p className="text-[11px] text-neutral-500 italic">
            ↪ Sẽ liên kết với tin nhắn nguồn.
          </p>
        )}
      </div>
    </Modal>
  )
}
