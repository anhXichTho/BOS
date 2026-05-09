import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { RefreshCw, Smile, Bot, CornerDownLeft, CheckSquare, MoreHorizontal, Pin, PinOff, Pencil, Trash2, Bell } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import { supabase } from '../../lib/supabase'
import { SkeletonList } from '../ui/Skeleton'
import RichTextDisplay from '../ui/RichTextDisplay'
import AttachmentPreview from './AttachmentPreview'
import RichCard from './RichCard'
import { openPanel } from '../../lib/sidePanelStore'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'
import QuickTaskModal from '../tasks/QuickTaskModal'
import { avatarColorOf } from '../../lib/avatarColor'
import type { ChatMessage, ContextType, MessageReaction } from '../../types'

interface BotReplyContext {
  botName: string
  panelId: string | null
  history: { role: 'user' | 'assistant'; content: string }[]
}

const REACTION_EMOJIS = ['👍', '😮', '😢', '😂', '❤️', '💔', '😎']

interface Props {
  contextType: ContextType
  contextId: string
  onReplyToBot?: (ctx: BotReplyContext) => void
  scrollToMessageId?: string
  onScrolled?: () => void
  /** Round-9: hover reply icon click → caller sets reply-target state. */
  onReplyToMsg?: (target: { id: string; preview: string; authorName: string }) => void
}

function avatarInitials(name: string) {
  return name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
}

function relativeTime(ts: string) {
  return formatDistanceToNow(new Date(ts), { addSuffix: true, locale: vi })
}

