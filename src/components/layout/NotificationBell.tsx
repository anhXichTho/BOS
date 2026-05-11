import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Bell, X, Check, AtSign, FolderKanban, GitBranch, Calendar, ClipboardList, FileText, Inbox, CheckSquare, MessageSquare, Clock,
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { vi } from 'date-fns/locale'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { openPanel } from '../../lib/sidePanelStore'
import type { Notification, NotificationKind } from '../../types'

interface PendingReminder {
  id: string
  title: string
  fire_at: string
  source_context_type: string | null
  source_context_id: string | null
  source_message_id: string | null
}

/**
 * Bell + drawer for in-app notifications. Subscribes to Supabase Realtime
 * on the notifications table filtered by user_id; falls back to a 30s
 * polling refetch. Also shows pending (unfired) reminders from the reminders table.
 */
export default function NotificationBell() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('unread')
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef  = useRef<HTMLButtonElement>(null)

  // Set dropdown anchor on open. Desktop only — on mobile anchor stays null
  // and the dropdown uses the fixed top-of-screen layout.
  // Always use left=60 (fixed sidebar slot 48px + 12px gap) so the panel
  // doesn't follow the expanding sidebar and end up floating mid-screen.
  useEffect(() => {
    if (!open) return
    const isDesktop = window.matchMedia('(min-width: 768px)').matches
    if (!isDesktop) { setAnchor(null); return }
    const r = buttonRef.current?.getBoundingClientRect()
    if (!r) return
    setAnchor({ top: r.top, left: 60 })
  }, [open])

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(50)
      // Tolerate missing table (404) — feature works once migration is applied.
      // Without this, an unhandled query error blanks the whole app.
      if (error) {
        console.warn('[NotificationBell] notifications query failed:', error.message)
        return [] as Notification[]
      }
      return (data ?? []) as Notification[]
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
    retry: false,
  })

  // Pending (not yet fired) reminders created by this user
  const { data: pendingReminders = [] } = useQuery<PendingReminder[]>({
    queryKey: ['reminders-pending', user?.id],
    queryFn: async () => {
      if (!user) return []
      const { data, error } = await supabase
        .from('reminders')
        .select('id,title,fire_at,source_context_type,source_context_id,source_message_id')
        .eq('created_by', user.id)
        .is('fired_at', null)
        .order('fire_at', { ascending: true })
        .limit(20)
      if (error) {
        console.warn('[NotificationBell] reminders query failed:', error.message)
        return []
      }
      return (data ?? []) as PendingReminder[]
    },
    enabled: !!user?.id,
    refetchInterval: 30_000,
    retry: false,
  })

  // Realtime — invalidate the query whenever a row arrives for this user.
  // Guards:
  //   1. Use a unique channel name per mount so re-mounts (StrictMode/HMR) get a
  //      fresh channel instead of getting the cached one (which is already subscribed,
  //      so calling .on after .subscribe would throw).
  //   2. Wrap subscribe() in try/catch so a backend hiccup doesn't crash the tree.
  //   3. removeChannel on unmount.
  useEffect(() => {
    if (!user?.id) return
    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel(`notifications-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        }, async (payload) => {
          qc.invalidateQueries({ queryKey: ['notifications', user.id] })
          // Realtime → SW.showNotification fallback. The FCM/SW push path
          // (fan_out_push → send-push → push event) is unreliable when the
          // app runs as an installed PWA — sometimes silently drops. Use the
          // same `tag` the FCM path uses (= notification.kind) so the two
          // showNotification calls collapse to a single OS toast when both
          // fire successfully.
          if (payload.eventType !== 'INSERT' || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
          const n = payload.new as { id?: string; title?: string; body?: string; kind?: string; payload?: Record<string, string>; link?: string }
          try {
            const reg = await navigator.serviceWorker.ready
            const np = n.payload ?? {}
            const navUrl = n.link ??
              (n.kind === 'mention'
                ? `/chat?ctx_type=${np.context_type ?? 'channel'}&ctx_id=${np.context_id ?? ''}&msg_id=${np.message_id ?? ''}`
                : n.kind === 'dm_message'         ? `/chat?dm=${np.channel_id ?? ''}`
                : n.kind === 'approval_requested' || n.kind === 'step_approved' || n.kind === 'step_rejected' || n.kind === 'workflow_assigned' || n.kind === 'workflow_completed'
                  ? (np.run_id ? `/workflows?open_run=${np.run_id}` : '/workflows')
                : n.kind === 'project_assigned'   ? '/projects'
                : n.kind === 'task_assigned' || n.kind === 'task_completed'
                  ? (np.task_id ? `/tasks?id=${np.task_id}` : '/tasks')
                : '/')
            await reg.showNotification(n.title || 'BOS', {
              body: n.body || '',
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: n.kind || 'bos',  // same tag as FCM path → dedupes when both fire
              data: { url: navUrl },
              renotify: true,
            } as NotificationOptions & { renotify: boolean })
          } catch (err) {
            console.warn('[NotificationBell] showNotification failed:', err)
          }
        })
        .subscribe(status => {
          if (status === 'CHANNEL_ERROR') {
            // Realtime not available (table missing, replication off, etc.) —
            // polling fallback (30s refetchInterval above) keeps things working.
            console.warn('[NotificationBell] realtime unavailable; using polling.')
          }
        })
    } catch (err) {
      console.warn('[NotificationBell] realtime subscribe failed:', err)
    }
    return () => { if (channel) supabase.removeChannel(channel) }
  }, [user?.id, qc])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const unreadCount = notifications.filter(n => !n.read_at).length
  const visible = filter === 'unread'
    ? notifications.filter(n => !n.read_at)
    : notifications

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  })

  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', user!.id)
        .is('read_at', null)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  })

  function handleClick(n: Notification) {
    if (!n.read_at) markRead.mutate(n.id)
    setOpen(false)

    if (n.link) { navigate(n.link); return }

    const meta = (n.payload ?? {}) as Record<string, string | undefined>

    switch (n.kind) {
      case 'mention':
        navigate('/chat')
        break
      case 'dm_message':
        if (meta.channel_id) {
          navigate(`/chat?dm=${meta.channel_id}`)
        } else {
          navigate('/chat')
        }
        break
      case 'project_assigned':
        navigate('/projects')
        break
      case 'approval_requested':
      case 'step_approved':
      case 'step_rejected':
      case 'workflow_assigned':
      case 'workflow_completed':
        if (meta.run_id) {
          openPanel({ id: meta.run_id, kind: 'workflow_run', title: n.title })
          navigate('/workflows')
        } else {
          navigate('/workflows')
        }
        break
      case 'reminder':
        if (meta.source_context_type && meta.source_context_id) {
          const params = new URLSearchParams({
            ctx_type: meta.source_context_type,
            ctx_id: meta.source_context_id,
          })
          if (meta.source_message_id) params.set('msg_id', meta.source_message_id)
          navigate(`/chat?${params.toString()}`)
        }
        break
      case 'schedule_fired':
        navigate('/workflows')
        break
      case 'form_submitted':
        navigate('/settings')
        break
      case 'task_assigned':
      case 'task_completed':
        if (meta.task_id) {
          openPanel({ id: meta.task_id, kind: 'task_view', title: n.title })
          navigate('/tasks')
        } else {
          navigate('/tasks')
        }
        break
      default:
        break
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center justify-center transition-colors h-12 w-12 rounded-lg relative ${
          open ? 'bg-primary-50 text-primary-600' : 'text-neutral-400 hover:text-neutral-200'
        }`}
        title="Thông báo"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            className="absolute top-2 right-2 min-w-[16px] h-[16px] px-1 rounded-full text-white text-[9px] font-bold flex items-center justify-center"
            style={{ background: 'var(--color-danger, #C9534B)' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
        {unreadCount === 0 && pendingReminders.length > 0 && (
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-400 border border-white" />
        )}
      </button>

      {open && (
        <div
          style={anchor ? { position: 'fixed', top: anchor.top, left: anchor.left } : undefined}
          className="md:max-w-none fixed md:w-[360px] inset-x-2 top-14 md:inset-auto z-50 w-auto bg-white border border-neutral-200 rounded-lg shadow-xl flex flex-col max-h-[80vh]">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2 shrink-0">
            <Bell size={14} className="text-neutral-500" />
            <span className="text-sm font-medium text-neutral-800">Thông báo</span>
            <span className="text-[11px] text-neutral-400">({unreadCount} chưa đọc)</span>
            <div className="flex-1" />
            <button
              onClick={() => setOpen(false)}
              className="text-neutral-400 hover:text-neutral-700 p-1 rounded"
            >
              <X size={14} />
            </button>
          </div>

          {/* Filter + actions */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-neutral-100 shrink-0">
            <button
              onClick={() => setFilter('unread')}
              className={`text-[11px] px-2 py-1 rounded transition-colors ${
                filter === 'unread'
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              Chưa đọc
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`text-[11px] px-2 py-1 rounded transition-colors ${
                filter === 'all'
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              Tất cả
            </button>
            <div className="flex-1" />
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="text-[11px] text-neutral-500 hover:text-primary-600 inline-flex items-center gap-0.5"
              >
                <Check size={11} /> Đánh dấu đã đọc
              </button>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {/* Pending reminders section */}
            {pendingReminders.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 bg-neutral-50 border-b border-neutral-100">
                  🔔 Nhắc việc đang chờ ({pendingReminders.length})
                </div>
                <ul className="divide-y divide-neutral-100">
                  {pendingReminders.map(r => (
                    <li key={r.id}>
                      <button
                        onClick={() => {
                          setOpen(false)
                          if (r.source_context_type && r.source_context_id) {
                            const params = new URLSearchParams({
                              ctx_type: r.source_context_type,
                              ctx_id: r.source_context_id,
                            })
                            if (r.source_message_id) params.set('msg_id', r.source_message_id)
                            navigate(`/chat?${params.toString()}`)
                          }
                        }}
                        className="w-full text-left flex items-start gap-2.5 px-3 py-2.5 hover:bg-amber-50/40 transition-colors"
                      >
                        <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 bg-white border border-neutral-200 text-amber-500">
                          <Clock size={13} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-neutral-800 truncate">{r.title}</p>
                          <p className="text-[10px] text-neutral-400 mt-0.5">
                            {format(new Date(r.fire_at), 'HH:mm · dd/MM', { locale: vi })}
                            {' · '}
                            {formatDistanceToNow(new Date(r.fire_at), { addSuffix: true, locale: vi })}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {visible.length === 0 && pendingReminders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-neutral-400">
                <Inbox size={28} className="mb-2 text-neutral-300" />
                <p className="text-xs">{filter === 'unread' ? 'Không có thông báo chưa đọc.' : 'Chưa có thông báo nào.'}</p>
              </div>
            ) : visible.length === 0 ? null : (
              <>
                {pendingReminders.length > 0 && (
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 bg-neutral-50 border-b border-neutral-100">
                    Thông báo
                  </div>
                )}
              <ul className="divide-y divide-neutral-100">
                {visible.map(n => {
                  const meta = (n.payload ?? {}) as Record<string, string | undefined>
                  const isApproval = n.kind === 'approval_requested'
                  return (
                    <li key={n.id}>
                      {isApproval ? (
                        <div className={`flex items-start gap-2.5 px-3 py-2.5 ${!n.read_at ? 'bg-amber-50/30' : ''}`}>
                          <KindIcon kind={n.kind} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-medium text-neutral-800 truncate">{n.title}</p>
                              {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />}
                            </div>
                            {n.body && <p className="text-[11px] text-neutral-500 truncate mt-0.5">{n.body}</p>}
                            <p className="text-[10px] text-neutral-400 mt-0.5">
                              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: vi })}
                            </p>
                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              <button
                                onClick={() => {
                                  if (!n.read_at) markRead.mutate(n.id)
                                  setOpen(false)
                                  if (meta.run_id) openPanel({ id: meta.run_id, kind: 'workflow_run', title: n.title })
                                  navigate('/workflows')
                                }}
                                className="text-[10px] px-2 py-1 border border-neutral-200 bg-white rounded text-neutral-700 hover:bg-neutral-50 transition-colors"
                              >
                                Xem tại Luồng NV
                              </button>
                              {meta.run_id && (
                                <button
                                  onClick={async () => {
                                    if (!n.read_at) markRead.mutate(n.id)
                                    setOpen(false)
                                    // Find the chat thread that originally started this run
                                    const { data: msg } = await supabase
                                      .from('chat_messages')
                                      .select('id, context_type, context_id')
                                      .eq('workflow_run_id', meta.run_id!)
                                      .neq('context_type', 'standalone')
                                      .order('created_at', { ascending: true })
                                      .limit(1)
                                      .maybeSingle()
                                    const ctxMeta = msg
                                      ? { context_type: msg.context_type, context_id: msg.context_id }
                                      : {}
                                    openPanel({ id: meta.run_id!, kind: 'workflow_run', title: n.title, meta: ctxMeta })
                                    if (msg) {
                                      let ctxName = ''
                                      if (msg.context_type === 'channel') {
                                        const { data: ch } = await supabase.from('chat_channels').select('name').eq('id', msg.context_id).single()
                                        ctxName = ch?.name ?? ''
                                      } else if (msg.context_type === 'project') {
                                        const { data: proj } = await supabase.from('projects').select('title').eq('id', msg.context_id).single()
                                        ctxName = proj?.title ?? ''
                                      }
                                      navigate(`/chat?ctx_type=${msg.context_type}&ctx_id=${msg.context_id}&ctx_name=${encodeURIComponent(ctxName)}&msg_id=${msg.id}`)
                                    } else {
                                      navigate('/chat')
                                    }
                                  }}
                                  className="text-[10px] px-2 py-1 border border-neutral-200 bg-white rounded text-neutral-700 hover:bg-neutral-50 transition-colors"
                                >
                                  Xem tại Tin nhắn
                                </button>
                              )}
                              {!n.read_at && (
                                <button
                                  onClick={() => markRead.mutate(n.id)}
                                  className="text-[10px] px-2 py-1 bg-neutral-100 rounded text-neutral-500 hover:bg-neutral-200 transition-colors"
                                >
                                  Đã đọc
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleClick(n)}
                          className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 hover:bg-neutral-25 transition-colors ${
                            !n.read_at ? 'bg-primary-50/30' : ''
                          }`}
                        >
                          <KindIcon kind={n.kind} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-medium text-neutral-800 truncate">{n.title}</p>
                              {!n.read_at && (
                                <span className="w-1.5 h-1.5 rounded-full bg-primary-600 shrink-0" />
                              )}
                            </div>
                            {n.body && (
                              <p className="text-[11px] text-neutral-500 truncate mt-0.5">{n.body}</p>
                            )}
                            <p className="text-[10px] text-neutral-400 mt-0.5">
                              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: vi })}
                            </p>
                          </div>
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          </div>
        </div>
      )}
    </div>
  )
}

function KindIcon({ kind }: { kind: NotificationKind }) {
  const cls = 'w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 bg-white border border-neutral-200'
  switch (kind) {
    case 'dm_message':
      return <div className={`${cls} text-primary-600`}><MessageSquare size={13} /></div>
    case 'mention':
      return <div className={`${cls} text-primary-600`}><AtSign size={13} /></div>
    case 'project_assigned':
      return <div className={`${cls} text-amber-600`}><FolderKanban size={13} /></div>
    case 'workflow_assigned':
    case 'workflow_completed':
      return <div className={`${cls} text-green-600`}><GitBranch size={13} /></div>
    case 'schedule_fired':
      return <div className={`${cls} text-violet-600`}><Calendar size={13} /></div>
    case 'form_submitted':
      return <div className={`${cls} text-rose-600`}><ClipboardList size={13} /></div>
    case 'approval_requested':
      return <div className={`${cls} text-amber-600`}><Check size={13} /></div>
    case 'step_approved':
      return <div className={`${cls} text-green-600`}><Check size={13} /></div>
    case 'step_rejected':
      return <div className={`${cls} text-red-500`}><X size={13} /></div>
    case 'task_assigned':
    case 'task_completed':
      return <div className={`${cls} text-primary-600`}><CheckSquare size={13} /></div>
    case 'reminder':
      return <div className={`${cls} text-amber-500`}><Clock size={13} /></div>
    case 'doc_shared':
      return <div className={`${cls} text-cyan-600`}><FileText size={13} /></div>
    default:
      return <div className={`${cls} text-neutral-500`}><Bell size={13} /></div>
  }
}
