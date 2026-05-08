import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, Edit2, Play, Trash2, Users, Calendar, Power, Search, AlertCircle } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import Button from '../components/ui/Button'
import { RunStatusBadge } from '../components/ui/Badge'
import { SkeletonList } from '../components/ui/Skeleton'
import Modal from '../components/ui/Modal'
import ScheduleEditor from '../components/workflow/ScheduleEditor'
import RunProgressBar from '../components/workflow/RunProgressBar'
import FormPane from '../components/settings/FormPane'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/ui/Toast'
import { supabase } from '../lib/supabase'
import { openPanel } from '../lib/sidePanelStore'
import { formatRoutine } from '../lib/routine'
import { usePendingApprovalCount } from '../lib/usePendingApprovals'
import type { WorkflowTemplate, WorkflowRun, WorkflowSchedule } from '../types'

type StepMeta = {
  id: string
  title: string
  order_index: number
  duration_hours: number
  parent_step_id: string | null
  step_type?: 'simple' | 'branch' | string | null
  requires_approval?: boolean | null
  approver_user_id?: string | null
  approver_role?: 'admin' | 'editor' | 'specific_user' | string | null
  approver?: { full_name: string | null } | null
}

/** A step counts as a "high-level root" for progress bars when it's the head
 *  of the linear chain OR a child of a non-branch (simple) parent. Branch
 *  children are excluded so the bar shows the skeleton path, not the fan-out. */
function isProgressBarRoot(step: StepMeta, byId: Map<string, StepMeta>): boolean {
  if (!step.parent_step_id) return true
  const parent = byId.get(step.parent_step_id)
  return parent?.step_type !== 'branch'
}
type ResultMeta = { snapshot_id: string | null; step_id: string | null; is_done: boolean; approval_status: 'pending' | 'approved' | 'rejected' | null }
type TemplateWithSteps = WorkflowTemplate & { steps?: StepMeta[] }
type RunWithSteps = WorkflowRun & { run_steps?: StepMeta[]; step_results?: ResultMeta[] }

type Tab = 'templates' | 'forms' | 'my-runs' | 'team-runs' | 'scheduled'

// ─── Start Run Modal ──────────────────────────────────────────────────────────

