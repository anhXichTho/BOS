import type { ReactNode } from 'react'
import type { ProjectStatus, RunStatus, UserRole } from '../../types'

const base = 'text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full inline-block'

export const projectStatusColors: Record<ProjectStatus, string> = {
  open:        'border border-neutral-200 bg-white text-neutral-700',
  in_progress: 'border border-neutral-200 bg-white text-neutral-700',
  review:      'border border-neutral-200 bg-white text-neutral-700',
  completed:   'border border-neutral-200 bg-white text-neutral-700',
  cancelled:   'border border-neutral-200 bg-white text-neutral-500',
}

export const projectStatusBorderColors: Record<ProjectStatus, string> = {
  open:        'border-l-neutral-300',
  in_progress: 'border-l-amber-400',
  review:      'border-l-primary-400',
  completed:   'border-l-green-500',
  cancelled:   'border-l-red-400',
}

export const projectStatusLabel: Record<ProjectStatus, string> = {
  open:        'Mở',
  in_progress: 'Đang làm',
  review:      'Review',
  completed:   'Hoàn thành',
  cancelled:   'Huỷ / Đóng băng',
}

export const runStatusColors: Record<RunStatus, string> = {
  in_progress: 'bg-amber-50 text-amber-700',
  completed:   'bg-green-50 text-green-700',
  cancelled:   'bg-neutral-100 text-neutral-500',
}

export const runStatusLabel: Record<RunStatus, string> = {
  in_progress: 'Đang chạy',
  completed:   'Hoàn thành',
  cancelled:   'Huỷ',
}

export const roleColors: Record<UserRole, string> = {
  admin:  'bg-violet-50 text-violet-700',
  editor: 'bg-primary-50 text-primary-700',
  user:   'bg-neutral-100 text-neutral-600',
}

export const roleLabel: Record<UserRole, string> = {
  admin:  'Admin',
  editor: 'Editor',
  user:   'User',
}

interface BadgeProps {
  children: ReactNode
  className?: string
}

export function Badge({ children, className = '' }: BadgeProps) {
  return <span className={`${base} ${className}`}>{children}</span>
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge className={projectStatusColors[status]}>{projectStatusLabel[status]}</Badge>
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <Badge className={runStatusColors[status]}>{runStatusLabel[status]}</Badge>
}

export function RoleBadge({ role }: { role: UserRole }) {
  return <Badge className={roleColors[role]}>{roleLabel[role]}</Badge>
}
