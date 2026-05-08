/**
 * TasksPage — centralized Quick Tasks tab. Round-9.
 *
 * Sub-tabs:
 *  - Của tôi  : assigned to me (user OR member of assignee_group)
 *  - Tôi giao : created by me
 *  - Cả nhóm  : admin/editor only — visibility limited by RLS otherwise
 *
 * Filters: Đang làm / Đã xong / Quá hạn
 *
 * Click a row → opens TaskView in side panel.
 * "+ Tạo việc" → opens QuickTaskModal.
 */
import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Plus, CheckSquare, Square, AlertTriangle, Search, ExternalLink } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import AppShell from '../components/layout/AppShell'
import Button from '../components/ui/Button'
import { SkeletonList } from '../components/ui/Skeleton'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { openPanel } from '../lib/sidePanelStore'
import QuickTaskModal from '../components/tasks/QuickTaskModal'
import type { QuickTask } from '../types'

type Tab    = 'mine' | 'created' | 'all'
type Filter = 'open' | 'done' | 'overdue'

export default function TasksPage() {
  const { user, isAdmin, isEditor } = useAuth()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('mine')
  const [filter, setFilter] = useState<Filter>('open')
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')

  // ── Auto-open task drawer when ?id=<task_id> in URL (from notification) ──
  useEffect(() => {
    const id = searchParams.get('id')
    if (id) {
      openPanel({ id, kind: 'task_view', title: 'Việc' })
    }
  }, [searchParams])

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['quick-tasks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quick_tasks')
        .select('*, creator:profiles!created_by(full_name), assignee_user:profiles!assignee_user_id(full_name), assignee_group:user_groups!assignee_group_id(name)')
        .order('created_at', { ascending: false })
      if (error) {
        console.warn('[TasksPage] tasks query failed (migration #31 pending?):', error.message)
        return []
      }
      return (data ?? []) as QuickTask[]
    },
    refetchInterval: 30_000,
  })

  // Group memberships for "assigned to me via group" detection
  const { data: myGroupIds = [] } = useQuery({
    queryKey: ['my-group-ids', user?.id],
    queryFn: async () => {
      if (!user?.id) return []
      const { data } = await supabase
        .from('user_group_members').select('group_id').eq('user_id', user.id)
      return (data ?? []).map((r: any) => r.group_id as string)
    },
    enabled: !!user?.id,
    staleTime: 300_000,
  })

  const filtered = useMemo(() => {
    if (!user?.id) return []
    let list = tasks
    if (tab === 'mine') {
      list = list.filter(t =>
        t.assignee_user_id === user.id
        || (t.assignee_group_id && myGroupIds.includes(t.assignee_group_id))
      )
    } else if (tab === 'created') {
      list = list.filter(t => t.created_by === user.id)
    }
    // Filter
    const today = new Date().toISOString().slice(0, 10)
    if (filter === 'open') list = list.filter(t => t.status === 'open')
    else if (filter === 'done') list = list.filter(t => t.status === 'done')
    else if (filter === 'overdue') list = list.filter(t => t.status === 'open' && t.due_date && t.due_date < today)
    // Search
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(t =>
        t.title.toLowerCase().includes(q)
        || (t.description_html ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [tasks, tab, filter, user?.id, myGroupIds, search])

  // Counts for tab badges
  const myCount = useMemo(() => {
    if (!user?.id) return 0
    return tasks.filter(t =>
      t.status === 'open'
      && (t.assignee_user_id === user.id
          || (t.assignee_group_id && myGroupIds.includes(t.assignee_group_id)))
    ).length
  }, [tasks, user?.id, myGroupIds])

  return (
    <AppShell title="Việc cần làm">
      <div className="px-4 sm:px-6 py-4 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold text-neutral-900">Việc cần làm</h1>
          <Button variant="primary" onClick={() => setShowModal(true)}>
            <Plus size={14} /> Tạo việc
          </Button>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-neutral-100 mb-3 overflow-x-auto scrollbar-none">
          <TabButton active={tab === 'mine'}    onClick={() => setTab('mine')}    label="Của tôi"  count={myCount} />
          <TabButton active={tab === 'created'} onClick={() => setTab('created')} label="Tôi giao" />
          {(isAdmin || isEditor) && (
            <TabButton active={tab === 'all'}  onClick={() => setTab('all')}     label="Cả nhóm" />
          )}
        </div>

        {/* Filters + search */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <FilterChip active={filter === 'open'}    onClick={() => setFilter('open')}    label="Đang làm" />
          <FilterChip active={filter === 'done'}    onClick={() => setFilter('done')}    label="Đã xong" />
          <FilterChip active={filter === 'overdue'} onClick={() => setFilter('overdue')} label="Quá hạn" icon={<AlertTriangle size={11} />} />
          <div className="ml-auto relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm..."
              className="pl-7 pr-2 py-1 text-[12px] border border-neutral-200 rounded focus:outline-none focus:border-primary-300 w-44"
            />
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <SkeletonList count={5} />
        ) : filtered.length === 0 ? (
          <p className="text-sm text-neutral-400 italic py-6 text-center">
            Không có việc nào trong mục này.
          </p>
        ) : (
          <div className="bg-white border border-neutral-100 rounded-lg divide-y divide-neutral-100">
            {filtered.map(t => (
              <TaskRow key={t.id} task={t} myGroupIds={myGroupIds} userId={user?.id ?? ''} qc={qc} />
            ))}
          </div>
        )}
      </div>

      <QuickTaskModal
        open={showModal}
        onClose={() => setShowModal(false)}
      />
    </AppShell>
  )
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={`section-tab-bookmark px-4 py-2 text-sm font-medium whitespace-nowrap border-t-2 transition-colors flex items-center gap-2 ${
        active ? 'border-primary-600 text-primary-700' : 'border-transparent text-neutral-500 hover:text-neutral-800'
      }`}
    >
      {label}
      {typeof count === 'number' && count > 0 && (
        <span className="bg-primary-600 text-white text-[10px] font-bold px-1.5 py-0 rounded-full leading-4 min-w-[16px] text-center">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}

function FilterChip({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] inline-flex items-center gap-1 px-2.5 py-1 rounded-full border ${
        active ? 'bg-primary-50 border-primary-200 text-primary-700' : 'bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300'
      }`}
    >
      {icon}{label}
    </button>
  )
}

function TaskRow({ task, myGroupIds, userId, qc }: { task: QuickTask; myGroupIds: string[]; userId: string; qc: ReturnType<typeof useQueryClient> }) {
  const today = new Date().toISOString().slice(0, 10)
  const isOverdue = task.status === 'open' && task.due_date && task.due_date < today
  const assignedToMe = task.assignee_user_id === userId
                    || (task.assignee_group_id && myGroupIds.includes(task.assignee_group_id))
  void assignedToMe

  // Quick toggle done (only assignee/creator can do it; RLS will block others)
  async function toggleDone(e: React.MouseEvent) {
    e.stopPropagation()
    const next = task.status === 'done' ? 'open' : 'done'
    const { error } = await supabase.from('quick_tasks').update({
      status: next,
      completed_at: next === 'done' ? new Date().toISOString() : null,
      updated_at:   new Date().toISOString(),
    }).eq('id', task.id)
    if (!error) qc.invalidateQueries({ queryKey: ['quick-tasks'] })
  }

  return (
    <div
      onClick={() => openPanel({ id: task.id, kind: 'task_view', title: task.title })}
      className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-neutral-25 transition-colors"
    >
      <button
        onClick={toggleDone}
        className="mt-0.5 shrink-0 text-neutral-300 hover:text-primary-600 transition-colors"
        title={task.status === 'done' ? 'Đã xong — click để hoàn tác' : 'Đánh dấu xong'}
      >
        {task.status === 'done'
          ? <CheckSquare size={18} className="text-green-600" />
          : <Square size={18} />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-[13px] font-medium ${task.status === 'done' ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}>
          {task.title}
        </p>
        <div className="flex flex-wrap gap-2 mt-1 text-[11px] text-neutral-500">
          <span>
            {task.assignee_user?.full_name && <>👤 {task.assignee_user.full_name}</>}
            {task.assignee_group?.name && <>🏷 {task.assignee_group.name}</>}
          </span>
          {task.due_date && (
            <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
              {isOverdue && <AlertTriangle size={10} className="inline mr-0.5" />}
              Hạn: {new Date(task.due_date).toLocaleDateString('vi')}
            </span>
          )}
          <span className="text-neutral-400">
            tạo {formatDistanceToNow(new Date(task.created_at), { addSuffix: true, locale: vi })}
          </span>
          {task.source_message_id && (
            <span className="inline-flex items-center gap-0.5 text-primary-500">
              <ExternalLink size={9} /> tin nhắn gốc
            </span>
          )}
        </div>
      </div>
      <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full shrink-0 ${
        task.status === 'done' ? 'bg-green-100 text-green-700' :
        task.status === 'cancelled' ? 'bg-neutral-100 text-neutral-500' :
        isOverdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
      }`}>
        {task.status === 'done' ? 'Xong' : task.status === 'cancelled' ? 'Huỷ' : isOverdue ? 'Quá hạn' : 'Đang làm'}
      </span>
    </div>
  )
}
