/**
 * GlobalSearchBox — sidebar-mounted message search across all visible
 * channels + project threads + DMs. Round-9.
 *
 * Behaviour:
 *  - Debounced 250 ms.
 *  - Shows results grouped by context (channel name OR project title).
 *  - Click a result → calls onSelectHit({ contextType, contextId, name, msgId }).
 *  - ChatPage handles the navigation: setActive(...) + scrollToMessageId.
 *  - Esc / click-outside closes the dropdown.
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, X } from 'lucide-react'
import { searchMessages, highlightMatch, type SearchHit } from '../../lib/searchMessages'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'

export interface SearchHitContext {
  contextType: 'channel' | 'project'
  contextId:   string
  name:        string             // channel name OR project title
  msgId:       string
}

interface Props {
  onSelectHit: (ctx: SearchHitContext) => void
  /** Optional resolver: given a DM channel name (literal "DM"), return the
   *  partner's full name. Lets the dropdown show partner names instead of
   *  the literal "DM" string for DM hits. */
  resolveChannelName?: (channelId: string, fallback: string) => string
}

/** Strip HTML tags and decode basic entities for plain-text search previews. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ').trim()
}

export default function GlobalSearchBox({ onSelectHit, resolveChannelName }: Props) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Debounce
  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    const t = setTimeout(async () => {
      const results = await searchMessages(query, { limit: 30 })
      setHits(results)
      setLoading(false)
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  // Click outside / Esc to close
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Group hits by (context_type, context_id)
  const groups = useMemo(() => {
    const m = new Map<string, { type: 'channel' | 'project'; id: string; name: string; hits: SearchHit[] }>()
    for (const h of hits) {
      const key = `${h.context_type}:${h.context_id}`
      if (!m.has(key)) {
        const baseName = h.context_type === 'channel'
          ? (h.channel_name ?? 'Kênh')
          : (h.project_title ?? 'Dự án')
        const name = resolveChannelName && h.context_type === 'channel'
          ? resolveChannelName(h.context_id, baseName)
          : baseName
        m.set(key, { type: h.context_type as 'channel' | 'project', id: h.context_id, name, hits: [] })
      }
      m.get(key)!.hits.push(h)
    }
    return Array.from(m.values())
  }, [hits, resolveChannelName])

  return (
    <div ref={wrapRef} className="px-3 py-2 relative">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Tìm trong tất cả tin nhắn..."
          className="w-full pl-8 pr-7 py-1.5 text-[12px] border border-neutral-200 rounded bg-white focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-100 placeholder:text-neutral-400"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setHits([]); setOpen(false) }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-neutral-400 hover:text-neutral-600"
            title="Xoá"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute left-3 right-3 top-full mt-1 z-30 bg-white border border-neutral-200 rounded shadow-lg max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="px-3 py-2 text-[11px] text-neutral-400">Đang tìm...</div>
          )}
          {!loading && hits.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-neutral-400 italic">Không có kết quả.</div>
          )}
          {!loading && groups.map(g => (
            <div key={`${g.type}:${g.id}`} className="border-b border-neutral-100 last:border-b-0">
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 bg-neutral-50">
                {g.type === 'channel' ? '# ' : '📁 '}{g.name}
                <span className="ml-1 text-neutral-400 font-normal normal-case">· {g.hits.length}</span>
              </div>
              {g.hits.map(h => (
                <button
                  key={h.id}
                  onClick={() => {
                    onSelectHit({ contextType: g.type, contextId: g.id, name: g.name, msgId: h.id })
                    setOpen(false)
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-neutral-50 border-t border-neutral-50 first:border-t-0"
                >
                  <p className="text-[12px] text-neutral-800 line-clamp-2">
                    {highlightMatch(stripHtml(h.content ?? ''), query).map((seg, i) =>
                      seg.match
                        ? <mark key={i} className="bg-yellow-100 text-neutral-900 rounded-sm px-0.5">{seg.text}</mark>
                        : <span key={i}>{seg.text}</span>
                    )}
                  </p>
                  <p className="text-[10px] text-neutral-400 mt-0.5">
                    {h.author_name ?? 'Hệ thống'} · {formatDistanceToNow(new Date(h.created_at), { addSuffix: true, locale: vi })}
                  </p>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
