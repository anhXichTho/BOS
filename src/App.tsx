import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './components/ui/Toast'
import ThemeApplier from './components/layout/ThemeApplier'

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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeApplier />
        <ToastProvider>
          <BrowserRouter>
            <ExitGuard />
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
  )
}
