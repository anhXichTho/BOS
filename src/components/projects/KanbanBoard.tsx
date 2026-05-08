import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Info } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import { ProjectStatusBadge, projectStatusBorderColors } from '../ui/Badge'
import { supabase } from '../../lib/supabase'
import { useToast } from '../ui/Toast'
import ProjectActivityFeed from './ProjectActivityFeed'
import type { Project, ProjectStatus } from '../../types'

const COLUMNS: ProjectStatus[] = ['open', 'in_progress', 'review', 'completed', 'cancelled']

const columnColors: Record<ProjectStatus, string> = {
  open:        'bg-neutral-50',
  in_progress: 'bg-neutral-50',
  review:      'bg-neutral-50',
  completed:   'bg-neutral-50',
  cancelled:   'bg-neutral-50',
}

interface Props {
  projects: Project[]
}

export default function KanbanBoard({ projects }: Props) {
  const navigate   = useNavigate()
  const qc         = useQueryClient()
  const { error: toastError } = useToast()

  const changeStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ProjectStatus }) => {
      const { error } = await supabase.from('projects').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
    onError:   () => toastError('Không thể cập nhật trạng thái'),
  })

  function handleDragStart(e: React.DragEvent, projectId: string) {
    e.dataTransfer.setData('projectId', projectId)
  }

  function handleDrop(e: React.DragEvent, status: ProjectStatus) {
    e.preventDefault()
    const projectId = e.dataTransfer.getData('projectId')
    if (projectId) changeStatus.mutate({ id: projectId, status })
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 h-full">
      {/* Activity feed — appears before "Mở" column on desktop. Hidden on mobile
          to keep the kanban scrollable horizontally without an extra wide pane. */}
      {/* Round-7b: dropped panel chrome — feed reads as a flat log, not a card. */}
      <div className="flex-shrink-0 w-[260px] hidden md:flex pt-2 pr-2 overflow-hidden">
        <ProjectActivityFeed limit={30} className="h-full w-full" />
      </div>

      {COLUMNS.map(status => {
        const col = projects.filter(p => p.status === status)
        return (
          <div
            key={status}
            className={`flex-shrink-0 w-[240px] rounded-lg ${columnColors[status]} border border-neutral-100 flex flex-col`}
            onDrop={e => handleDrop(e, status)}
            onDragOver={handleDragOver}
          >
            {/* Column header */}
            <div className="flex items-center justify-between px-3 pt-3 pb-2">
              <ProjectStatusBadge status={status} />
              <span className="text-[11px] text-neutral-400">{col.length}</span>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
              {col.map(project => (
                <div
                  key={project.id}
                  draggable
                  onDragStart={e => handleDragStart(e, project.id)}
                  onClick={() => navigate(`/projects/${project.slug}`)}
                  className={`relative bg-white rounded-lg shadow-sm cursor-pointer hover:shadow-md transition-all group border border-neutral-100 border-l-4 ${projectStatusBorderColors[project.status]}`}
                >
                  <div className="p-3">
                    {/* Code chip + title + info icon */}
                    {project.code && (
                      <span className="inline-block font-mono text-[9px] px-1 py-0.5 bg-neutral-100 text-neutral-600 rounded mb-1">
                        {project.code}
                      </span>
                    )}
                    <div className="flex items-start gap-1 mb-1.5">
                      <p className="flex-1 text-sm font-medium text-neutral-800 group-hover:text-primary-700 leading-snug">
                        {project.title}
                      </p>
                      <div className="relative group/info shrink-0 mt-0.5">
                        <Info size={12} className="text-neutral-300 hover:text-neutral-500 transition-colors cursor-default" />
                        <div className="absolute right-0 top-5 z-10 hidden group-hover/info:block bg-neutral-800 text-white text-[10px] rounded-md px-2.5 py-1.5 w-48 shadow-lg pointer-events-none">
                          <p className="mb-0.5">Tạo: {new Date(project.created_at).toLocaleDateString('vi', { day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
                          {project.creator?.full_name && (
                            <p>Bởi: {project.creator.full_name}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {project.assignee && (
                      <p className="text-[11px] text-neutral-400">
                        👤 {project.assignee.full_name}
                      </p>
                    )}
                    {project.due_date && (
                      <p className="text-[11px] text-neutral-400">
                        📅 {new Date(project.due_date).toLocaleDateString('vi')}
                      </p>
                    )}

                    {/* Last updated */}
                    <p className="text-[10px] text-neutral-300 mt-1.5">
                      Cập nhật {formatDistanceToNow(new Date(project.updated_at), { addSuffix: true, locale: vi })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

