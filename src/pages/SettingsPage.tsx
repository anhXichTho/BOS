import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, GitBranch, LogOut, ChevronDown, Plus, X, FlaskConical, UserCog } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import { RoleBadge } from '../components/ui/Badge'
import LabTab from '../components/settings/LabTab'
import GroupsSection from '../components/settings/GroupsSection'
import PersonalTab from '../components/settings/PersonalTab'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/ui/Toast'
import { supabase } from '../lib/supabase'
import type { Profile, UserRole, LeaderMember } from '../types'

type Tab = 'team' | 'hierarchy' | 'lab' | 'personal'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function avatarInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('team')
  const { profile, signOut } = useAuth()

  return (
    <AppShell
      title="Cài đặt"
      sidebar={
        <div className="flex flex-col h-full p-3 gap-1">
          <button
            onClick={() => setTab('team')}
            className={`flex items-center gap-2 py-1.5 pr-2 text-[13px] text-left transition-colors ${
              tab === 'team'
                ? 'border-l-4 border-primary-600 bg-neutral-50 text-neutral-900 font-medium pl-2'
                : 'border-l-4 border-transparent text-neutral-700 hover:bg-neutral-50 pl-2'
            }`}
          >
            <Users size={14} /> Thành viên
          </button>
          <button
            onClick={() => setTab('hierarchy')}
            className={`flex items-center gap-2 py-1.5 pr-2 text-[13px] text-left transition-colors ${
              tab === 'hierarchy'
                ? 'border-l-4 border-primary-600 bg-neutral-50 text-neutral-900 font-medium pl-2'
                : 'border-l-4 border-transparent text-neutral-700 hover:bg-neutral-50 pl-2'
            }`}
          >
            <GitBranch size={14} /> Phân cấp
          </button>

          <button
            onClick={() => setTab('lab')}
            className={`flex items-center gap-2 py-1.5 pr-2 text-[13px] text-left transition-colors ${
              tab === 'lab'
                ? 'border-l-4 border-primary-600 bg-neutral-50 text-neutral-900 font-medium pl-2'
                : 'border-l-4 border-transparent text-neutral-700 hover:bg-neutral-50 pl-2'
            }`}
          >
            <FlaskConical size={14} /> Lab
          </button>

          <button
            onClick={() => setTab('personal')}
            className={`flex items-center gap-2 py-1.5 pr-2 text-[13px] text-left transition-colors ${
              tab === 'personal'
                ? 'border-l-4 border-primary-600 bg-neutral-50 text-neutral-900 font-medium pl-2'
                : 'border-l-4 border-transparent text-neutral-700 hover:bg-neutral-50 pl-2'
            }`}
          >
            <UserCog size={14} /> Cá nhân
          </button>

          <div className="flex-1" />

          <div className="border-t border-neutral-100 pt-3 pb-1">
            <div className="text-[11px] text-neutral-400 px-2 mb-2 truncate">{profile?.full_name}</div>
            <button
              onClick={signOut}
              className="flex items-center gap-2 py-1.5 px-2 rounded-lg text-[13px] text-neutral-600 hover:bg-neutral-50 w-full text-left"
            >
              <LogOut size={14} /> Đăng xuất
            </button>
          </div>
        </div>
      }
    >
      <div className="p-4 pb-10 sm:p-6 sm:pb-12 max-w-3xl">
        <h1 className="text-lg font-serif font-medium text-neutral-800 mb-6">
          {tab === 'team'      && 'Thành viên & Phân quyền'}
          {tab === 'hierarchy' && 'Phân cấp & Groups'}
          {tab === 'lab'       && 'Lab — AI Assistants & FAQ Docs'}
          {tab === 'personal'  && 'Cá nhân'}
        </h1>
        {tab === 'team'      && <TeamTab />}
        {tab === 'hierarchy' && <HierarchyTab />}
        {tab === 'lab'       && <LabTab />}
        {tab === 'personal'  && <PersonalTab />}
      </div>
    </AppShell>
  )
}

// ─── Team tab ────────────────────────────────────────────────────────────────

