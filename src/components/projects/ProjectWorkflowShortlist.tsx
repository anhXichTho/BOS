/**
 * ProjectWorkflowShortlist — "Nghiệp vụ khả dụng" for a project.
 * Round-10 follow-up.
 *
 * Used in two places:
 *   - ProjectWorkspacePanel (the right column on /chat for project threads)
 *   - ProjectDetailPage's "Nghiệp vụ" tab
 *
 * Behaviour:
 *   - Lists workflow templates linked to this project via the
 *     project_workflow_templates table (migration #36).
 *   - "+ Thêm" opens a small picker: search the global workflow_templates
 *     library and pick one to add. Add = INSERT into the link table.
 *   - Each row has a tiny X to remove (creator/assignee/admin only — RLS
 *     enforces server-side; UI mirrors the rule).
 *   - Click a row → opens the WorkflowEditPage for that template. (Run-it
 *     flow stays in the panel/page that hosts this component.)
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, X, Play, GitBranch, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import type { WorkflowTemplate } from '../../types'

interface Props {
  projectId: string
  /** When set, clicking a row's "Run" button calls this callback (e.g. open
   *  StartWorkflowFromChatModal pre-selected). When null, just navigate. */
  onRunTemplate?: (template: WorkflowTemplate) => void
  /** Compact = panel-friendly tighter rows; default false = page-friendly. */
  compact?: boolean
}

export default function ProjectWorkflowShortlist({
  projectId, onRunTemplate, compact = false,
}: Props) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, isAdmin, isEditor } = useAuth()
  const { success, error: toastError } = useToast()
  const [pickerOpen, setPickerOpen] = useState(false)

  // Linked templates for this project
  const { data: linked = [] } = useQuery({
    queryKey: ['project-workflow-shortlist', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_workflow_templates')
        .select('template_id, added_at, template:workflow_templates(id, name, description, is_active)')
        .eq('project_id', projectId)
        .order('added_at', { ascending: false })
      if (error) {
        console.warn('[Shortlist] query failed:', error.message)
        return [] as Array<{ template: WorkflowTemplate }>
      }
      // Filter out broken rows (template deleted)
      return (data ?? []).filter((r: any) => r.template) as unknown as Array<{ template: WorkflowTemplate }>
    },
    staleTime: 30_000,
    retry: false,
  })

  async function removeFromProject(templateId: string) {
    const { error } = await supabase
      .from('project_workflow_templates')
      .delete()
      .eq('project_id', projectId)
      .eq('template_id', templateId)
    if (error) { toastError(error.message); return }
    success('Đã gỡ khỏi dự án')
    qc.invalidateQueries({ queryKey: ['project-workflow-shortlist', projectId] })
  }

  const canManage = !!user
    && (isAdmin || isEditor /* RLS handles the project-creator/assignee case */)

  const rowCls = compact
    ? 'flex items-center gap-2 px-2 py-1.5 bg-white border border-neutral-100 rounded hover:border-primary-200 hover:bg-primary-50/30 transition-colors group'
    : 'flex items-center gap-3 px-3 py-2 bg-white border border-neutral-100 rounded-lg hover:border-primary-200 hover:bg-primary-50/30 transition-colors group'

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <div className="flex items-center justify-between">
        <span className={compact
          ? 'text-[10px] font-semibold uppercase tracking-wider text-neutral-500'
          : 'text-xs font-semibold uppercase tracking-wider text-neutral-600'}
        >
          Nghiệp vụ khả dụng ({linked.length})
        </span>
        <button
          onClick={() => setPickerOpen(true)}
          className={`${compact ? 'text-[11px]' : 'text-xs'} inline-flex items-center gap-1 text-primary-600 hover:text-primary-700`}
          title="Thêm nghiệp vụ từ kho"
        >
          <Plus size={11} /> Thêm
        </button>
      </div>

      {linked.length === 0 && (
        <p className="text-[11px] text-neutral-400 italic">
          Chưa có nghiệp vụ nào dành riêng cho dự án này.
        </p>
      )}

      {linked.map(({ template }) => (
        <div key={template.id} className={rowCls}>
          <GitBranch size={compact ? 12 : 14} className="text-primary-500 shrink-0" />
          <button
            onClick={() => navigate(`/workflows/${template.id}/edit`)}
            className="flex-1 text-left min-w-0"
          >
            <p className={`${compact ? 'text-[12px]' : 'text-sm'} font-medium text-neutral-800 truncate`}>
              {template.name}
            </p>
            {!compact && template.description && (
              <p className="text-[11px] text-neutral-500 truncate">{template.description}</p>
            )}
          </button>
          {onRunTemplate && (
            <button
              type="button"
              onClick={() => onRunTemplate(template)}
              className={`${compact ? 'text-[11px]' : 'text-xs'} inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700`}
              title="Chạy nghiệp vụ này cho dự án"
            >
              <Play size={11} /> Chạy
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => removeFromProject(template.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-neutral-400 hover:text-red-600 p-0.5"
              title="Gỡ khỏi dự án"
            >
              <X size={11} />
            </button>
          )}
        </div>
      ))}

      {pickerOpen && (
        <AddFromLibraryModal
          projectId={projectId}
          existingIds={new Set(linked.map(r => r.template.id))}
          onClose={() => setPickerOpen(false)}
          onAdded={() => qc.invalidateQueries({ queryKey: ['project-workflow-shortlist', projectId] })}
        />
      )}
    </div>
  )
}

