import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, EyeOff, Copy } from 'lucide-react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import TemplateEditor from '../forms/TemplateEditor'
import SubmissionsViewer from '../forms/SubmissionsViewer'
import { SkeletonList } from '../ui/Skeleton'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'
import { supabase } from '../../lib/supabase'
import type { FormTemplate, FormField } from '../../types'

type Tab = 'templates' | 'submissions'

export default function FormPane() {
  const { canManageTemplates } = useAuth()
  const [tab, setTab] = useState<Tab>('templates')
  const [editingTemplate, setEditingTemplate] = useState<FormTemplate | null | 'new'>(null)
  const { success, error: toastError } = useToast()
  const qc = useQueryClient()

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['form-templates-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('form_templates')
        .select('*')
        .order('name')
      if (error) {
        console.warn('[FormPane] query failed (migration pending?):', error.message)
        return []
      }
      return data as FormTemplate[]
    },
    retry: false,
  })

  const saveTemplate = useMutation({
    mutationFn: async (payload: { name: string; description: string; fields: FormField[]; summary_field_ids: string[] }) => {
      if (editingTemplate === 'new') {
        const { error } = await supabase.from('form_templates').insert(payload)
        if (error) throw error
      } else if (editingTemplate) {
        const { error } = await supabase
          .from('form_templates')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingTemplate.id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['form-templates-all'] })
      qc.invalidateQueries({ queryKey: ['form-templates'] })
      success('Đã lưu template')
      setEditingTemplate(null)
    },
    onError: () => toastError('Không thể lưu template'),
  })

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('form_templates').update({ is_active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['form-templates-all'] }),
  })

  const duplicateTemplate = useMutation({
    mutationFn: async (t: FormTemplate) => {
      const { error } = await supabase.from('form_templates').insert({
        name:        `${t.name} (copy)`,
        description: t.description,
        fields:      t.fields,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['form-templates-all'] })
      success('Đã duplicate template')
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-neutral-600 mb-0.5">Biểu mẫu</p>
          <p className="text-[11px] text-neutral-400">
            Tạo và quản lý template biểu mẫu — gắn vào bước workflow để thu thập dữ liệu.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border-b border-neutral-100">
            {(['templates', 'submissions'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`section-tab-bookmark px-3 py-1.5 text-xs transition-colors border-t-2 ${
                  tab === t
                    ? 'border-primary-600 bg-white text-primary-700 font-medium'
                    : 'border-transparent text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
                }`}
              >
                {t === 'templates' ? 'Templates' : 'Submissions'}
              </button>
            ))}
          </div>
          {canManageTemplates && tab === 'templates' && (
            <Button size="sm" onClick={() => setEditingTemplate('new')}>
              <Plus size={13} /> Tạo template
            </Button>
          )}
        </div>
      </div>

      {tab === 'templates' && (
        isLoading ? <SkeletonList count={4} /> : (
          <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
            {templates.map(t => (
              <div key={t.id} className={`flex items-center gap-3 px-4 py-3 ${!t.is_active ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-neutral-800">{t.name}</p>
                    {!t.is_active && (
                      <span className="text-[9px] bg-neutral-100 text-neutral-500 px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider">Ẩn</span>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-400">
                    {t.fields.length} trường · Cập nhật {new Date(t.updated_at).toLocaleDateString('vi')}
                  </p>
                </div>
                {canManageTemplates && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditingTemplate(t)}
                      className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded-lg transition-colors"
                      title="Sửa"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => duplicateTemplate.mutate(t)}
                      className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded-lg transition-colors"
                      title="Duplicate"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      onClick={() => toggleActive.mutate({ id: t.id, is_active: !t.is_active })}
                      className="text-neutral-400 hover:text-amber-600 p-1.5 rounded-lg transition-colors"
                      title={t.is_active ? 'Ẩn template' : 'Hiện lại'}
                    >
                      <EyeOff size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {templates.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-neutral-400">
                Chưa có template nào.
              </div>
            )}
          </div>
        )
      )}

      {tab === 'submissions' && <SubmissionsViewer />}

      <Modal
        open={editingTemplate !== null}
        onClose={() => setEditingTemplate(null)}
        title={editingTemplate === 'new' ? 'Tạo template mới' : `Sửa: ${(editingTemplate as FormTemplate)?.name}`}
        size="xl"
      >
        {editingTemplate !== null && (
          <TemplateEditor
            template={editingTemplate === 'new' ? undefined : editingTemplate as FormTemplate}
            onSave={saveTemplate.mutateAsync}
            onCancel={() => setEditingTemplate(null)}
          />
        )}
      </Modal>
    </div>
  )
}
