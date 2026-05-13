import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { Plus, Hash, FolderKanban, UserCircle, ChevronDown, ChevronRight, Users, Trash2, Loader2 } from 'lucide-react'
import AppShell, { useCloseDrawer, useIsDrawerOpen } from '../components/layout/AppShell'
import { useMediaQuery } from '../lib/useMediaQuery'
import { setInThreadView } from '../lib/exitGuardState'
import { SidebarSection, SidebarItem } from '../components/layout/Sidebar'
import MessageFeed from '../components/chat/MessageFeed'
import MessageInput from '../components/chat/MessageInput'
import NewDMModal from '../components/chat/NewDMModal'
import ChannelMembersModal from '../components/chat/ChannelMembersModal'
import GlobalSearchBox from '../components/chat/GlobalSearchBox'
import ChannelSearchBox from '../components/chat/ChannelSearchBox'
import ProjectWorkspacePanel from '../components/panel/ProjectWorkspacePanel'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/ui/Toast'
import { supabase } from '../lib/supabase'
import { clearPanels } from '../lib/sidePanelStore'
import { useChatUnread, useMarkChatRead } from '../lib/useChatUnread'
import { avatarColorOf, initialsOf } from '../lib/avatarColor'
import type { ChatChannel, Project, ContextType } from '../types'

interface ActiveContext {
  type: ContextType
  id: string
  name: string
}

// ─── Member avatar stack ──────────────────────────────────────────────────────
// Round-9 polish: each member's chip uses a stable hash colour (warm palette)
// instead of the previous all-blue look — gives every team channel a distinct
// visual fingerprint based on its member set.

const MemberAvatarStack = memo(
  function MemberAvatarStack({ members }: { members: { id: string; full_name: string }[] }) {
    const shown = members.slice(0, 2)
    const rest  = members.length - shown.length
    return (
      <span className="flex items-center shrink-0">
        {shown.map(m => {
          const c = avatarColorOf(m.id)
          return (
            <span
              key={m.id}
              title={m.full_name}
              className={`w-4 h-4 rounded-full ${c.bg} ${c.text} text-[7px] font-bold flex items-center justify-center border border-white first:ml-0 -ml-1`}
            >
              {initialsOf(m.full_name)}
            </span>
          )
        })}
        {rest > 0 && <span className="text-[9px] text-neutral-400 ml-1">+{rest}</span>}
      </span>
    )
  },
  // Cheap shallow compare — members come from a memoised query, so the
  // array reference stays stable unless the list actually changes.
  (a, b) => a.members === b.members,
)

// ─── Sidebar content ─────────────────────────────────────────────────────────

