import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import type { WorkflowTemplate, ContextType } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  contextType: ContextType
  contextId: string
  /** Pre-select a template (e.g. from the / slash command picker) */
  initialTemplateId?: string
}

/**
 * From a chat (channel or project thread), pick a workflow template, create
 * a run, snapshot the steps, and post a `workflow_run_link` message into the
 * thread so everyone sees + can open the run.
 */
export default function StartWorkflowFromChatModal({
  open, onClose, contextType, contextId, initialTemplateId,
}: Props) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()

  const [templateId, setTemplateId] = useState(initialTemplateId ?? '')
  const [note, setNote]             = useState('')
  const [starting, setStarting]     = useState(false)

  // Sync pre-selection when opened via slash command
  useEffect(() => {
    if (open && initialTemplateId) setTemplateId(initialTemplateId)
  }, [open, initialTemplateId])

  const { data: templates = [] } = useQuery({
    queryKey: ['workflow-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_templates')
        .select('id, name, description')
        .order('name')
      if (error) throw error
      return data as Pick<WorkflowTemplate, 'id' | 'name' | 'description'>[]
    },
    enabled: open,
  })

  const selected = templates.find(t => t.id === templateId)

  async function start() {
    if (!templateId || !user) { toastError('Chọn mẫu nghiệp vụ'); return }
    setStarting(true)
    try {
      // 1) Create the run; if the chat is a project thread, attach project_id.
      const projectId = contextType === 'project' ? contextId : null
      const { data: run, error: runErr } = await supabase
        .from('workflow_runs')
        .insert({
          template_id:   templateId,
          template_name: selected?.name ?? '',
          project_id:    projectId,
          run_by:        user.id,
        })
        .select()
        .single()
      if (runErr) throw runErr

      // 2) Snapshot the step tree (best-effort).
      const { error: snapErr } = await supabase.rpc('snapshot_workflow_run', { p_run: run.id })
      if (snapErr) console.warn('Snapshot failed:', snapErr.message)

      // 3) Post a workflow_run_link message into the chat.
      const { error: msgErr } = await supabase
        .from('chat_messages')
        .insert({
          context_type:    contextType,
          context_id:      contextId,
          author_id:       user.id,
          message_type:    'workflow_run_link',
          content:         note.trim() || null,
          workflow_run_id: run.id,
        })
      if (msgErr) throw msgErr

      qc.invalidateQueries({ queryKey: ['messages', contextId] })
      qc.invalidateQueries({ queryKey: ['workflow-runs'] })
      success(`Đã chạy: ${selected?.name}`)
      handleClose()
    } catch (err: any) {
      toastError(err?.message ?? 'Không thể chạy nghiệp vụ')
    } finally {
      setStarting(false)
    }
  }

  function handleClose() {
    setTemplateId(initialTemplateId ?? ''); setNote(''); setStarting(false)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Chạy nghiệp vụ trong tin nhắn"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>Huỷ</Button>
          <Button onClick={start} disabled={starting || !templateId}>
            {starting ? 'Đang tạo…' : 'Chạy & post'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-neutral-500">
          Chạy nghiệp vụ mới và đăng thẻ vào kênh hiện tại. Mọi thành viên trong{' '}
          {contextType === 'project' ? 'thread dự án' : 'kênh'} sẽ thấy + click vào để mở chi tiết.
        </p>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Mẫu nghiệp vụ *
          </label>
          <select
            value={templateId}
            onChange={e => setTemplateId(e.target.value)}
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full"
          >
            <option value="">— Chọn mẫu nghiệp vụ —</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {selected?.description && (
            <p className="text-[11px] text-neutral-500 mt-1">{selected.description}</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Ghi chú (tuỳ chọn)
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder="VD: chạy cho release v1.2 sprint cuối tháng…"
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full resize-y"
          />
        </div>
      </div>
    </Modal>
  )
}
