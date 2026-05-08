/**
 * NewDMModal — pick a user → start (or open) a 1-1 DM channel.
 *
 * Round-7b: previously the only way to land in a DM was via a system-generated
 * card (e.g. approval request); there was no UI to start a fresh DM with
 * any teammate. This modal queries `profiles`, lets the user search by name,
 * and on selection calls `get_or_create_dm_channel(partner_id)` (idempotent
 * RPC — see gotcha #29). Modal closes on success and the parent navigates
 * to the new DM.
 */
import { memo, useMemo, useState } from 'react'
import { Search, MessageSquare, Loader2 } from 'lucide-react'
import Modal from '../ui/Modal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'
import { useQuery } from '@tanstack/react-query'
import type { Profile } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  /** Called with channelId + partner display name when DM is ready. */
  onCreated: (channelId: string, partnerName: string) => void
}

export default memo(function NewDMModal({ open, onClose, onCreated }: Props) {
  const { user } = useAuth()
  const { error: toastError } = useToast()
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: profiles = [] } = useQuery({
    queryKey: ['all-profiles-for-dm'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .order('full_name')
      if (error) {
        console.warn('[NewDMModal] profiles query failed:', error.message)
        return []
      }
      return data as Profile[]
    },
    staleTime: 0,
    gcTime: 0,
    enabled: open,
  })

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return profiles.filter(p =>
      p.id !== user?.id &&
      (!s || (p.full_name ?? '').toLowerCase().includes(s)),
    )
  }, [profiles, search, user?.id])

  async function start(p: Profile) {
    if (busy) return
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('get_or_create_dm_channel', {
        partner_id: p.id,
      })
      if (error || !data) {
        toastError('Không thể tạo DM: ' + (error?.message ?? 'unknown'))
        return
      }
      // RPC may return either the channel row or just an id depending on
      // schema. Handle both.
      const channelId = typeof data === 'string'
        ? data
        : (data as { id?: string }).id
      if (!channelId) {
        toastError('RPC trả về không có channel id.')
        return
      }
      onCreated(channelId, p.full_name ?? 'DM')
      setSearch('')
      onClose()
    } catch (err) {
      toastError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nhắn tin riêng — chọn người" size="md">
      <div className="space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm tên thành viên…"
            autoFocus
            className="w-full border border-neutral-200 rounded-lg pl-7 pr-3 py-2 text-sm bg-white focus:outline-none focus:border-primary-400"
          />
        </div>

        <ul className="max-h-[40vh] overflow-y-auto divide-y divide-neutral-100 -mx-3 px-3">
          {filtered.length === 0 && (
            <li className="py-3 text-[12px] text-neutral-400 italic text-center">
              Không thấy thành viên phù hợp.
            </li>
          )}
          {filtered.map(p => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => start(p)}
                disabled={busy}
                className="w-full flex items-center gap-2 py-2 text-left hover:bg-neutral-50 rounded px-2 disabled:opacity-50"
              >
                <span className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                  {(p.full_name ?? '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-neutral-800 truncate">{p.full_name || '(Chưa đặt tên)'}</div>
                  <div className="text-[10px] text-neutral-500 truncate">{p.role}</div>
                </div>
                {busy
                  ? <Loader2 size={14} className="text-primary-600 animate-spin" />
                  : <MessageSquare size={14} className="text-neutral-400" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
})
