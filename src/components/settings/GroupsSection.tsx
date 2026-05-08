import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Edit2, Users, X, ChevronRight } from 'lucide-react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import type { UserGroup, Profile } from '../../types'

const COLOR_PRESETS = [
  '#4A6AAB', '#15803d', '#d97706', '#e11d48',
  '#7c3aed', '#0891b2', '#ea580c', '#475569',
]

function avatarInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

export default function GroupsSection() {
  const { isAdmin, isEditor } = useAuth()
  const canManage = isAdmin || isEditor
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()

  const [creating, setCreating]   = useState(false)
  const [editing, setEditing]     = useState<UserGroup | null>(null)
  const [openGroup, setOpenGroup] = useState<UserGroup | null>(null)

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['user-groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_groups')
        .select('*')
        .order('name')
      if (error) throw error
      return data as UserGroup[]
    },
  })

  const { data: memberCounts = {} } = useQuery({
    queryKey: ['user-group-member-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_group_members')
        .select('group_id')
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const r of data ?? []) counts[r.group_id as string] = (counts[r.group_id as string] ?? 0) + 1
      return counts
    },
    enabled: groups.length > 0,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('user_groups').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-groups'] })
      qc.invalidateQueries({ queryKey: ['user-group-member-counts'] })
      success('Đã xoá group')
    },
    onError: () => toastError('Không thể xoá group'),
  })

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-0.5">User Groups</h3>
          <p className="text-[11px] text-neutral-400">
            Group là tag dùng để phân quyền truy cập resource (project, workflow, document). 1 user có thể thuộc nhiều group.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={12} /> Group mới
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-neutral-100 animate-pulse rounded-lg" />)}
        </div>
      ) : groups.length === 0 ? (
        <p className="text-sm text-neutral-400 italic">Chưa có group nào.</p>
      ) : (
        <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
          {groups.map(g => (
            <div key={g.id} className="flex items-center gap-3 px-4 py-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-semibold shrink-0"
                style={{ background: g.color ?? '#4A6AAB' }}
              >
                <Users size={13} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-neutral-800 truncate">{g.name}</p>
                <p className="text-[11px] text-neutral-400 truncate">
                  {memberCounts[g.id] ?? 0} thành viên{g.description ? ` · ${g.description}` : ''}
                </p>
              </div>
              <button
                onClick={() => setOpenGroup(g)}
                className="text-xs text-primary-600 hover:underline shrink-0 flex items-center gap-0.5"
              >
                Quản lý <ChevronRight size={12} />
              </button>
              {canManage && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditing(g)}
                    className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded-lg"
                  >
                    <Edit2 size={13} />
                  </button>
                  <button
                    onClick={() => { if (confirm(`Xoá group "${g.name}"?`)) remove.mutate(g.id) }}
                    className="text-neutral-400 hover:text-red-500 p-1.5 rounded-lg"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <GroupEditorModal
        open={creating || !!editing}
        group={editing}
        onClose={() => { setCreating(false); setEditing(null) }}
      />

      {openGroup && (
        <GroupMembersModal
          group={openGroup}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </section>
  )
}

// ─── Create / edit group modal ────────────────────────────────────────────────

function GroupEditorModal({ open, group, onClose }: { open: boolean; group: UserGroup | null; onClose: () => void }) {
  const isEdit = !!group
  const { user } = useAuth()
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()

  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [color, setColor] = useState(group?.color ?? COLOR_PRESETS[0])

  // Re-sync local state when the modal is reopened with a different group
  // (or with no group, for the create case).
  useEffect(() => {
    if (!open) return
    setName(group?.name ?? '')
    setDescription(group?.description ?? '')
    setColor(group?.color ?? COLOR_PRESETS[0])
  }, [open, group?.id])

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Tên group bắt buộc')
      if (isEdit) {
        const { error } = await supabase
          .from('user_groups')
          .update({ name: name.trim(), description: description.trim() || null, color, updated_at: new Date().toISOString() })
          .eq('id', group!.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('user_groups')
          .insert({ name: name.trim(), description: description.trim() || null, color, created_by: user?.id })
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-groups'] })
      success(isEdit ? 'Đã cập nhật group' : 'Đã tạo group')
      handleClose()
    },
    onError: (err: Error) => toastError(err.message),
  })

  function handleClose() {
    setName(''); setDescription(''); setColor(COLOR_PRESETS[0])
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={isEdit ? 'Sửa group' : 'Group mới'}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>Huỷ</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Đang lưu…' : isEdit ? 'Lưu' : 'Tạo'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Tên *</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="VD: Marketing, Engineering, QA…"
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Mô tả</label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Tuỳ chọn"
            className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white w-full"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Màu</label>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PRESETS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-lg border-2 ${color === c ? 'border-neutral-700' : 'border-neutral-200'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── Members management modal ────────────────────────────────────────────────

function GroupMembersModal({ group, onClose }: { group: UserGroup; onClose: () => void }) {
  const { isAdmin, isEditor } = useAuth()
  const canManage = isAdmin || isEditor
  const qc = useQueryClient()
  const { success, error: toastError } = useToast()
  const [picker, setPicker] = useState('')

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name').order('full_name')
      return (data ?? []) as Profile[]
    },
  })

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['group-members', group.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_group_members')
        .select('user_id')
        .eq('group_id', group.id)
      if (error) throw error
      return (data ?? []).map(r => r.user_id as string)
    },
  })

  const memberSet = new Set(members)
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]))
  const candidates = profiles.filter(p => !memberSet.has(p.id))

  const add = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('user_group_members')
        .insert({ group_id: group.id, user_id: userId })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-members', group.id] })
      qc.invalidateQueries({ queryKey: ['user-group-member-counts'] })
      setPicker('')
    },
    onError: () => toastError('Không thể thêm thành viên'),
  })

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('user_group_members')
        .delete()
        .eq('group_id', group.id)
        .eq('user_id', userId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-members', group.id] })
      qc.invalidateQueries({ queryKey: ['user-group-member-counts'] })
      success('Đã xoá khỏi group')
    },
    onError: () => toastError('Không thể xoá'),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={`Thành viên: ${group.name}`}
      size="md"
    >
      <div className="space-y-3">
        {canManage && candidates.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={picker}
              onChange={e => setPicker(e.target.value)}
              className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm bg-white flex-1"
            >
              <option value="">— Chọn người để thêm —</option>
              {candidates.map(p => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
            <Button size="sm" disabled={!picker || add.isPending} onClick={() => picker && add.mutate(picker)}>
              <Plus size={12} /> Thêm
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="text-sm text-neutral-400">Đang tải…</div>
        ) : members.length === 0 ? (
          <p className="text-sm text-neutral-400 italic">Chưa có thành viên.</p>
        ) : (
          <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
            {members.map(uid => {
              const p = profileMap[uid]
              if (!p) return null
              return (
                <div key={uid} className="flex items-center gap-3 px-3 py-2">
                  <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-semibold shrink-0">
                    {avatarInitials(p.full_name)}
                  </div>
                  <span className="text-sm text-neutral-800 flex-1">{p.full_name}</span>
                  {canManage && (
                    <button
                      onClick={() => remove.mutate(uid)}
                      className="text-neutral-300 hover:text-red-500 p-1"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
