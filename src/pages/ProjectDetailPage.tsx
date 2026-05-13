import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Info, X, Pencil, Check, Trash2, Users } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { ProjectStatusBadge } from '../components/ui/Badge'
import { SkeletonCard } from '../components/ui/Skeleton'
import MessageFeed from '../components/chat/MessageFeed'
import MessageInput from '../components/chat/MessageInput'
import ProjectFilesTab from '../components/projects/ProjectFilesTab'
import ProjectActivityFeed from '../components/projects/ProjectActivityFeed'
import CustomerPortalTab from '../components/projects/CustomerPortalTab'
import ProjectWorkflowShortlist from '../components/projects/ProjectWorkflowShortlist'
import ProjectMembersModal from '../components/projects/ProjectMembersModal'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { openPanel } from '../lib/sidePanelStore'
import type { Project, ProjectStatus, WorkflowRun } from '../types'

const STATUS_OPTIONS: ProjectStatus[] = ['open', 'in_progress', 'review', 'completed', 'cancelled']
const STATUS_LABELS: Record<ProjectStatus, string> = {
  open: 'Mở', in_progress: 'Đang làm', review: 'Review', completed: 'Hoàn thành', cancelled: 'Huỷ / Đóng băng',
}

type Tab = 'workflow' | 'thread' | 'files' | 'portal'

const TAB_LABELS: Record<Tab, string> = {
  thread:   'Thread',
  workflow: 'Nghiệp vụ',
  files:    'Tài liệu',
  portal:   'Cổng KH',
}

