import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, MessageCircleQuestion, Bot, Send, Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { HelperPanel, HelperFaqItem } from '../../types'

interface Props {
  panelId: string
}

/**
 * Read-only runtime view for a helper panel — shown alongside a workflow run.
 * - FAQ panels: list of Q&A with smart-ish search (full-text + word-token fallback).
 * - Chatbot panels: chat UI scaffold; actual LLM call is gated behind an env var
 *   and handled by a future edge function.
 */
export default function HelperPanelView({ panelId }: Props) {
  const { data: panel, isLoading } = useQuery({
    queryKey: ['helper-panel', panelId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('helper_panels')
        .select('*')
        .eq('id', panelId)
        .maybeSingle()
      if (error) throw error
      return data as HelperPanel | null
    },
  })

  if (isLoading) {
    return <div className="text-xs text-neutral-400 p-3">Đang tải helper…</div>
  }
  if (!panel) {
    return <div className="text-xs text-neutral-400 p-3">Không tìm thấy helper.</div>
  }

  return panel.type === 'faq'
    ? <FaqView panel={panel} />
    : <ChatbotView panel={panel} />
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

function tokenize(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function FaqView({ panel }: { panel: HelperPanel }) {
  const [query, setQuery] = useState('')

  const { data: items = [] } = useQuery({
    queryKey: ['helper-faq', panel.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('helper_faq_items')
        .select('*')
        .eq('panel_id', panel.id)
        .order('order_index')
      if (error) throw error
      return data as HelperFaqItem[]
    },
  })

  /**
   * Lightweight "smart-ish" matching:
   * - Tokenise both query and Q+A.
   * - A FAQ item matches when at least one query token is a prefix of any item token.
   * - Score = number of matching tokens, ties broken by Q match > A match.
   *
   * This isn't true semantic search but feels closer than substring matching,
   * and ships without an embeddings dependency. Real semantic upgrade lives in
   * the helper_faq_items_fts index (full-text) + embeddings — to be wired later.
   */
  const ranked = useMemo(() => {
    const q = tokenize(query)
    if (q.length === 0) return items
    return items
      .map(item => {
        const qTokens = tokenize(item.question)
        const aTokens = tokenize(item.answer)
        let score = 0
        for (const qt of q) {
          if (qTokens.some(t => t.startsWith(qt))) score += 2
          else if (aTokens.some(t => t.startsWith(qt))) score += 1
        }
        return { item, score }
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.item)
  }, [items, query])

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-neutral-100 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <MessageCircleQuestion size={14} className="text-primary-600" />
          <span className="text-sm font-medium text-neutral-800">{panel.name}</span>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-300" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Tìm trong FAQ…"
            className="w-full text-xs pl-7 pr-2 py-1.5 border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg bg-white"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {ranked.length === 0 ? (
          <p className="text-xs text-neutral-400">
            {query ? 'Không tìm thấy câu phù hợp.' : 'Chưa có FAQ nào.'}
          </p>
        ) : ranked.map(item => (
          <details key={item.id} className="bg-white border border-neutral-100 rounded-lg overflow-hidden group">
            <summary className="px-3 py-2 cursor-pointer text-xs font-medium text-neutral-800 hover:bg-neutral-25 list-none flex items-center justify-between">
              <span>{item.question}</span>
              <span className="text-neutral-300 group-open:rotate-180 transition-transform">▾</span>
            </summary>
            <div className="px-3 pb-3 pt-1 text-xs text-neutral-600 whitespace-pre-wrap border-t border-neutral-100">
              {item.answer}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

// ─── Chatbot scaffold ─────────────────────────────────────────────────────────

interface Msg { role: 'user' | 'assistant'; content: string }

function ChatbotView({ panel }: { panel: HelperPanel }) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function send() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    const nextMessages: Msg[] = [...messages, { role: 'user' as const, content: text }]
    setMessages(nextMessages)
    setThinking(true)

    try {
      // Calls the `chat-helper` edge function. Returns a single (non-streamed)
      // assistant message; streaming can be added later via Server-Sent Events.
      const { data, error } = await supabase.functions.invoke('chat-helper', {
        body: { panel_id: panel.id, messages: nextMessages },
      })
      if (error) throw error
      const reply = (data as { reply?: string })?.reply
        ?? '(Không nhận được phản hồi từ AI.)'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (err: any) {
      // Fall back to an explanatory message so the user knows what to fix.
      const detail = err?.message ?? String(err)
      const isMissingFn = /not found|404/i.test(detail)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: isMissingFn
          ? 'AI chưa được kết nối. Cần deploy Supabase Edge Function `chat-helper` và set secret `LLM_API_KEY`. Xem `supabase/functions/chat-helper/index.ts` để biết hướng dẫn.'
          : `Lỗi gọi AI: ${detail}`,
      }])
    } finally {
      setThinking(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-neutral-100 shrink-0">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-violet-600" />
          <span className="text-sm font-medium text-neutral-800">{panel.name}</span>
          <Sparkles size={11} className="text-amber-500" />
        </div>
        {panel.description && <p className="text-[11px] text-neutral-500 mt-0.5">{panel.description}</p>}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-xs text-neutral-400 text-center py-6">
            Hỏi gì đó về workflow để bắt đầu…
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-xs rounded-lg px-3 py-2 max-w-[90%] ${
              m.role === 'user'
                ? 'bg-primary-50 text-primary-800 ml-auto'
                : 'bg-neutral-50 text-neutral-700 mr-auto'
            }`}
          >
            {m.content}
          </div>
        ))}
        {thinking && (
          <div className="text-xs bg-neutral-50 text-neutral-400 rounded-lg px-3 py-2 mr-auto">
            <span className="animate-pulse">Đang suy nghĩ…</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={e => { e.preventDefault(); send() }}
        className="border-t border-neutral-100 p-2 flex gap-1.5 shrink-0"
      >
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Hỏi chatbot…"
          className="flex-1 text-xs border border-neutral-200 focus:border-primary-400 focus:outline-none rounded-lg px-2.5 py-1.5 bg-white"
        />
        <button
          type="submit"
          disabled={!draft.trim() || thinking}
          className="bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 px-2.5 py-1.5 rounded-lg"
        >
          <Send size={12} />
        </button>
      </form>
    </div>
  )
}
