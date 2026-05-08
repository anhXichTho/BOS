import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Send, Lock, User } from 'lucide-react'
import bcrypt from 'bcryptjs'
import { supabase } from '../../lib/supabase'
import RichTextEditor from '../../components/ui/RichTextEditor'
import RichTextDisplay from '../../components/ui/RichTextDisplay'
import { looksLikeHtml } from '../../lib/sanitizeHtml'
import type { Project, WorkflowRun, ChatMessage } from '../../types'

// ─── Login gate ──────────────────────────────────────────────────────────────

function LoginGate({
  project,
  onVerified,
}: {
  project: Project
  onVerified: (username: string) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setVerifying(true)

    // Verification synchronous via bcryptjs
    try {
      const usernameOk = username.trim() === (project.portal_username ?? '')
      const passwordOk = project.portal_password_hash
        ? bcrypt.compareSync(password, project.portal_password_hash)
        : false

      if (usernameOk && passwordOk) {
        sessionStorage.setItem(`portal_verified_${project.slug}`, username.trim())
        onVerified(username.trim())
      } else {
        setError('Username hoặc mật khẩu không đúng')
      }
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-sm border border-neutral-100 w-full max-w-sm p-6 sm:p-8">
        <div className="text-center mb-6">
          <Lock size={28} className="text-neutral-300 mx-auto mb-3" />
          <h2 className="font-serif text-xl font-medium text-neutral-800 mb-1">{project.title}</h2>
          <p className="text-xs text-neutral-500">Cổng thông tin khách hàng</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">
              Username
            </label>
            <div className="relative">
              <User size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-300" />
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg pl-8 pr-3 py-2 text-sm bg-white w-full"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-1">
              Mật khẩu
            </label>
            <div className="relative">
              <Lock size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-300" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg pl-8 pr-3 py-2 text-sm bg-white w-full"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={verifying}
            className="w-full bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 py-2 rounded-lg text-sm font-medium transition-colors mt-2"
          >
            {verifying ? 'Đang kiểm tra…' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── 404 page ─────────────────────────────────────────────────────────────────

function NotFound() {
  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
      <div className="text-center">
        <p className="text-5xl font-serif font-medium text-neutral-200 mb-4">404</p>
        <p className="text-neutral-500">Không tìm thấy trang này.</p>
      </div>
    </div>
  )
}

// ─── Portal content ───────────────────────────────────────────────────────────

function PortalContent({
  project,
  guestName,
}: {
  project: Project
  guestName: string
}) {
  const [guestMessage, setGuestMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [resetSignal, setResetSignal] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: runs = [] } = useQuery({
    queryKey: ['portal-runs', project.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('workflow_runs')
        .select('id, template_name, status, started_at, completed_at')
        .eq('project_id', project.id)
        .order('started_at', { ascending: false })
      return (data ?? []) as WorkflowRun[]
    },
  })

  const { data: messages = [], refetch: refetchMessages } = useQuery({
    queryKey: ['portal-messages', project.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('*, author:profiles(full_name)')
        .eq('context_type', 'project')
        .eq('context_id', project.id)
        .eq('message_type', 'text')
        .order('created_at', { ascending: true })
      return (data ?? []) as ChatMessage[]
    },
    refetchInterval: 30000,
  })

  // Realtime updates
  useEffect(() => {
    const channel = supabase
      .channel('portal-' + project.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `context_id=eq.${project.id}`,
      }, () => refetchMessages())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [project.id, refetchMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const completedRuns = runs.filter(r => r.status === 'completed').length
  const progress = runs.length > 0 ? Math.round((completedRuns / runs.length) * 100) : 0

  async function sendGuestMessage() {
    if (!guestMessage || !guestMessage.trim()) return
    setSending(true)
    try {
      // If the body contains HTML tags, prefix the guest name as an HTML
      // paragraph so the recipient still sees the speaker. Otherwise prefix as plain text.
      const isHtml = looksLikeHtml(guestMessage)
      const body = isHtml
        ? `<p><strong>[${escapeHtml(guestName)}]:</strong></p>${guestMessage}`
        : `[${guestName}]: ${guestMessage}`

      await supabase.from('chat_messages').insert({
        context_type: 'project',
        context_id:   project.id,
        message_type: 'text',
        content:      body,
      })
      setGuestMessage('')
      setResetSignal(s => s + 1)
      refetchMessages()
    } finally {
      setSending(false)
    }
  }

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-100 px-4 sm:px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-serif text-lg sm:text-xl font-medium text-neutral-800">{project.title}</h1>
            <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">Cổng thông tin khách hàng</p>
          </div>
          <span className="text-[10px] text-neutral-400 font-mono hidden sm:inline">@{guestName}</span>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4 sm:space-y-6">
        {/* Progress */}
        <div className="bg-white rounded-lg border border-neutral-100 p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-neutral-700">Tiến độ tổng thể</p>
            <span className="text-sm font-semibold text-primary-600">{progress}%</span>
          </div>
          <div className="h-2 bg-neutral-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-600 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-neutral-400 mt-2">
            {completedRuns}/{runs.length} workflow đã hoàn thành
          </p>
        </div>

        {/* Workflow runs */}
        {runs.length > 0 && (
          <div className="bg-white rounded-lg border border-neutral-100 p-4 sm:p-5">
            <p className="text-sm font-semibold text-neutral-700 mb-3">Các giai đoạn</p>
            <div className="space-y-2">
              {runs.map(run => (
                <div key={run.id} className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    run.status === 'completed' ? 'bg-green-500' :
                    run.status === 'cancelled' ? 'bg-red-300' : 'bg-amber-400'
                  }`} />
                  <span className="text-sm text-neutral-700 flex-1 truncate">{run.template_name}</span>
                  <span className={`text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    run.status === 'completed' ? 'bg-green-50 text-green-700' :
                    run.status === 'cancelled' ? 'bg-neutral-100 text-neutral-500' :
                    'bg-amber-50 text-amber-700'
                  }`}>
                    {run.status === 'completed' ? 'Xong' : run.status === 'cancelled' ? 'Huỷ' : 'Đang làm'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Thread / messages */}
        <div className="bg-white rounded-lg border border-neutral-100 overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b border-neutral-100">
            <p className="text-sm font-semibold text-neutral-700">Trao đổi</p>
          </div>

          <div className="max-h-80 overflow-y-auto px-4 sm:px-5 py-3 space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-neutral-400">Chưa có tin nhắn nào.</p>
            ) : messages.map(msg => (
              <div key={msg.id} className="text-sm">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="font-medium text-neutral-700">
                    {msg.author?.full_name ?? 'Khách'}
                  </span>
                  <span className="text-[10px] text-neutral-300">
                    {new Date(msg.created_at).toLocaleTimeString('vi', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <RichTextDisplay content={msg.content} className="text-sm text-neutral-600 break-words" />
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Guest input */}
          <div className="border-t border-neutral-100 px-3 sm:px-4 py-3 space-y-2">
            <RichTextEditor
              value={guestMessage}
              onChange={setGuestMessage}
              placeholder={`Nhắn với tư cách ${guestName}…`}
              uploadPrefix={`portal/${project.id}`}
              onSubmit={sendGuestMessage}
              minHeight={56}
              compact
              resetSignal={resetSignal}
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={sendGuestMessage}
                disabled={sending || !guestMessage.trim()}
                className="bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-medium"
              >
                <Send size={13} /> Gửi
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main portal page ─────────────────────────────────────────────────────────

export default function PortalPage() {
  const { slug } = useParams<{ slug: string }>()

  const { data: project, isLoading, isError } = useQuery({
    queryKey: ['portal-project', slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('slug', slug!)
        .eq('portal_enabled', true)
        .maybeSingle()
      if (error) throw error
      return data as Project | null
    },
    enabled: !!slug,
    retry: false,
  })

  const [guestName, setGuestName] = useState<string | null>(() =>
    slug ? sessionStorage.getItem(`portal_verified_${slug}`) : null
  )

  if (isLoading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-primary-400 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (isError || !project) return <NotFound />

  // Username + password mandatory — no bypass
  if (!guestName) {
    return <LoginGate project={project} onVerified={setGuestName} />
  }

  return <PortalContent project={project} guestName={guestName} />
}