export default function MessageFeed({ contextType, contextId, onReplyToBot, scrollToMessageId, onScrolled, onReplyToMsg }: Props) {
  const qc = useQueryClient()
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // Tracks the scrollHeight seen on the previous effect run, so we can detect
  // "user was at the bottom before a new message expanded the container".
  const prevScrollHeightRef = useRef<number>(0)
  const { user, isAdmin, isEditor } = useAuth()

  // Round-10: pin / edit / delete state
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const { success: toastSuccess, error: toastError } = useToast()

  const { data: messages = [], isLoading, refetch } = useQuery({
    queryKey: ['messages', contextId],
    queryFn: async () => {
      // Round-10 follow-up: stop filtering by parent_id IS NULL — replies
      // render inline now (Zalo-style quote-snap), not in a separate panel.
      // The optional `parent` self-join brings just enough fields for the
      // snap header: parent's author + first chunk of content.
      const { data, error } = await supabase
        .from('chat_messages')
        .select(`
          *,
          author:profiles(*),
          parent:chat_messages!parent_id(id, content, author_id, author:profiles(full_name)),
          attachments:chat_attachments(*),
          form_submission:form_submissions(*),
          workflow_run:workflow_runs(id, template_name, status, started_at, completed_at),
          reactions:chat_message_reactions(id, emoji, user_id, created_at)
        `)
        .eq('context_type', contextType)
        .eq('context_id', contextId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as ChatMessage[]
    },
    // Realtime invalidates this query on every INSERT/UPDATE — no polling
    // needed. staleTime keeps the cache warm for tab-switches.
    staleTime: 30_000,
  })

  // Realtime — new messages
  useEffect(() => {
    const ch = supabase
      .channel(`chat-${contextId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chat_messages',
        filter: `context_id=eq.${contextId}`,
      }, () => qc.invalidateQueries({ queryKey: ['messages', contextId] }))
      .subscribe(s => { if (s === 'CHANNEL_ERROR') console.warn('[MessageFeed] realtime unavailable') })
    return () => { supabase.removeChannel(ch) }
  }, [contextId, qc])

  // Realtime — reaction changes
  useEffect(() => {
    const ch = supabase
      .channel(`reactions-${contextId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'chat_message_reactions',
      }, () => qc.invalidateQueries({ queryKey: ['messages', contextId] }))
      .subscribe(s => { if (s === 'CHANNEL_ERROR') console.warn('[MessageFeed] reactions realtime unavailable') })
    return () => { supabase.removeChannel(ch) }
  }, [contextId, qc])

  // Round-10: search lifted up to ChatPage topbar — ChatPage drives this prop.
  const effectiveScrollMsgId = scrollToMessageId ?? null

  /** Round-9: when user clicks "Tạo việc" on a message, this holds the
   *  source for QuickTaskModal pre-fill. */
  const [quickTaskFromMsg, setQuickTaskFromMsg] = useState<{ id: string; title: string } | null>(null)

  /** Round-10 follow-up: same idea for the Bell hover action — opens the
   *  ReminderModal pre-filled. */
  const [reminderFromMsg, setReminderFromMsg] = useState<{ id: string; title: string } | null>(null)

  // Round-10 follow-up: replies render inline with a quote-snap above the
  // bubble (Zalo-style); the old "+ N câu trả lời" thread badge + counts
  // query are gone.

  // Scroll to bottom when messages load or context changes.
  // Uses direct scrollTop assignment — immune to StrictMode double-invoke and smooth-scroll races.
  // "was at bottom" is evaluated against the PREVIOUS scrollHeight so that a newly-rendered
  // tall message doesn't push the user away from bottom without auto-following.
  useEffect(() => {
    if (effectiveScrollMsgId) return
    if (messages.length === 0) return
    const el = scrollContainerRef.current
    if (!el) return
    const isContextSwitch = el.dataset.lastContext !== contextId
    el.dataset.lastContext = contextId
    // Were we at (or within 20px of) the bottom before this render expanded the container?
    const wasAtBottom = prevScrollHeightRef.current === 0 ||
      el.scrollTop + el.clientHeight >= prevScrollHeightRef.current - 20
    prevScrollHeightRef.current = el.scrollHeight
    if (isContextSwitch || wasAtBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, effectiveScrollMsgId, contextId])

  // Scroll to and highlight a specific message (search hit from ChatPage topbar OR deep-link prop)
  useEffect(() => {
    if (!effectiveScrollMsgId || messages.length === 0) return
    const el = document.querySelector(`[data-msg-id="${effectiveScrollMsgId}"]`) as HTMLElement | null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-primary-300', 'rounded-lg')
    const timer = setTimeout(() => el.classList.remove('ring-2', 'ring-primary-300', 'rounded-lg'), 2500)
    onScrolled?.()
    return () => clearTimeout(timer)
  }, [effectiveScrollMsgId, messages.length, onScrolled])

  const toggleReaction = useMutation({
    mutationFn: async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      if (!user) return
      const msg = messages.find(m => m.id === messageId)
      const existing = msg?.reactions?.find(r => r.emoji === emoji && r.user_id === user.id)
      if (existing) {
        const { error } = await supabase.from('chat_message_reactions').delete().eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('chat_message_reactions')
          .insert({ message_id: messageId, user_id: user.id, emoji })
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', contextId] }),
  })

  // Round-10 — pin / unpin / edit / delete
  const pinMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await supabase.rpc('pin_message', { p_message_id: messageId })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['messages', contextId] }); toastSuccess('Đã ghim') },
    onError: (e: any) => toastError(e?.message ?? 'Không ghim được'),
  })

  const unpinMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await supabase.rpc('unpin_message', { p_message_id: messageId })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['messages', contextId] }); toastSuccess('Đã bỏ ghim') },
    onError: (e: any) => toastError(e?.message ?? 'Không bỏ ghim được'),
  })

  const editMutation = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const { error } = await supabase
        .from('chat_messages')
        .update({ content, edited_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', contextId] })
      setEditingMsgId(null); setEditingDraft('')
      toastSuccess('Đã sửa tin nhắn')
    },
    onError: (e: any) => toastError(e?.message ?? 'Không sửa được (đã quá 10 phút?)'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await supabase.from('chat_messages').delete().eq('id', messageId)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['messages', contextId] }); toastSuccess('Đã xoá tin nhắn') },
    onError: (e: any) => toastError(e?.message ?? 'Không xoá được'),
  })

  // Single pinned message (gotcha #migration-32 enforces this server-side too)
  const pinnedMessage = messages.find(m => m.pinned_at)

  function handleReplyToBotMsg(msg: ChatMessage) {
    if (!onReplyToBot) return
    const payload = msg.payload as { kind: 'bot_response'; reply: string; query: string; panel_id?: string | null; bot_name?: string } | undefined
    if (!payload || payload.kind !== 'bot_response') return

    // Collect up to 5 Q&A pairs going backward from this bot message
    const msgIdx = messages.findIndex(m => m.id === msg.id)
    const history: { role: 'user' | 'assistant'; content: string }[] = []
    let i = msgIdx
    let pairs = 0

    while (i > 0 && pairs < 5) {
      const cur = messages[i]
      if (cur.payload?.kind === 'bot_response') {
        const prev = messages[i - 1]
        if (prev && prev.message_type === 'text' && prev.content) {
          const userContent = (prev.content ?? '').replace(/^@\S+\s+/, '').trim() || prev.content
          history.unshift({ role: 'assistant' as const, content: (cur.payload as any).reply ?? '' })
          history.unshift({ role: 'user' as const, content: userContent })
          pairs++
          i -= 2
        } else {
          break
        }
      } else {
        break
      }
    }

    onReplyToBot({
      botName:  payload.bot_name ?? 'Bot',
      panelId:  payload.panel_id ?? null,
      history,
    })
  }

  if (isLoading) return <SkeletonList count={5} />

  return (
    <div ref={scrollContainerRef} className="flex flex-col flex-1 overflow-y-auto px-4 py-3 gap-4">
      {/* Round-10: search moved into ChatPage topbar; keep a small refresh
          button only — discoverable but unobtrusive. */}
      <div className="flex justify-end items-center gap-1">
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors px-1.5"
        >
          <RefreshCw size={11} /> Làm mới
        </button>
      </div>

      {messages.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-neutral-500">👋 Chưa có tin nhắn nào. Hãy bắt đầu cuộc trò chuyện!</p>
        </div>
      )}

      {/* Round-10: pinned message banner */}
      {pinnedMessage && (
        <button
          type="button"
          onClick={() => {
            const el = document.querySelector(`[data-msg-id="${pinnedMessage.id}"]`) as HTMLElement | null
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' })
              el.classList.add('ring-2', 'ring-primary-300', 'rounded-lg')
              setTimeout(() => el.classList.remove('ring-2', 'ring-primary-300', 'rounded-lg'), 2500)
            }
          }}
          className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-[#FBEFE0] border-l-4 border-[#D78B45] rounded text-left hover:bg-[#F8E5D2] transition-colors"
        >
          <Pin size={11} className="text-[#8C5022] shrink-0" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8C5022] shrink-0">Đã ghim</span>
          <span className="text-[12px] text-neutral-700 truncate flex-1 min-w-0">
            {(pinnedMessage.content ?? (pinnedMessage.payload as any)?.title ?? '').slice(0, 100)}
          </span>
          {(isAdmin || isEditor || pinnedMessage.author_id === user?.id) && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); unpinMutation.mutate(pinnedMessage.id) }}
              className="text-neutral-500 hover:text-neutral-700 p-0.5"
              title="Bỏ ghim"
            >
              <PinOff size={11} />
            </span>
          )}
        </button>
      )}

      {messages.map(msg => {
        return (
          <div key={msg.id} data-msg-id={msg.id} className="bos-fade-in-up">
            <MessageBubble
              message={msg}
              currentUserId={user?.id ?? null}
              isManager={!!(isAdmin || isEditor)}
              contextType={contextType}
              contextId={contextId}
              editing={editingMsgId === msg.id}
              editingDraft={editingDraft}
              setEditingDraft={setEditingDraft}
              onStartEdit={() => { setEditingMsgId(msg.id); setEditingDraft(msg.content ?? '') }}
              onCancelEdit={() => { setEditingMsgId(null); setEditingDraft('') }}
              onSubmitEdit={(content) => editMutation.mutate({ id: msg.id, content })}
              onPin={() => pinMutation.mutate(msg.id)}
              onUnpin={() => unpinMutation.mutate(msg.id)}
              onDelete={() => {
                if (window.confirm('Xoá tin nhắn này? Không thể hoàn tác.')) deleteMutation.mutate(msg.id)
              }}
              onToggleReaction={(msgId, emoji) => toggleReaction.mutate({ messageId: msgId, emoji })}
              onReplyToBot={onReplyToBot ? () => handleReplyToBotMsg(msg) : undefined}
              onReplyToMsg={onReplyToMsg ? () => onReplyToMsg({
                id: msg.id,
                preview: (msg.content ?? '').slice(0, 80),
                authorName: (msg as any).author?.full_name ?? 'người này',
              }) : undefined}
              onCreateTask={() => setQuickTaskFromMsg({
                id: msg.id,
                title: (msg.content ?? '').slice(0, 80),
              })}
              onCreateReminder={() => setReminderFromMsg({
                id: msg.id,
                title: (msg.content ?? '').slice(0, 80),
              })}
              onScrollToParent={(parentId) => {
                const el = document.querySelector(`[data-msg-id="${parentId}"]`) as HTMLElement | null
                if (!el) return
                el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                el.classList.add('ring-2', 'ring-primary-300', 'rounded-lg')
                setTimeout(() => el.classList.remove('ring-2', 'ring-primary-300', 'rounded-lg'), 2500)
              }}
            />
          </div>
        )
      })}

      <div ref={bottomRef} />

      {/* Round-9: Tạo việc từ tin nhắn — mounted at end so it sits above the feed.
          Round-10: pass chatContext so the modal posts a quick_task card. */}
      {quickTaskFromMsg && (
        <QuickTaskModal
          open={true}
          onClose={() => setQuickTaskFromMsg(null)}
          initialTitle={quickTaskFromMsg.title}
          sourceMessageId={quickTaskFromMsg.id}
          chatContext={contextType === 'project' || contextType === 'channel' ? { type: contextType, id: contextId } : null}
        />
      )}

      {/* Round-10 follow-up: reminder modal — sourced from the Bell hover action. */}
      {reminderFromMsg && (
        <ReminderModal
          open
          onClose={() => setReminderFromMsg(null)}
          initialTitle={reminderFromMsg.title}
          sourceMessageId={reminderFromMsg.id}
          chatContext={{ type: contextType as 'channel' | 'project', id: contextId }}
        />
      )}
    </div>
  )
}

