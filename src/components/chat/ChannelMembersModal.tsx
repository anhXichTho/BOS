/**
 * ChannelMembersModal — view + manage members of a private channel.
 *
 * Round-7b/2: per-channel membership ACL. Channel owner OR any admin/editor
 * can add/remove members. Non-members of a private channel won't see it in
 * their sidebar (RLS).
 *
 * Renders:
 *  • Current channel info (name + private/public chip).
 *  • Member list with role + remove button.
 *  • "+ Thêm" picker → search profiles → click → inserts via RPC.
 */
import { memo, useMemo, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Search, X, Users, Loader2, ShieldCheck } from 'lucide-react'
import Modal from '../ui/Modal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'
import type { Profile, ChatChannel } from '../../types'

interface MemberRow {
  user_id: string
  role: string
  added_at: string
  profile?: Profile
}

interface Props {
  open: boolean
  onClose: () => void
  channel: Pick<ChatChannel, 'id' | 'name' | 'channel_type'> & { is_private?: boolean; created_by?: string | null; owner_id?: string | null }
}

export default memo(function ChannelMembersModal({ open, onClose, channel }: Props) {
  const qc = useQueryClient()
  const { user, isAdmin, isEditor } = useAuth()
  const { success, error: toastError } = useToast()
  const [search, setSearch] = useState('')

  const isOwner = !!user && (channel.created_by === user.id || channel.owner_id === user.id)
  const canManage = isOwner || isAdmin || isEditor

  // ─── Query members ────────────────────────────────────────────────────────
  const { data: members = [], isLoading } = useQuery({
    queryKey: ['chat-channel-members', channel.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_channel_members')
        .select('user_id, role, added_at, profile:profiles!user_id(id, full_name, role)')
        .eq('channel_id', channel.id)
      if (error) {
        console.warn('[ChannelMembers] fetch failed (migration #28 pending?):', error.message)
        return []
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data as any[]).map(r => ({
        user_id: r.user_id,
        role: r.role,
        added_at: r.added_at,
        // Supabase nested-select can return either object or array depending
        // on relationship; normalise.
        profile: Array.isArray(r.profile) ? r.profile[0] : r.profile,
      })) as MemberRow[]
    },
    enabled: open,
  })

  // ─── Query all profiles (for invite) ──────────────────────────────────────
  const { data: profiles = [] } = useQuery({
    queryKey: ['all-profiles-for-channel-invite'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .order('full_name')
      if (error) return []
      return data as Profile[]
    },
    enabled: open && canManage,
    staleTime: 5 * 60_000,
  })

  // ─── Add / remove ────────────────────────────────────────────────────────
  const addMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc('add_channel_member', {
        p_channel_id: channel.id,
        p_user_id: userId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-channel-members', channel.id] })
      qc.invalidateQueries({ queryKey: ['channels'] })
      success('Đã thêm thành viên')
    },
    onError: (err: Error) => toastError('Không thể thêm: ' + err.message),
  })

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('chat_channel_members')
        .delete()
        .eq('channel_id', channel.id)
        .eq('user_id', userId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat-channel-members', channel.id] })
      qc.invalidateQueries({ queryKey: ['channels'] })
      success('Đã gỡ thành viên')
    },
    onError: (err: Error) => toastError('Không thể gỡ: ' + err.message),
  })

  // ─── Filter candidates for invite ────────────────────────────────────────
  const memberIds = useMemo(() => new Set(members.map(m => m.user_id)), [members])
  const candidates = useMemo(() => {
    const s = search.trim().toLowerCase()
    return profiles.filter(p =>
      !memberIds.has(p.id) &&
      (!s || (p.full_name ?? '').toLowerCase().includes(s)),
    )
  }, [profiles, search, memberIds])

  return (
    <Modal open={open} onClose={onClose} title={`Thành viên — ${channel.name}`} size="md">
      <div className="space-y-3">
        {/* Privacy hint */}
        <div className="flex items-center gap-2 text-[11px] text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2">
          {channel.is_private
            ? <><ShieldCheck size={12} className="text-amber-600" /> Kênh riêng — chỉ thành viên thấy được</>
            : <><Users size={12} className="text-primary-600" /> Kênh công khai — mọi user đều thấy. Thành viên dưới đây có vai trò hiển thị; có thể chuyển thành riêng tư khi cần.</>
          }
        </div>

        {/* Member list */}
        <section>
          <h5 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
            Thành viên ({members.length})
          </h5>
          {isLoading && (
            <p className="text-[11px] text-neutral-400 italic">Đang tải…</p>
          )}
          <ul className="divide-y divide-neutral-100 -mx-2 px-2 max-h-[40vh] overflow-y-auto">
            {members.length === 0 && !isLoading && (
              <li className="py-2 text-[11px] text-neutral-400 italic text-center">
                Chưa có thành viên nào.
              </li>
            )}
            {members.map(m => (
              <li key={m.user_id} className="py-2 flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                  {(m.profile?.full_name ?? '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-neutral-800 truncate">{m.profile?.full_name ?? '(Chưa đặt tên)'}</div>
                  <div className="text-[10px] text-neutral-500 truncate">
                    {m.profile?.role ?? '—'} · {m.role === 'owner' ? 'chủ kênh' : 'thành viên'}
                  </div>
                </div>
                {canManage && m.role !== 'owner' && (
                  <button
                    type="button"
                    onClick={() => removeMember.mutate(m.user_id)}
                    disabled={removeMember.isPending}
                    className="text-neutral-400 hover:text-red-600 p-0.5"
                    title="Gỡ thành viên"
                  >
                    {removeMember.isPending && removeMember.variables === m.user_id
                      ? <Loader2 size={12} className="animate-spin" />
                      : <X size={12} />
                    }
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Invite — only when caller can manage */}
        {canManage && (
          <section>
            <h5 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
              Thêm thành viên
            </h5>
            <div className="relative mb-1.5">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm tên thành viên…"
                className="w-full border border-neutral-200 rounded pl-7 pr-2 py-1.5 text-xs bg-white focus:outline-none focus:border-primary-400"
              />
            </div>
            <ul className="divide-y divide-neutral-100 max-h-[30vh] overflow-y-auto">
              {candidates.length === 0 && (
                <li className="py-2 text-[10px] text-neutral-400 italic text-center">
                  {search ? 'Không tìm thấy ai phù hợp.' : 'Tất cả mọi người đã là thành viên.'}
                </li>
              )}
              {candidates.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => addMember.mutate(p.id)}
                    disabled={addMember.isPending}
                    className="w-full flex items-center gap-2 py-1.5 px-1 text-left text-xs hover:bg-neutral-50 disabled:opacity-50"
                  >
                    <span className="w-6 h-6 rounded-full bg-neutral-100 text-neutral-600 text-[9px] font-bold flex items-center justify-center shrink-0">
                      {(p.full_name ?? '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                    </span>
                    <span className="flex-1 truncate text-neutral-800">{p.full_name || '(Chưa đặt tên)'}</span>
                    <span className="text-[10px] text-neutral-400">{p.role}</span>
                    {addMember.isPending && addMember.variables === p.id && (
                      <Loader2 size={11} className="animate-spin text-primary-600 shrink-0" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  )
})
