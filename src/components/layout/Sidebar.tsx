import type { ReactNode } from 'react'

interface SidebarProps {
  children: ReactNode
}

export default function Sidebar({ children }: SidebarProps) {
  return (
    <aside className="w-[240px] bg-neutral-25 border-r border-neutral-100 flex flex-col overflow-hidden shrink-0">
      {children}
    </aside>
  )
}

// ── Sub-components for reuse across pages ────────────────────────────────────

interface SidebarSectionProps {
  title: string
  children: ReactNode
  action?: ReactNode
}

export function SidebarSection({ title, children, action }: SidebarSectionProps) {
  return (
    <div className="mb-3">
      {/* Round-9 polish: removed the underline border — section title alone is
          enough; less visual noise = livelier feel. */}
      <div className="flex items-center justify-between px-3 pt-4 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-normal text-neutral-400">
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  )
}

interface SidebarItemProps {
  label: string
  meta?: string
  active?: boolean
  onClick?: () => void
  actions?: ReactNode
  /** Persistent badge(s) shown after the label — e.g. draft-count pill or running-workflow dot. */
  badge?: ReactNode
  /** Optional icon rendered before the label. */
  icon?: ReactNode
}

export function SidebarItem({ label, meta, active, onClick, actions, badge, icon }: SidebarItemProps) {
  return (
    <div
      onClick={onClick}
      className={`group flex items-center justify-between py-1.5 cursor-pointer text-base transition-colors ${
        active
          ? 'border-l-4 border-primary-600 bg-primary-50 text-primary-700 font-semibold pl-2 pr-2 mx-0 shadow-[inset_0_0_0_1px_rgba(58,89,148,0.1)]'
          : 'border-l-4 border-transparent text-neutral-700 hover:bg-primary-50/50 hover:text-primary-700 pl-2 pr-2 mx-0'
      }`}
    >
      <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
        {icon}
        <div className="truncate font-medium">{label}</div>
        {badge}
      </div>
      {meta && <div className="text-[11px] text-neutral-400 truncate">{meta}</div>}
      {actions && (
        <div className="opacity-40 group-hover:opacity-100 transition-opacity ml-1 shrink-0">
          {actions}
        </div>
      )}
    </div>
  )
}