function MessageBubble({
  message: msg,
  currentUserId,
  isManager,
  contextType,
  contextId,
  editing,
  editingDraft,
  setEditingDraft,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onPin,
  onUnpin,
  onDelete,
  onToggleReaction,
  onReplyToBot,
  onReplyToMsg,
  onCreateTask,
  onCreateReminder,
  onScrollToParent,
}: {
  message: ChatMessage
  currentUserId: string | null
  isManager: boolean
  contextType: ContextType
  contextId: string
  editing: boolean
  editingDraft: string
  setEditingDraft: (s: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSubmitEdit: (content: string) => void
  onPin: () => void
  onUnpin: () => void
  onDelete: () => void
  onToggleReaction: (messageId: string, emoji: string) => void
  onReplyToBot?: () => void
  onReplyToMsg?: () => void
  onCreateTask?: () => void
  onCreateReminder?: () => void
  onScrollToParent?: (parentId: string) => void
}) {
  const isBotMsg = msg.author_id === null && msg.payload?.kind === 'bot_response'
  const authorName = isBotMsg ? 'Bot' : (msg.author?.full_name ?? 'Unknown')
  const isOwn = !isBotMsg && !!currentUserId && msg.author_id === currentUserId
  const isPinned = !!msg.pinned_at
  const editWindowOpen = isOwn && msg.message_type === 'text' &&
    (Date.now() - new Date(msg.created_at).getTime()) < 10 * 60_000
  const canEdit   = editWindowOpen || (isManager && msg.message_type === 'text')
  const canDelete = isOwn || isManager
  // Round-9 polish: every non-own author gets a stable hashed colour so the
  // chat wall is visually lively instead of a sea of identical blue chips.
  const authorColor = avatarColorOf(msg.author_id ?? authorName)

  return (
    <div className={`flex gap-3 group ${isOwn ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      {isBotMsg ? (
        <div className="w-8 h-8 rounded-full bg-neutral-100 border border-neutral-200 flex items-center justify-center shrink-0 mt-0.5">
          <Bot size={14} className="text-neutral-500" />
        </div>
      ) : (
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5 ${
            isOwn ? 'bg-primary-600 text-white' : `${authorColor.bg} ${authorColor.text}`
          }`}
        >
          {avatarInitials(authorName)}
        </div>
      )}

      {/* Content column */}
      <div className={`flex-1 min-w-0 flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
        {/* Header */}
        <div className="flex items-baseline gap-2 mb-0.5">
          {!isOwn && (
            <span className={`text-sm font-semibold ${isBotMsg ? 'text-neutral-700' : authorColor.text}`}>{authorName}</span>
          )}
          <span className="text-[11px] text-neutral-400">{relativeTime(msg.created_at)}</span>
          {msg.edited_at && (
            <span className="text-[10px] text-neutral-300 italic">(đã sửa)</span>
          )}
        </div>

        {/* Round-10 follow-up: Zalo-style reply snap. Click → scroll to original. */}
        {msg.parent_id && msg.parent && (
          <button
            type="button"
            onClick={() => onScrollToParent?.(msg.parent!.id)}
            className={`mb-1 max-w-[75%] flex items-stretch gap-2 text-left bg-neutral-50/80 border-l-2 border-primary-300 rounded px-2 py-1 hover:bg-primary-50/60 transition-colors ${isOwn ? 'self-end' : ''}`}
            title="Tới tin nhắn gốc"
          >
            <CornerDownLeft size={10} className="text-primary-500 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] text-primary-700 font-semibold truncate">
                ↩ {msg.parent.author?.full_name ?? 'Người dùng'}
              </p>
              <p className="text-[11px] text-neutral-600 truncate">
                {(msg.parent.content ?? '').slice(0, 120) || '(không có nội dung)'}
              </p>
            </div>
          </button>
        )}

        {/* Text bubble — both own + other get a soft bubble for visual balance.
            Own: muted blue tint (Tableau-style). Other: paper-tinted neutral.
            Editing mode: replace bubble with inline textarea + Save/Cancel. */}
        {msg.message_type === 'text' && msg.content && !editing && (
          <div
            className={`rounded-xl px-3 py-2 max-w-[75%] ${
              isOwn
                ? 'bg-[#E8EEF6] rounded-tr-sm'
                : 'bg-[#F5F3F0] rounded-tl-sm'
            } ${isPinned ? 'ring-1 ring-[#D78B45]' : ''}`}
          >
            {isRichHtml(msg.content)
              ? <RichTextDisplay content={msg.content} className="text-base text-neutral-800 break-words" />
              : <TextWithMentions text={msg.content} isOwn={isOwn} className="text-base text-neutral-800 break-words" />
            }
          </div>
        )}

        {msg.message_type === 'text' && editing && (
          <div className={`rounded-xl px-3 py-2 max-w-[75%] w-full ${isOwn ? 'bg-[#E8EEF6]' : 'bg-[#F5F3F0]'}`}>
            <textarea
              value={editingDraft}
              onChange={(e) => setEditingDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); onCancelEdit() }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  if (editingDraft.trim()) onSubmitEdit(editingDraft.trim())
                }
              }}
              className="w-full text-base text-neutral-800 bg-transparent resize-none focus:outline-none"
              rows={Math.min(8, Math.max(2, editingDraft.split('\n').length))}
              autoFocus
            />
            <div className="flex justify-end items-center gap-2 mt-1.5 text-[11px]">
              <button onClick={onCancelEdit} className="text-neutral-500 hover:text-neutral-700">Huỷ</button>
              <button
                onClick={() => editingDraft.trim() && onSubmitEdit(editingDraft.trim())}
                disabled={!editingDraft.trim() || editingDraft.trim() === (msg.content ?? '').trim()}
                className="bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white px-2 py-0.5 rounded"
              >
                Lưu
              </button>
            </div>
          </div>
        )}

        {/* Legacy form submission card */}
        {msg.message_type === 'form_submission' && msg.form_submission && (
          <FormSubmissionCard submission={msg.form_submission as any} />
        )}

        {/* Workflow run card (legacy message_type) */}
        {msg.message_type === 'workflow_run_link' && msg.workflow_run && (
          <>
            {msg.content && (
              <RichTextDisplay content={msg.content} className="text-sm text-neutral-700 break-words mb-1" />
            )}
            <WorkflowRunCard run={msg.workflow_run as any} contextType={contextType} contextId={contextId} />
          </>
        )}

        {/* Rich card (Phase 1+) */}
        {msg.message_type === 'rich_card' && msg.payload && (
          <RichCard
            payload={msg.payload}
            authorName={authorName}
            createdAt={msg.created_at}
            contextType={contextType}
            contextId={contextId}
          />
        )}

        {/* Reply-to-bot button — shown on hover for bot_response messages */}
        {isBotMsg && msg.payload?.kind === 'bot_response' && onReplyToBot && (
          <button
            type="button"
            onClick={onReplyToBot}
            className="opacity-40 group-hover:opacity-100 focus:opacity-100 transition-opacity flex items-center gap-1 text-[11px] text-neutral-400 hover:text-primary-600 mt-1"
            title="Trả lời bot này"
          >
            <CornerDownLeft size={11} />
            <span>Trả lời</span>
          </button>
        )}

        {/* Round-9 + Round-10: hover actions row.
            Reply, Tạo việc, More menu (Pin/Edit/Delete). */}
        {!isBotMsg && !editing && (
          <div className="opacity-40 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-2 mt-1">
            {onReplyToMsg && (
              <button
                type="button"
                onClick={onReplyToMsg}
                className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-primary-600"
                title="Trả lời tin nhắn này (mở thread)"
              >
                <CornerDownLeft size={11} />
                <span>Trả lời</span>
              </button>
            )}
            {onCreateTask && (
              <button
                type="button"
                onClick={onCreateTask}
                className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-primary-600"
                title="Tạo việc từ tin nhắn này"
              >
                <CheckSquare size={11} />
                <span>Tạo việc</span>
              </button>
            )}
            {onCreateReminder && (
              <button
                type="button"
                onClick={onCreateReminder}
                className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-primary-600"
                title="Đặt nhắc việc"
              >
                <Bell size={11} />
                <span>Nhắc</span>
              </button>
            )}
            <MoreActionsMenu
              isPinned={isPinned}
              canEdit={canEdit}
              canDelete={canDelete}
              onPin={onPin}
              onUnpin={onUnpin}
              onEdit={onStartEdit}
              onDelete={onDelete}
            />
          </div>
        )}

        {/* Reactions */}
        <ReactionsArea
          messageId={msg.id}
          reactions={msg.reactions ?? []}
          currentUserId={currentUserId}
          isOwn={isOwn}
          onToggle={onToggleReaction}
        />

        {/* Attachments */}
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {msg.attachments.map(att => (
              <AttachmentPreview key={att.id} attachment={att} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── More-actions menu (Round-10) ────────────────────────────────────────────

function MoreActionsMenu({
  isPinned, canEdit, canDelete, onPin, onUnpin, onEdit, onDelete,
}: {
  isPinned: boolean
  canEdit: boolean
  canDelete: boolean
  onPin: () => void
  onUnpin: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  // Don't render the button if there's nothing to show.
  if (!canEdit && !canDelete) {
    // Pin is open to anyone — still show.
    // (canPin is currently always true for authenticated users.)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-primary-600 p-0.5"
        title="Tuỳ chọn khác"
      >
        <MoreHorizontal size={13} />
      </button>
      {open && (
        <div className="absolute z-30 left-0 top-full mt-1 w-44 bg-white border border-neutral-200 rounded shadow-lg py-1 text-[12px]">
          {isPinned ? (
            <button onClick={() => { onUnpin(); setOpen(false) }} className="w-full text-left px-3 py-1.5 hover:bg-neutral-50 inline-flex items-center gap-2">
              <PinOff size={12} /> Bỏ ghim
            </button>
          ) : (
            <button onClick={() => { onPin(); setOpen(false) }} className="w-full text-left px-3 py-1.5 hover:bg-neutral-50 inline-flex items-center gap-2">
              <Pin size={12} /> Ghim tin nhắn
            </button>
          )}
          {canEdit && (
            <button onClick={() => { onEdit(); setOpen(false) }} className="w-full text-left px-3 py-1.5 hover:bg-neutral-50 inline-flex items-center gap-2">
              <Pencil size={12} /> Sửa
            </button>
          )}
          {canDelete && (
            <button onClick={() => { onDelete(); setOpen(false) }} className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 inline-flex items-center gap-2">
              <Trash2 size={12} /> Xoá
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Reactions ────────────────────────────────────────────────────────────────

function ReactionsArea({
  messageId,
  reactions,
  currentUserId,
  isOwn,
  onToggle,
}: {
  messageId: string
  reactions: MessageReaction[]
  currentUserId: string | null
  isOwn: boolean
  onToggle: (messageId: string, emoji: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pickerOpen) return
    function handler(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pickerOpen])

  const grouped = REACTION_EMOJIS
    .map(emoji => ({
      emoji,
      count: reactions.filter(r => r.emoji === emoji).length,
      mine: !!currentUserId && reactions.some(r => r.emoji === emoji && r.user_id === currentUserId),
    }))
    .filter(g => g.count > 0)

  if (grouped.length === 0 && !currentUserId) return null

  return (
    <div className="flex items-center flex-wrap gap-1 mt-1.5">
      {grouped.map(g => (
        <button
          key={g.emoji}
          onClick={() => onToggle(messageId, g.emoji)}
          className={`flex items-center gap-1 px-1.5 py-0.5 text-[13px] border rounded-full transition-colors select-none ${
            g.mine
              ? 'border-primary-300 bg-primary-50 text-primary-700'
              : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50'
          }`}
          title={g.mine ? 'Bỏ reaction' : 'React'}
        >
          <span>{g.emoji}</span>
          <span className="text-[11px] font-medium tabular-nums">{g.count}</span>
        </button>
      ))}

      {currentUserId && (
        <div ref={pickerRef} className="relative">
          <button
            onClick={() => setPickerOpen(o => !o)}
            className="opacity-40 group-hover:opacity-100 focus:opacity-100 transition-opacity p-2 text-neutral-300 hover:text-neutral-500 hover:bg-neutral-100 rounded-full"
            title="Thêm reaction"
          >
            <Smile size={13} />
          </button>
          {pickerOpen && (
            <div
              className={`absolute z-30 bottom-8 flex gap-0.5 bg-white border border-neutral-200 rounded-full shadow-lg px-2 py-1.5 ${
                isOwn ? 'right-0' : 'left-0'
              }`}
            >
              {REACTION_EMOJIS.map(emoji => {
                const mine = reactions.some(r => r.emoji === emoji && r.user_id === currentUserId)
                return (
                  <button
                    key={emoji}
                    onClick={() => { onToggle(messageId, emoji); setPickerOpen(false) }}
                    className={`text-[18px] hover:scale-110 hover:-translate-y-0.5 transition-transform duration-150 rounded p-0.5 ${
                      mine ? 'bg-primary-50 ring-1 ring-primary-300 rounded-full' : 'hover:bg-neutral-100 rounded-full'
                    }`}
                    title={emoji}
                  >
                    {emoji}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

function isRichHtml(text: string) {
  return /<[a-z][\s\S]*>/i.test(text)
}

function TextWithMentions({ text, isOwn, className }: { text: string; isOwn: boolean; className?: string }) {
  const parts = text.split(/(@\S+)/g)
  return (
    <p className={className}>
      {parts.map((part, i) => {
        if (!/^@\S+$/.test(part)) return part
        // Round-9: @all + multi-word group names get a distinct purple pill
        const isAll = part.toLowerCase() === '@all'
        // Heuristic: a hyphenated token (e.g. @CH-Quan-1) likely a group; non-hyphen
        // single-word tokens are personal mentions. Personal full-names with multiple
        // words won't match \S+ anyway since space breaks the regex.
        const isGroup = !isAll && part.includes('-')
        if (isAll || isGroup) {
          // Muted plum tint instead of the punchy purple-100.
          return (
            <span
              key={i}
              className="font-semibold text-[#6E4862] bg-[#E8DCE5] rounded px-1"
              title={isAll ? 'Gửi cho tất cả thành viên' : 'Gửi cho nhóm'}
            >
              {part}
            </span>
          )
        }
        return (
          <span
            key={i}
            className={isOwn
              ? 'font-semibold text-[#3D5994] bg-[#D6DEEC]/70 rounded px-0.5'
              : 'font-semibold text-[#3D5994] bg-[#EEF1F8] rounded px-0.5'
            }
          >
            {part}
          </span>
        )
      })}
    </p>
  )
}

// ─── Legacy card components ───────────────────────────────────────────────────

function WorkflowRunCard({
  run,
  contextType,
  contextId,
}: {
  run: { id: string; template_name: string; status: string; started_at: string; completed_at: string | null }
  contextType: ContextType
  contextId: string
}) {
  // Round-9 polish: in-progress workflow uses muted orange (Tableau orange
  // tint #FBEFE0 / border #D78B45) instead of amber-50 / amber-300 — easier
  // on the eye than the previous yellow-leaning palette.
  const statusColor =
    run.status === 'completed' ? 'border-green-300 bg-green-50' :
    run.status === 'cancelled' ? 'border-neutral-200 bg-neutral-50' :
    'border-[#D78B45] bg-[#FBEFE0]'
  const statusLabel =
    run.status === 'completed' ? 'Hoàn thành' :
    run.status === 'cancelled' ? 'Huỷ' : 'Đang chạy'

  return (
    <button
      type="button"
      onClick={() => openPanel({ id: run.id, kind: 'workflow_run', title: `▶ ${run.template_name}`, meta: { context_type: contextType, context_id: contextId } })}
      className={`text-left block border-l-4 ${statusColor} rounded-lg p-3 mt-1 max-w-sm hover:opacity-80 transition-opacity w-full`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-600">
          🔀 Nghiệp vụ
        </span>
        <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
          run.status === 'completed' ? 'bg-green-100 text-green-700' :
          run.status === 'cancelled' ? 'bg-neutral-100 text-neutral-600' :
          'bg-[#F8E5D2] text-[#8C5022]'
        }`}>
          {statusLabel}
        </span>
      </div>
      <p className="text-sm font-medium text-neutral-800 truncate">{run.template_name}</p>
      <p className="text-[11px] text-neutral-500 mt-0.5">
        Bắt đầu {new Date(run.started_at).toLocaleString('vi')}
        {run.completed_at && <> · Xong {new Date(run.completed_at).toLocaleString('vi')}</>}
      </p>
      <p className="text-[11px] text-primary-600 mt-1 hover:underline">Mở run →</p>
    </button>
  )
}