// ─── Picker modal ─────────────────────────────────────────────────────────────

function AddFromLibraryModal({
  projectId, existingIds, onClose, onAdded,
}: {
  projectId: string
  existingIds: Set<string>
  onClose: () => void
  onAdded: () => void
}) {
  const { user } = useAuth()
  const { success, error: toastError } = useToast()
  const [search, setSearch] = useState('')

  const { data: templates = [] } = useQuery({
    queryKey: ['workflow-templates-library'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_templates')
        .select('id, name, description, is_active')
        .eq('is_active', true)
        .order('name')
      if (error) return []
      return data as WorkflowTemplate[]
    },
    staleTime: 60_000,
  })

  const visible = search.trim()
    ? templates.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase())
        || (t.description ?? '').toLowerCase().includes(search.toLowerCase()))
    : templates

  async function add(templateId: string) {
    if (!user) return
    const { error } = await supabase.from('project_workflow_templates').insert({
      project_id:  projectId,
      template_id: templateId,
      added_by:    user.id,
    })
    if (error) { toastError(error.message); return }
    success('Đã thêm vào dự án')
    onAdded()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Thêm nghiệp vụ từ kho"
      size="md"
      footer={<Button variant="primary" onClick={onClose}>Xong</Button>}
    >
      <div className="space-y-3">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300"
            autoFocus
          />
        </div>

        <div className="border border-neutral-100 rounded max-h-[50vh] overflow-y-auto">
          {visible.length === 0 && (
            <p className="text-[11px] text-neutral-400 italic px-3 py-3">
              Không có mẫu nghiệp vụ nào.
            </p>
          )}
          {visible.map(t => {
            const already = existingIds.has(t.id)
            return (
              <div key={t.id} className="flex items-center gap-2 px-3 py-2 border-b border-neutral-50 last:border-b-0 hover:bg-neutral-50">
                <GitBranch size={12} className="text-primary-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-neutral-800 truncate">{t.name}</p>
                  {t.description && (
                    <p className="text-[11px] text-neutral-500 truncate">{t.description}</p>
                  )}
                </div>
                {already ? (
                  <span className="text-[11px] text-neutral-400 italic shrink-0">Đã thêm</span>
                ) : (
                  <button
                    onClick={() => add(t.id)}
                    className="text-[11px] inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 px-2 py-0.5 border border-primary-200 rounded shrink-0"
                  >
                    <Plus size={10} /> Thêm
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