export default function ProjectDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, isAdmin, isEditor } = useAuth()
  const [membersModalOpen, setMembersModalOpen] = useState(false)
  const { success, error: toastError } = useToast()
  const [tab, setTab] = useState<Tab>('thread')
  const [infoOpen, setInfoOpen] = useState(false)
  const [editingCode, setEditingCode] = useState(false)
  const [codeDraft, setCodeDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*, assignee:profiles!assigned_to(*)')
        .eq('slug', slug!)
        .maybeSingle()
      if (error) throw error
      return data as Project | null
    },
    enabled: !!slug,
  })

  const projectId = project?.id

  const { data: runs = [] } = useQuery({
    queryKey: ['project-runs', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_runs')
        .select('*, runner:profiles!run_by(*)')
        .eq('project_id', projectId!)
        .order('started_at', { ascending: false })
      if (error) throw error
      return data as WorkflowRun[]
    },
    enabled: !!projectId,
  })

  const updateStatus = useMutation({
    mutationFn: async (status: ProjectStatus) => {
      const { error } = await supabase.from('projects').update({ status }).eq('id', projectId!)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', slug] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      success('Đã cập nhật trạng thái')
    },
    onError: () => toastError('Không thể cập nhật trạng thái'),
  })

  /** Rename project.code (admin/editor only). Postgres unique index will reject duplicates. */
  const updateCode = useMutation({
    mutationFn: async (newCode: string) => {
      const trimmed = newCode.trim().toUpperCase()
      if (!trimmed) throw new Error('empty')
      if (trimmed.length > 10) throw new Error('too_long')
      const { error } = await supabase
        .from('projects')
        .update({ code: trimmed })
        .eq('id', projectId!)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', slug] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['project-activity-feed'] })
      success('Đã đổi mã dự án')
      setEditingCode(false)
    },
    onError: (err: Error) => {
      if (err.message === 'empty') toastError('Mã không được để trống')
      else if (err.message === 'too_long') toastError('Mã tối đa 10 ký tự')
      else if ((err as { code?: string }).code === '23505') toastError('Mã đã tồn tại — chọn mã khác')
      else toastError('Không thể đổi mã dự án')
    },
  })


  const deleteProject = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('projects').delete().eq('id', projectId!)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      navigate('/projects')
    },
    onError: () => toastError('Không thể xóa dự án'),
  })

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-6">
          <SkeletonCard />
        </div>
      </AppShell>
    )
  }

  if (!project) {
    return (
      <AppShell>
        <div className="p-6 text-sm text-neutral-500">Không tìm thấy dự án.</div>
      </AppShell>
    )
  }

  const canEdit = isAdmin || isEditor
  const canManageMembers = canEdit
    || project?.assigned_to === user?.id
    || project?.created_by === user?.id

  // Extracted so it can be rendered in both the desktop side panel and the mobile drawer.
  const infoPanel = (
    <>
      {/* Project info card */}
      <div className="bg-white border border-neutral-100 rounded-lg p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Thông tin dự án</p>
          {project.code && !editingCode && (
            <button
              type="button"
              onClick={() => {
                if (!canEdit) return
                setCodeDraft(project.code ?? '')
                setEditingCode(true)
              }}
              disabled={!canEdit}
              className={`group inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 bg-neutral-100 text-neutral-600 rounded transition-colors ${
                canEdit ? 'hover:bg-neutral-200 hover:text-neutral-800' : 'cursor-default'
              }`}
              title={canEdit ? 'Bấm để đổi mã' : undefined}
            >
              <span>{project.code}</span>
              {canEdit && <Pencil size={9} className="opacity-30 group-hover:opacity-100 transition-opacity" />}
            </button>
          )}
          {editingCode && canEdit && (
            <form
              onSubmit={e => { e.preventDefault(); updateCode.mutate(codeDraft) }}
              className="inline-flex items-center gap-1"
            >
              <input
                autoFocus
                value={codeDraft}
                maxLength={10}
                onChange={e => setCodeDraft(e.target.value.toUpperCase())}
                onBlur={() => { if (!updateCode.isPending) setEditingCode(false) }}
                onKeyDown={e => { if (e.key === 'Escape') setEditingCode(false) }}
                className="font-mono text-[10px] w-20 px-1.5 py-0.5 bg-white border border-primary-400 rounded text-neutral-800 focus:outline-none"
              />
              <button
                type="submit"
                disabled={updateCode.isPending || codeDraft.trim() === (project.code ?? '')}
                onMouseDown={e => e.preventDefault()}  /* keep input focused */
                className="text-primary-600 hover:text-primary-800 disabled:text-neutral-300 p-0.5"
                aria-label="Lưu mã"
              >
                <Check size={11} />
              </button>
            </form>
          )}
        </div>
        <div className="space-y-2 text-sm">
          <div>
            <span className="text-neutral-500">Phụ trách: </span>
            <span className="text-neutral-800">{project.assignee?.full_name ?? '—'}</span>
          </div>
          <div>
            <span className="text-neutral-500">Deadline: </span>
            <span className="text-neutral-800">
              {project.due_date ? new Date(project.due_date).toLocaleDateString('vi') : '—'}
            </span>
          </div>
          {project.description && (
            <p className="text-neutral-600 text-xs">{project.description}</p>
          )}
        </div>

        {canEdit && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">Đổi trạng thái</p>
            <div className="flex flex-wrap gap-1">
              {STATUS_OPTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => updateStatus.mutate(s)}
                  className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full border transition-colors ${
                    project.status === s
                      ? 'border-primary-400 text-primary-700 bg-primary-50'
                      : 'border-neutral-200 text-neutral-500 hover:border-primary-300'
                  }`}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        )}

        {canManageMembers && (
          <div className="pt-2 border-t border-neutral-100">
            <button
              onClick={() => setMembersModalOpen(true)}
              className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-primary-700 transition-colors"
            >
              <Users size={13} />
              Quản lý thành viên
            </button>
          </div>
        )}

        {canEdit && (
          <div className="pt-2 border-t border-neutral-100">
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 transition-colors"
            >
              <Trash2 size={13} />
              Xóa dự án
            </button>
          </div>
        )}
      </div>

      {/* Activity log — flat list, no panel chrome (round-7b). */}
      <div className="min-h-[400px] pt-2">
        <ProjectActivityFeed
          projectId={project.id}
          limit={50}
          hideProjectLabel
          className="h-full"
        />
      </div>
    </>
  )

  return (
    <AppShell>
      <div className="h-full flex flex-col">
        {/* Top bar */}
        <div className="flex items-center gap-3 border-b border-neutral-100 px-4 sm:px-6 py-3 shrink-0">
          <button onClick={() => navigate('/projects')} className="text-neutral-400 hover:text-neutral-700">
            <ArrowLeft size={16} />
          </button>
          <h1 className="font-serif font-medium text-neutral-800 flex-1 truncate">{project.title}</h1>
          <ProjectStatusBadge status={project.status} />
          {/* Mobile-only Info button — opens slide-in drawer */}
          <button
            onClick={() => setInfoOpen(true)}
            className="md:hidden text-neutral-500 hover:text-primary-600 p-1 -mr-1 rounded-lg hover:bg-neutral-50"
            title="Thông tin dự án"
          >
            <Info size={18} />
          </button>
        </div>

        {/* Body — split layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left — tabs (full width on mobile, 65% on desktop) */}
          <div className="flex-1 md:flex-[65] flex flex-col overflow-hidden md:border-r md:border-neutral-100">
            {/* Tab bar */}
            <div className="flex border-b border-neutral-100 px-4 shrink-0 overflow-x-auto">
              {(['thread', 'workflow', 'files', 'portal'] as Tab[])
                .filter(t => t !== 'portal' || canEdit)
                .map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                      tab === t
                        ? 'border-primary-600 text-primary-700'
                        : 'border-transparent text-neutral-500 hover:text-neutral-800'
                    }`}
                  >
                    {TAB_LABELS[t]}
                  </button>
                ))}
            </div>

            {/* Thread */}
            {tab === 'thread' && (
              <div className="flex flex-col flex-1 overflow-hidden">
                <MessageFeed contextType="project" contextId={project.id} />
                <MessageInput contextType="project" contextId={project.id} />
              </div>
            )}

            {/* Files & Forms */}
            {tab === 'files' && (
              <ProjectFilesTab projectId={project.id} />
            )}

            {/* Workflow runs */}
            {tab === 'workflow' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Round-10: project-curated shortlist of available workflows */}
                <div className="bg-neutral-25 border border-neutral-100 rounded-lg p-3">
                  <ProjectWorkflowShortlist projectId={project.id} />
                </div>

                {/* Run history */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-neutral-500">{runs.length} nghiệp vụ đã chạy</span>
                  <Button
                    size="sm"
                    onClick={() => navigate('/workflows')}
                  >
                    + Chạy nghiệp vụ mới
                  </Button>
                </div>
                {runs.length === 0 ? (
                  <p className="text-sm text-neutral-400">Chưa có nghiệp vụ nào được gắn với dự án này.</p>
                ) : runs.map(run => (
                  <div
                    key={run.id}
                    onClick={() => openPanel({
                      id:    run.id,
                      kind:  'workflow_run',
                      title: `▶ ${run.template_name}`,
                      meta:  { context_type: 'project', context_id: project.id },
                    })}
                    className="bg-white border border-neutral-100 rounded-lg p-3 cursor-pointer hover:border-primary-200 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-neutral-800">{run.template_name}</p>
                      <span className={`text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        run.status === 'completed' ? 'bg-green-50 text-green-700' :
                        run.status === 'cancelled' ? 'bg-neutral-100 text-neutral-500' :
                        'bg-amber-50 text-amber-700'
                      }`}>
                        {run.status === 'completed' ? 'Hoàn thành' : run.status === 'cancelled' ? 'Huỷ' : 'Đang chạy'}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-400">
                      {run.runner?.full_name} · {new Date(run.started_at).toLocaleDateString('vi')}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Customer portal tab — admin/editor only (filter applied above) */}
            {tab === 'portal' && canEdit && (
              <div className="flex-1 overflow-y-auto p-4">
                <CustomerPortalTab project={project} />
              </div>
            )}
          </div>

          {/* Right 35% — info (desktop only) */}
          <div className="hidden md:flex md:flex-[35] overflow-y-auto p-4 space-y-4 flex-col">
            {infoPanel}
          </div>
        </div>

        {/* Mobile info drawer */}
        {infoOpen && (
          <>
            <div
              onClick={() => setInfoOpen(false)}
              className="md:hidden fixed inset-0 bg-black/40 z-40"
            />
            <aside className="md:hidden fixed inset-y-0 right-0 z-50 w-3/4 max-w-sm bg-white border-l border-neutral-100 flex flex-col animate-in slide-in-from-right">
              <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3 shrink-0">
                <span className="text-sm font-serif font-medium text-neutral-700">Thông tin dự án</span>
                <button
                  onClick={() => setInfoOpen(false)}
                  className="text-neutral-400 hover:text-neutral-700 p-1 -mr-1 rounded-lg hover:bg-neutral-50"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {infoPanel}
              </div>
            </aside>
          </>
        )}
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Xóa dự án"
        size="sm"
        footer={
          <>
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={deleteProject.isPending}
              className="px-4 py-1.5 text-sm text-neutral-600 hover:text-neutral-900 disabled:opacity-50"
            >
              Huỷ
            </button>
            <button
              onClick={() => deleteProject.mutate()}
              disabled={deleteProject.isPending}
              className="px-4 py-1.5 text-sm font-medium bg-red-500 hover:bg-red-600 text-white rounded disabled:opacity-50 transition-colors"
            >
              {deleteProject.isPending ? 'Đang xóa...' : 'Xóa dự án'}
            </button>
          </>
        }
      >
        <p className="text-sm text-neutral-600">
          Xóa dự án <strong>"{project?.title}"</strong>? Hành động này không thể hoàn tác.
        </p>
      </Modal>

      {membersModalOpen && project && (
        <ProjectMembersModal
          open
          onClose={() => setMembersModalOpen(false)}
          project={{ id: project.id, title: project.title, assigned_to: project.assigned_to, created_by: project.created_by }}
        />
      )}
    </AppShell>
  )
}
