import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { Users, X } from 'lucide-react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { slugify, uniqueSlug } from '../../lib/slug'
import type { Profile, UserGroup } from '../../types'

interface FormData {
  title: string
  description: string
  assigned_to: string
  due_date: string
}

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

export default function CreateProjectModal({ open, onClose, onCreated }: Props) {
  const { user } = useAuth()
  const [serverError, setServerError] = useState<string | null>(null)
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>()

  const titleWatch = watch('title') ?? ''
  const slugPreview = slugify(titleWatch || 'project')

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name').order('full_name')
      return (data ?? []) as Profile[]
    },
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['user-groups'],
    queryFn: async () => {
      const { data } = await supabase.from('user_groups').select('id, name, color').order('name')
      return (data ?? []) as UserGroup[]
    },
    enabled: open,
  })

  async function onSubmit(data: FormData) {
    setServerError(null)

    // Fetch existing slugs + titles to enforce uniqueness client-side
    const { data: existing } = await supabase
      .from('projects')
      .select('title, slug')

    const titles = new Set((existing ?? []).map(r => (r.title as string).toLowerCase()))
    const slugs  = new Set((existing ?? []).map(r => r.slug as string))

    if (titles.has(data.title.trim().toLowerCase())) {
      setServerError('Tên dự án đã tồn tại. Vui lòng chọn tên khác.')
      return
    }

    const baseSlug = slugify(data.title) || 'project'
    const slug     = uniqueSlug(baseSlug, slugs)

    const { data: created, error } = await supabase
      .from('projects')
      .insert({
        title:       data.title.trim(),
        slug,
        description: data.description || null,
        assigned_to: data.assigned_to || null,
        due_date:    data.due_date || null,
        created_by:  user?.id,
      })
      .select()
      .single()

    if (error || !created) {
      // 23505 is the Postgres unique-violation code (race against the index).
      if (error?.code === '23505') {
        setServerError('Tên hoặc slug đã tồn tại. Thử tên khác.')
      } else {
        setServerError(error?.message ?? 'Không thể tạo dự án')
      }
      return
    }

    // Attach groups via ACL
    if (selectedGroups.length > 0) {
      const aclRows = selectedGroups.map(groupId => ({
        resource_type: 'project' as const,
        resource_id:   created.id,
        group_id:      groupId,
      }))
      const { error: aclErr } = await supabase.from('resource_group_acl').insert(aclRows)
      if (aclErr) {
        // Project itself was created; ACL failed. Surface but proceed.
        setServerError(`Tạo dự án OK nhưng không gắn được group: ${aclErr.message}`)
        // fall through — user can still edit later
      }
    }

    reset()
    setSelectedGroups([])
    onCreated()
    onClose()
  }

  function toggleGroup(id: string) {
    setSelectedGroups(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tạo dự án mới"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Huỷ</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={isSubmitting}>
            {isSubmitting ? 'Đang tạo…' : 'Tạo dự án'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Tên dự án *
          </label>
          <input
            {...register('title', { required: true, minLength: 2 })}
            placeholder="VD: Website redesign Q3"
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm font-serif bg-white w-full"
          />
          {errors.title && (
            <p className="text-xs text-red-500 mt-1">Tối thiểu 2 ký tự.</p>
          )}
          {titleWatch.trim().length > 0 && (
            <p className="text-[11px] text-neutral-400 mt-1 font-mono">
              Slug → /portal/<span className="text-primary-600">{slugPreview}</span>
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Mô tả
          </label>
          <textarea
            {...register('description')}
            rows={3}
            placeholder="Mô tả ngắn về dự án…"
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm font-serif bg-white w-full resize-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Giao cho
          </label>
          <select
            {...register('assigned_to')}
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm font-serif bg-white w-full"
          >
            <option value="">— Chưa giao —</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Deadline
          </label>
          <input
            type="date"
            {...register('due_date')}
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm font-serif bg-white w-full"
          />
        </div>

        {/* Groups (ACL via resource_group_acl) */}
        {groups.length > 0 && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">
              <Users size={11} className="inline mr-1 -mt-0.5" />
              Cấp quyền cho group
            </label>
            <p className="text-[11px] text-neutral-400 mb-2">
              Thành viên trong các group được chọn sẽ thấy + chỉnh sửa được dự án này.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {groups.map(g => {
                const checked = selectedGroups.includes(g.id)
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => toggleGroup(g.id)}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${
                      checked
                        ? 'border-primary-400 text-white'
                        : 'border-neutral-200 text-neutral-600 hover:border-neutral-300'
                    }`}
                    style={checked ? { background: g.color ?? '#4A6AAB' } : undefined}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: g.color ?? '#4A6AAB' }} />
                    {g.name}
                    {checked && <X size={10} />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {serverError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
            {serverError}
          </div>
        )}
      </div>
    </Modal>
  )
}
