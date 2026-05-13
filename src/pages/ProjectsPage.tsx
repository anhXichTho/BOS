import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, List, Plus } from 'lucide-react'
import AppShell from '../components/layout/AppShell'
import Button from '../components/ui/Button'
import { SkeletonList } from '../components/ui/Skeleton'
import KanbanBoard from '../components/projects/KanbanBoard'
import ProjectTable, { STATUS_OPTIONS } from '../components/projects/ProjectTable'
import CreateProjectModal from '../components/projects/CreateProjectModal'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { Project, ProjectStatus } from '../types'

type ViewMode = 'kanban' | 'table'

export default function ProjectsPage() {
  const [view, setView] = useState<ViewMode>('kanban')
  const [createOpen, setCreateOpen] = useState(false)
  const [filterStatus, setFilterStatus] = useState<ProjectStatus | ''>('')
  const { canCreateResources } = useAuth()
  const qc = useQueryClient()

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*, assignee:profiles!assigned_to(*), creator:profiles!created_by(full_name)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Project[]
    },
  })

  const filtered = filterStatus
    ? projects.filter(p => p.status === filterStatus)
    : projects

  return (
    <AppShell title="Dự án">
      <div className="p-4 sm:p-6 h-full flex flex-col">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4 shrink-0">
          <h1 className="text-lg font-serif font-medium text-neutral-800">Dự án</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status filter */}
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as ProjectStatus | '')}
              className="border border-neutral-200 rounded-lg px-2 py-1.5 text-xs focus:border-primary-400 focus:outline-none bg-white"
            >
              {STATUS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            {/* View toggle */}
            <div className="flex border border-neutral-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setView('kanban')}
                className={`p-1.5 transition-colors ${view === 'kanban' ? 'bg-primary-600 text-white' : 'text-neutral-500 hover:bg-neutral-50'}`}
                title="Kanban"
              >
                <LayoutGrid size={15} />
              </button>
              <button
                onClick={() => setView('table')}
                className={`p-1.5 transition-colors ${view === 'table' ? 'bg-primary-600 text-white' : 'text-neutral-500 hover:bg-neutral-50'}`}
                title="Table"
              >
                <List size={15} />
              </button>
            </div>

            {canCreateResources && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus size={14} /> Tạo dự án
              </Button>
            )}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <SkeletonList count={4} />
        ) : view === 'kanban' ? (
          // Kanban spans full screen width on desktop — negate the outer
          // page padding (-mx-4 sm:-mx-6) and re-apply small horizontal padding
          // (px-4 sm:px-6) to keep the first/last column from hugging the edge.
          <div className="flex-1 overflow-hidden -mx-4 sm:-mx-6">
            <div className="h-full px-4 sm:px-6">
              <KanbanBoard projects={filtered} />
            </div>
          </div>
        ) : (
          <ProjectTable projects={filtered} />
        )}

        {/* Create modal */}
        <CreateProjectModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['projects'] })}
        />
      </div>
    </AppShell>
  )
}