function StartRunModal({
  open,
  template,
  onClose,
  onStarted,
}: {
  open: boolean
  template: WorkflowTemplate | null
  onClose: () => void
  onStarted: (runId: string, name?: string) => void
}) {
  const { user } = useAuth()
  const { success, error: toastError } = useToast()
  const [starting, setStarting] = useState(false)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list'],
    queryFn: async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, title')
        .not('status', 'in', '("completed","cancelled")')
        .order('title')
      return (data ?? []) as { id: string; title: string }[]
    },
    enabled: open,
  })

  const [projectId, setProjectId] = useState('')

  async function startRun() {
    if (!template || !user) return
    setStarting(true)
    try {
      const { data: run, error } = await supabase
        .from('workflow_runs')
        .insert({
          template_id:   template.id,
          template_name: template.name,
          project_id:    projectId || null,
          run_by:        user.id,
        })
        .select()
        .single()
      if (error) throw error

      // Snapshot the template's step tree into workflow_run_steps so future
      // edits to the template don't mutate this run. Best-effort: legacy DBs
      // without the migration silently fall back to live-step rendering.
      const { error: snapErr } = await supabase.rpc('snapshot_workflow_run', { p_run: run.id })
      if (snapErr) {
        console.warn('Snapshot RPC failed (legacy DB?), continuing with live steps:', snapErr.message)
      }

      success(`Đã bắt đầu: ${template.name}`)
      onStarted(run.id, template.name)
      onClose()
    } catch {
      toastError('Không thể tạo nghiệp vụ')
    } finally {
      setStarting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Chạy: ${template?.name ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button onClick={startRun} disabled={starting}>
            {starting ? 'Đang tạo…' : '▶ Bắt đầu'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-neutral-600">{template?.description}</p>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Gắn với dự án (tuỳ chọn)
          </label>
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-1.5 text-sm font-serif bg-white w-full"
          >
            <option value="">— Không gắn dự án —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  )
}

// ─── Confirm delete modal ─────────────────────────────────────────────────────

function ConfirmDeleteModal({
  open,
  title,
  description,
  onConfirm,
  onClose,
  loading,
}: {
  open: boolean
  title: string
  description: string
  onConfirm: () => void
  onClose: () => void
  loading?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-1.5 text-sm text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
          >
            Huỷ
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-1.5 text-sm font-medium bg-red-500 hover:bg-red-600 text-white rounded disabled:opacity-50 transition-colors"
          >
            {loading ? 'Đang xóa...' : 'Xóa'}
          </button>
        </>
      }
    >
      <p className="text-sm text-neutral-600">{description}</p>
    </Modal>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function WorkflowsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAdmin, isEditor, isLeader, user } = useAuth()
  const { success, error: toastError } = useToast()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('templates')
  const [search, setSearch] = useState('')
  const [runTarget, setRunTarget] = useState<WorkflowTemplate | null>(null)
  const [scheduleEditor, setScheduleEditor] = useState<{ open: boolean; schedule: WorkflowSchedule | null }>({ open: false, schedule: null })
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'run' | 'template'; id: string; name: string } | null>(null)
  const canManage = isAdmin || isEditor
  const { data: pendingApprovals = 0 } = usePendingApprovalCount()

  // Open specific run panel when navigated from a push notification (?open_run=<id>)
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const runId = params.get('open_run')
    if (runId) {
      openPanel({ id: runId, kind: 'workflow_run', title: '▶ Nghiệp vụ' })
      navigate('/workflows', { replace: true })
    }
  }, [location.search, navigate])

  // Persist active tab per user
  useEffect(() => {
    if (!user?.id) return
    try {
      const saved = localStorage.getItem(`bos_workflows_tab_${user.id}`)
      if (saved && ['templates', 'forms', 'my-runs', 'team-runs', 'scheduled'].includes(saved)) setTab(saved as Tab)
    } catch {}
  }, [user?.id])

  function changeTab(t: Tab) {
    setTab(t)
    setSearch('')
    try { if (user?.id) localStorage.setItem(`bos_workflows_tab_${user.id}`, t) } catch {}
  }

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['workflow-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_templates')
        .select('*, steps:workflow_steps(id, title, order_index, duration_hours, parent_step_id, step_type)')
        .order('name')
      if (error) throw error
      return data as TemplateWithSteps[]
    },
  })

  const { data: myRuns = [], isLoading: runsLoading } = useQuery({
    queryKey: ['my-workflow-runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_runs')
        .select('*, runner:profiles!run_by(full_name), run_steps:workflow_run_steps(id, title, order_index, duration_hours, parent_step_id:parent_snapshot_id, step_type, requires_approval, approver_user_id, approver_role, approver:profiles!approver_user_id(full_name)), step_results:workflow_step_results(snapshot_id, step_id, is_done, approval_status)')
        .order('started_at', { ascending: false })
      if (error) {
        const { data: fb, error: e2 } = await supabase
          .from('workflow_runs')
          .select('*, runner:profiles!run_by(full_name)')
          .order('started_at', { ascending: false })
        if (e2) throw e2
        return fb as RunWithSteps[]
      }
      return data as RunWithSteps[]
    },
    enabled: tab !== 'templates',
  })

  const deleteRun = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('workflow_runs').delete().eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('no_permission')
    },
    onSuccess: () => {
      success('Đã xóa lượt chạy')
      qc.invalidateQueries({ queryKey: ['my-workflow-runs'] })
    },
    onError: (err: Error) => {
      if (err.message === 'no_permission') toastError('Không có quyền xóa lượt chạy này')
      else toastError('Không thể xóa lượt chạy')
    },
  })

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('workflow_templates').delete().eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('no_permission')
    },
    onSuccess: () => {
      success('Đã xóa mẫu nghiệp vụ')
      qc.invalidateQueries({ queryKey: ['workflow-templates'] })
    },
    onError: (err: Error) => {
      if (err.message === 'no_permission') toastError('Không có quyền xóa mẫu này')
      else toastError('Không thể xóa mẫu nghiệp vụ')
    },
  })

  const { data: schedules = [], isLoading: schedulesLoading } = useQuery({
    queryKey: ['workflow-schedules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_schedules')
        .select('*, template:workflow_templates(id, name), runner:profiles!run_by(id, full_name), project:projects!project_id(id, title, slug)')
        .order('next_run_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as WorkflowSchedule[]
    },
    enabled: tab === 'scheduled',
  })

  const toggleSchedule = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from('workflow_schedules')
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow-schedules'] }),
    onError: () => toastError('Không thể cập nhật'),
  })

  const deleteSchedule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('workflow_schedules').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow-schedules'] }),
    onError: () => toastError('Không thể xoá'),
  })

  // Round-10: forms moved here from Settings → Lab. Visual dividers split
  // template-tabs | run-tabs | schedule-tabs.
  type TabItem = { key: Tab; label: string; dot?: boolean } | { divider: true }
  const tabs: TabItem[] = [
    { key: 'templates', label: 'Mẫu NV' },
    { key: 'forms',     label: 'Mẫu Biểu mẫu' },
    { divider: true },
    { key: 'my-runs',   label: 'Của tôi', dot: pendingApprovals > 0 },
    ...(isLeader || isAdmin || isEditor ? [{ key: 'team-runs' as Tab, label: 'Của team' }] : []),
    { divider: true },
    { key: 'scheduled', label: 'Lịch tự động' },
  ]

  return (
    <AppShell title="Luồng Nghiệp vụ">
      <div className="p-4 sm:p-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h1 className="text-lg font-serif font-medium text-neutral-800">Luồng Nghiệp vụ</h1>
          {/* Action button */}
          <div className="shrink-0">
            {tab === 'templates' && canManage && (
              <Button onClick={() => navigate('/workflows/new/edit')}>
                <Plus size={14} /> Mẫu mới
              </Button>
            )}
            {tab === 'scheduled' && (
              <Button onClick={() => setScheduleEditor({ open: true, schedule: null })}>
                <Plus size={14} /> Lịch mới
              </Button>
            )}
          </div>
        </div>

        {/* Tab bar — scrollable on mobile */}
        <div className="flex overflow-x-auto scrollbar-none border-b border-neutral-100 mb-3 -mx-4 sm:-mx-6 px-4 sm:px-6">
          {tabs.map((t, i) => (
            'divider' in t ? (
              <span key={`div-${i}`} className="self-center px-2 text-neutral-300 select-none">│</span>
            ) : (
              <button
                key={t.key}
                onClick={() => changeTab(t.key)}
                className={`section-tab-bookmark relative shrink-0 whitespace-nowrap px-4 py-2 text-sm transition-colors border-t-2 ${
                  tab === t.key
                    ? 'border-primary-600 bg-white text-primary-700 font-medium'
                    : 'border-transparent text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
                }`}
              >
                {t.label}
                {t.dot && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-red-500 block" />
                )}
              </button>
            )
          ))}
        </div>

        {/* Search bar */}
        <div className="relative mb-4">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm kiếm..."
            className="w-full pl-8 pr-3 h-8 text-sm border border-neutral-200 rounded-lg bg-white focus:outline-none focus:border-primary-400 placeholder-neutral-400"
          />
        </div>

        {/* Round-10 — Forms catalogue (moved from Settings → Lab) */}
        {tab === 'forms' && (
          <FormPane />
        )}

        {/* Templates */}
        {tab === 'templates' && (
          templatesLoading ? <SkeletonList count={3} /> : (() => {
            const q = search.toLowerCase()
            const filtered = q
              ? templates.filter(t => t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
              : templates
            return (
            <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
              {filtered.map(t => (
                <div key={t.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-neutral-800">{t.name}</p>
                    {t.description && <p className="text-[11px] text-neutral-400 truncate">{t.description}</p>}
                    <StepDurationBar steps={t.steps ?? []} className="mt-1.5" />
                  </div>
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    <Button size="sm" variant="secondary" onClick={() => setRunTarget(t)}>
                      <Play size={11} /> Bắt đầu
                    </Button>
                    {canManage && (
                      <>
                        <button
                          onClick={() => navigate(`/workflows/${t.id}/edit`)}
                          className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ type: 'template', id: t.id, name: t.name })}
                          className="text-neutral-400 hover:text-red-500 p-1.5 rounded"
                          title="Xóa mẫu"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-neutral-400">
                  {q ? 'Không tìm thấy mẫu nào.' : 'Chưa có mẫu nghiệp vụ nào.'}
                </div>
              )}
            </div>
            )
          })()
        )}

        {/* My runs */}
        {tab === 'my-runs' && (
          runsLoading ? <SkeletonList count={3} /> : (() => {
            const q = search.toLowerCase()
            const filtered = q ? myRuns.filter(r => r.template_name.toLowerCase().includes(q)) : myRuns
            return <RunList runs={filtered} onOpen={(id, name) => openPanel({ id, kind: 'workflow_run', title: `▶ ${name}` })} onDelete={(id, name) => setDeleteConfirm({ type: 'run', id, name })} emptyMessage={q ? 'Không tìm thấy luồng nào.' : undefined} />
          })()
        )}

        {/* Team runs */}
        {tab === 'team-runs' && (
          runsLoading ? <SkeletonList count={3} /> : (() => {
            const q = search.toLowerCase()
            const filtered = q
              ? myRuns.filter(r =>
                  r.template_name.toLowerCase().includes(q) ||
                  ((r as any).runner?.full_name ?? '').toLowerCase().includes(q)
                )
              : myRuns
            return (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-3">
                  <Users size={14} className="text-neutral-400" />
                  <span className="text-sm text-neutral-500">{filtered.length} luồng của team</span>
                </div>
                <RunList runs={filtered} onOpen={(id, name) => openPanel({ id, kind: 'workflow_run', title: `▶ ${name}` })} onDelete={(id, name) => setDeleteConfirm({ type: 'run', id, name })} showRunner emptyMessage={q ? 'Không tìm thấy luồng nào.' : undefined} />
              </div>
            )
          })()
        )}

        {/* Scheduled */}
        {tab === 'scheduled' && (
          schedulesLoading ? <SkeletonList count={3} /> : (() => {
            const q = search.toLowerCase()
            const filteredSch = q
              ? schedules.filter(s =>
                  (s.name ?? '').toLowerCase().includes(q) ||
                  (s.template?.name ?? '').toLowerCase().includes(q)
                )
              : schedules
            return (
            <div className="space-y-3">
              <p className="text-[11px] text-neutral-400">
                Luồng nghiệp vụ theo lịch (daily / weekly / monthly / once). Server tự tạo run khi đến giờ.
              </p>
              {filteredSch.length === 0 ? (
                <div className="border border-dashed border-neutral-200 rounded-lg p-8 text-center text-sm text-neutral-400">
                  {q ? 'Không tìm thấy lịch nào.' : 'Chưa có lịch nào. Bấm "Lịch mới" để bắt đầu.'}
                </div>
              ) : (
                <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
                  {filteredSch.map(s => {
                    const due = new Date(s.next_run_at)
                    const isPast = due.getTime() < Date.now()
                    return (
                      <div key={s.id} className="flex items-start gap-3 px-4 py-3">
                        <Calendar size={14} className={`mt-0.5 shrink-0 ${s.enabled ? 'text-violet-600' : 'text-neutral-300'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-neutral-800 truncate">
                              {s.name || s.template?.name || '(unnamed)'}
                            </p>
                            {!s.enabled && <span className="text-[10px] uppercase tracking-wider bg-neutral-100 text-neutral-500 px-1.5 py-0.5 rounded">paused</span>}
                            {s.project && (
                              <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                                📁 {s.project.title}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-500 truncate">{formatRoutine(s.routine)}</p>
                          <p className="text-[11px] text-neutral-400">
                            Next: <span className={`font-mono ${isPast && s.enabled ? 'text-amber-600' : ''}`}>
                              {due.toLocaleString('vi')}
                            </span>
                            {s.last_run_at && <> · Last: <span className="font-mono">{new Date(s.last_run_at).toLocaleString('vi')}</span></>}
                            {s.runner && <> · {s.runner.full_name}</>}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => toggleSchedule.mutate({ id: s.id, enabled: !s.enabled })}
                            className={`p-1.5 rounded-lg transition-colors ${
                              s.enabled
                                ? 'text-primary-600 hover:bg-primary-50'
                                : 'text-neutral-400 hover:text-primary-600 hover:bg-neutral-50'
                            }`}
                            title={s.enabled ? 'Tạm ngưng' : 'Kích hoạt'}
                          >
                            <Power size={13} />
                          </button>
                          <button
                            onClick={() => setScheduleEditor({ open: true, schedule: s })}
                            className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded-lg hover:bg-neutral-50"
                            title="Sửa"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => { if (confirm(`Xoá lịch "${s.name || s.template?.name}"?`)) deleteSchedule.mutate(s.id) }}
                            className="text-neutral-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-neutral-50"
                            title="Xoá"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            )
          })()
        )}

        {/* Start run modal */}
        <StartRunModal
          open={!!runTarget}
          template={runTarget}
          onClose={() => setRunTarget(null)}
          onStarted={(id, name) => openPanel({ id, kind: 'workflow_run', title: `▶ ${name ?? 'Nghiệp vụ'}` })}
        />

        {/* Schedule editor modal */}
        <ScheduleEditor
          open={scheduleEditor.open}
          schedule={scheduleEditor.schedule}
          onClose={() => setScheduleEditor({ open: false, schedule: null })}
        />

        <ConfirmDeleteModal
          open={!!deleteConfirm}
          title={deleteConfirm?.type === 'template' ? 'Xóa mẫu nghiệp vụ' : 'Xóa lượt chạy'}
          description={
            deleteConfirm?.type === 'template'
              ? `Xóa mẫu "${deleteConfirm.name}"? Các lượt chạy cũ vẫn được giữ lại.`
              : `Xóa lượt chạy "${deleteConfirm?.name}"? Hành động này không thể hoàn tác.`
          }
          loading={deleteTemplate.isPending || deleteRun.isPending}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={() => {
            if (!deleteConfirm) return
            if (deleteConfirm.type === 'template') deleteTemplate.mutate(deleteConfirm.id, { onSettled: () => setDeleteConfirm(null) })
            else deleteRun.mutate(deleteConfirm.id, { onSettled: () => setDeleteConfirm(null) })
          }}
        />
      </div>
    </AppShell>
  )
}

function RunList({
  runs,
  onOpen,
  onDelete,
  showRunner = false,
  emptyMessage,
}: {
  runs: RunWithSteps[]
  onOpen: (id: string, name: string) => void
  onDelete?: (id: string, name: string) => void
  showRunner?: boolean
  emptyMessage?: string
}) {
  if (runs.length === 0) {
    return <p className="text-sm text-neutral-400">{emptyMessage ?? 'Chưa có luồng nghiệp vụ nào.'}</p>
  }
  return (
    <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
      {runs.map(r => {
        const steps   = r.run_steps ?? []
        const results = r.step_results ?? []
        const elapsedHours = (Date.now() - new Date(r.started_at).getTime()) / 3_600_000
        const actualHours = r.completed_at
          ? (new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 3_600_000
          : elapsedHours
        return (
          <div
            key={r.id}
            onClick={() => onOpen(r.id, r.template_name)}
            className="group flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-neutral-25 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-neutral-800">{r.template_name}</p>
              <p className="text-[11px] text-neutral-400">
                {showRunner && (r as any).runner?.full_name && `${(r as any).runner.full_name} · `}
                {new Date(r.started_at).toLocaleDateString('vi')}
              </p>
              {steps.length > 0 && (() => {
                const byId = new Map(steps.map(s => [s.id, s]))
                const expectedHours = steps.filter(s => isProgressBarRoot(s, byId))
                                           .reduce((s, x) => s + (x.duration_hours ?? 3), 0)
                const over = actualHours > expectedHours
                return (
                  <p className={`text-[11px] mt-1 ${over ? 'text-red-500' : 'text-neutral-400'}`}>
                    (Đã trôi qua <strong>{actualHours.toFixed(1)} tiếng</strong>
                    {' · '}Tiêu chuẩn xử lý: <strong>{expectedHours} tiếng</strong>
                    {over && ' — vượt kế hoạch'})
                  </p>
                )
              })()}
              {steps.length > 0 ? (
                <RunProgressBar
                  steps={steps}
                  results={results}
                  runStatus={r.status}
                  className="mt-1.5"
                />
              ) : (
                <StepDurationBar steps={steps} className="mt-1.5" />
              )}
              {steps.length > 0 && (() => {
                // Find current pending step + its assignee
                const byId = new Map(steps.map(s => [s.id, s]))
                const roots = steps.filter(s => isProgressBarRoot(s, byId))
                                   .sort((a, b) => a.order_index - b.order_index)
                const resultBy = new Map<string, any>()
                for (const rr of results) {
                  const k = (rr.snapshot_id ?? rr.step_id) ?? ''
                  if (k) resultBy.set(k, rr)
                }
                const pendingStep = roots.find(st => {
                  const rr = resultBy.get(st.id)
                  if (rr?.approval_status === 'pending') return true
                  // Or first non-done root step
                  const done = rr?.is_done && (!st.requires_approval || rr.approval_status === 'approved')
                  return !done
                })
                if (!pendingStep || r.status !== 'in_progress') return null
                const result = resultBy.get(pendingStep.id)
                const isPendingApproval = result?.approval_status === 'pending'
                const assigneeName = isPendingApproval && pendingStep.requires_approval
                  ? (pendingStep.approver?.full_name
                     ?? (pendingStep.approver_role === 'admin'  ? 'Tất cả Admin'
                       : pendingStep.approver_role === 'editor' ? 'Tất cả Editor'
                       : null))
                  : ((r as any).runner?.full_name ?? null)
                const verb = isPendingApproval ? 'Chờ duyệt' : 'Đang xử lý'
                return (
                  <p className="text-[11px] text-neutral-500 mt-1.5 truncate">
                    <span className={isPendingApproval ? 'text-amber-600 font-medium' : ''}>● {verb}</span>
                    {' '}<span className="text-neutral-700">{pendingStep.title}</span>
                    {assigneeName && <> {' · '}<span className="text-neutral-500">phụ trách: <strong>{assigneeName}</strong></span></>}
                  </p>
                )
              })()}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {onDelete && (
                <button
                  onClick={e => { e.stopPropagation(); onDelete(r.id, r.template_name) }}
                  className="p-1.5 text-neutral-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded"
                  title="Xóa lượt chạy"
                >
                  <Trash2 size={13} />
                </button>
              )}
              <RunStatusBadge status={r.status} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Progress bar components ──────────────────────────────────────────────────

// The bar container represents a 24-hour scale. Workflows longer than 24h fill
// the full bar width but show a (*) info icon with the exact total.
const MAX_BAR_HOURS = 24

// Alternating light blue-grey shades for step segments
const STEP_COLORS = ['bg-sky-300', 'bg-sky-400', 'bg-sky-200', 'bg-blue-300', 'bg-sky-300']

function StepDurationBar({ steps, className = '' }: { steps: StepMeta[]; className?: string }) {
  const byId = new Map(steps.map(s => [s.id, s]))
  const roots = steps.filter(s => isProgressBarRoot(s, byId))
                     .sort((a, b) => a.order_index - b.order_index)
  const total = roots.reduce((s, x) => s + (x.duration_hours ?? 3), 0)
  if (roots.length === 0 || total === 0) return null

  const capped    = Math.min(total, MAX_BAR_HOURS)
  const barWidth  = (capped / MAX_BAR_HOURS) * 100
  const isOver    = total > MAX_BAR_HOURS

  return (
    <div className={className}>
      <p className="text-[10px] text-neutral-500 mb-1 flex items-center gap-1">
        Thường thực hiện trong
        <strong className="text-neutral-700 font-semibold">{total} tiếng</strong>
        {isOver && (
          <span
            title={`Tổng thực tế: ${total} tiếng — hiển thị tối đa 24 tiếng trên thanh`}
            className="inline-flex items-center text-amber-500 cursor-help"
          >
            <AlertCircle size={11} />
          </span>
        )}
      </p>
      {/* Container = full width → 24h scale */}
      <div className="w-full h-2.5 bg-neutral-100 rounded-full overflow-hidden">
        {/* Inner bar: only occupies min(total,24)/24 of container */}
        <div
          className="h-full flex rounded-full overflow-hidden"
          style={{ width: `${barWidth}%` }}
        >
          {roots.map((s, i) => (
            <div
              key={s.id}
              className={`${STEP_COLORS[i % STEP_COLORS.length]} h-full`}
              style={{ width: `${((s.duration_hours ?? 3) / total) * 100}%` }}
              title={`${s.title}: ${s.duration_hours ?? 3} tiếng`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// (Legacy ActualTimeBar removed in round-8 — replaced by an inline text line
//  above RunProgressBar that reads "Đã trôi qua X tiếng · Tiêu chuẩn Y tiếng".)
