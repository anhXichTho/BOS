import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './components/ui/Toast'
import ThemeApplier from './components/layout/ThemeApplier'
import ErrorBoundary from './components/ErrorBoundary'
import { supabase } from './lib/supabase'

// ─── Eager (tiny, always needed) ─────────────────────────────────────────────
import LoginPage from './pages/LoginPage'
import SidePanel from './components/panel/SidePanel'
import WelcomeOnboardingModal from './components/auth/WelcomeOnboardingModal'

// ─── Lazy (code-split per route) ─────────────────────────────────────────────
const ChatPage          = lazy(() => import('./pages/ChatPage'))
const ProjectsPage      = lazy(() => import('./pages/ProjectsPage'))
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'))
const WorkflowsPage     = lazy(() => import('./pages/WorkflowsPage'))
const WorkflowEditPage  = lazy(() => import('./pages/WorkflowEditPage'))
const WorkflowRunPage   = lazy(() => import('./pages/WorkflowRunPage'))
const SettingsPage      = lazy(() => import('./pages/SettingsPage'))
const PortalPage        = lazy(() => import('./pages/portal/PortalPage'))
const TasksPage         = lazy(() => import('./pages/TasksPage'))
const DocumentsPage     = lazy(() => import('./pages/DocumentsPage'))

// ─── Mobile back-button exit guard ───────────────────────────────────────────
// Pushes a sentinel history entry so the hardware/browser back button can be
// intercepted before it closes the tab. On "back to sentinel" → confirm dialog.
// If cancelled: re-push sentinel. If confirmed: next back naturally exits.
function ExitGuard() {
  useEffect(() => {
    // Only intercept on mobile — on desktop the back button navigates between
    // in-app pages and should never trigger an exit-confirmation dialog.
    if (!window.matchMedia('(max-width: 767px)').matches) return

    window.history.pushState({ _bosGuard: true }, '')

    const handlePop = () => {
      if (window.history.state?._bosGuard) {
        const ok = window.confirm('Bạn có muốn thoát ứng dụng không?')
        if (!ok) {
          window.history.pushState({ _bosGuard: true }, '')
        }
      }
    }

    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  return null
}

// ─── Connection recovery on tab visibility change ────────────────────────────
// When the tab becomes visible again after being idle for a while, Supabase's
// realtime channels and auth session may be stale. Refresh the session and
// invalidate all queries to force a refetch — prevents stuck/blank state.
function ConnectionRecovery() {
  useEffect(() => {
    let lastHidden = 0
    function handler() {
      if (document.visibilityState === 'hidden') {
        lastHidden = Date.now()
        return
      }
      // Visible again — only recover if hidden for more than 30s
      if (lastHidden && Date.now() - lastHidden > 30_000) {
        supabase.auth.refreshSession().catch(err =>
          console.warn('[recovery] refreshSession failed:', err)
        )
        queryClient.invalidateQueries()
      }
      lastHidden = 0
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])
  return null
}

// ─── Push notification click → React Router navigation ──────────────────────
// Service worker (sw-push.js) posts {type:'bos-push-navigate', url} when user
// taps a push notification while the app is already open. Using SPA navigate
// instead of a full reload preserves state and re-triggers route effects that
// process query params like ?msg_id=.
function PushNavListener() {
  const navigate = useNavigate()
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    function handler(event: MessageEvent) {
      const data = event.data as { type?: string; url?: string } | undefined
      if (data?.type !== 'bos-push-navigate' || !data.url) return
      navigate(data.url)
    }
    navigator.serviceWorker.addEventListener('message', handler)
    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [navigate])
  return null
}

// ─── Loading fallback ─────────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="w-6 h-6 rounded-full border-2 border-primary-400 border-t-transparent animate-spin" />
    </div>
  )
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ThemeApplier />
          <ToastProvider>
            <BrowserRouter>
              <ExitGuard />
              <ConnectionRecovery />
              <PushNavListener />
            {/* Global side panel — outside Routes so it persists across navigation */}
            <SidePanel />
            {/* Round-10: first-login welcome modal — auto-shows when profile.onboarded_at is null. */}
            <WelcomeOnboardingModal />
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {/* Public routes */}
                <Route path="/login"                 element={<LoginPage />} />
                <Route path="/portal/:slug"          element={<PortalPage />} />

                {/* Protected routes (AppShell handles redirect if !session) */}
                <Route path="/"                      element={<Navigate to="/chat" replace />} />
                <Route path="/chat"                  element={<ChatPage />} />
                <Route path="/projects"              element={<ProjectsPage />} />
                <Route path="/projects/:slug"        element={<ProjectDetailPage />} />
                <Route path="/workflows"             element={<WorkflowsPage />} />
                <Route path="/workflows/:id/edit"    element={<WorkflowEditPage />} />
                <Route path="/workflows/runs/:runId" element={<WorkflowRunPage />} />
                <Route path="/tasks"                 element={<TasksPage />} />
                <Route path="/documents/*"           element={<DocumentsPage />} />
                <Route path="/settings"              element={<SettingsPage />} />

                {/* 404 fallback */}
                <Route path="*"                      element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
