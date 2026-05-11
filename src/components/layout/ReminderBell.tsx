/**
 * ReminderBell — shows both:
 *   - Pending reminders (fire_at in future, not fired yet) from `reminders` table
 *   - Fired but unread reminder notifications from `notifications` table
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Clock } from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Notification } from '../../types'

interface Props {
  className?: string
}

interface Reminder {
  id: string
  title: string
  fire_at: string
  fired_at: string | null
  source_context_type: string | null
  source_context_id: string | null
  source_message_id: string | null
}

export default function ReminderBell({ className = '' }: Props) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // Fired but unread notifications
  const { data: firedItems = [] } = useQuery<Notification[]>({
    queryKey: ['reminder-notifications', user?.id],
    queryFn: async () => {
      if (!user) return []
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .eq('kind', 'reminder')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) {
        console.warn('[ReminderBell] notifications query failed:', error.message)
        return [] as Notification[]
      }
      return (data ?? []) as Notification[]
    },
    enabled: !!user,
    refetchInterval: 30_000,
    retry: false,
  })

  // Pending (not yet fired) reminders created by this user
  const { data: pendingItems = [] } = useQuery<Reminder[]>({
    queryKey: ['reminders-pending', user?.id],
    queryFn: async () => {
      if (!user) return []
      const { data, error } = await supabase
        .from('reminders')
        .select('id,title,fire_at,fired_at,source_context_type,source_context_id,source_message_id')
        .eq('created_by', user.id)
        .is('fired_at', null)
        .order('fire_at', { ascending: true })
        .limit(20)
      if (error) {
        console.warn('[ReminderBell] reminders query failed:', error.message)
        return [] as Reminder[]
      }
      return (data ?? []) as Reminder[]
    },
    enabled: !!user,
    refetchInterval: 30_000,
    retry: false,
  })

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminder-notifications'] }),
  })

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null

  const unreadCount = firedItems.length
  const totalCount = firedItems.length + pendingItems.length

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o) }}
        className={`relative p-1 rounded transition-colors ${totalCount > 0 ? 'text-[#8C5022] hover:bg-[#FBEFE0]' : 'text-neutral-300 hover:text-neutral-500'}`}
        title={totalCount > 0 ? `${totalCount} nhắc việc` : 'Nhắc việc'}
      >
        <Bell size={13} />
        {totalCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 bg-[#D78B45] text-white text-[9px] font-bold rounded-full leading-[14px] text-center">
            {totalCount > 9 ? '9+' : totalCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed sm:absolute sm:top-full sm:right-0 sm:mt-1 left-2 right-2 sm:left-auto sm:w-[320px] z-50 bg-white border border-neutral-200 rounded-lg shadow-lg max-h-[60vh] overflow-y-auto"
          style={{ top: '50%' }}
        >
          <div className="px-3 py-2 border-b border-neutral-100 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 flex items-center justify-between">
            <span>🔔 Nhắc việc</span>
            <span className="text-neutral-400 font-normal normal-case">
              {unreadCount > 0 && `${unreadCount} đã đến giờ · `}{pendingItems.length} đang chờ
            </span>
          </div>

          {totalCount === 0 ? (
            <p className="text-[11px] text-neutral-400 italic px-3 py-3">
              Không có nhắc việc nào.
            </p>
          ) : (
            <>
              {/* Fired but unread */}
              {firedItems.map(n => {
                const meta = (n.payload as any) ?? {}
                return (
                  <button
                    key={n.id}
                    onClick={() => {
                      markRead.mutate(n.id)
                      if (meta.source_context_type && meta.source_context_id) {
                        const params = new URLSearchParams({
                          ctx_type: meta.source_context_type,
                          ctx_id:   meta.source_context_id,
                        })
                        if (meta.source_message_id) params.set('msg_id', meta.source_message_id)
                        navigate(`/chat?${params.toString()}`)
                      }
                      setOpen(false)
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-amber-50 border-t border-neutral-50 first:border-t-0 transition-colors"
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">Đến giờ</span>
                    </div>
                    <p className="text-[12px] font-medium text-neutral-800 truncate">{n.title}</p>
                    {n.body && <p className="text-[11px] text-neutral-500 mt-0.5">{n.body}</p>}
                    <p className="text-[10px] text-neutral-400 mt-0.5">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: vi })}
                    </p>
                  </button>
                )
              })}

              {/* Pending (not fired yet) */}
              {pendingItems.map(r => (
                <div
                  key={r.id}
                  className="w-full text-left px-3 py-2 border-t border-neutral-50 bg-neutral-50/60"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Clock size={9} className="text-neutral-400" />
                    <span className="text-[9px] font-medium text-neutral-500 uppercase tracking-wider">Đang chờ</span>
                  </div>
                  <p className="text-[12px] font-medium text-neutral-700 truncate">🔔 {r.title}</p>
                  <p className="text-[10px] text-neutral-400 mt-0.5">
                    {format(new Date(r.fire_at), 'HH:mm · dd/MM', { locale: vi })}
                    {' · '}
                    {formatDistanceToNow(new Date(r.fire_at), { addSuffix: true, locale: vi })}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