function TeamTab() {
  const { isAdmin } = useAuth()
  const { success, error: toastError } = useToast()
  const qc = useQueryClient()

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name')
      if (error) throw error
      return data as Profile[]
    },
  })

  const changeRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: UserRole }) => {
      const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] })
      success('Đã cập nhật role')
    },
    onError: () => toastError('Không thể cập nhật role'),
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-14 bg-neutral-100 animate-pulse rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
      {profiles.map(p => (
        <div key={p.id} className="flex items-center gap-3 px-4 py-3">
          <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-semibold shrink-0">
            {avatarInitials(p.full_name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-neutral-800 truncate">{p.full_name}</div>
            <div className="text-[11px] text-neutral-400">{p.id.slice(0, 8)}…</div>
          </div>
          <div className="flex items-center gap-2">
            <RoleBadge role={p.role} />
            {isAdmin && (
              <RoleSelect
                value={p.role}
                onChange={role => changeRole.mutate({ id: p.id, role })}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function RoleSelect({ value, onChange }: { value: UserRole; onChange: (r: UserRole) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value as UserRole)}
        className="appearance-none pl-2 pr-6 py-1 text-xs border border-neutral-200 rounded-lg focus:border-primary-400 focus:outline-none bg-white"
      >
        <option value="admin">Admin</option>
        <option value="editor">Editor</option>
        <option value="user">User</option>
      </select>
      <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
    </div>
  )
}

// ─── Hierarchy tab ────────────────────────────────────────────────────────────

function HierarchyTab() {
  const { isAdmin } = useAuth()
  const { success, error: toastError } = useToast()
  const qc = useQueryClient()

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name')
      if (error) throw error
      return data as Profile[]
    },
  })

  const { data: relations = [] } = useQuery({
    queryKey: ['leader_members'],
    queryFn: async () => {
      const { data, error } = await supabase.from('leader_members').select('*')
      if (error) throw error
      return data as LeaderMember[]
    },
  })

  const addRelation = useMutation({
    mutationFn: async ({ leader_id, member_id }: { leader_id: string; member_id: string }) => {
      const { error } = await supabase.from('leader_members').insert({ leader_id, member_id })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leader_members'] })
      success('Đã thêm quan hệ')
    },
    onError: () => toastError('Không thể thêm (có thể đã tồn tại)'),
  })

  const removeRelation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('leader_members').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leader_members'] })
    },
    onError: () => toastError('Không thể xóa quan hệ'),
  })

  // Group relations by leader
  const leaders = [...new Set(relations.map(r => r.leader_id))]
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]))

  const [selectedLeader, setSelectedLeader] = useState('')
  const [selectedMember, setSelectedMember] = useState('')

  function handleAdd() {
    if (!selectedLeader || !selectedMember || selectedLeader === selectedMember) return
    addRelation.mutate({ leader_id: selectedLeader, member_id: selectedMember })
  }

  return (
    <div className="space-y-8">
      {/* Groups — independent of leader-member, used for resource ACL */}
      <GroupsSection />

      <div className="border-t border-neutral-100" />

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">Leader – Member Hierarchy</h3>
        <p className="text-[11px] text-neutral-400 mb-3">
          Phân cấp dùng cho RLS: leader xem được dữ liệu của subordinate. Tách bi&ecirc;̣t khỏi Groups (tag-based).
        </p>
      </div>

      {/* Add relation form (admin only) */}
      {isAdmin && (
        <div className="bg-neutral-25 border border-neutral-100 rounded-lg p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
            Thêm quan hệ
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selectedLeader}
              onChange={e => setSelectedLeader(e.target.value)}
              className="border border-neutral-200 rounded-lg px-2 py-1.5 text-sm focus:border-primary-400 focus:outline-none bg-white"
            >
              <option value="">— Leader —</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
            <span className="text-neutral-400 text-sm">manages</span>
            <select
              value={selectedMember}
              onChange={e => setSelectedMember(e.target.value)}
              className="border border-neutral-200 rounded-lg px-2 py-1.5 text-sm focus:border-primary-400 focus:outline-none bg-white"
            >
              <option value="">— Member —</option>
              {profiles.filter(p => p.id !== selectedLeader).map(p => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              disabled={!selectedLeader || !selectedMember}
              className="flex items-center gap-1 bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 px-3 py-1.5 text-xs rounded-lg"
            >
              <Plus size={12} /> Thêm
            </button>
          </div>
        </div>
      )}

      {/* Tree display */}
      {leaders.length === 0 ? (
        <p className="text-sm text-neutral-400">Chưa có quan hệ leader–member nào.</p>
      ) : (
        <div className="space-y-4">
          {leaders.map(leaderId => {
            const leader = profileMap[leaderId]
            const members = relations.filter(r => r.leader_id === leaderId)
            if (!leader) return null
            return (
              <div key={leaderId} className="bg-white border border-neutral-100 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-semibold">
                    {avatarInitials(leader.full_name)}
                  </div>
                  <span className="text-sm font-medium text-neutral-800">{leader.full_name}</span>
                  <RoleBadge role={leader.role} />
                </div>
                <div className="ml-5 space-y-1 border-l-2 border-neutral-100 pl-3">
                  {members.map(rel => {
                    const member = profileMap[rel.member_id]
                    if (!member) return null
                    return (
                      <div key={rel.id} className="flex items-center gap-2 py-0.5">
                        <div className="w-6 h-6 rounded-full bg-neutral-100 text-neutral-600 flex items-center justify-center text-[10px] font-semibold shrink-0">
                          {avatarInitials(member.full_name)}
                        </div>
                        <span className="text-sm text-neutral-700 flex-1">{member.full_name}</span>
                        <RoleBadge role={member.role} />
                        {isAdmin && (
                          <button
                            onClick={() => removeRelation.mutate(rel.id)}
                            className="text-neutral-300 hover:text-red-500 transition-colors"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
