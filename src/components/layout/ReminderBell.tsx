/**
 * ReminderBell — Round-10 follow-up.
 *
 * A dedicated bell that surfaces FIRED but UNREAD reminder notifications.
 * Visually separate from the system NotificationBell — different icon
 * colour and a different popover (this one only lists `kind = 'reminder'`).
 *
 * Anchored next to the Tin nhắn nav row's red unread-chat dot. Click →
 * popover with the unread reminders. Click a row → navigate to the source
 * message + mark the notification as read.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Notification } from '../../types'

interface Props {
  /** Optional className passed through to the wrapper. */
  className?: string
}

export default function ReminderBell({ className = '' }: Props) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  const { data: items = [] } = useQuery<Notification[]>({
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
        console.warn('[ReminderBell] query failed:', error.message)
        return [] as Notification[]
      }
      return (data ?? []) as Notification[]
    },
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: 60_000,
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

  // Close on click-outside / Esc
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
  const unread = items.length

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o) }}
        className={`relative p-1 rounded transition-colors ${unread > 0 ? 'text-[#8C5022] hover:bg-[#FBEFE0]' : 'text-neutral-300 hover:text-neutral-500'}`}
        title={unread > 0 ? `${unread} nhắc việc chưa đọc` : 'Nhắc việc'}
      >
        <Bell size={13} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 bg-[#D78B45] text-white text-[9px] font-bold rounded-full leading-[14px] text-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed sm:absolute sm:top-full sm:right-0 sm:mt-1 left-2 right-2 sm:left-auto sm:w-[320px] z-50 bg-white border border-neutral-200 rounded-lg shadow-lg max-h-[60vh] overflow-y-auto"
             style={{ top: '50%' }}>
          <div className="px-3 py-2 border-b border-neutral-100 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 flex items-center justify-between">
            <span>🔔 Nhắc việc</span>
            <span className="text-neutral-400 font-normal normal-case">{unread} chưa đọc</span>
          </div>
          {items.length === 0 ? (
            <p className="text-[11px] text-neutral-400 italic px-3 py-3">
              Không có nhắc việc nào.
            </p>
          ) : items.map(n => {
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
                className="w-full text-left px-3 py-2 hover:bg-neutral-50 border-t border-neutral-50 first:border-t-0 transition-colors"
              >
                <p className="text-[12px] font-medium text-neutral-800 truncate">{n.title}</p>
                {n.body && (
                  <p className="text-[11px] text-neutral-500 line-clamp-2 mt-0.5">{n.body}</p>
                )}
                <p className="text-[10px] text-neutral-400 mt-0.5">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: vi })}
                </p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
