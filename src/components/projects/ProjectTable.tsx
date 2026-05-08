import { useNavigate } from 'react-router-dom'
import { Info } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import { ProjectStatusBadge, projectStatusBorderColors } from '../ui/Badge'
import type { Project, ProjectStatus } from '../../types'

const STATUS_OPTIONS: { value: ProjectStatus | ''; label: string }[] = [
  { value: '', label: 'Tất cả' },
  { value: 'open', label: 'Mở' },
  { value: 'in_progress', label: 'Đang làm' },
  { value: 'review', label: 'Review' },
  { value: 'completed', label: 'Hoàn thành' },
  { value: 'cancelled', label: 'Huỷ / Đóng băng' },
]

interface Props {
  projects: Project[]
}

export default function ProjectTable({ projects }: Props) {
  const navigate = useNavigate()

  return (
    <div className="bg-white border border-neutral-100 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-100 bg-neutral-25">
            <th className="text-left pl-0 pr-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Tên dự án</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Phụ trách</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Trạng thái</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Deadline</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Cập nhật</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {projects.map(p => (
            <tr
              key={p.id}
              onClick={() => navigate(`/projects/${p.slug}`)}
              className="hover:bg-neutral-25 cursor-pointer transition-colors group"
            >
              <td className={`py-3 pr-4 border-l-4 pl-3 ${projectStatusBorderColors[p.status]}`}>
                <div className="flex items-center gap-1.5">
                  {p.code && (
                    <span className="font-mono text-[10px] px-1 py-0.5 bg-neutral-100 text-neutral-600 rounded">
                      {p.code}
                    </span>
                  )}
                  <span className="font-medium text-neutral-800 group-hover:text-primary-700">{p.title}</span>
                  <div className="relative group/info">
                    <Info size={12} className="text-neutral-300 hover:text-neutral-500 transition-colors" />
                    <div className="absolute left-0 top-5 z-10 hidden group-hover/info:block bg-neutral-800 text-white text-[10px] rounded-md px-2.5 py-1.5 w-48 shadow-lg pointer-events-none whitespace-nowrap">
                      <p className="mb-0.5">Tạo: {new Date(p.created_at).toLocaleDateString('vi', { day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
                      {p.creator?.full_name && <p>Bởi: {p.creator.full_name}</p>}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-neutral-600">{p.assignee?.full_name ?? '—'}</td>
              <td className="px-4 py-3"><ProjectStatusBadge status={p.status} /></td>
              <td className="px-4 py-3 text-neutral-500 text-[11px]">
                {p.due_date ? new Date(p.due_date).toLocaleDateString('vi') : '—'}
              </td>
              <td className="px-4 py-3 text-neutral-400 text-[11px]">
                {formatDistanceToNow(new Date(p.updated_at), { addSuffix: true, locale: vi })}
              </td>
            </tr>
          ))}
          {projects.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-sm text-neutral-400">
                Chưa có dự án nào.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// Export for use in filter UI
export { STATUS_OPTIONS }
