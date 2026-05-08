/**
 * StickerPicker — popover grid of stickers shown above the chat input.
 *
 * Round-7b/3 (post-fix). Click a sticker → calls `onPick(sticker)` then
 * closes via setTimeout(0) so React's synthetic-event handler completes
 * before unmounting.
 *
 * Click-outside listener uses a small mounting delay so the same click
 * that opened the picker doesn't immediately close it.
 */
import { memo, useEffect, useRef, useState } from 'react'
import { STICKERS, STICKER_CATEGORIES } from '../../lib/stickers'
import type { Sticker, StickerCategory } from '../../lib/stickers'

interface Props {
  open: boolean
  onClose: () => void
  onPick: (sticker: Sticker) => void
  /** Optional anchor positioning (default: pops up from bottom-right of caller). */
  anchorClassName?: string
}

export default memo(function StickerPicker({ open, onClose, onPick, anchorClassName = '' }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [activeCat, setActiveCat] = useState<StickerCategory>(STICKER_CATEGORIES[0])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    function handleClickOutside(e: MouseEvent) {
      if (cancelled) return
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    // Defer adding the click-outside listener until the next tick so the
    // very click that opened the picker doesn't immediately re-close it.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)
    document.addEventListener('keydown', handleKey)
    return () => {
      cancelled = true
      clearTimeout(t)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open, onClose])

  if (!open) return null

  const visible = STICKERS.filter(s => (s.category ?? 'Khác') === activeCat)

  return (
    <div
      ref={ref}
      className={`absolute z-40 bg-white border border-neutral-200 rounded-lg shadow-lg p-2 w-[300px] max-h-[340px] flex flex-col ${anchorClassName}`}
      // Stop bubbling — defensive against parent handlers that might close.
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Category tabs — only render when more than one set ships */}
      {STICKER_CATEGORIES.length > 1 && (
        <div className="flex gap-1 mb-2 border-b border-neutral-100 pb-1.5">
          {STICKER_CATEGORIES.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCat(cat)}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                activeCat === cat
                  ? 'bg-primary-100 text-primary-700 font-semibold'
                  : 'text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Sticker grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-3 gap-1.5">
          {visible.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onPick(s)
                // Defer close to next tick so synthetic event finishes first.
                setTimeout(() => onClose(), 0)
              }}
              className="border border-transparent hover:border-primary-300 hover:bg-primary-50/30 rounded p-1 transition-colors"
              title={s.alt}
            >
              <img
                src={s.url}
                alt={s.alt}
                loading="lazy"
                className="w-full aspect-square object-contain pointer-events-none"
                onError={(e) => {
                  // If a meme template ever 404s, hide the broken thumb gracefully.
                  const el = e.currentTarget
                  el.style.opacity = '0.3'
                  el.title = el.title + ' (không tải được)'
                }}
              />
            </button>
          ))}
          {visible.length === 0 && (
            <p className="col-span-3 text-[11px] text-neutral-400 italic text-center py-6">
              Không có sticker.
            </p>
          )}
        </div>
      </div>

      <p className="text-[9px] text-neutral-400 italic mt-1.5 text-center">
        Bộ sticker · Ami
      </p>
    </div>
  )
})
