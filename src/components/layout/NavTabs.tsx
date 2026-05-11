import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  MessageSquare, FolderKanban, GitBranch, Settings, CheckSquare, FileText,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import NotificationBell from './NotificationBell'
import ReminderBell from './ReminderBell'
import { useOpenDrawer } from './AppShell'
import { useChatTotalUnread } from '../../lib/useChatUnread'
import { usePendingApprovalCount } from '../../lib/usePendingApprovals'

interface Tab {
  to: string
  icon: LucideIcon
  label: string
}

const baseTabs: Tab[] = [
  { to: '/chat',      icon: MessageSquare, label: 'Tin nhắn' },
  { to: '/projects',  icon: FolderKanban,  label: 'Dự án' },
  { to: '/workflows', icon: GitBranch,     label: 'Nghiệp vụ' },
  { to: '/tasks',     icon: CheckSquare,   label: 'Việc cần làm' },
  { to: '/documents', icon: FileText,      label: 'Document' },
]

const settingsTab: Tab = { to: '/settings', icon: Settings, label: 'Cài đặt' }

/**
 * Desktop sidebar — permanent mini-hybrid (Round-10 follow-up #2).
 *
 * Single fixed-width rail (w-20 = 80px). Each tab renders icon + small
 * label below (~11.5px). No expand/collapse, no pin, no hover-grow —
 * always the same shape. Mobile keeps its bottom tab bar.
 */
export default function NavTabs() {
  const location = useLocation()
  const navigate = useNavigate()
  const openDrawer = useOpenDrawer()
  const tabs = baseTabs

  // Unread chat count — drives the dot indicator on the Chat tab
  const { data: totalUnread = 0 } = useChatTotalUnread()
  // Pending approval count — drives the dot indicator on the Nghiệp vụ tab
  const { data: pendingApprovals = 0 } = usePendingApprovalCount()

  function isActive(to: string) {
    return location.pathname.startsWith(to)
  }

  // Vertical layout: icon on top, label beneath. Active state uses the
  // primary tint + a left-edge accent so it reads at a glance.
  function tabClass(active: boolean) {
    return [
      'flex flex-col items-center justify-center gap-0.5 transition-colors',
      'w-full py-1.5 px-1 rounded',
      active
        ? 'bg-primary-50 text-primary-700 font-semibold'
        : 'text-neutral-500 hover:bg-primary-50/60 hover:text-primary-700',
    ].join(' ')
  }

  function mobileTabClass(active: boolean) {
    return [
      'flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative',
      'text-[10px] font-medium transition-colors',
      active ? 'text-primary-700' : 'text-neutral-400',
    ].join(' ')
  }

  return (
    <>
      {/* Desktop mini-hybrid rail — fixed width 80px, push layout. */}
      <nav className="hidden md:flex shrink-0 w-20 bg-neutral-25 border-r border-neutral-100 flex-col py-2 gap-1 overflow-hidden">
        {/* Brand — logo only (narrow rail; no room for app name text) */}
        <div className="flex items-center justify-center px-1">
          <span
            className="w-9 h-9 rounded-md bg-primary-600 text-white text-[12px] font-bold flex items-center justify-center"
            title="Business OS"
          >
            BO
          </span>
        </div>

        <div className="my-1.5 mx-2 h-px bg-neutral-100" />

        {/* Bell row — notification bell + reminder bell */}
        <div className="flex items-center justify-center gap-1 px-1">
          <ReminderBell />
          <NotificationBell />
        </div>

        <div className="my-1.5 mx-2 h-px bg-neutral-100" />

        <div className="flex flex-col gap-0.5 px-1">
          {tabs.map(({ to, icon: Icon, label }) => {
            const showDot = (to === '/chat' && totalUnread > 0) || (to === '/workflows' && pendingApprovals > 0)
            return (
              <NavLink key={to} to={to} title={label} className={tabClass(isActive(to))}>
                <div className="relative shrink-0">
                  <Icon size={18} />
                  {showDot && (
                    <span
                      className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-neutral-25 block"
                      style={{ background: 'var(--color-danger, #C9534B)' }}
                    />
                  )}
                </div>
                <span className="text-[11.5px] leading-tight text-center whitespace-normal break-words mt-0.5">
                  {label}
                </span>
              </NavLink>
            )
          })}
        </div>

        <div className="flex-1 min-h-2" />

        <div className="my-1.5 mx-2 h-px bg-neutral-100" />

        <div className="px-1">
          <NavLink
            to={settingsTab.to}
            title={settingsTab.label}
            className={tabClass(isActive(settingsTab.to))}
          >
            <Settings size={18} className="shrink-0" />
            <span className="text-[11.5px] leading-tight text-center whitespace-normal break-words mt-0.5">
              {settingsTab.label}
            </span>
          </NavLink>
        </div>
      </nav>{/* end desktop mini-rail */}

      {/* Mobile: bottom tab bar only — bell has moved to AppShell top bar.
          Round-9: pb-[env(safe-area-inset-bottom)] keeps the tab icons clear
          of the iOS home indicator on devices with no physical button. */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-neutral-200 h-14 flex items-stretch pb-[env(safe-area-inset-bottom)] overflow-hidden">
        {[...tabs, settingsTab].map(({ to, icon: Icon, label }) => {
          const active = isActive(to)
          const showDot = (to === '/chat' && totalUnread > 0) || (to === '/workflows' && pendingApprovals > 0)
          const tabContent = (
            <>
              {/* Active top-line indicator */}
              {active && (
                <span className="absolute top-0 left-4 right-4 h-[2px] bg-primary-600 rounded-b-full" />
              )}
              <div className="relative mt-0.5">
                <Icon size={active ? 19 : 18} strokeWidth={active ? 2.2 : 1.8} />
                {showDot && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white block"
                    style={{ background: 'var(--color-danger, #C9534B)' }}
                  />
                )}
              </div>
              <span className="truncate max-w-full px-1">{label}</span>
            </>
          )
          // Chat tab: tap while already on /chat → open drawer; otherwise navigate normally.
          if (to === '/chat') {
            return (
              <button
                key={to}
                onClick={() => active ? openDrawer() : navigate('/chat')}
                className={`${mobileTabClass(active)} min-w-0 overflow-hidden`}
              >
                {tabContent}
              </button>
            )
          }
          return (
            <NavLink key={to} to={to} className={`${mobileTabClass(active)} min-w-0 overflow-hidden`}>
              {tabContent}
            </NavLink>
          )
        })}
      </nav>
    </>
  )
}
