import { useState, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Send, Paperclip, X, Loader2, Type, GitBranch, MoreHorizontal, Bot, CornerDownLeft, Smile } from 'lucide-react'
import StickerPicker from './StickerPicker'
import type { Sticker } from '../../lib/stickers'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../ui/Toast'
import RichTextEditor from '../ui/RichTextEditor'
import StartWorkflowFromChatModal from './StartWorkflowFromChatModal'
import type { ContextType, Profile } from '../../types'

interface BotReplyContext {
  botName: string
  panelId: string | null
  history: { role: 'user' | 'assistant'; content: string }[]
}

interface Props {
  contextType: ContextType
  contextId: string
  botReplyContext?: BotReplyContext | null
  onClearBotReply?: () => void
  /** Round-9: when set, the next message is posted with parent_id = .id
   *  (creates a threaded reply) and a chip is rendered above the input. */
  replyingToMsg?: { id: string; preview: string; authorName: string } | null
  onClearReplyTo?: () => void
}

interface PendingFile {
  file: File
  previewUrl?: string
}

interface BotOption {
  id: string          // 'general' or helper_panel uuid
  name: string
  panelId: string | null
}

const GENERAL_BOT: BotOption = { id: 'general', name: 'Trợ lý chung', panelId: null }

export default function MessageInput({ contextType, contextId, botReplyContext, onClearBotReply, replyingToMsg, onClearReplyTo }: Props) {
  const { user, selfChatId } = useAuth()
  const isSelfChat = !!(selfChatId && selfChatId === contextId)
  const { error: toastError } = useToast()
  const qc = useQueryClient()

  const [content, setContent] = useState('')
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [sending, setSending] = useState(false)
  const [mentionSearch, setMentionSearch] = useState<string | null>(null)
  const [mentions, setMentions] = useState<string[]>([])
  /** Round-9: pending @all / @groupname markers, expanded to user IDs at send. */
  const [groupMarkers, setGroupMarkers] = useState<Array<{ kind: 'all' } | { kind: 'group'; id: string; name: string }>>([])
  const [workflowModalOpen, setWorkflowModalOpen] = useState(false)
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false)
  const [workflowSearch, setWorkflowSearch] = useState<string | null>(null)
  const [preselectedWorkflowId, setPreselectedWorkflowId] = useState<string | null>(null)
  const [richMode, setRichMode] = useState(false)
  const [resetSignal, setResetSignal] = useState(0)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [selectedBot, setSelectedBot] = useState<BotOption | null>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: allProfiles = [] } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, full_name').order('full_name')
      return (data ?? []) as Profile[]
    },
  })

  /** Round-9: user_groups for @groupname mention. */
  const { data: allGroups = [] } = useQuery({
    queryKey: ['user-groups-brief'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_groups')
        .select('id, name')
        .order('name')
      if (error) {
        console.warn('[MessageInput] user_groups query failed:', error.message)
        return []
      }
      return (data ?? []) as { id: string; name: string }[]
    },
    staleTime: 300_000,
  })

  // Load chatbot helper panels for bot picker (only relevant in personal channel)
  const { data: botPanels = [] } = useQuery({
    queryKey: ['helper-panels-bots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('helper_panels')
        .select('id, name')
        .eq('type', 'chatbot')
        .order('name')
      if (error) {
        console.warn('[MessageInput] bot panels query failed (migration pending?):', error.message)
        return []
      }
      return (data ?? []) as { id: string; name: string }[]
    },
    // Round-10: bots available in every chat — load whenever the user is logged in.
    enabled: !!user,
    retry: false,
  })

  const allBotOptions: BotOption[] = [
    GENERAL_BOT,
    ...botPanels.map(p => ({ id: p.id, name: p.name, panelId: p.id })),
  ]

  // Workflow templates for slash command picker
  const { data: workflowTemplates = [] } = useQuery({
    queryKey: ['workflow-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflow_templates')
        .select('id, name, description')
        .eq('is_active', true)
        .order('name')
      if (error) {
        console.warn('[MessageInput] workflow templates query failed:', error.message)
        return []
      }
      return data as { id: string; name: string; description: string | null }[]
    },
    enabled: workflowSearch !== null,
    retry: false,
  })

  // Bot picker — Round-10: available in every chat. The bot reply gets
  // posted to the same context_id and is visible to all members.
  const botResults = (!selectedBot && mentionSearch !== null)
    ? allBotOptions.filter(b =>
        mentionSearch === ''
          ? true
          : b.name.toLowerCase().includes(mentionSearch.toLowerCase())
      ).slice(0, 6)
    : []

  // User mention picker: shown in non-personal channels
  const mentionResults = (!isSelfChat && mentionSearch !== null)
    ? allProfiles.filter(p => p.full_name.toLowerCase().includes(mentionSearch.toLowerCase())).slice(0, 6)
    : []

  // Round-9: @all option (channels + projects only — not DMs)
  const supportsAtAll = !isSelfChat && contextType !== 'project' ? false : (!isSelfChat)
  // Show @all only in channels (not DMs, not personal)
  const showAtAll = !isSelfChat && contextType === 'channel' && mentionSearch !== null
                    && (mentionSearch === '' || 'all'.startsWith(mentionSearch.toLowerCase()))
  // Group mention results — same fuzzy filter
  const groupResults = (!isSelfChat && mentionSearch !== null)
    ? allGroups.filter(g => g.name.toLowerCase().includes(mentionSearch.toLowerCase())).slice(0, 5)
    : []
  // Suppress reference to keep type-checker happy when feature toggles
  void supportsAtAll

  // Workflow slash command picker: shown when content is just /...
  const workflowResults = workflowSearch !== null
    ? workflowTemplates.filter(t =>
        workflowSearch === ''
          ? true
          : t.name.toLowerCase().includes(workflowSearch.toLowerCase())
      ).slice(0, 8)
    : []

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setContent(val)

    // Clear selected bot if user deleted the @BotName prefix
    if (selectedBot && !val.startsWith(`@${selectedBot.name}`)) {
      setSelectedBot(null)
    }

    // Slash command: triggers when entire content is /... (Discord-style)
    const slashMatch = val.match(/^\/([^\n]*)$/)
    setWorkflowSearch(slashMatch ? slashMatch[1] : null)

    // Detect @ pattern for pickers (only when not in slash command mode)
    // Use permissive pattern in personal channel (Vietnamese chars in bot names)
    const beforeCursor = val.slice(0, e.target.selectionStart)
    // Round-10: use permissive regex everywhere so bots with spaces/Vietnamese
    // names show up in non-personal chats too.
    const mentionMatch = !slashMatch && beforeCursor.match(/@([^@\n]*)$/)

    // Only show picker when no bot is committed yet
    setMentionSearch(!selectedBot && mentionMatch ? mentionMatch[1] : null)

    const el = textareaRef.current
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 144) + 'px' }
  }

  function insertMention(profile: Profile) {
    const cursorPos = textareaRef.current?.selectionStart ?? content.length
    const before = content.slice(0, cursorPos).replace(/@\w*$/, '')
    const after  = content.slice(cursorPos)
    const newContent = before + `@${profile.full_name} ` + after
    const newCursor  = before.length + `@${profile.full_name} `.length
    setContent(newContent)
    setMentions(prev => [...new Set([...prev, profile.id])])
    setMentionSearch(null)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursor, newCursor)
      }
    }, 0)
  }

  /** Round-9: insert "@all" — fans out to channel members at send time. */
  function insertAtAll() {
    const cursorPos = textareaRef.current?.selectionStart ?? content.length
    const before = content.slice(0, cursorPos).replace(/@\w*$/, '')
    const after  = content.slice(cursorPos)
    const newContent = before + `@all ` + after
    const newCursor  = before.length + `@all `.length
    setContent(newContent)
    setGroupMarkers(prev => prev.some(m => m.kind === 'all') ? prev : [...prev, { kind: 'all' }])
    setMentionSearch(null)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursor, newCursor)
      }
    }, 0)
  }

  /** Round-9: insert "@<groupname>" — fans out to user_group members at send. */
  function insertAtGroup(group: { id: string; name: string }) {
    const cursorPos = textareaRef.current?.selectionStart ?? content.length
    const before = content.slice(0, cursorPos).replace(/@\w*$/, '')
    const after  = content.slice(cursorPos)
    // Replace whitespace in group name with hyphen so the @<token> stays a single word
    const tokenName = group.name.replace(/\s+/g, '-')
    const newContent = before + `@${tokenName} ` + after
    const newCursor  = before.length + `@${tokenName} `.length
    setContent(newContent)
    setGroupMarkers(prev => prev.some(m => m.kind === 'group' && m.id === group.id)
      ? prev
      : [...prev, { kind: 'group', id: group.id, name: tokenName }])
    setMentionSearch(null)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursor, newCursor)
      }
    }, 0)
  }

  /** Round-9: at send time, expand @all + @group markers to user UUIDs. */
  async function expandGroupMarkersToUserIds(): Promise<string[]> {
    if (groupMarkers.length === 0) return []
    const ids = new Set<string>()
    for (const m of groupMarkers) {
      if (m.kind === 'all') {
        // Channel context: if private, restrict to chat_channel_members; else everyone
        if (contextType === 'channel') {
          const { data: ch } = await supabase
            .from('chat_channels')
            .select('is_private')
            .eq('id', contextId)
            .maybeSingle()
          if (ch?.is_private) {
            const { data } = await supabase
              .from('chat_channel_members')
              .select('user_id').eq('channel_id', contextId)
            for (const r of data ?? []) ids.add((r as any).user_id)
          } else {
            const { data } = await supabase.from('profiles').select('id')
            for (const r of data ?? []) ids.add((r as any).id)
          }
        } else {
          const { data } = await supabase.from('profiles').select('id')
          for (const r of data ?? []) ids.add((r as any).id)
        }
      } else if (m.kind === 'group') {
        const { data } = await supabase
          .from('user_group_members')
          .select('user_id').eq('group_id', m.id)
        for (const r of data ?? []) ids.add((r as any).user_id)
      }
    }
    // Don't notify the sender themselves
    if (user?.id) ids.delete(user.id)
    return Array.from(ids)
  }

  function selectBotFromDropdown(bot: BotOption) {
    const cursorPos = textareaRef.current?.selectionStart ?? content.length
    const before = content.slice(0, cursorPos).replace(/@[^@\n]*$/, '')
    const after  = content.slice(cursorPos)
    const newContent = before + `@${bot.name} ` + after
    const newCursor  = before.length + `@${bot.name} `.length
    setContent(newContent)
    setSelectedBot(bot)
    setMentionSearch(null)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursor, newCursor)
      }
    }, 0)
  }

  function selectWorkflowFromDropdown(template: { id: string; name: string }) {
    setContent('')
    setWorkflowSearch(null)
    setPreselectedWorkflowId(template.id)
    setWorkflowModalOpen(true)
  }

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find(i => i.type.startsWith('image/'))
    if (!imageItem) return
    e.preventDefault()
    const file = imageItem.getAsFile()
    if (!file) return
    const previewUrl = URL.createObjectURL(file)
    setPendingFiles(prev => [...prev, { file, previewUrl }])
  }, [])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    const withPreview = files.map(f => ({
      file: f,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
    }))
    setPendingFiles(prev => [...prev, ...withPreview])
    e.target.value = ''
  }

  function removePendingFile(idx: number) {
    setPendingFiles(prev => {
      const copy = [...prev]
      if (copy[idx].previewUrl) URL.revokeObjectURL(copy[idx].previewUrl!)
      copy.splice(idx, 1)
      return copy
    })
  }

  async function uploadFile(file: File): Promise<string> {
    const date = new Date().toISOString().slice(0, 10)
    const ext  = file.name.split('.').pop()
    const path = `${contextId}/${date}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('chat-attachments').upload(path, file)
    if (error) throw error
    const { data: { publicUrl } } = supabase.storage.from('chat-attachments').getPublicUrl(path)
    return publicUrl
  }

  /** Round-7b/3 — post a sticker as a rich-card chat message. */
  async function sendSticker(s: Sticker) {
    if (!user) {
      toastError('Bạn cần đăng nhập để gửi sticker.')
      return
    }
    try {
      const { error } = await supabase.from('chat_messages').insert({
        context_type: contextType,
        context_id:   contextId,
        author_id:    user.id,
        message_type: 'rich_card',
        content:      null,
        payload: { kind: 'sticker', url: s.url, alt: s.alt },
      })
      if (error) throw error
      // Refetch immediately so the sender sees the sticker without waiting
      // for realtime (which may be delayed or RLS-filtered).
      qc.invalidateQueries({ queryKey: ['messages', contextId] })
    } catch (err) {
      const msg = (err as Error).message
      console.error('[sendSticker] insert failed:', msg)
      toastError('Không gửi được sticker: ' + msg)
    }
  }

  async function handleSend() {
    const isRichContent = richMode && /<(img|p|h[1-3]|ul|ol|strong|em|span)/i.test(content)
    const trimmed = content.trim()
    if (!trimmed && pendingFiles.length === 0) return
    if (!user) return
    setSending(true)
    try {
      // Resolve bot query — reply context takes priority over typed selection
      let botQuery: string | null = null
      let activeBotPanelId: string | null = null
      let historyMessages: { role: 'user' | 'assistant'; content: string }[] | null = null

      if (isSelfChat && botReplyContext) {
        // Reply-to-bot mode: use pre-built history from MessageFeed
        const q = trimmed
        if (q) {
          botQuery = q
          activeBotPanelId = botReplyContext.panelId
          historyMessages = [...botReplyContext.history, { role: 'user' as const, content: q }]
        }
      } else if (selectedBot) {
        // Round-10: bot prefix recognised in every chat (not just self-chat).
        const prefix = `@${selectedBot.name}`
        if (trimmed.startsWith(prefix)) {
          const q = trimmed.slice(prefix.length).trimStart()
          if (q) {
            botQuery = q
            activeBotPanelId = selectedBot.panelId
          }
        }
      }
      // Fallback: legacy /bot or @bot without picker (e.g. typed manually).
      // Now active in every chat (Round-10).
      if (botQuery === null) {
        const legacyMatch = trimmed.match(/^[@/]bot\s+([\s\S]+)/i)
        if (legacyMatch) {
          botQuery = legacyMatch[1].trim()
          activeBotPanelId = null
        }
      }

      console.log('[MessageInput] send — isSelfChat:', isSelfChat, 'botQuery:', botQuery, 'panelId:', activeBotPanelId, 'withHistory:', !!historyMessages)

      // Round-9: expand @all / @groupname markers into individual user IDs
      // BEFORE insert so fan_out_mentions trigger fires for each.
      const expandedIds = await expandGroupMarkersToUserIds()
      const finalMentions = Array.from(new Set([...mentions, ...expandedIds]))

      // Post the user message (stored as-is including @BotName prefix)
      const stored = isRichContent ? content : trimmed
      const insertRow: Record<string, unknown> = {
        context_type: contextType,
        context_id:   contextId,
        author_id:    user.id,
        message_type: 'text',
        content:      stored || null,
        mentions:     finalMentions,
      }
      // Round-9: thread reply — set parent_id when replying
      if (replyingToMsg?.id) insertRow.parent_id = replyingToMsg.id
      const { data: msg, error: msgErr } = await supabase
        .from('chat_messages')
        .insert(insertRow as any)
        .select()
        .single()
      if (msgErr) throw msgErr

      if (pendingFiles.length > 0) {
        const uploads = await Promise.all(pendingFiles.map(async pf => {
          const url = await uploadFile(pf.file)
          return {
            message_id: msg.id,
            file_name:  pf.file.name,
            file_url:   url,
            file_type:  pf.file.type,
            file_size:  pf.file.size,
          }
        }))
        await supabase.from('chat_attachments').insert(uploads)
      }

      setContent('')
      setMentions([])
      setGroupMarkers([])
      setPendingFiles([])
      setSelectedBot(null)
      setMentionSearch(null)
      setResetSignal(s => s + 1)
      onClearBotReply?.()
      onClearReplyTo?.()
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      qc.invalidateQueries({ queryKey: ['messages', contextId] })

      // If bot was invoked, call edge function
      if (botQuery !== null) {
        console.log('[Bot] invoking personal-bot — panelId:', activeBotPanelId, 'query:', botQuery, 'historyLen:', historyMessages?.length ?? 1)

        // Use pre-built reply history (from reply-to-bot) or just the single current query
        const messages = historyMessages ?? [{ role: 'user' as const, content: botQuery }]

        const { error: fnErr } = await supabase.functions.invoke('personal-bot', {
          body: {
            context_type: contextType,
            context_id:   contextId,
            messages,
            panel_id:     activeBotPanelId,
            user_id:      user.id,
          },
        })
        if (fnErr) {
          // Extract the actual error body from the 500 response for better diagnostics
          let detail = fnErr.message ?? 'unknown'
          try {
            const body = await (fnErr as any).context?.json?.()
            if (body?.error) detail = body.error
          } catch {}
          console.error('[Bot] edge function error — detail:', detail, fnErr)
          toastError(detail.includes('LLM_API_KEY')
            ? 'Bot chưa được cấu hình: LLM_API_KEY chưa set trong Supabase Secrets.'
            : `Bot lỗi: ${detail}`)
        } else {
          console.log('[Bot] edge function invoked successfully')
        }
        qc.invalidateQueries({ queryKey: ['messages', contextId] })
      }
    } catch (err) {
      console.error('[MessageInput] send error:', err)
      toastError('Không thể gửi tin nhắn')
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setMentionSearch(null); setWorkflowSearch(null); return }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
    <div className="border-t border-neutral-100 p-3 relative">

      {/* Workflow slash command dropdown */}
      {workflowResults.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-neutral-200 rounded-lg shadow-lg overflow-hidden z-10">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 px-3 pt-2 pb-1">
            Chạy workflow — <span className="normal-case font-normal">Enter để chọn</span>
          </p>
          {workflowResults.map(t => (
            <button
              key={t.id}
              onClick={() => selectWorkflowFromDropdown(t)}
              className="w-full text-left px-3 py-2 hover:bg-primary-50 hover:text-primary-700 flex items-start gap-2"
            >
              <GitBranch size={13} className="text-primary-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm text-neutral-800 truncate">{t.name}</p>
                {t.description && (
                  <p className="text-[11px] text-neutral-400 truncate">{t.description}</p>
                )}
              </div>
            </button>
          ))}
          {workflowSearch !== '' && workflowTemplates.length > 0 && workflowResults.length === 0 && (
            <p className="px-3 py-2 text-sm text-neutral-400 italic">Không tìm thấy workflow</p>
          )}
        </div>
      )}

      {/* Bot picker dropdown (personal channel only) */}
      {botResults.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-neutral-200 rounded-lg shadow-lg overflow-hidden z-10">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 px-3 pt-2 pb-1">
            Chọn bot
          </p>
          {botResults.map(bot => (
            <button
              key={bot.id}
              onClick={() => selectBotFromDropdown(bot)}
              className="w-full text-left px-3 py-2 text-sm text-neutral-700 hover:bg-primary-50 hover:text-primary-700 flex items-center gap-2"
            >
              <Bot size={13} className="text-primary-400 shrink-0" />
              <span>{bot.name}</span>
              {bot.id === 'general' && (
                <span className="text-[10px] text-neutral-400 ml-auto">Mặc định</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* User mention dropdown (non-personal channels) — Round-9 includes @all + @group */}
      {(showAtAll || groupResults.length > 0 || mentionResults.length > 0) && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-neutral-200 rounded-lg shadow-lg overflow-hidden z-10 max-h-72 overflow-y-auto">
          {showAtAll && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 bg-neutral-50 border-b border-neutral-100">
                Cả nhóm
              </div>
              <button
                onClick={insertAtAll}
                className="w-full text-left px-3 py-2 text-sm text-purple-700 hover:bg-purple-50 flex items-center gap-2"
              >
                <span className="font-semibold">@all</span>
                <span className="text-[11px] text-neutral-500">Gửi thông báo cho tất cả thành viên trong kênh</span>
              </button>
            </>
          )}
          {groupResults.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 bg-neutral-50 border-y border-neutral-100">
                Nhóm thành viên
              </div>
              {groupResults.map(g => (
                <button
                  key={g.id}
                  onClick={() => insertAtGroup(g)}
                  className="w-full text-left px-3 py-2 text-sm text-purple-700 hover:bg-purple-50 flex items-center gap-2"
                >
                  <span className="font-semibold">@{g.name.replace(/\s+/g, '-')}</span>
                  <span className="text-[11px] text-neutral-500 truncate">{g.name}</span>
                </button>
              ))}
            </>
          )}
          {mentionResults.length > 0 && (
            <>
              {(showAtAll || groupResults.length > 0) && (
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 bg-neutral-50 border-y border-neutral-100">
                  Cá nhân
                </div>
              )}
              {mentionResults.map(p => (
                <button
                  key={p.id}
                  onClick={() => insertMention(p)}
                  className="w-full text-left px-3 py-2 text-sm text-neutral-700 hover:bg-primary-50 hover:text-primary-700"
                >
                  {p.full_name}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Pending file previews */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {pendingFiles.map((pf, i) => (
            <div key={i} className="relative group">
              {pf.previewUrl ? (
                <img src={pf.previewUrl} alt="" className="w-14 h-14 object-cover rounded-lg border border-neutral-200" />
              ) : (
                <div className="w-14 h-14 rounded-lg border border-neutral-200 bg-neutral-50 flex items-center justify-center">
                  <Paperclip size={16} className="text-neutral-400" />
                </div>
              )}
              <button
                onClick={() => removePendingFile(i)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Round-9: thread reply chip */}
      {replyingToMsg && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <div className="flex items-center gap-1 text-[11px] text-primary-700 bg-primary-50 border border-primary-200 rounded-full px-2 py-0.5 max-w-[420px]">
            <CornerDownLeft size={10} className="shrink-0" />
            <span className="truncate">
              Trả lời <strong>{replyingToMsg.authorName}</strong>: <em className="text-neutral-500">{replyingToMsg.preview || '...'}</em>
            </span>
            <button
              onClick={() => { onClearReplyTo?.(); setTimeout(() => textareaRef.current?.focus(), 0) }}
              className="ml-0.5 text-primary-400 hover:text-primary-700"
            >
              <X size={9} />
            </button>
          </div>
        </div>
      )}

      {/* Reply-to-bot indicator chip */}
      {botReplyContext && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <div className="flex items-center gap-1 text-[11px] text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">
            <CornerDownLeft size={10} className="shrink-0" />
            <span>Trả lời @{botReplyContext.botName}</span>
            <button
              onClick={() => { onClearBotReply?.(); setTimeout(() => textareaRef.current?.focus(), 0) }}
              className="ml-0.5 text-violet-400 hover:text-violet-700"
            >
              <X size={9} />
            </button>
          </div>
          <span className="text-[10px] text-neutral-400">
            {botReplyContext.history.length > 0
              ? `${botReplyContext.history.length / 2} cặp Q&A · Nhập và Enter`
              : 'Nhập câu hỏi và nhấn Enter'}
          </span>
        </div>
      )}

      {/* Selected bot indicator chip */}
      {selectedBot && !botReplyContext && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <div className="flex items-center gap-1 text-[11px] text-primary-600 bg-primary-50 border border-primary-100 rounded-full px-2 py-0.5">
            <Bot size={10} className="shrink-0" />
            <span>{selectedBot.name}</span>
            <button
              onClick={() => {
                setSelectedBot(null)
                setContent('')
                setTimeout(() => textareaRef.current?.focus(), 0)
              }}
              className="ml-0.5 text-primary-400 hover:text-primary-700"
            >
              <X size={9} />
            </button>
          </div>
          <span className="text-[10px] text-neutral-400">Nhập câu hỏi và nhấn Enter</span>
        </div>
      )}

      {/* Input + actions */}
      <div className={`flex ${richMode ? 'flex-col' : 'items-end'} gap-2`}>
        {richMode ? (
          <RichTextEditor
            value={content}
            onChange={setContent}
            placeholder="Soạn tin nhắn — định dạng đầy đủ, paste ảnh trực tiếp…"
            uploadPrefix={`chat/${contextId}`}
            onSubmit={handleSend}
            initialMode="rich"
            hideToggle
            minHeight={120}
            resetSignal={resetSignal}
            className="flex-1"
          />
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={isSelfChat
              ? 'Nhập ghi chú… hoặc @ để chọn bot AI (Enter gửi)'
              : 'Nhập tin nhắn… (Enter gửi · Shift+Enter xuống dòng · @ tag người)'
            }
            rows={1}
            className="flex-1 resize-none border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-3 py-2 text-sm font-serif bg-white overflow-hidden"
            style={{ maxHeight: '144px' }}
          />
        )}

        <div className={`flex items-center gap-1 ${richMode ? 'justify-end' : ''}`}>

          {/* ── Desktop action buttons ── */}
          <div className="hidden md:flex items-center gap-1">
            <button
              type="button"
              onClick={() => setRichMode(m => !m)}
              className={`transition-colors p-1.5 rounded-lg ${
                richMode ? 'text-primary-600 bg-primary-50' : 'text-neutral-400 hover:text-neutral-700'
              }`}
              title={richMode ? 'Thoát rich text' : 'Chuyển sang rich text'}
            >
              <Type size={18} />
            </button>

            <button
              onClick={() => setWorkflowModalOpen(true)}
              className="text-neutral-400 hover:text-neutral-700 transition-colors p-1.5"
              title="Chạy nghiệp vụ"
            >
              <GitBranch size={18} />
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-neutral-400 hover:text-neutral-700 transition-colors p-1.5"
              title="Đính kèm file"
            >
              <Paperclip size={18} />
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setStickerPickerOpen(v => !v)}
                className={`transition-colors p-1.5 rounded-lg ${
                  stickerPickerOpen ? 'text-primary-600 bg-primary-50' : 'text-neutral-400 hover:text-neutral-700'
                }`}
                title="Sticker"
              >
                <Smile size={18} />
              </button>
              <StickerPicker
                open={stickerPickerOpen}
                onClose={() => setStickerPickerOpen(false)}
                onPick={sendSticker}
                anchorClassName="bottom-full right-0 mb-2"
              />
            </div>
          </div>

          {/* ── Mobile menu ── */}
          <div ref={mobileMenuRef} className="md:hidden relative">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(v => !v)}
              className={`transition-colors p-2 rounded-lg ${
                mobileMenuOpen ? 'text-primary-600 bg-primary-50' : 'text-neutral-500 hover:text-neutral-700'
              }`}
              title="Thêm"
            >
              <MoreHorizontal size={20} />
            </button>

            {mobileMenuOpen && (
              <div className="absolute bottom-full mb-1 right-0 w-52 bg-white border border-neutral-200 shadow-xl rounded-xl overflow-hidden z-20">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 px-3 pt-2.5 pb-1">
                  Thêm vào tin nhắn
                </p>
                <button
                  onClick={() => { setMobileMenuOpen(false); setWorkflowModalOpen(true) }}
                  className="w-full text-left px-3 py-2.5 text-sm text-neutral-700 hover:bg-primary-50 hover:text-primary-700 flex items-center gap-2.5"
                >
                  <GitBranch size={16} className="text-primary-500 shrink-0" />
                  <span>Chạy Workflow</span>
                </button>
                <button
                  onClick={() => { setMobileMenuOpen(false); fileInputRef.current?.click() }}
                  className="w-full text-left px-3 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 flex items-center gap-2.5"
                >
                  <Paperclip size={16} className="text-neutral-400 shrink-0" />
                  <span>Đính kèm file</span>
                </button>
                <button
                  onClick={() => { setMobileMenuOpen(false); setStickerPickerOpen(true) }}
                  className="w-full text-left px-3 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 flex items-center gap-2.5"
                >
                  <Smile size={16} className="text-neutral-400 shrink-0" />
                  <span>Sticker</span>
                </button>
              </div>
            )}
          </div>

          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />

          <button
            onClick={handleSend}
            disabled={sending || (!content.trim() && pendingFiles.length === 0)}
            className="bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 rounded-lg p-2 transition-colors ml-1"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>

    <StartWorkflowFromChatModal
      open={workflowModalOpen}
      onClose={() => { setWorkflowModalOpen(false); setPreselectedWorkflowId(null) }}
      contextType={contextType}
      contextId={contextId}
      initialTemplateId={preselectedWorkflowId ?? undefined}
    />
    </>
  )
}
