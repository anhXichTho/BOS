/**
 * ChannelSearchBox — collapsible search input for the active channel /
 * project thread / DM. Round-9.
 *
 * Click the magnifier icon → input expands. Type a query → results list
 * appears below. Click a result → onSelect(msgId). Esc closes.
 */
import { useState, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { searchMessages, highlightMatch, type SearchHit } from '../../lib/searchMessages'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'

interface Props {
  contextId: string
  onSelect: (msgId: string) => void
}

export default function ChannelSearchBox({ contextId, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Reset when channel changes
  useEffect(() => {
    setQuery('')
    setHits([])
    setOpen(false)
  }, [contextId])

  // Debounced fetch
  useEffect(() => {
    if (!open) return
    if (query.trim().length < 2) {
      setHits([])
      setLoading(false)
      return
    }
    setLoading(true)
    const t = setTimeout(async () => {
      const results = await searchMessages(query, { contextId, limit: 30 })
      setHits(results)
      setLoading(false)
    }, 250)
    return () => clearTimeout(t)
  }, [query, contextId, open])

  // Esc closes
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Click outside closes
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`p-1.5 rounded transition-colors ${open ? 'bg-primary-50 text-primary-700' : 'text-neutral-500 hover:bg-neutral-100'}`}
        title="Tìm trong kênh này"
      >
        <Search size={14} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-80 bg-white border border-neutral-200 rounded shadow-lg">
          <div className="relative p-2 border-b border-neutral-100">
            <Search size={12} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm trong kênh..."
              className="w-full pl-7 pr-7 py-1.5 text-[12px] border border-neutral-200 rounded bg-white focus:outline-none focus:border-primary-300 focus:ring-1 focus:ring-primary-100 placeholder:text-neutral-400"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setHits([]) }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-neutral-400 hover:text-neutral-600"
                title="Xoá"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {loading && <p className="px-3 py-2 text-[11px] text-neutral-400">Đang tìm...</p>}
            {!loading && query.trim().length >= 2 && hits.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-neutral-400 italic">Không có kết quả.</p>
            )}
            {!loading && hits.map(h => (
              <button
                key={h.id}
                onClick={() => { onSelect(h.id); setOpen(false) }}
                className="w-full text-left px-3 py-2 hover:bg-neutral-50 border-t border-neutral-50 first:border-t-0"
              >
                <p className="text-[12px] text-neutral-800 line-clamp-2">
                  {highlightMatch(h.content ?? '', query).map((seg, i) =>
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
        </div>
      )}
    </div>
  )
}