function FormSubmissionCard({ submission }: { submission: any }) {
  const fields = (submission.template_snapshot ?? []) as Array<{ id: string; label: string }>
  const data = submission.data ?? {}

  return (
    <div className="border-l-4 border-primary-400 bg-primary-50 rounded-lg p-3 mt-1 max-w-sm">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-primary-700 uppercase tracking-wider">
          📋 {submission.template_name}
        </span>
      </div>
      <div className="space-y-1">
        {fields.slice(0, 5).map((f: any) => {
          const val = data[f.id]
          if (val === null || val === undefined || val === '') return null
          const display = Array.isArray(val) ? val.join(', ') : String(val)
          return (
            <div key={f.id} className="text-xs">
              <span className="text-neutral-500 font-medium">{f.label}:</span>{' '}
              <span className="text-neutral-700">{display}</span>
            </div>
          )
        })}
        {fields.length > 5 && (
          <p className="text-[10px] text-neutral-400">+{fields.length - 5} trường nữa…</p>
        )}
      </div>
    </div>
  )
}

// ─── Reminder modal (Round-10 follow-up) ─────────────────────────────────────

function ReminderModal({
  open, onClose, initialTitle, sourceMessageId, chatContext,
}: {
  open: boolean
  onClose: () => void
  initialTitle: string
  sourceMessageId: string
  chatContext: { type: 'channel' | 'project' | 'portal'; id: string }
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { success: toastSuccess, error: toastError } = useToast()
  const [title, setTitle]   = useState(initialTitle)
  const [date, setDate]     = useState('')
  const [time, setTime]     = useState('')
  const [busy, setBusy]     = useState(false)

  // Default: 1 hour from now (rounded to nearest 5 minutes), local timezone
  useEffect(() => {
    if (!open) return
    const t = new Date(Date.now() + 60 * 60_000)
    const m = t.getMinutes()
    t.setMinutes(Math.ceil(m / 5) * 5, 0, 0)
    const yyyy = t.getFullYear()
    const mm   = String(t.getMonth() + 1).padStart(2, '0')
    const dd   = String(t.getDate()).padStart(2, '0')
    const hh   = String(t.getHours()).padStart(2, '0')
    const mi   = String(t.getMinutes()).padStart(2, '0')
    setDate(`${yyyy}-${mm}-${dd}`)
    setTime(`${hh}:${mi}`)
    setTitle(initialTitle)
  }, [open, initialTitle])

  async function submit() {
    if (!user) return
    if (!title.trim() || !date || !time) {
      toastError('Cần tiêu đề + thời điểm nhắc')
      return
    }
    const fireAt = new Date(`${date}T${time}`)
    if (Number.isNaN(fireAt.getTime()) || fireAt.getTime() < Date.now()) {
      toastError('Thời điểm phải ở tương lai')
      return
    }
    setBusy(true)
    try {
      const ctxType = chatContext.type === 'portal' ? null : chatContext.type
      const { error } = await supabase.from('reminders').insert({
        recipient_id:        user.id,
        created_by:          user.id,
        title:               title.trim(),
        fire_at:             fireAt.toISOString(),
        source_message_id:   sourceMessageId,
        source_context_type: ctxType,
        source_context_id:   chatContext.id,
      })
      if (error) throw error

      // Post a reminder_card to chat immediately so the team sees it
      if (ctxType) {
        await supabase.from('chat_messages').insert({
          context_type: ctxType,
          context_id:   chatContext.id,
          author_id:    user.id,
          message_type: 'rich_card',
          content:      null,
          payload: {
            kind:    'reminder_card',
            title:   title.trim(),
            fire_at: fireAt.toISOString(),
          },
        })
        qc.invalidateQueries({ queryKey: ['messages', chatContext.id] })
      }

      toastSuccess(`Đã đặt nhắc lúc ${fireAt.toLocaleString('vi')}`)
      onClose()
    } catch (e: any) {
      toastError(e?.message ?? 'Không tạo được nhắc việc')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white border border-neutral-100 rounded-xl shadow-lg w-full sm:max-w-[420px] flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 h-12 shrink-0">
          <h2 className="text-base font-semibold text-neutral-900">🔔 Đặt nhắc việc</h2>
          <button onClick={onClose} className="text-neutral-600 hover:text-neutral-900 p-1">
            ✕
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Tiêu đề</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Gọi lại khách Anh Minh"
              className="mt-1 w-full px-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-100"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Ngày</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300"
              />
            </div>
            <div className="flex-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Giờ</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-neutral-200 rounded focus:outline-none focus:border-primary-300"
              />
            </div>
          </div>
          <p className="text-[11px] text-neutral-400 italic">
            Khi đến giờ, hệ thống sẽ gửi thông báo + đăng card nhắc trong chat này.
          </p>
        </div>
        <div className="border-t border-neutral-100 px-5 py-3 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-neutral-600 hover:text-neutral-900"
          >
            Huỷ
          </button>
          <button
            onClick={submit}
            disabled={busy || !title.trim() || !date || !time}
            className="px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded disabled:opacity-50"
          >
            {busy ? 'Đang lưu...' : 'Đặt nhắc'}
          </button>
        </div>
      </div>
    </div>
  )
}
