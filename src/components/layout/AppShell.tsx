import { useState, useEffect, createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import NavTabs from './NavTabs'
import Sidebar from './Sidebar'
import NotificationBell from './NotificationBell'
import { useAuth } from '../../contexts/AuthContext'
import { useSidePanel } from '../../lib/sidePanelStore'

const DrawerCloseContext = createContext<() => void>(() => {})
/** Call inside any sidebar component to close the mobile drawer when an item is selected. */
export function useCloseDrawer() { return useContext(DrawerCloseContext) }

const DrawerOpenContext = createContext<() => void>(() => {})
/** Call from NavTabs (mobile) to open the drawer when already on /chat. */
export function useOpenDrawer() { return useContext(DrawerOpenContext) }

interface AppShellProps {
  sidebar?: ReactNode
  children: ReactNode
  /** Page title shown in the mobile top-bar. */
  title?: string
}

export default function AppShell({ sidebar, children, title }: AppShellProps) {
  const { session, loading } = useAuth()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Push chat content left of the side panel when it's open as a push panel (desktop only).
  // workflow_run in expanded mode uses a modal overlay — no push needed.
  const { active: panelActive } = useSidePanel()
  const pushRight = !!panelActive && !panelActive.expanded

  const hasSidebar = !!sidebar

  // Close drawer when navigating away from /chat.
  // On /chat: auto-open if no active chat context is saved (first visit / fresh user).
  // Otherwise opening is driven by NavTabs (tap tab again) or the hamburger ☰ button.
  useEffect(() => {
    if (!location.pathname.startsWith('/chat')) {
      setDrawerOpen(false)
      return
    }
    if (!hasSidebar) return
    const userId = session?.user?.id
    if (!userId) return
    const saved = localStorage.getItem(`bos_chat_active_${userId}`)
    if (!saved) {
      setDrawerOpen(true)
    }
  }, [location.pathname, hasSidebar, session?.user?.id])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="w-6 h-6 rounded-full border-2 border-primary-400 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  return (
    <div
      className="flex h-[100dvh] overflow-hidden bg-white"
      style={{ borderTop: '2px solid var(--color-accent-retro, #C1695B)' }}
    >
      {/* Desktop: vertical nav strip on left + sidebar */}
      <DrawerOpenContext.Provider value={() => setDrawerOpen(true)}>
        <NavTabs />
      </DrawerOpenContext.Provider>

      {sidebar && (
        <div className="hidden md:flex">
          <Sidebar>{sidebar}</Sidebar>
        </div>
      )}

      {/* Mobile drawer */}
      {sidebar && drawerOpen && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            className="md:hidden fixed inset-0 bg-black/40 z-40"
          />
          <div className="md:hidden fixed left-0 top-0 bottom-14 z-50 w-[280px] bg-neutral-25 border-r border-neutral-100 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
              <span className="text-sm font-serif font-medium text-neutral-700">Menu</span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="text-neutral-400 hover:text-neutral-700"
              >
                <X size={18} />
              </button>
            </div>
            <DrawerCloseContext.Provider value={() => setDrawerOpen(false)}>
              <div className="flex-1 overflow-y-auto">{sidebar}</div>
            </DrawerCloseContext.Provider>
          </div>
        </>
      )}

      {/* Main column — gains a right margin on desktop when the side panel is open,
          so the panel pushes content instead of overlaying it. */}
      <div className={`flex-1 flex flex-col overflow-hidden pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0 md:transition-[margin-right] md:duration-200 ${pushRight ? 'md:mr-[480px]' : ''}`}>
        {/* Mobile-only top bar — always visible so bell is always accessible */}
        <div className="md:hidden flex items-center gap-2 border-b border-neutral-100 px-3 py-2 shrink-0 bg-white">
          {sidebar && (
            <button
              onClick={() => setDrawerOpen(true)}
              className="text-neutral-600 hover:text-primary-600 p-1.5 rounded-lg hover:bg-neutral-50"
            >
              <Menu size={18} />
            </button>
          )}
          {title ? (
            <span className="font-serif text-sm font-medium text-neutral-800 truncate flex-1">{title}</span>
          ) : (
            <div className="flex-1" />
          )}
          <NotificationBell />
        </div>

        <main className="flex-1 overflow-y-auto bg-white">
          {children}
        </main>
      </div>
    </div>
  )
}
