import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { defaultRoutine, computeNextRun, formatRoutine } from '../../lib/routine'
import type {
  Routine, RoutineKind, WorkflowSchedule, WorkflowTemplate, Project,
} from '../../types'

interface Props {
  open: boolean
  schedule?: WorkflowSchedule | null
  onClose: () => void
}

const DAY_NAMES_VI = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

/**
 * Create / edit a workflow_schedule. Persists routine as jsonb and
 * computes next_run_at client-side (server re-computes anyway).
 */
export default function ScheduleEditor({ open, schedule, onClose }: Props) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()
  const isEdit = !!schedule

  const [name,        setName]        = useState('')
  const [templateId,  setTemplateId]  = useState('')
  const [projectId,   setProjectId]   = useState('')
  const [routine,     setRoutine]     = useState<Routine>(defaultRoutine('daily'))
  const [enabled,     setEnabled]     = useState(true)
  const [saving,      setSaving]      = useState(false)

  // Re-sync state when modal opens (or schedule changes).
  useEffect(() => {
    if (!open) return
    if (schedule) {
      setName(schedule.name ?? '')
      setTemplateId(schedule.template_id)
      setProjectId(schedule.project_id ?? '')
      setRoutine(schedule.routine as Routine)
      setEnabled(schedule.enabled)
    } else {
      setName('')
      setTemplateId('')
      setProjectId('')
      setRoutine(defaultRoutine('daily'))
      setEnabled(true)
    }
  }, [open, schedule?.id])

  const { data: templates = [] } = useQuery({
    queryKey: ['workflow-templates'],
    queryFn: async () => {
      const { data } = await supabase.from('workflow_templates').select('id, name').order('name')
      return (data ?? []) as Pick<WorkflowTemplate, 'id' | 'name'>[]
    },
    enabled: open,
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('id, title, slug').order('title')
      return (data ?? []) as Pick<Project, 'id' | 'title' | 'slug'>[]
    },
    enabled: open,
  })

  const handleSave = useMutation({
    mutationFn: async () => {
      if (!templateId) throw new Error('Chọn mẫu nghiệp vụ')
      if (!user) return
      const next_run_at = computeNextRun(routine)
      if (!next_run_at) throw new Error('Routine không hợp lệ — không xác định được lần chạy tiếp theo')

      const payload = {
        template_id: templateId,
        project_id:  projectId || null,
        run_by:      user.id,
        name:        name.trim() || null,
        routine,
        next_run_at,
        enabled,
        updated_at:  new Date().toISOString(),
      }
      if (isEdit) {
        const { error } = await supabase.from('workflow_schedules').update(payload).eq('id', schedule!.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('workflow_schedules').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow-schedules'] })
      success(isEdit ? 'Đã cập nhật lịch' : 'Đã tạo lịch')
      onClose()
    },
    onError: (err: Error) => toastError(err.message),
  })

  function setKind(k: RoutineKind) {
    setRoutine(defaultRoutine(k))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Sửa lịch chạy' : 'Lịch chạy mới'}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button onClick={() => { setSaving(true); handleSave.mutate(undefined, { onSettled: () => setSaving(false) }) }} disabled={saving}>
            {saving ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Tên lịch (tuỳ chọn)</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="VD: Daily standup checklist"
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Workflow template *</label>
          <select
            value={templateId}
            onChange={e => setTemplateId(e.target.value)}
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full"
          >
            <option value="">— Chọn template —</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Gắn với dự án (tuỳ chọn)</label>
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full"
          >
            <option value="">— Không gắn —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>

        {/* Routine builder */}
        <div className="bg-neutral-25 border border-neutral-100 rounded-lg p-3 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Định kỳ</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {(['daily','weekly','monthly','once'] as RoutineKind[]).map(k => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                  routine.kind === k
                    ? 'border-primary-400 bg-primary-50 text-primary-700 font-medium'
                    : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                }`}
              >
                {k === 'daily' ? 'Hằng ngày' : k === 'weekly' ? 'Hằng tuần' : k === 'monthly' ? 'Hằng tháng' : 'Một lần'}
              </button>
            ))}
          </div>

          {routine.kind !== 'once' && (
            <div className="flex items-center gap-2 flex-wrap">
              {routine.kind === 'weekly' && (
                <select
                  value={routine.day_of_week}
                  onChange={e => setRoutine({ ...routine, day_of_week: Number(e.target.value) })}
                  className="border border-neutral-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                >
                  {DAY_NAMES_VI.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              )}
              {routine.kind === 'monthly' && (
                <select
                  value={routine.day_of_month}
                  onChange={e => setRoutine({ ...routine, day_of_month: Number(e.target.value) })}
                  className="border border-neutral-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(n => <option key={n} value={n}>Ngày {n}</option>)}
                </select>
              )}
              <span className="text-xs text-neutral-500">lúc</span>
              <input
                type="time"
                value={routine.at}
                onChange={e => setRoutine({ ...routine, at: e.target.value })}
                className="border border-neutral-200 rounded-lg px-2 py-1.5 text-sm bg-white"
              />
              <span className="text-[11px] text-neutral-400">(múi giờ Việt Nam)</span>
            </div>
          )}

          {routine.kind === 'once' && (
            <div>
              <input
                type="datetime-local"
                value={isoToLocal(routine.at)}
                onChange={e => setRoutine({ kind: 'once', at: localToIso(e.target.value) })}
                className="border border-neutral-200 rounded-lg px-2 py-1.5 text-sm bg-white"
              />
            </div>
          )}

          <p className="text-[11px] text-neutral-500 bg-white border border-neutral-100 rounded-lg px-2.5 py-1.5">
            <span className="font-semibold">Tóm tắt:</span> {formatRoutine(routine)} · Lần chạy tiếp theo:{' '}
            <span className="font-mono text-primary-700">
              {(() => {
                const next = computeNextRun(routine)
                return next ? new Date(next).toLocaleString('vi') : '—'
              })()}
            </span>
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="accent-primary-600"
          />
          Đang kích hoạt
        </label>
      </div>
    </Modal>
  )
}

// ─── Helpers — datetime-local ↔ ISO ───────────────────────────────────────────

function isoToLocal(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localToIso(local: string): string {
  if (!local) return new Date().toISOString()
  return new Date(local).toISOString()
}