function ChatSidebar({
  active,
  onSelect,
  onSearchHit,
}: {
  active: ActiveContext | null
  onSelect: (ctx: ActiveContext) => void
  /** Round-9: search-hit click → navigates AND sets scroll-to-message. */
  onSearchHit?: (ctx: ActiveContext, msgId: string) => void
}) {
  const { isAdmin, isEditor, selfChatId, user } = useAuth()
  const closeDrawer = useCloseDrawer()
  const select = (ctx: ActiveContext) => { closeDrawer(); onSelect(ctx) }
  const { success, error: toastError } = useToast()
  const qc = useQueryClient()
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [showNewDM, setShowNewDM] = useState(false)
  const [manageMembersForChannelId, setManageMembersForChannelId] = useState<string | null>(null)
  const [confirmDeleteChannel, setConfirmDeleteChannel] = useState<{ id: string; name: string } | null>(null)
  const [confirmText, setConfirmText] = useState('')
  // Round-7b: per-section "Xem thêm" expansion state.
  const [expanded, setExpanded] = useState<{ channels: boolean; dms: boolean; projects: boolean }>({
    channels: false, dms: false, projects: false,
  })
  const [newChannelName, setNewChannelName] = useState('')

  // ── Data queries ───────────────────────────────────────────────────────────

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_channels')
        .select('*')
        .order('name')
      if (error) throw error
      return data as ChatChannel[]
    },
  })

  // Split channels by type
  const teamChannels = channels.filter(ch => ch.channel_type === 'team' || (!ch.channel_type && !ch.owner_id))
  const dmChannels   = channels.filter(ch => ch.channel_type === 'dm')

  const { data: allMembers = [] } = useQuery({
    queryKey: ['all-profiles-brief'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name').order('full_name')
      return (data ?? []) as { id: string; full_name: string }[]
    },
    staleTime: 300_000,
  })

  /** Round-9: id → profile lookup so DM channels can render the partner's
   *  full name + avatar initials in the sidebar instead of the literal "DM". */
  const membersById = useMemo(
    () => new Map(allMembers.map(m => [m.id, m])),
    [allMembers],
  )

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, title, status')
        .neq('status', 'cancelled')
        .order('title')
      if (error) throw error
      return data as Project[]
    },
  })

  // ── Badge data ─────────────────────────────────────────────────────────────

  // Running workflow runs linked to channels/projects.
  // Round-9 perf: was scanning ALL chat_messages with workflow_run_id then
  // filtering client-side. Now queries `workflow_runs` directly + a narrow
  // join on chat_messages to recover the context_id. Much smaller payload.
  const { data: runningWorkflowCtxIds = [] } = useQuery({
    queryKey: ['running-workflow-channels', user?.id],
    queryFn: async () => {
      if (!user) return []
      const { data: runs } = await supabase
        .from('workflow_runs')
        .select('id')
        .eq('status', 'in_progress')
        .eq('run_by', user.id)
      const runIds = (runs ?? []).map((r: any) => r.id as string)
      if (runIds.length === 0) return []
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('context_id, context_type, workflow_run_id')
        .in('workflow_run_id', runIds)
        .in('context_type', ['channel', 'project'])
      return (msgs ?? []).map((m: any) => m.context_id as string)
    },
    staleTime: 60_000,
    retry: false,
  })
  const runningWorkflowCtxSet = new Set(runningWorkflowCtxIds)

  // Unread message counts per context_id
  const allContextIds = [
    ...channels.map(ch => ch.id),
    ...projects.map(p => p.id),
    ...(selfChatId ? [selfChatId] : []),
  ]
  const { data: unreadCountMap = {} } = useChatUnread(allContextIds)

  // ── Badge renderer ─────────────────────────────────────────────────────────

  function channelBadge(ctxId: string) {
    const unread = unreadCountMap[ctxId] ?? 0
    const hasWorkflow = runningWorkflowCtxSet.has(ctxId)
    // Round-9 polish: every channel always shows a tiny hashed-colour dot
    // (not just when there's an unread/workflow) so the list reads as a
    // colourful index instead of a uniform blue list. Cost: 1 div, no query.
    const hue = avatarColorOf(ctxId)
    if (!unread && !hasWorkflow) {
      return (
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${hue.solid} shrink-0 opacity-50`} />
      )
    }
    return (
      <span className="flex items-center gap-1 shrink-0">
        {unread > 0 && (
          <span className={`min-w-[16px] h-4 text-[10px] font-bold ${hue.solid} text-white px-1 rounded-full leading-4 text-center tabular-nums shadow-sm`}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
        {hasWorkflow && (
          <span
            title="Nghiệp vụ đang chạy"
            className="inline-block w-2 h-2 rounded-full bg-[#C8954A] shrink-0 animate-pulse"
          />
        )}
      </span>
    )
  }

  // ── Channel creation ───────────────────────────────────────────────────────
  // Round-7b: new channels are PRIVATE by default. Creator gets auto-added
  // as the first member (owner role); they then open the members modal to
  // invite teammates. Existing channels (is_private=false) keep their open
  // visibility — see migration #28 + gotcha #70.

  async function createChannel() {
    const name = newChannelName.trim()
    if (!name) return
    const { data: created, error } = await supabase
      .from('chat_channels')
      .insert({
        name,
        is_private: true,
        owner_id: user?.id ?? null,
        created_by: user?.id ?? null,
      })
      .select('id')
      .single()
    if (error || !created) {
      toastError('Không thể tạo channel: ' + (error?.message ?? 'unknown'))
      return
    }
    // Auto-add creator as owner-member.
    if (user?.id) {
      await supabase
        .from('chat_channel_members')
        .insert({ channel_id: created.id, user_id: user.id, role: 'owner' })
        .then(({ error: memErr }) => {
          if (memErr) console.warn('[createChannel] add-owner-member failed:', memErr.message)
        })
    }
    success(`#${name} đã tạo. Mở "Thành viên" để mời thêm.`)
    qc.invalidateQueries({ queryKey: ['channels'] })
    setShowNewChannel(false)
    setNewChannelName('')
    // Open the members modal so the creator can invite people right away.
    setManageMembersForChannelId(created.id)
  }

  const canManageChannels = isAdmin || isEditor
  const selfUnread = selfChatId ? (unreadCountMap[selfChatId] ?? 0) : 0

  /** Helper: can the current user delete this team channel? Owner OR admin/editor. */
  function canDeleteChannel(ch: ChatChannel): boolean {
    if (!user) return false
    if (isAdmin || isEditor) return true
    return ch.owner_id === user.id || ch.created_by === user.id
  }

  const deleteChannelMutation = useMutation({
    mutationFn: async (channelId: string) => {
      const { error } = await supabase.rpc('delete_channel', { p_channel_id: channelId })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['channels'] })
      qc.invalidateQueries({ queryKey: ['chat-total-unread'] })
      success(`Đã xoá kênh "${confirmDeleteChannel?.name}"`)
      setConfirmDeleteChannel(null)
      setConfirmText('')
    },
    onError: (err: Error) => toastError('Không thể xoá: ' + err.message),
  })

  // Round-9: resolver so search-hit channel labels show DM partner names,
  // not the literal "DM" stored in chat_channels.name.
  const channelById = useMemo(() => new Map(channels.map(ch => [ch.id, ch])), [channels])
  const resolveChannelName = (channelId: string, fallback: string) => {
    const ch = channelById.get(channelId)
    if (!ch) return fallback
    if (ch.channel_type === 'dm') {
      const otherUserId = ch.dm_partner_id === user?.id ? ch.owner_id : ch.dm_partner_id
      const partner = otherUserId ? membersById.get(otherUserId) : null
      return partner?.full_name ?? fallback
    }
    return ch.name ?? fallback
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        {/* Round-9: global message search — across all visible channels/projects */}
        <GlobalSearchBox
          resolveChannelName={resolveChannelName}
          onSelectHit={(ctx) => {
            const next: ActiveContext = {
              type: ctx.contextType === 'project' ? 'project' : 'channel',
              id:   ctx.contextId,
              name: ctx.name,
            }
            if (onSearchHit) onSearchHit(next, ctx.msgId)
            else select(next)
          }}
        />
        {/* Personal channel — pinned at top */}
        {selfChatId && (
          <div className="px-3 pt-3 pb-1">
            <button
              onClick={() => select({ type: 'channel', id: selfChatId, name: 'Cá nhân' })}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-medium transition-all rounded-lg shadow-sm border ${
                active?.id === selfChatId
                  ? 'border-primary-200 bg-primary-50 text-primary-700 shadow'
                  : 'border-neutral-100 bg-white text-neutral-700 hover:bg-neutral-50 hover:shadow'
              }`}
            >
              <UserCircle size={15} className={active?.id === selfChatId ? 'text-primary-500' : 'text-neutral-400'} />
              <span className="flex-1 text-left truncate">Cá nhân</span>
              {selfUnread > 0 && (
                <span className="min-w-[16px] h-4 text-[10px] font-bold bg-primary-600 text-white px-1 rounded-full leading-4 text-center tabular-nums">
                  {selfUnread > 99 ? '99+' : selfUnread}
                </span>
              )}
              <span className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded-full">
                riêng
              </span>
            </button>
          </div>
        )}

        {/* Kênh — public channels */}
        <SidebarSection
          title="Kênh"
          action={canManageChannels ? (
            <button
              onClick={() => setShowNewChannel(true)}
              className="text-neutral-400 hover:text-neutral-700 transition-colors"
              title="Tạo kênh mới"
            >
              <Plus size={14} />
            </button>
          ) : undefined}
        >
          <CollapsibleList
            items={teamChannels}
            expanded={expanded.channels}
            onToggle={() => setExpanded(s => ({ ...s, channels: !s.channels }))}
            renderItem={ch => (
              <SidebarItem
                key={ch.id}
                label={ch.name}
                active={active?.id === ch.id}
                onClick={() => select({ type: 'channel', id: ch.id, name: ch.name })}
                badge={channelBadge(ch.id)}
                icon={<MemberAvatarStack members={allMembers} />}
                actions={
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setManageMembersForChannelId(ch.id) }}
                      className="text-neutral-400 hover:text-neutral-700 p-0.5"
                      title="Quản lý thành viên"
                    >
                      <Users size={11} />
                    </button>
                    {canDeleteChannel(ch) && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteChannel({ id: ch.id, name: ch.name }); setConfirmText('') }}
                        className="text-neutral-400 hover:text-red-600 p-0.5"
                        title="Xoá kênh"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                }
              />
            )}
          />
        </SidebarSection>

        {/* Tin nhắn riêng — DMs (always visible so user can start a new DM) */}
        <SidebarSection
          title="Tin nhắn riêng"
          action={
            <button
              onClick={() => setShowNewDM(true)}
              className="text-neutral-400 hover:text-neutral-700 transition-colors"
              title="Nhắn tin riêng"
            >
              <Plus size={14} />
            </button>
          }
        >
          {dmChannels.length === 0 ? (
            <p className="text-[11px] text-neutral-400 px-3 py-1.5 italic">
              Chưa có ai. Bấm + để bắt đầu.
            </p>
          ) : (
            <CollapsibleList
              items={dmChannels}
              expanded={expanded.dms}
              onToggle={() => setExpanded(s => ({ ...s, dms: !s.dms }))}
              renderItem={ch => {
                // Round-9: DM channels show partner's full name + avatar
                // initials in a stable hashed colour (per-partner) so the DM
                // list is instantly visually scannable.
                // If I am the dm_partner, the "other person" is the owner; otherwise it's the partner.
                const otherUserId = ch.dm_partner_id === user?.id ? ch.owner_id : ch.dm_partner_id
                const partner = otherUserId ? membersById.get(otherUserId) : null
                const partnerName = partner?.full_name ?? 'Người dùng'
                const c = avatarColorOf(otherUserId ?? ch.id)
                return (
                  <SidebarItem
                    key={ch.id}
                    label={partnerName}
                    active={active?.id === ch.id}
                    onClick={() => select({ type: 'channel', id: ch.id, name: partnerName })}
                    badge={channelBadge(ch.id)}
                    icon={
                      <span className={`w-5 h-5 rounded-full ${c.bg} ${c.text} text-[10px] font-semibold flex items-center justify-center shrink-0`}>
                        {initialsOf(partnerName) || '?'}
                      </span>
                    }
                  />
                )
              }}
            />
          )}
        </SidebarSection>

        {/* Tin nhắn theo dự án */}
        <SidebarSection title="Tin nhắn theo dự án">
          {projects.length === 0 ? (
            <p className="text-[11px] text-neutral-400 px-3 py-2">Chưa có dự án nào.</p>
          ) : (
            <CollapsibleList
              items={projects}
              expanded={expanded.projects}
              onToggle={() => setExpanded(s => ({ ...s, projects: !s.projects }))}
              renderItem={p => (
                <SidebarItem
                  key={p.id}
                  label={p.title}
                  active={active?.id === p.id}
                  onClick={() => select({ type: 'project', id: p.id, name: p.title })}
                  badge={channelBadge(p.id)}
                />
              )}
            />
          )}
        </SidebarSection>
      </div>

      {/* New channel modal */}
      <Modal
        open={showNewChannel}
        onClose={() => setShowNewChannel(false)}
        title="Tạo channel mới"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowNewChannel(false)}>Huỷ</Button>
            <Button onClick={createChannel}>Tạo</Button>
          </>
        }
      >
        <input
          autoFocus
          type="text"
          placeholder="tên-channel (không dấu, dùng dấu gạch)"
          value={newChannelName}
          onChange={e => setNewChannelName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && createChannel()}
          className="border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-1.5 text-sm font-serif bg-white w-full"
        />
      </Modal>

      {/* New DM modal — pick a partner → open the 1-1 channel */}
      <NewDMModal
        open={showNewDM}
        onClose={() => setShowNewDM(false)}
        onCreated={(channelId, name) => {
          qc.invalidateQueries({ queryKey: ['channels'] })
          select({ type: 'channel', id: channelId, name })
        }}
      />

      {/* Manage members modal — round-7b/2 per-channel ACL */}
      {manageMembersForChannelId && (
        <ChannelMembersModal
          open
          onClose={() => setManageMembersForChannelId(null)}
          channel={teamChannels.find(c => c.id === manageMembersForChannelId) ?? {
            id: manageMembersForChannelId,
            name: 'Channel',
            channel_type: 'team',
          }}
        />
      )}

      {/* Delete channel confirmation modal */}
      {confirmDeleteChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
            <div className="px-4 py-3 border-b border-neutral-100 flex items-center gap-2">
              <Trash2 size={14} className="text-red-600" />
              <h3 className="text-sm font-semibold text-neutral-800">Xoá kênh "{confirmDeleteChannel.name}"</h3>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-[12px] text-neutral-700">
                Hành động này sẽ xoá <strong>toàn bộ tin nhắn, file đính kèm, reaction</strong> trong kênh và <strong>không thể khôi phục</strong>.
              </p>
              <div>
                <label className="block text-[11px] text-neutral-600 mb-1">
                  Gõ tên kênh <span className="font-mono font-semibold text-neutral-800">{confirmDeleteChannel.name}</span> để xác nhận:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder={confirmDeleteChannel.name}
                  className="w-full border border-red-200 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-red-500"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => { setConfirmDeleteChannel(null); setConfirmText('') }}
                disabled={deleteChannelMutation.isPending}
                className="text-xs px-3 py-1.5 border border-neutral-200 text-neutral-600 hover:bg-neutral-100 rounded transition-colors"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={() => deleteChannelMutation.mutate(confirmDeleteChannel.id)}
                disabled={deleteChannelMutation.isPending || confirmText !== confirmDeleteChannel.name}
                className="text-xs px-3 py-1.5 bg-red-600 text-white hover:bg-red-700 rounded transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                {deleteChannelMutation.isPending && <Loader2 size={11} className="animate-spin" />}
                Xoá vĩnh viễn
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── CollapsibleList helper ────────────────────────────────────────────────────
// Round-7b: every chat sidebar section caps at 8 visible items by default;
// click "Xem thêm (+N)" to expand the full list, "Thu gọn" to collapse.

const VISIBLE_LIMIT = 8

function CollapsibleList<T>({
  items, expanded, onToggle, renderItem,
}: {
  items: T[]
  expanded: boolean
  onToggle: () => void
  renderItem: (it: T) => React.ReactNode
}) {
  const overflow = items.length - VISIBLE_LIMIT
  const visible = expanded ? items : items.slice(0, VISIBLE_LIMIT)
  return (
    <>
      {visible.map(it => renderItem(it))}
      {overflow > 0 && (
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center gap-1 text-[11px] text-neutral-500 hover:text-primary-700 px-3 py-1 hover:bg-neutral-50 transition-colors"
        >
          {expanded
            ? <><ChevronDown size={11} /><span>Thu gọn</span></>
            : <><ChevronRight size={11} /><span>Xem thêm (+{overflow})</span></>}
        </button>
      )}
    </>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

interface BotReplyContext {
  botName: string
  panelId: string | null
  history: { role: 'user' | 'assistant'; content: string }[]
}

export default function ChatPage() {
  const [active, setActive] = useState<ActiveContext | null>(null)
  const [botReplyContext, setBotReplyContext] = useState<BotReplyContext | null>(null)
  const [pendingScrollMsgId, setPendingScrollMsgId] = useState<string | null>(null)
  /** Round-9: thread reply target. When set, MessageInput renders a chip and
   *  posts with parent_id = replyingToMsg.id. */
  const [replyingToMsg, setReplyingToMsg] = useState<{ id: string; preview: string; authorName: string } | null>(null)
  const { selfChatId, user } = useAuth()
  const isSelfChat = !!(active && selfChatId && active.id === selfChatId)
  const { mutate: markRead } = useMarkChatRead()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Helper: resolve channel/project name from React Query cache (populated by
  // ChatSidebar). Falls back to direct DB lookup if cache hasn't hydrated.
  const resolveContextName = useCallback(
    async (type: ContextType, id: string): Promise<string> => {
      if (type === 'project') {
        const cached = queryClient.getQueryData<Project[]>(['projects-list'])
        const hit = cached?.find(p => p.id === id)
        if (hit?.title) return hit.title
        const { data } = await supabase.from('projects').select('title').eq('id', id).maybeSingle()
        return data?.title ?? ''
      }
      const cached = queryClient.getQueryData<ChatChannel[]>(['channels'])
      const hit = cached?.find(c => c.id === id)
      if (hit?.name) return hit.name
      const { data } = await supabase.from('chat_channels').select('name').eq('id', id).maybeSingle()
      return data?.name ?? ''
    },
    [queryClient],
  )

  // Handle navigation params from notification deep-links:
  //   ?dm=<channelId>&dm_name=<name>            — open a DM channel
  //   ?ctx_type=channel|project&ctx_id=<id>&ctx_name=<name>  — open a specific thread
  // Push notifications omit ctx_name (built server-side), so we resolve names
  // from cached queries (or fall back to a DB lookup) when missing.
  useEffect(() => {
    const params = new URLSearchParams(location.search)

    const dmChannel = params.get('dm')
    if (dmChannel) {
      const dmName = params.get('dm_name')
      if (dmName) {
        setActive({ type: 'channel', id: dmChannel, name: dmName })
      } else {
        setActive({ type: 'channel', id: dmChannel, name: '' })
        resolveContextName('channel', dmChannel).then(name => {
          if (name) setActive(a => (a && a.id === dmChannel ? { ...a, name } : a))
        })
      }
      navigate('/chat', { replace: true })
      return
    }

    const ctxType = params.get('ctx_type') as ContextType | null
    const ctxId   = params.get('ctx_id')
    const msgId   = params.get('msg_id')
    if (ctxType && ctxId) {
      const ctxName = params.get('ctx_name')
      if (ctxName) {
        setActive({ type: ctxType, id: ctxId, name: ctxName })
      } else {
        setActive({ type: ctxType, id: ctxId, name: '' })
        resolveContextName(ctxType, ctxId).then(name => {
          if (name) setActive(a => (a && a.id === ctxId ? { ...a, name } : a))
        })
      }
      if (msgId) setPendingScrollMsgId(msgId)
      navigate('/chat', { replace: true })
    }
  }, [location.search, navigate, resolveContextName])

  // ── Messenger-style mobile back UX ───────────────────────────────────────
  // Publish "in thread view" state so the single popstate handler in App's
  // ExitGuard can decide whether to open the drawer or show the exit confirm.
  // This avoids competing popstate listeners and timing races on tab/route
  // transitions.
  const isMobile = useMediaQuery('(max-width: 767px)')
  const isDrawerOpen = useIsDrawerOpen()

  useEffect(() => {
    setInThreadView(isMobile && !!active && !isDrawerOpen)
    return () => setInThreadView(false)
  }, [isMobile, active, isDrawerOpen])

  // Restore last active context from localStorage when user becomes available.
  // Skip if there are URL navigation params (ctx_id / dm) — the URL effect
  // takes precedence and runs first; restoring from localStorage would overwrite it.
  useEffect(() => {
    if (!user?.id) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('ctx_id') || params.get('dm')) return
    const saved = localStorage.getItem(`bos_chat_active_${user.id}`)
    if (!saved) return
    try {
      const parsed = JSON.parse(saved) as ActiveContext
      setActive(parsed)
    } catch { /* ignore malformed data */ }
  }, [user?.id])

  // Persist active context to localStorage on every change
  useEffect(() => {
    if (!user?.id || !active) return
    localStorage.setItem(`bos_chat_active_${user.id}`, JSON.stringify(active))
  }, [active, user?.id])

  // Mark the newly opened thread as read so its unread badge clears immediately
  useEffect(() => {
    if (!active?.id) return
    const type = active.type
    if (type === 'channel' || type === 'project') {
      markRead({ contextId: active.id, contextType: type })
    }
  }, [active?.id, markRead])

  // Close any open panel when the user switches to a different chat thread.
  const prevContextId = useRef<string | null>(null)
  useEffect(() => {
    const currentId = active?.id ?? null
    if (prevContextId.current !== null && prevContextId.current !== currentId) {
      clearPanels()
      setBotReplyContext(null)
      setPendingScrollMsgId(null)
    }
    prevContextId.current = currentId
  }, [active?.id])

  return (
    <AppShell
      title="Tin nhắn"
      sidebar={
        <ChatSidebar
          active={active}
          onSelect={setActive}
          onSearchHit={(ctx, msgId) => {
            setActive(ctx)
            setPendingScrollMsgId(msgId)
          }}
        />
      }
    >
      {active ? (
        <div className="flex h-full">
          <div className="flex flex-col flex-1 min-w-0">
            {/* Header — channel/thread name (left) + persistent search (far right) */}
            <div className="flex items-center gap-2 px-5 py-3 shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
              {isSelfChat
                ? <UserCircle size={16} className="text-primary-400" />
                : active.type === 'channel'
                  ? <Hash size={16} className="text-neutral-500" />
                  : <FolderKanban size={16} className="text-neutral-500" />
              }
              <h2 className="font-serif font-medium text-neutral-800">{active.name}</h2>
              {isSelfChat && (
                <span className="text-[10px] text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded-full ml-1">
                  Chỉ mình bạn thấy
                </span>
              )}
              <div className="flex-1" />
              {/* Round-10: persistent in-channel search */}
              <ChannelSearchBox
                contextId={active.id}
                onSelect={(msgId) => setPendingScrollMsgId(msgId)}
              />
            </div>

            {/* Feed */}
            <MessageFeed
              contextType={active.type}
              contextId={active.id}
              onReplyToBot={isSelfChat ? setBotReplyContext : undefined}
              scrollToMessageId={pendingScrollMsgId ?? undefined}
              onScrolled={() => setPendingScrollMsgId(null)}
              onReplyToMsg={setReplyingToMsg}
            />

            {/* Input */}
            <MessageInput
              contextType={active.type}
              contextId={active.id}
              botReplyContext={botReplyContext}
              onClearBotReply={() => setBotReplyContext(null)}
              replyingToMsg={replyingToMsg}
              onClearReplyTo={() => setReplyingToMsg(null)}
            />
          </div>

          {/* Round-10: project chat → permanent right-side workspace panel */}
          {active.type === 'project' && (
            <ProjectWorkspacePanel projectId={active.id} projectTitle={active.name} />
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-4xl mb-2 select-none">👋</div>
            <Hash size={28} className="text-primary-200 mx-auto mb-3 opacity-90" />
            <p className="text-sm text-neutral-500">Chọn channel hoặc project thread để bắt đầu</p>
          </div>
        </div>
      )}
    </AppShell>
  )
}
